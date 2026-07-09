import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { fixturesDir, validateEvent, type EventEnvelope } from "@fairy/protocol";
import { MemoryStore } from "@fairy/memory";
import { assertNoRawAudioPayloads } from "@fairy/voice";
import {
  assertSchemaValidStream,
  MockFairyClient,
  MockOpenAIChatServer
} from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

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

const runVoiceLoopback = async (
  client: MockFairyClient,
  sid: string,
  script: Record<string, unknown>
): Promise<readonly EventEnvelope[]> => {
  const before = client.events().length;
  client.sendRaw({ op: "voice.loopback", script, sid });
  await client.waitFor((event) =>
    event.sid === sid &&
    event.type === "speech.mark" &&
    client.events().indexOf(event) >= before &&
    payloadRecord(event).mark_id === "turn-boundary",
  60000);
  return client.events().slice(before);
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

afterEach(async () => {
  await provider?.stop();
  provider = undefined;
  await fallback?.stop();
  fallback = undefined;
});

describe("voice.protocol-loopback-v0", () => {
  it("validates registered speech fixtures and loopback event ordering", async () => {
    for (const name of [
      "speech.asr.partial.valid.json",
      "speech.asr.final.valid.json",
      "speech.tts.chunk.valid.json",
      "speech.mark.valid.json"
    ]) {
      expect(validateEvent(JSON.parse(readFileSync(join(fixturesDir, name), "utf8")))).toMatchObject({ ok: true, known: true });
    }

    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden plan"],
      text: ["visible voice answer"],
      usage: { completion_tokens: 4, prompt_tokens: 6, total_tokens: 10 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-loopback-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-loopback-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice loopback");
      const events = await runVoiceLoopback(client, created.sid, {
        partials: ["voice", "voice hello"],
        text: "voice hello",
        utterance_id: "utt_e2e"
      });
      client.close();

      expect(events.map((event) => event.type)).toEqual([
        "speech.mark",
        "speech.asr.partial",
        "speech.asr.partial",
        "speech.asr.final",
        "speech.mark",
        "turn.input",
        "context.manifest",
        "reasoning.delta",
        "turn.delta",
        "turn.final",
        "speech.mark",
        "speech.tts.chunk",
        "speech.mark",
        "speech.mark"
      ]);
      expect(events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: { text: "voice hello", utterance_id: "utt_e2e" },
        provenance: "user"
      });
      expect(events.find((event) => event.type === "turn.input")).toMatchObject({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        payload: {
          channel: "voice",
          routing_hints: { prefer_local: true },
          speech: { utterance_id: "utt_e2e" }
        },
        provenance: "user"
      });
      expect(provider.requests).toBe(1);
      expect(JSON.stringify(provider.requestBodies[0])).toContain("voice hello");
      expect(events.filter((event) => event.type === "turn.input")).toHaveLength(1);
      expect(events.filter((event) => event.type === "speech.tts.chunk").map((event) => payloadRecord(event).text)).toEqual(["visible voice answer"]);
      expect(JSON.stringify(events.filter((event) => event.type === "speech.tts.chunk"))).not.toContain("hidden plan");
      assertNoRawAudioPayloads(events);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, 90_000);

  it("routes spoken secret content away from an under-cleared primary", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["primary should not be called"] });
    fallback = await MockOpenAIChatServer.start({ text: ["local fallback voice answer"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-secret-route-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-secret-route-token";
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
      ]
    });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice secret route");
      const events = await runVoiceLoopback(client, created.sid, {
        text: "API_KEY=sk_test_1234567890abcdef",
        utterance_id: "utt_secret"
      });
      client.close();

      expect(provider.requests).toBe(0);
      expect(fallback.requests).toBe(1);
      expect(events.find((event) => event.type === "speech.asr.final")).toMatchObject({
        labels: { residency: "local-only", sensitivity: "secret" }
      });
      expect(events.find((event) => event.type === "turn.input")).toMatchObject({
        labels: { residency: "local-only", sensitivity: "secret" }
      });
      expect(events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "route-denied")).toMatchObject({
        payload: { model_id: "mock-main" }
      });
      expect(payloadText(events.find((event) => event.type === "turn.final"))).toBe("local fallback voice answer");
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, 90_000);

  it("inherits MemoryGate admission and secret-deny behavior for voice turns", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["memory path reached"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-memory-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-memory-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("voice memory");
      const safeEvents = await runVoiceLoopback(client, created.sid, {
        text: "remember that favorite editor is Helix",
        utterance_id: "utt_memory_safe"
      });
      const secretEvents = await runVoiceLoopback(client, created.sid, {
        text: "remember that API_KEY=sk_test_1234567890abcdef",
        utterance_id: "utt_memory_secret"
      });
      client.close();

      expect(safeEvents.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "hold", reason: "personal_default_hold" }
      });
      expect(safeEvents.some((event) => event.type === "memory.written")).toBe(false);
      expect(secretEvents.find((event) => event.type === "memory.gate.decision")).toMatchObject({
        payload: { decision: "deny", reason: "secret_denied" }
      });
      expect(secretEvents.some((event) => event.type === "memory.written")).toBe(false);
      expect(new MemoryStore(dataDir).list()).toEqual([]);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  }, 90_000);

  it("blocks spoken secret egress and keeps TTS on visible final text only", async () => {
    const outbound = await startCountingHttpServer();
    provider = await MockOpenAIChatServer.start({ text: ["primary should not be called"] });
    fallback = await MockOpenAIChatServer.start();
    fallback.enqueueScript({
      reasoning: ["hidden local plan"],
      toolCalls: [{ id: "call_voice_secret_web", name: "web.fetch", args: { url: `${outbound.url}?token=sk_test_1234567890abcdef` } }]
    });
    fallback.enqueueScript({
      reasoning: ["hidden after denial"],
      text: ["visible egress blocked"]
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-egress-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "voice-egress-token";
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
      const created = await client.createSession("voice egress");
      const events = await runVoiceLoopback(client, created.sid, {
        text: "Use API_KEY=sk_test_1234567890abcdef only in local reasoning.",
        utterance_id: "utt_egress"
      });
      client.close();

      expect(outbound.requests()).toBe(0);
      expect(provider.requests).toBe(0);
      expect(fallback.requests).toBe(2);
      expect(events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "egress.denied")).toMatchObject({
        payload: { reason_code: "api_key", tool: "web.fetch" }
      });
      expect(events.find((event) => event.type === "tool.result" && payloadRecord(event).call_id === "call_voice_secret_web")).toMatchObject({
        payload: {
          denied_by_policy: true,
          egress: { label_class: "secret", reason_code: "api_key" },
          reason_code: "egress_denied",
          status: "error"
        }
      });
      const ttsText = events.filter((event) => event.type === "speech.tts.chunk").map((event) => String(payloadRecord(event).text)).join("");
      expect(ttsText).toBe("visible egress blocked");
      expect(ttsText).not.toContain("hidden");
      expect(ttsText).not.toContain("sk_test_1234567890abcdef");
      expect(JSON.stringify(events.filter((event) => !["turn.input", "speech.asr.partial", "speech.asr.final"].includes(event.type)))).not.toContain("sk_test_1234567890abcdef");

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
      expect(replay.stdout).toContain("speech.asr.final utt_egress");
      expect(replay.stdout).toContain("speech.tts.chunk utt_egress:tts:001 visible egress blocked");
      expect(replay.stdout).not.toContain("sk_test_1234567890abcdef");

      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).not.toContain("data:audio/");
      assertNoRawAudioPayloads(events);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
      await outbound.close();
    }
  }, 90_000);
});
