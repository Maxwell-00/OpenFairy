import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@fairy/memory";
import type { EventEnvelope } from "@fairy/protocol";
import { assertNoRawAudioPayloads } from "@fairy/voice";
import {
  decodeSpeechWorkerWireMessage,
  encodeSpeechWorkerWireMessage,
  SpeechWorkerProcess,
  validateSpeechWorkerWireMessage,
  type SpeechWorkerWireMessage
} from "../../../apps/gateway/src/speech-worker-process.js";
import { assertSchemaValidStream, MockFairyClient, MockOpenAIChatServer } from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const speechWorkerDir = join(repoRoot, "workers", "speech");
const WORKER_E2E_TIMEOUT_MS = 120_000;
const LOCAL_DEADLINE_MS = 10_000;

type GatewayProcess = ChildProcessByStdio<null, Readable, Readable>;

let provider: MockOpenAIChatServer | undefined;
let fallback: MockOpenAIChatServer | undefined;

const withDeadline = async <T>(label: string, promise: Promise<T>, timeoutMs = LOCAL_DEADLINE_MS): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const waitForProcessGone = async (pid: number): Promise<void> => {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await withDeadline(`process ${pid} exit`, new Promise<void>((resolvePromise) => {
      timer = setInterval(() => {
        if (!processExists(pid)) {
          resolvePromise();
        }
      }, 10);
    }), 5_000);
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
};

const waitForGateway = (process: GatewayProcess): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`gateway did not start in time\n${output}`)), 30_000);
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
      reject(new Error(`gateway exited before startup with code ${String(code)}\n${output}`));
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
  await withDeadline("gateway shutdown", new Promise<void>((resolvePromise) => process.once("exit", () => resolvePromise())), 20_000);
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
      ? ["permissions:", "  ask_timeout_s: 3", "  rules:", ...options.permissions]
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

const runVoiceWorker = async (
  client: MockFairyClient,
  sid: string,
  script: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<{ ack: Record<string, unknown>; events: readonly EventEnvelope[] }> => {
  const beforeEvents = client.events().length;
  const beforeFrames = client.frames().length;
  client.sendRaw({ op: "voice.worker", script, sid });
  const ack = await client.waitForFrame((frame) =>
    frame.kind === "ack" && frame.op === "voice.worker" && client.frames().indexOf(frame) >= beforeFrames,
  timeoutMs);
  return {
    ack: ack as Record<string, unknown>,
    events: client.events().slice(beforeEvents)
  };
};

const runReplay = (sid: string, dataDir: string): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin/fairy.ts", "replay", sid, "--data-dir", dataDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    timeout: 30_000,
    windowsHide: true
  });

const startCountingHttpServer = async (): Promise<{ close: () => Promise<void>; requests: () => number; url: string }> => {
  let requests = 0;
  const server: Server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("mock outbound response");
  });
  await withDeadline("outbound server listen", new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  }));
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("mock outbound server did not bind");
  }
  return {
    close: () => withDeadline("outbound server close", new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))),
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

