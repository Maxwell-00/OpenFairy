import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@fairy/memory";
import type { EventEnvelope } from "@fairy/protocol";
import {
  assertNoRawAudioPayloads,
  clampVoiceFrameLabels,
  createVoiceDuplexPair,
  decodeVoiceControlFrame,
  encodeVoiceControlFrame,
  MockSpeechDuplexWorker,
  normalizeLoopbackScript,
  validateVoiceAudioFrame,
  validateVoiceControlFrame,
  voiceAudioFrameMetadata,
  type VoiceControlFrame
} from "@fairy/voice";
import {
  assertSchemaValidStream,
  MockFairyClient,
  MockOpenAIChatServer
} from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const VOICE_DUPLEX_E2E_TIMEOUT_MS = 90_000;

type GatewayProcess = ChildProcessByStdio<null, Readable, Readable>;

let provider: MockOpenAIChatServer | undefined;
let fallback: MockOpenAIChatServer | undefined;

const waitForGateway = (process: GatewayProcess): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`gateway did not start in time\n${output}`));
    }, 30000);

    process.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/gateway\.started (\{.*\})/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolvePromise((JSON.parse(match[1]) as { port: number }).port);
      }
    });

    process.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`gateway exited before startup with code ${code}\n${output}`));
    });
  });

const startGateway = (configPath: string): GatewayProcess =>
  spawn(process.execPath, ["--import", "tsx", "apps/gateway/src/bin/gateway.ts", "--config", configPath], {
    cwd: repoRoot,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });

const stopGateway = async (process: GatewayProcess): Promise<void> => {
  if (process.exitCode !== null) {
    return;
  }
  process.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => process.once("exit", () => resolvePromise()));
};