describe("voice.worker-process-v0", () => {
  it("validates the NDJSON wire, discovers Python, and exercises handshake, ASR, TTS, cancel, shutdown, and redaction", async () => {
    const valid = JSON.parse(readFileSync(join(speechWorkerDir, "fixtures", "wire.valid.json"), "utf8")) as unknown[];
    const invalid = JSON.parse(readFileSync(join(speechWorkerDir, "fixtures", "wire.invalid.json"), "utf8")) as unknown[];
    for (const message of valid) {
      expect(validateSpeechWorkerWireMessage(message)).toMatchObject({ ok: true });
    }
    for (const message of invalid) {
      expect(validateSpeechWorkerWireMessage(message)).toMatchObject({ ok: false });
    }
    const stable: SpeechWorkerWireMessage = {
      audio_ref: "fixture://audio/stable",
      final: "stable final",
      kind: "asr.script",
      partials: ["stable"],
      request_id: "req-stable",
      utterance_id: "utt-stable"
    };
    const encoded = encodeSpeechWorkerWireMessage(stable);
    expect(encoded).not.toContain("\n");
    expect(decodeSpeechWorkerWireMessage(`${encoded}\r`)).toEqual(stable);
    expect(validateSpeechWorkerWireMessage({ ...stable, audio_ref: "data:audio/wav;base64,AAAA" })).toMatchObject({ ok: false });
    expect(validateSpeechWorkerWireMessage({ ...stable, extra: true })).toMatchObject({ ok: false });

    const workerFilesBefore = (await readdir(speechWorkerDir, { recursive: true })).map(String).sort();
    const worker = new SpeechWorkerProcess();
    const ready = await worker.start();
    const pid = ready.processId;
    expect(ready).toMatchObject({
      capabilities: expect.arrayContaining(["asr.script", "tts.script", "cancel", "shutdown"]),
      interpreter: {
        argv0: expect.any(String),
        source: "discovered",
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
      },
      pythonVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      workerId: "speech-mock-v0"
    });
    const partials: string[] = [];
    const asr = await worker.requestAsr({
      audioRef: "fixture://audio/utt-unit",
      final: "unit final",
      partials: ["unit", "unit final"],
      requestId: "req-unit-asr",
      utteranceId: "utt-unit"
    }, (partial) => {
      partials.push(partial);
    });
    expect(asr).toMatchObject({ cancelled: false, text: "unit final", utteranceId: "utt-unit" });
    expect(partials).toEqual(["unit", "unit final"]);
    const chunks: string[] = [];
    const tts = await worker.requestTts({
      chunkChars: 4,
      requestId: "req-unit-tts",
      text: "visible answer",
      utteranceId: "utt-unit"
    }, (chunk) => {
      chunks.push(chunk.text);
    });
    expect(tts.chunks).toHaveLength(4);
    expect(chunks.join("")).toBe("visible answer");
    await expect(worker.requestAsr({
      audioRef: "data:audio/wav;base64,AAAA",
      final: "must be rejected",
      partials: [],
      requestId: "req-raw-audio",
      utteranceId: "utt-raw-audio"
    })).rejects.toMatchObject({ code: "SPEECH_WORKER_WIRE_INVALID" });
    await worker.shutdown();
    expect(worker.isAlive()).toBe(false);
    await waitForProcessGone(pid);
    expect((await readdir(speechWorkerDir, { recursive: true })).map(String).sort()).toEqual(workerFilesBefore);

    const cancelling = new SpeechWorkerProcess();
    const cancellingReady = await cancelling.start();
    const pendingAsr = cancelling.requestAsr({
      audioRef: "fixture://audio/utt-cancel",
      final: "must not finalize",
      mockBehavior: "wait",
      partials: ["cancel me"],
      requestId: "req-cancel-asr",
      utteranceId: "utt-cancel"
    });
    await cancelling.cancel("req-cancel", "req-cancel-asr", "asr");
    expect(await pendingAsr).toMatchObject({ cancelled: true });
    await cancelling.shutdown();
    await waitForProcessGone(cancellingReady.processId);

    const originalOverride = process.env.FAIRY_TEST_PYTHON;
    process.env.FAIRY_TEST_PYTHON = ready.interpreter.argv0;
    const overridden = new SpeechWorkerProcess();
    if (originalOverride === undefined) {
      delete process.env.FAIRY_TEST_PYTHON;
    } else {
      process.env.FAIRY_TEST_PYTHON = originalOverride;
    }
    const overrideReady = await overridden.start();
    expect(overrideReady.interpreter).toMatchObject({ argv0: ready.interpreter.argv0, source: "test-override" });
    await overridden.shutdown();
    await waitForProcessGone(overrideReady.processId);

    const noisy = new SpeechWorkerProcess({ testMode: "stderr-secret" });
    const noisyReady = await noisy.start();
    expect(noisy.stderrDiagnostic()).toContain("[REDACTED:");
    expect(noisy.stderrDiagnostic()).not.toContain("sk_test_1234567890abcdef");
    await noisy.shutdown();
    await waitForProcessGone(noisyReady.processId);

    const startupTimeout = new SpeechWorkerProcess({
      deadlines: { cancellationMs: 1_000, handshakeMs: 100 },
      testMode: "startup-timeout"
    });
    await expect(startupTimeout.start()).rejects.toMatchObject({ code: "SPEECH_WORKER_HANDSHAKE_TIMEOUT" });
    expect(startupTimeout.isAlive()).toBe(false);

    const malformedStartup = new SpeechWorkerProcess({
      deadlines: { cancellationMs: 1_000, handshakeMs: 1_000 },
      testMode: "malformed-startup"
    });
    await expect(malformedStartup.start()).rejects.toMatchObject({
      code: expect.stringMatching(/SPEECH_WORKER_(MALFORMED_OUTPUT|PROTOCOL_FAILED)/)
    });
    expect(malformedStartup.isAlive()).toBe(false);

    const killed = new SpeechWorkerProcess({ deadlines: { cancellationMs: 1_000, requestMs: 2_000 } });
    const killedReady = await killed.start();
    const killedRequest = killed.requestAsr({
      audioRef: "fixture://audio/utt-killed",
      final: "must not finalize",
      mockBehavior: "wait",
      partials: ["before crash"],
      requestId: "req-killed-asr",
      utteranceId: "utt-killed"
    });
    await killed.terminateForTest("kill actual worker child");
    await expect(killedRequest).rejects.toMatchObject({ code: "SPEECH_WORKER_EXITED" });
    expect(killed.isAlive()).toBe(false);
    await waitForProcessGone(killedReady.processId);

    const pythonSource = await readFile(join(speechWorkerDir, "mock_worker.py"), "utf8");
    expect([...pythonSource].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(pythonSource).toContain("sys.stdout.buffer.write(encoded_message + b\"\\n\")");
    expect(pythonSource).toContain("sys.stdout.buffer.flush()");
    expect(pythonSource).not.toMatch(/\bprint\s*\(/);
    expect(pythonSource).not.toMatch(/^\s*(?:from|import)\s+(?:socket|subprocess|requests|urllib|pyaudio|sounddevice)\b/m);
    expect(pythonSource).not.toMatch(/\b(?:microphone|speaker|pip\s+install|deepgram|elevenlabs|openai)\b/i);
    expect(pythonSource).not.toMatch(/\bopen\s*\(/);
    const supervisorSource = await readFile(join(repoRoot, "apps", "gateway", "src", "speech-worker-process.ts"), "utf8");
    expect(supervisorSource).toContain("shell: false");
    expect(supervisorSource).not.toContain("shell: true");
    expect(supervisorSource).toContain('"-u"');
    expect(supervisorSource).toContain('line.endsWith("\\r")');
    expect(supervisorSource).toContain('child.stdout.on("data"');
    expect(supervisorSource).toContain('child.stderr.on("data"');
    expect((supervisorSource.match(/FAIRY_TEST_PYTHON/g) ?? [])).toHaveLength(1);
    expect(readFileSync(join(repoRoot, "packages", "voice", "src", "index.ts"), "utf8")).not.toContain("node:child_process");
  }, WORKER_E2E_TIMEOUT_MS);

  it("runs one worker-backed final through TurnRunner and keeps TTS output-only and replayable", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden worker reasoning"],
      text: ["visible worker answer"],
      usage: { completion_tokens: 4, prompt_tokens: 6, total_tokens: 10 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-worker-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-worker-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice worker");
      const { ack, events } = await runVoiceWorker(client, created.sid, {
        frame_labels: { residency: "global-ok", sensitivity: "public" },
        partials: ["worker", "worker hello"],
        text: "worker hello",
        utterance_id: "utt_worker_e2e"
      });
      client.close();

      expect(ack).toMatchObject({
        cancelled: false,
        error_status: "none",
        interpreter: {
          argv0: expect.any(String),
          source: expect.stringMatching(/^(?:discovered|test-override)$/),
          version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
        },
        model_request_count: 1,
        python_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        request_ids: {
          asr: "worker-asr:utt_worker_e2e",
          cancel: null,
          tts: "worker-tts:utt_worker_e2e"
        },
        transcript_text: "worker hello",
        tts_chunk_count: 1,
        worker_id: "speech-mock-v0",
        worker_process_id: expect.any(Number)
      });
      expect(ack.deadlines_ms).toMatchObject({ cancellationMs: expect.any(Number), discoveryMs: expect.any(Number), handshakeMs: expect.any(Number), processStartupMs: expect.any(Number), requestMs: expect.any(Number), shutdownMs: expect.any(Number) });
      await waitForProcessGone(Number(ack.worker_process_id));
      expect(events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: { text: "worker hello", utterance_id: "utt_worker_e2e" },
        provenance: "user"
      });
      expect(events.find((event) => event.type === "turn.input")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: {
          channel: "voice",
          routing_hints: { prefer_local: true },
          speech: { utterance_id: "utt_worker_e2e" }
        },
        provenance: "user"
      });
      expect(events.filter((event) => event.type === "turn.input")).toHaveLength(1);
      expect(events.findIndex((event) => event.type === "speech.asr.final")).toBeLessThan(events.findIndex((event) => event.type === "turn.input"));
      expect(events.filter((event) => event.type === "speech.asr.partial")).toHaveLength(2);
      expect(provider.requests).toBe(1);
      expect(JSON.stringify(provider.requestBodies[0])).toContain("worker hello");
      const ttsText = events.filter((event) => event.type === "speech.tts.chunk").map((event) => String(payloadRecord(event).text)).join("");
      expect(ttsText).toBe("visible worker answer");
      expect(ttsText).not.toContain("hidden worker reasoning");
      expect(payloadText(events.find((event) => event.type === "turn.final"))).toBe(ttsText);

      const replay = runReplay(created.sid, dataDir);
      expect(replay.status, String(replay.stderr)).toBe(0);
      expect(replay.stdout).toContain("speech.asr.final utt_worker_e2e worker hello");
      expect(replay.stdout).toContain("speech.tts.chunk utt_worker_e2e:tts:001 visible worker answer");
      expect(replay.stdout).not.toContain("hidden worker reasoning");
      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).not.toContain("asr.script");
      expect(rawLog).not.toContain("tts.script");
      expect(rawLog).not.toContain("speech.worker.");
      expect(rawLog).not.toContain("data:audio/");
      expect(rawLog).not.toMatch(/[A-Za-z0-9+/]{120,}={0,2}/);
      assertNoRawAudioPayloads(events);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, WORKER_E2E_TIMEOUT_MS);

  it("keeps cancel, crash, malformed output, and timeout paths turn-free, child-free, and replayable", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["must not be called"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-worker-failures-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-worker-failure-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice worker failures");
      const cancelled = await runVoiceWorker(client, created.sid, {
        cancel_asr_before_final: true,
        partials: ["cancel before final"],
        text: "cancelled text must not enter model context",
        utterance_id: "utt_worker_cancel"
      });
      expect(cancelled.ack).toMatchObject({ cancelled: true, error_status: "none", model_request_count: 0, transcript_text: "", tts_chunk_count: 0 });
      expect(cancelled.events.map((event) => event.type)).toEqual(["speech.mark", "speech.asr.partial", "speech.mark"]);
      expect(cancelled.events.at(-1)).toMatchObject({ payload: { mark_id: "asr-cancelled" }, type: "speech.mark" });

      for (const failure of [
        { behavior: "crash", expected: "SPEECH_WORKER_EXITED", id: "crash" },
        { behavior: "malformed", expected: "SPEECH_WORKER_MALFORMED_OUTPUT", id: "malformed" },
        { behavior: "wait", expected: "SPEECH_WORKER_REQUEST_TIMEOUT", id: "timeout" }
      ] as const) {
        const result = await runVoiceWorker(client, created.sid, {
          partials: [`before ${failure.id}`],
          text: `failure ${failure.id} must not enter model context`,
          utterance_id: `utt_worker_${failure.id}`,
          worker_behavior: failure.behavior
        }, failure.behavior === "wait" ? 30_000 : 10_000);
        expect(String(result.ack.error_status)).toContain(failure.expected);
        expect(result.ack).toMatchObject({ cancelled: false, model_request_count: 0, transcript_text: "", tts_chunk_count: 0 });
        expect(result.events.some((event) => event.type === "turn.input")).toBe(false);
        expect(result.events.some((event) => event.type === "speech.asr.final")).toBe(false);
        expect(result.events.find((event) => event.type === "progress.update")).toMatchObject({
          payload: { stage: "voice.worker.failed" },
          type: "progress.update"
        });
        expect(JSON.stringify(result.events.filter((event) => event.type === "progress.update"))).not.toContain(`failure ${failure.id} must not enter model context`);
        expect(result.events.every((event) => !event.type.startsWith("speech.worker.") && !event.type.startsWith("voice.worker."))).toBe(true);
        await waitForProcessGone(Number(result.ack.worker_process_id));
      }
      client.close();

      expect(provider.requests).toBe(0);
      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).not.toContain('"type":"turn.input"');
      expect(rawLog).not.toContain('"type":"speech.asr.final"');
      expect(rawLog).not.toContain('"type":"speech.worker.');
      expect(rawLog).not.toContain('"type":"voice.worker.');
      expect(rawLog).not.toContain("asr.script");
      expect(rawLog).not.toContain("tts.script");
      expect(rawLog).toContain('"stage":"voice.worker.failed"');
      const replay = runReplay(created.sid, dataDir);
      expect(replay.status, String(replay.stderr)).toBe(0);
      expect(replay.stdout).not.toContain("turn.input");
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, WORKER_E2E_TIMEOUT_MS);

  it("inherits route clearance, MemoryGate, egress redaction, and visible-only TTS", async () => {
    const outbound = await startCountingHttpServer();
    provider = await MockOpenAIChatServer.start({ text: ["safe memory handled"] });
    fallback = await MockOpenAIChatServer.start();
    fallback.enqueueScript({ text: ["secret memory handled"] });
    fallback.enqueueScript({
      reasoning: ["hidden local worker tool plan"],
      toolCalls: [{ id: "call_worker_secret_web", name: "web.fetch", args: { url: `${outbound.url}?token=sk_test_1234567890abcdef` } }]
    });
    fallback.enqueueScript({ reasoning: ["hidden after worker denial"], text: ["visible worker egress blocked"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-worker-trust-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-worker-trust-token";
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
      mainRole: ["    model: mock-main", "    fallback: [mock-local]"],
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
      const created = await client.createSession("voice worker trust");
      const safeMemory = await runVoiceWorker(client, created.sid, {
        frame_labels: { residency: "global-ok", sensitivity: "public" },
        text: "remember that favorite terminal is WezTerm",
        utterance_id: "utt_worker_memory_safe"
      });
      const primaryAfterSafe = provider.requests;
      const fallbackBeforeSecret = fallback.requests;
      const secretMemory = await runVoiceWorker(client, created.sid, {
        text: "remember that API_KEY=sk_test_1234567890abcdef",
        utterance_id: "utt_worker_memory_secret"
      });
      const primaryBeforeEgress = provider.requests;
      const fallbackBeforeEgress = fallback.requests;
      const egress = await runVoiceWorker(client, created.sid, {
        text: "Use API_KEY=sk_test_1234567890abcdef only in local reasoning.",
        utterance_id: "utt_worker_egress"
      });
      client.close();

      expect(safeMemory.events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" }
      });
      expect(safeMemory.events.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "hold", reason: "personal_default_hold" }
      });
      expect(safeMemory.events.some((event) => event.type === "memory.written")).toBe(false);
      expect(secretMemory.events.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "deny", reason: "secret_denied" }
      });
      expect(secretMemory.events.some((event) => event.type === "memory.written")).toBe(false);
      expect(primaryAfterSafe).toBe(1);
      expect(primaryBeforeEgress).toBe(primaryAfterSafe);
      expect(provider.requests).toBe(primaryBeforeEgress);
      expect(fallbackBeforeEgress - fallbackBeforeSecret).toBe(1);
      expect(payloadText(secretMemory.events.find((event) => event.type === "turn.final"))).toBe("secret memory handled");
      expect(new MemoryStore(dataDir).list()).toEqual([]);

      expect(outbound.requests()).toBe(0);
      expect(provider.requests).toBe(primaryBeforeEgress);
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
      expect(egress.events.find((event) => event.type === "tool.result" && payloadRecord(event).call_id === "call_worker_secret_web")).toMatchObject({
        payload: { denied_by_policy: true, reason_code: "egress_denied", status: "error" }
      });
      const ttsText = egress.events.filter((event) => event.type === "speech.tts.chunk").map((event) => String(payloadRecord(event).text)).join("");
      expect(ttsText).toBe("visible worker egress blocked");
      expect(ttsText).not.toContain("hidden");
      expect(ttsText).not.toContain("sk_test_1234567890abcdef");
      expect(ttsText).not.toContain("egress.denied");
      expect(ttsText).not.toContain("route-denied");
      expect(ttsText).not.toContain("call_worker_secret_web");
      expect(JSON.stringify(egress.events.filter((event) => !["turn.input", "speech.asr.partial", "speech.asr.final"].includes(event.type)))).not.toContain("sk_test_1234567890abcdef");
      expect(payloadText(egress.events.find((event) => event.type === "turn.final"))).toBe(ttsText);
      for (const result of [safeMemory, secretMemory, egress]) {
        expect(result.ack.error_status).toBe("none");
        await waitForProcessGone(Number(result.ack.worker_process_id));
      }
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
      await outbound.close();
    }
  }, WORKER_E2E_TIMEOUT_MS);
});