const writeConfig = (path: string, dataDir: string, token: string, baseUrl: string, options: {
  readonly extraModels?: readonly string[];
  readonly mainRole?: readonly string[];
  readonly modelClearance?: readonly string[];
  readonly permissions?: readonly string[];
} = {}): void => {
  writeFileSync(path, [
    "models:",
    "  - id: mock-main",
    "    transport: openai-chat",
    `    base_url: ${JSON.stringify(baseUrl)}`,
    "    model: mock-model",
    ...(options.modelClearance ?? [
      "    data_clearance:",
      "      max_sensitivity: personal",
      "      residency: [region-restricted]",
      "      regions: [cn]"
    ]),
    ...(options.extraModels ?? []),
    "roles:",
    "  main:",
    ...(options.mainRole ?? ["    model: mock-main"]),
    "gateway:",
    "  port: 0",
    "  watchdog_s: 2",
    `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
    "  auth:",
    `    token: ${JSON.stringify(token)}`,
    "governance:",
    "  profile: balanced",
    "  home_regions: [cn]",
    "persona:",
    "  enabled: false",
    "affect:",
    "  enabled: false",
    ...(options.permissions
      ? [
          "permissions:",
          "  ask_timeout_s: 3",
          "  rules:",
          ...options.permissions
        ]
      : [])
  ].join("\n"), "utf8");
};

const payloadRecord = (event: EventEnvelope): Record<string, unknown> =>
  event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};

const payloadText = (event: EventEnvelope | undefined): string => {
  const payload = event ? payloadRecord(event) : {};
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((part) => part && typeof part === "object" && "kind" in part && part.kind === "text" && "text" in part && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
};

const runVoiceDuplex = async (
  client: MockFairyClient,
  sid: string,
  script: Record<string, unknown>
): Promise<{ ack: Record<string, unknown>; events: readonly EventEnvelope[] }> => {
  const beforeEvents = client.events().length;
  const beforeFrames = client.frames().length;
  client.sendRaw({ op: "voice.duplex", script, sid });
  const ack = await client.waitForFrame((frame) =>
    frame.kind === "ack" &&
    frame.op === "voice.duplex" &&
    client.frames().indexOf(frame) >= beforeFrames,
  60000);
  return {
    ack: ack as Record<string, unknown>,
    events: client.events().slice(beforeEvents)
  };
};

const startCountingHttpServer = async (): Promise<{ close: () => Promise<void>; requests: () => number; url: string }> => {
  let requests = 0;
  const server: Server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("mock outbound response");
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("mock outbound server did not bind");
  }
  return {
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
    requests: () => requests,
    url: `http://127.0.0.1:${address.port}/collect`
  };
};

afterEach(async () => {
  await provider?.stop();
  provider = undefined;
  await fallback?.stop();
  fallback = undefined;
});

describe("voice.duplex-transport-v0", () => {
  it("covers frame codec, in-memory transport, mock worker, and no raw audio serialization", async () => {
    const control: VoiceControlFrame = {
      audio_ref: "duplex://audio/utt_suite",
      kind: "utterance.start",
      labels: { residency: "global-ok", sensitivity: "public" },
      stream_id: "stream_suite",
      utterance_id: "utt_suite"
    };
    expect(validateVoiceControlFrame(control)).toMatchObject({ ok: true });
    expect(decodeVoiceControlFrame(encodeVoiceControlFrame(control))).toEqual(control);
    expect(validateVoiceControlFrame({ kind: "speech.worker.fake" })).toMatchObject({ ok: false });
    expect(validateVoiceAudioFrame({
      data: new Uint8Array(70_000),
      sequence: 0,
      stream_id: "stream_suite"
    })).toMatchObject({ ok: false });

    const [coordinator, workerSide] = createVoiceDuplexPair({ maxQueueFrames: 8 });
    const frames: VoiceControlFrame[] = [];
    const worker = new MockSpeechDuplexWorker(workerSide, normalizeLoopbackScript({
      partials: ["duplex"],
      text: "duplex suite request",
      utterance_id: "utt_suite"
    }), { pauseTtsAfterChunks: 1, ttsChunkChars: 7 });
    coordinator.onControl((frame) => {
      frames.push(frame);
    });

    await coordinator.sendControl(control);
    await coordinator.sendAudio({ data: Uint8Array.from([1, 2, 3]), sequence: 0, stream_id: "stream_suite" });
    await coordinator.sendAudio({ data: Uint8Array.from([4]), final: true, sequence: 1, stream_id: "stream_suite" });
    await coordinator.sendControl({
      kind: "tts.request",
      labels: { residency: "region-restricted", sensitivity: "personal" },
      text: "visible worker answer",
      utterance_id: "utt_suite"
    });
    await coordinator.sendControl({ kind: "cancel", reason: "stop tts", target: "tts" });
    await worker.flushPendingTts();

    expect(frames.some((frame) => frame.kind === "asr.final")).toBe(true);
    expect(frames.filter((frame) => frame.kind === "tts.chunk")).toHaveLength(1);
    expect(JSON.stringify(voiceAudioFrameMetadata({ data: Uint8Array.from([1, 2, 3]), sequence: 0, stream_id: "stream_suite" }))).not.toContain("AQID");
    expect(clampVoiceFrameLabels(
      { residency: "region-restricted", sensitivity: "personal" },
      { residency: "global-ok", sensitivity: "public" }
    )).toEqual({ residency: "region-restricted", sensitivity: "personal" });
  });

  it("runs ASR final through the normal TurnRunner path once and clamps frame labels", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden duplex reasoning"],
      text: ["visible duplex answer"],
      usage: { completion_tokens: 4, prompt_tokens: 6, total_tokens: 10 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-duplex-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-duplex-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice duplex");
      const { ack, events } = await runVoiceDuplex(client, created.sid, {
        audio_frame_bytes: [8, 8],
        frame_labels: { residency: "global-ok", sensitivity: "public" },
        partials: ["duplex", "duplex hello"],
        text: "duplex hello",
        utterance_id: "utt_duplex"
      });
      client.close();

      expect(ack).toMatchObject({
        cancelled: false,
        frame_counts: {
          "control.asr.final": 1,
          "control.asr.partial": 2,
          "control.tts.request": 1,
          audio: 3
        },
        model_request_count: 1,
        transcript_text: "duplex hello",
        tts_chunk_count: 1
      });
      expect(events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: { text: "duplex hello", utterance_id: "utt_duplex" },
        provenance: "user"
      });
      expect(events.find((event) => event.type === "turn.input")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: {
          channel: "voice",
          routing_hints: { prefer_local: true },
          speech: { utterance_id: "utt_duplex" }
        },
        provenance: "user"
      });
      expect(events.findIndex((event) => event.type === "speech.asr.partial")).toBeLessThan(events.findIndex((event) => event.type === "turn.input"));
      expect(events.filter((event) => event.type === "turn.input")).toHaveLength(1);
      expect(provider.requests).toBe(1);
      expect(JSON.stringify(provider.requestBodies[0])).toContain("duplex hello");
      expect(events.filter((event) => event.type === "speech.tts.chunk").map((event) => payloadRecord(event).text)).toEqual(["visible duplex answer"]);
      expect(JSON.stringify(events.filter((event) => event.type === "speech.tts.chunk"))).not.toContain("hidden duplex reasoning");

      const replay = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/bin/fairy.ts",
        "replay",
        created.sid,
        "--data-dir",
        dataDir
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        timeout: 30000,
        windowsHide: true
      });
      expect(replay.status, replay.stderr).toBe(0);
      expect(replay.stdout).toContain("speech.asr.final utt_duplex duplex hello");
      expect(replay.stdout).toContain("speech.tts.chunk utt_duplex:tts:001 visible duplex answer");
      expect(replay.stdout).not.toContain("hidden duplex reasoning");

      const replayJson = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/bin/fairy.ts",
        "replay",
        created.sid,
        "--data-dir",
        dataDir,
        "--json"
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        timeout: 30000,
        windowsHide: true
      });
      expect(replayJson.status, replayJson.stderr).toBe(0);
      expect(replayJson.stdout).toContain("\"type\":\"speech.asr.final\"");

      const manifests = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/bin/fairy.ts",
        "replay",
        created.sid,
        "--data-dir",
        dataDir,
        "--manifests"
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        timeout: 30000,
        windowsHide: true
      });
      expect(manifests.status, manifests.stderr).toBe(0);

      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).not.toContain("voice.frame.");
      expect(rawLog).not.toContain("speech.worker.");
      expect(rawLog).not.toContain("data:audio/");
      expect(rawLog).not.toMatch(/[A-Za-z0-9+/]{120,}={0,2}/);
      assertNoRawAudioPayloads(events);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, VOICE_DUPLEX_E2E_TIMEOUT_MS);

  it("leaves cancelled utterances replayable without turn.input, dangling turns, or model calls", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["should not be called"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-duplex-cancel-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-duplex-cancel-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice duplex cancel");
      const { ack, events } = await runVoiceDuplex(client, created.sid, {
        cancel_asr_before_final: true,
        partials: ["cancel this"],
        text: "this must not enter model context",
        utterance_id: "utt_duplex_cancel"
      });
      client.close();

      expect(ack).toMatchObject({ cancelled: true, model_request_count: 0, transcript_text: "", tts_chunk_count: 0 });
      expect(provider.requests).toBe(0);
      expect(events.map((event) => event.type)).toEqual([
        "speech.mark",
        "speech.asr.partial",
        "speech.mark"
      ]);
      expect(events.some((event) => event.type === "turn.input")).toBe(false);
      expect(events.at(-1)).toMatchObject({ payload: { mark_id: "asr-cancelled" }, type: "speech.mark" });

      const replay = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/bin/fairy.ts",
        "replay",
        created.sid,
        "--data-dir",
        dataDir
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        timeout: 30000,
        windowsHide: true
      });
      expect(replay.status, replay.stderr).toBe(0);
      expect(replay.stdout).toContain("speech.mark asr-cancelled 0ms");
      expect(replay.stdout).not.toContain("turn.input");

      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).not.toContain("\"type\":\"turn.input\"");
      expect(rawLog).not.toContain("voice.frame.");
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, VOICE_DUPLEX_E2E_TIMEOUT_MS);

  it("inherits route clearance, MemoryGate, egress guard, and visible-only TTS", async () => {
    const outbound = await startCountingHttpServer();
    provider = await MockOpenAIChatServer.start({ text: ["primary should not be called"] });
    fallback = await MockOpenAIChatServer.start();
    fallback.enqueueScript({
      text: ["secret memory handled"]
    });
    fallback.enqueueScript({
      reasoning: ["hidden local tool plan"],
      toolCalls: [{ id: "call_duplex_secret_web", name: "web.fetch", args: { url: `${outbound.url}?token=sk_test_1234567890abcdef` } }]
    });
    fallback.enqueueScript({
      reasoning: ["hidden after denial"],
      text: ["visible duplex egress blocked"]
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-duplex-trust-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-duplex-trust-token";
    writeConfig(configPath, dataDir, token, provider.url, {
      extraModels: [
        "  - id: mock-local",
        "    transport: openai-chat",
        `    base_url: ${JSON.stringify(fallback.url)}`,
        "    model: mock-model",
        "    data_clearance:",
        "      max_sensitivity: secret",
        "      residency: [local-only]"
      ],
      mainRole: [
        "    model: mock-main",
        "    fallback: [mock-local]"
      ],
      permissions: [
        "    - tool: \"web.*\"",
        "      decision: allow",
        "    - tool: \"*\"",
        "      decision: deny"
      ]
    });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice duplex trust");
      const safeMemory = await runVoiceDuplex(client, created.sid, {
        text: "remember that favorite terminal is WezTerm",
        utterance_id: "utt_duplex_memory_safe"
      });
      const providerBeforeSecretMemory = provider.requests;
      const fallbackBeforeSecretMemory = fallback.requests;
      const secretMemory = await runVoiceDuplex(client, created.sid, {
        text: "remember that API_KEY=sk_test_1234567890abcdef",
        utterance_id: "utt_duplex_memory_secret"
      });
      const providerBeforeEgress = provider.requests;
      const fallbackBeforeEgress = fallback.requests;
      const egress = await runVoiceDuplex(client, created.sid, {
        text: "Use API_KEY=sk_test_1234567890abcdef only in local reasoning.",
        utterance_id: "utt_duplex_egress"
      });
      client.close();

      expect(safeMemory.events.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "hold", reason: "personal_default_hold" }
      });
      expect(safeMemory.events.some((event) => event.type === "memory.written")).toBe(false);
      expect(secretMemory.events.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "deny", reason: "secret_denied" }
      });
      expect(secretMemory.events.some((event) => event.type === "memory.written")).toBe(false);
      expect(provider.requests).toBe(providerBeforeEgress);
      expect(fallbackBeforeEgress - fallbackBeforeSecretMemory).toBe(1);
      expect(providerBeforeSecretMemory).toBe(1);
      expect(new MemoryStore(dataDir).list()).toEqual([]);

      expect(outbound.requests()).toBe(0);
      expect(provider.requests).toBe(providerBeforeEgress);
      expect(fallback.requests - fallbackBeforeEgress).toBe(2);
      expect(egress.events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "local-only", sensitivity: "secret" }
      });
      expect(egress.events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "route-denied")).toMatchObject({
        payload: { model_id: "mock-main" }
      });
      expect(egress.events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "egress.denied")).toMatchObject({
        payload: { reason_code: "api_key", tool: "web.fetch" }
      });
      expect(egress.events.find((event) => event.type === "tool.result" && payloadRecord(event).call_id === "call_duplex_secret_web")).toMatchObject({
        payload: {
          denied_by_policy: true,
          egress: { label_class: "secret", reason_code: "api_key" },
          reason_code: "egress_denied",
          status: "error"
        }
      });
      const ttsText = egress.events.filter((event) => event.type === "speech.tts.chunk").map((event) => String(payloadRecord(event).text)).join("");
      expect(ttsText).toBe("visible duplex egress blocked");
      expect(ttsText).not.toContain("hidden");
      expect(ttsText).not.toContain("sk_test_1234567890abcdef");
      expect(JSON.stringify(egress.events.filter((event) => !["turn.input", "speech.asr.partial", "speech.asr.final"].includes(event.type)))).not.toContain("sk_test_1234567890abcdef");
      expect(payloadText(egress.events.find((event) => event.type === "turn.final"))).toBe("visible duplex egress blocked");
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
      await outbound.close();
    }
  }, VOICE_DUPLEX_E2E_TIMEOUT_MS);
});
