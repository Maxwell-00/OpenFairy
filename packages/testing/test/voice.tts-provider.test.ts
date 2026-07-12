import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactRegistry } from "@fairy/artifacts";
import { loadConfig } from "@fairy/config";
import type { EventEnvelope, Labels } from "@fairy/protocol";
import {
  assertSupportedSpeechWorkerPythonVersion,
  decodeSpeechWorkerWireMessage,
  encodeSpeechWorkerWireMessage,
  miniMaxEndpointProfiles,
  parseSpeechProviderConfig,
  resolveSpeechWorkerOutput,
  SpeechArtifactValidationError,
  SpeechWorkerProcess,
  SpeechWorkerProcessError,
  validateSpeechWorkerArtifact,
  validateSpeechWorkerWireMessage,
  type MiniMaxTtsProviderConfig,
  type MinimalGatewayTestOptions,
  type SpeechProviderWorkerTestMode,
  type SpeechWorkerTtsChunk
} from "../../../apps/gateway/src/index.js";
import { loadGatewayConfig } from "../../../apps/gateway/src/config.js";
import { MinimalGateway } from "../../../apps/gateway/src/server.js";
import { MockFairyClient, MockOpenAIChatServer } from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TEST_TIMEOUT_MS = 120_000;
const WAIT_TIMEOUT_MS = 10_000;
const fakeCredential = "M305_FAKE_MINIMAX_CREDENTIAL_7F4A2C9D_DO_NOT_USE";
const mp3Fixture = Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
  0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00,
  0x4d, 0x33, 0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00
]);

interface FakeRequest {
  readonly body: Record<string, unknown> | undefined;
  readonly bodyBytes: number;
  readonly headers: IncomingMessage["headers"];
  readonly method?: string;
  readonly path?: string;
  readonly rawBody: string;
}

interface FakePlan {
  readonly body?: Buffer | string | Record<string, unknown>;
  readonly hang?: boolean;
  readonly status?: number;
}

const successEnvelope = (audio = mp3Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  base_resp: { status_code: 0, status_msg: "success" },
  data: { audio: audio.toString("hex"), status: 2 },
  extra_info: {
    audio_channel: 1,
    audio_format: "mp3",
    audio_sample_rate: 32_000,
    audio_size: audio.byteLength,
    bitrate: 128_000
  },
  trace_id: "fake-trace-not-persisted",
  ...overrides
});

const providerErrorEnvelope = (statusCode: number): Record<string, unknown> => ({
  base_resp: { status_code: statusCode, status_msg: `fake error ${statusCode} ${fakeCredential}` },
  data: null
});

const exactKeys = (value: unknown, keys: readonly string[]): boolean =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort()));

class FakeMiniMaxServer {
  readonly requests: FakeRequest[] = [];
  readonly #plans: FakePlan[];
  readonly #server: Server;
  #connections = 0;
  #requestBytes = 0;
  #port = 0;

  private constructor(plans: readonly FakePlan[]) {
    this.#plans = [...plans];
    this.#server = createServer((request, response) => this.#handle(request, response));
    this.#server.on("connection", () => {
      this.#connections += 1;
    });
  }

  static async start(plans: readonly FakePlan[] = [{ body: successEnvelope() }]): Promise<FakeMiniMaxServer> {
    const server = new FakeMiniMaxServer(plans);
    await withDeadline("fake MiniMax listen", new Promise<void>((resolvePromise, reject) => {
      server.#server.once("error", reject);
      server.#server.listen(0, "127.0.0.1", () => {
        server.#server.off("error", reject);
        const address = server.#server.address();
        if (!address || typeof address !== "object") {
          reject(new Error("fake MiniMax did not bind"));
          return;
        }
        server.#port = address.port;
        resolvePromise();
      });
    }));
    return server;
  }

  get port(): number {
    return this.#port;
  }

  get connections(): number {
    return this.#connections;
  }

  get requestBytes(): number {
    return this.#requestBytes;
  }

  enqueue(plan: FakePlan): void {
    this.#plans.push(plan);
  }

  async stop(): Promise<void> {
    this.#server.closeAllConnections?.();
    if (!this.#server.listening) {
      return;
    }
    await withDeadline("fake MiniMax close", new Promise<void>((resolvePromise) => this.#server.close(() => resolvePromise())));
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      this.#requestBytes += chunk.byteLength;
    });
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(rawBody) as unknown;
        body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
      } catch {
        body = undefined;
      }
      this.requests.push({
        body,
        bodyBytes: Buffer.byteLength(rawBody),
        headers: request.headers,
        ...(request.method ? { method: request.method } : {}),
        ...(request.url ? { path: request.url } : {}),
        rawBody
      });
      if (request.headers.authorization !== `Bearer ${fakeCredential}`) {
        this.#respond(response, { body: providerErrorEnvelope(1004) });
        return;
      }
      if (!this.#validSupportedRequest(body)) {
        this.#respond(response, { body: providerErrorEnvelope(2013) });
        return;
      }
      this.#respond(response, this.#plans.shift() ?? { body: successEnvelope() });
    });
  }

  #respond(response: ServerResponse, plan: FakePlan): void {
    if (plan.hang) {
      return;
    }
    const raw = Buffer.isBuffer(plan.body)
      ? plan.body
      : Buffer.from(typeof plan.body === "string" ? plan.body : JSON.stringify(plan.body ?? successEnvelope()), "utf8");
    response.writeHead(plan.status ?? 200, {
      "content-length": raw.byteLength,
      "content-type": "application/json"
    });
    response.end(raw);
  }

  #validSupportedRequest(body: Record<string, unknown> | undefined): boolean {
    if (!body || !exactKeys(body, ["aigc_watermark", "audio_setting", "language_boost", "model", "output_format", "stream", "subtitle_enable", "text", "voice_setting"])) {
      return false;
    }
    const voice = body.voice_setting;
    const audio = body.audio_setting;
    return requestShape(body) &&
      exactKeys(voice, ["pitch", "speed", "voice_id", "vol"]) &&
      exactKeys(audio, ["bitrate", "channel", "format", "sample_rate"]);
  }
}

const requestShape = (body: Record<string, unknown>): boolean =>
  (body.model === "speech-2.8-turbo" || body.model === "speech-2.8-hd") &&
  body.stream === false &&
  body.output_format === "hex" &&
  body.subtitle_enable === false &&
  body.aigc_watermark === false &&
  (body.language_boost === "auto" || body.language_boost === "Chinese" || body.language_boost === "English") &&
  typeof body.text === "string" && body.text.length > 0 && body.text.length <= 3_000;

const withDeadline = async <T>(label: string, promise: Promise<T>, timeoutMs = WAIT_TIMEOUT_MS): Promise<T> => {
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

const waitForCondition = async (label: string, condition: () => boolean, timeoutMs = 5_000): Promise<void> => {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await withDeadline(label, new Promise<void>((resolvePromise) => {
      timer = setInterval(() => {
        if (condition()) {
          resolvePromise();
        }
      }, 10);
    }), timeoutMs);
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
};

interface SpeechProviderFixture {
  readonly endpointProfile?: "cn-primary" | "cn-backup";
  readonly id: string;
  readonly maxSensitivity?: Labels["sensitivity"];
  readonly maxTextChars?: number;
  readonly regions?: readonly string[];
  readonly residency?: readonly Labels["residency"][];
}

const providerBlock = (provider: SpeechProviderFixture): string[] => [
  `  - id: ${provider.id}`,
  "    stage: tts",
  "    transport: minimax-t2a-v2-http",
  `    endpoint_profile: ${provider.endpointProfile ?? "cn-primary"}`,
  "    voice:",
  "      voice_id: male-qn-qingse",
  "      speed: 1",
  "      volume: 1",
  "      pitch: 0",
  "    api_key_ref: secret://minimax_token_plan",
  "    language_boost: auto",
  "    audio:",
  "      format: mp3",
  "      sample_rate: 32000",
  "      bitrate: 128000",
  "      channel: 1",
  "    limits:",
  `      max_text_chars: ${provider.maxTextChars ?? 3000}`,
  "      max_response_bytes: 67108864",
  "      max_audio_bytes: 33554432",
  "    data_clearance:",
  `      max_sensitivity: ${provider.maxSensitivity ?? "personal"}`,
  `      residency: [${(provider.residency ?? ["region-restricted", "global-ok"]).join(", ")}]`,
  ...((provider.regions ?? ["cn"]).length > 0 ? [`      regions: [${(provider.regions ?? ["cn"]).join(", ")}]`] : [])
];

const writeGatewayConfig = async (
  path: string,
  dataDir: string,
  modelUrl: string,
  token: string,
  providers: readonly SpeechProviderFixture[],
  route: readonly string[]
): Promise<void> => {
  await writeFile(path, [
    "models:",
    "  - id: mock-main",
    "    transport: openai-chat",
    `    base_url: ${JSON.stringify(modelUrl)}`,
    "    model: mock-model",
    "    data_clearance:",
    "      max_sensitivity: personal",
    "      residency: [region-restricted]",
    "      regions: [cn]",
    "roles:",
    "  main:",
    "    model: mock-main",
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
    "speech:",
    "  providers:",
    ...providers.flatMap(providerBlock),
    "  roles:",
    "    tts:",
    `      primary: ${route[0] ?? "missing"}`,
    `      fallback: [${route.slice(1).join(", ")}]`
  ].join("\n"), "utf8");
};

const startGateway = async (
  configPath: string,
  testOptions: MinimalGatewayTestOptions
): Promise<{ gateway: MinimalGateway; port: number }> => {
  const config = loadGatewayConfig({ configPath }, repoRoot, { ...process.env, minimax_token_plan: fakeCredential });
  const gateway = new MinimalGateway(config, testOptions);
  const address = await gateway.start();
  return { gateway, port: address.port };
};

const payloadRecord = (event: EventEnvelope): Record<string, unknown> =>
  event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};

const payloadText = (event: EventEnvelope | undefined): string => {
  const content = event && Array.isArray(payloadRecord(event).content) ? payloadRecord(event).content as unknown[] : [];
  return content.map((part) => part && typeof part === "object" && !Array.isArray(part) && (part as Record<string, unknown>).kind === "text"
    ? String((part as Record<string, unknown>).text ?? "") : "").filter(Boolean).join("\n");
};

const runVoiceWorker = async (client: MockFairyClient, sid: string, text = "provider input"): Promise<{ ack: Record<string, unknown>; events: readonly EventEnvelope[] }> => {
  const beforeEvents = client.events().length;
  const beforeFrames = client.frames().length;
  client.sendRaw({
    op: "voice.worker",
    script: {
      frame_labels: { residency: "global-ok", sensitivity: "public" },
      partials: ["provider", text],
      text,
      utterance_id: `utt_${client.events().length}_${Date.now()}`
    },
    sid
  });
  const ack = await client.waitForFrame((frame) =>
    frame.kind === "ack" && frame.op === "voice.worker" && client.frames().indexOf(frame) >= beforeFrames,
  60_000);
  return { ack: ack as Record<string, unknown>, events: client.events().slice(beforeEvents) };
};

const runReplay = (sid: string, dataDir: string) => spawnSync(
  process.execPath,
  ["--import", "tsx", "apps/cli/src/bin/fairy.ts", "replay", sid, "--data-dir", dataDir, "--json"],
  { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CI: "true" }, timeout: 30_000, windowsHide: true }
);

const tempSpeechRoots = async (): Promise<string[]> =>
  (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("fairy-minimax-tts-"))
    .map((entry) => entry.name)
    .sort();

const baseProviderConfig = (): MiniMaxTtsProviderConfig => parseSpeechProviderConfig({
  speech: {
    providers: [{
      api_key_ref: "secret://minimax_token_plan",
      audio: { bitrate: 128_000, channel: 1, format: "mp3", sample_rate: 32_000 },
      data_clearance: { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] },
      endpoint_profile: "cn-primary",
      id: "minimax-direct",
      language_boost: "auto",
      limits: { max_audio_bytes: 33_554_432, max_response_bytes: 67_108_864, max_text_chars: 3_000 },
      stage: "tts",
      transport: "minimax-t2a-v2-http",
      voice: { pitch: 0, speed: 1, voice_id: "male-qn-qingse", volume: 1 }
    }],
    roles: { tts: { fallback: [], primary: "minimax-direct" } }
  }
}).ttsCandidates[0] as MiniMaxTtsProviderConfig;

const miniMaxServers: FakeMiniMaxServer[] = [];
const modelServers: MockOpenAIChatServer[] = [];
let gateways: MinimalGateway[] = [];

afterEach(async () => {
  await Promise.allSettled(gateways.splice(0).map((gateway) => gateway.stop()));
  await Promise.allSettled(miniMaxServers.splice(0).map((server) => server.stop()));
  await Promise.allSettled(modelServers.splice(0).map((server) => server.stop()));
});

describe.sequential("voice.tts-provider-v0", () => {
  it("Case A validates the closed config, endpoint profiles, provider wire, and Python >= 3.11 floor", async () => {
    const speech = {
      providers: [{
        api_key_ref: "secret://minimax_token_plan",
        audio: { bitrate: 128_000, channel: 1, format: "mp3", sample_rate: 32_000 },
        data_clearance: { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] },
        endpoint_profile: "cn-primary",
        id: "minimax-cn-tts",
        language_boost: "auto",
        limits: { max_audio_bytes: 33_554_432, max_response_bytes: 67_108_864, max_text_chars: 3_000 },
        stage: "tts",
        transport: "minimax-t2a-v2-http",
        voice: { pitch: 0, speed: 1, voice_id: "male-qn-qingse", volume: 1 }
      }],
      roles: { tts: { fallback: [], primary: "minimax-cn-tts" } }
    };
    expect(loadConfig({ sessionOverrides: { speech } }).config.speech).toBeDefined();
    expect(parseSpeechProviderConfig({ speech }).ttsCandidates[0]).toMatchObject({
      endpointProfile: "cn-primary",
      model: "speech-2.8-turbo",
      transport: "minimax-t2a-v2-http"
    });
    expect(miniMaxEndpointProfiles).toEqual({
      "cn-backup": "https://api-bj.minimaxi.com/v1/t2a_v2",
      "cn-primary": "https://api.minimaxi.com/v1/t2a_v2"
    });

    expect(() => parseSpeechProviderConfig({ speech: { ...speech, providers: [speech.providers[0], speech.providers[0]] } })).toThrow(/duplicate id/);
    expect(() => parseSpeechProviderConfig({ speech: { ...speech, roles: { tts: { fallback: [], primary: "missing" } } } })).toThrow(/unknown provider/);
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], stage: "asr" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], transport: "vendor-sdk" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], api_key_ref: "inline-secret" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], model: "speech-unknown" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], endpoint_profile: "https://evil.invalid/v1/t2a_v2" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], endpoint: "http://127.0.0.1:1/v1/t2a_v2" }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], limits: { ...speech.providers[0]?.limits, max_text_chars: 3_001 } }] } } })).toThrow();
    expect(() => loadConfig({ sessionOverrides: { speech: { ...speech, providers: [{ ...speech.providers[0], data_clearance: { max_sensitivity: "personal", residency: ["region-restricted"] } }] } } })).toThrow();

    const provider = baseProviderConfig();
    const wire = {
      audio_setting: { bitrate: 128_000, channel: 1, format: "mp3", sample_rate: 32_000 },
      deadlines_ms: { connect: 5_000, read: 5_000, total: 30_000 },
      endpoint_profile: "cn-primary",
      kind: "tts.request",
      labels: { residency: "region-restricted", sensitivity: "personal" },
      language_boost: "auto",
      limits: { max_audio_bytes: 33_554_432, max_response_bytes: 67_108_864, max_text_chars: 3_000 },
      model: provider.model,
      provider_transport: provider.transport,
      request_id: "req-provider-wire",
      text: "visible text",
      utterance_id: "utt-provider-wire",
      voice_setting: { pitch: 0, speed: 1, voice_id: "male-qn-qingse", volume: 1 }
    } as const;
    expect(validateSpeechWorkerWireMessage(wire)).toMatchObject({ ok: true });
    const encoded = encodeSpeechWorkerWireMessage(wire);
    expect(decodeSpeechWorkerWireMessage(`${encoded}\r`)).toEqual(wire);
    expect(encoded).not.toContain(fakeCredential);
    expect(validateSpeechWorkerWireMessage({ ...wire, stream: false })).toMatchObject({ ok: false });
    expect(validateSpeechWorkerWireMessage({ ...wire, endpoint_url: "http://127.0.0.1:1" })).toMatchObject({ ok: false });

    let unsupported: unknown;
    try {
      assertSupportedSpeechWorkerPythonVersion("3.10.99");
    } catch (error) {
      unsupported = error;
    }
    expect(unsupported).toMatchObject({ code: "SPEECH_WORKER_PYTHON_UNSUPPORTED" });
    expect(() => assertSupportedSpeechWorkerPythonVersion("3.11.0")).not.toThrow();
    expect(() => assertSupportedSpeechWorkerPythonVersion("4.0.0")).not.toThrow();
    const worker = new SpeechWorkerProcess();
    const ready = await worker.start();
    expect(ready.interpreter).toMatchObject({
      argv0: expect.any(String),
      source: expect.stringMatching(/^(?:discovered|test-override)$/),
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
    });
    assertSupportedSpeechWorkerPythonVersion(ready.pythonVersion);
    await worker.shutdown();
    await waitForProcessGone(ready.processId);

    const mismatchRoot = await mkdtemp(join(tmpdir(), "fairy-m305-version-mismatch-"));
    const mismatch = new SpeechWorkerProcess({
      provider: { credential: fakeCredential, outputRoot: mismatchRoot, testMode: "version-mismatch" }
    });
    await expect(mismatch.start()).rejects.toMatchObject({ code: "SPEECH_WORKER_VERSION_MISMATCH" });
    expect(mismatch.isAlive()).toBe(false);
    await rm(mismatchRoot, { force: true, recursive: true });
  }, TEST_TIMEOUT_MS);

  it("Cases B, D, and G send visible final text only and register one governed MP3 artifact", async () => {
    const forbidden = ["HIDDEN_REASONING_M305", "TOOL_TRACE_M305", "AUDIT_DETAIL_M305", "DENIED_SECRET_M305"];
    const model = await MockOpenAIChatServer.start({ text: ["unused mock fallback"] });
    model.enqueueScript({
      reasoning: [`${forbidden.join(" ")} sk_test_1234567890abcdef`],
      toolCalls: [{ id: "call_m305_trace", name: "chronicle.query", args: { query: "TOOL_TRACE_M305" } }]
    });
    model.enqueueScript({ text: ["Visible MiniMax artifact answer."] });
    modelServers.push(model);
    const miniMax = await FakeMiniMaxServer.start([{ body: successEnvelope() }]);
    miniMaxServers.push(miniMax);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-success-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-success-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [{ id: "minimax-cn-tts" }], ["minimax-cn-tts"]);
    const rootsBefore = await tempSpeechRoots();
    const started = await startGateway(configPath, { speechProviderLoopbackPorts: { "minimax-cn-tts": miniMax.port } });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 success");
    const result = await runVoiceWorker(client, created.sid, "synthesize the visible answer");
    client.close();

    expect(miniMax.connections).toBe(1);
    expect(miniMax.requests).toHaveLength(1);
    expect(miniMax.requestBytes).toBeGreaterThan(0);
    const request = miniMax.requests[0] as FakeRequest;
    expect(request).toMatchObject({ method: "POST", path: "/v1/t2a_v2" });
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers.authorization).toBe(`Bearer ${fakeCredential}`);
    expect(request.body).toEqual({
      aigc_watermark: false,
      audio_setting: { bitrate: 128_000, channel: 1, format: "mp3", sample_rate: 32_000 },
      language_boost: "auto",
      model: "speech-2.8-turbo",
      output_format: "hex",
      stream: false,
      subtitle_enable: false,
      text: "Visible MiniMax artifact answer.",
      voice_setting: { pitch: 0, speed: 1, voice_id: "male-qn-qingse", vol: 1 }
    });
    for (const marker of forbidden) {
      expect(request.rawBody).not.toContain(marker);
    }
    expect(request.rawBody).not.toContain("sk_test_1234567890abcdef");

    const chunks = result.events.filter((event) => event.type === "speech.tts.chunk");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      payload: {
        audio_ref: expect.stringMatching(/^art_[a-f0-9]{20}$/),
        text: "Visible MiniMax artifact answer."
      }
    });
    expect(payloadText(result.events.find((event) => event.type === "turn.final"))).toBe("Visible MiniMax artifact answer.");
    expect(result.events.filter((event) => event.type === "turn.input")).toHaveLength(1);
    expect(result.events.some((event) => event.type === "tool.call")).toBe(true);
    expect(result.events.some((event) => event.type === "tool.result")).toBe(true);
    expect(result.ack).toMatchObject({
      error_status: "none",
      provider_request_count: 1,
      provider_route: ["minimax-cn-tts:selected"],
      tts_chunk_count: 1,
      tts_provider: {
        artifact_id: expect.stringMatching(/^art_/),
        artifact_ref: expect.stringMatching(/^art_/),
        audio_format: "mp3",
        byte_count: mp3Fixture.byteLength,
        endpoint_profile: "cn-primary",
        model: "speech-2.8-turbo",
        provider_id: "minimax-cn-tts",
        sha256: `sha256:${createHash("sha256").update(mp3Fixture).digest("hex")}`,
        success_checks: {
          base_resp_status_zero: true,
          data_status_complete: true
        },
        transport: "minimax-t2a-v2-http",
        voice_id: "male-qn-qingse",
        worker: {
          interpreter: { argv0: expect.any(String), source: expect.stringMatching(/^(?:discovered|test-override)$/) },
          processId: expect.any(Number),
          pythonVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
          workerId: "speech-minimax-t2a-v2"
        }
      }
    });
    const ttsProvider = result.ack.tts_provider as Record<string, unknown>;
    const providerWorker = ttsProvider.worker as Record<string, unknown>;
    await waitForProcessGone(Number(providerWorker.processId));
    await waitForProcessGone(Number(result.ack.worker_process_id));

    const registry = new ArtifactRegistry(join(dataDir, "artifacts"));
    const artifact = await registry.get(String(payloadRecord(chunks[0] as EventEnvelope).audio_ref));
    expect(artifact).toMatchObject({
      kind: "speech",
      labels: { residency: "region-restricted", sensitivity: "personal" },
      metadata: { audio_format: "mp3" },
      mime: "audio/mpeg",
      size_bytes: mp3Fixture.byteLength
    });
    expect(await readFile(artifact?.path ?? "missing")).toEqual(mp3Fixture);
    expect(JSON.stringify(artifact?.metadata)).not.toContain(fakeCredential);
    expect(JSON.stringify(artifact?.metadata)).not.toContain("minimax");

    const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
    const artifactRegistry = await readFile(join(dataDir, "artifacts", "artifacts.jsonl"), "utf8");
    const publicSurfaces = JSON.stringify({ ack: result.ack, events: result.events, artifact });
    for (const surface of [rawLog, artifactRegistry, publicSurfaces]) {
      expect(surface).not.toContain(fakeCredential);
      expect(surface).not.toContain(`Bearer ${fakeCredential}`);
      expect(surface).not.toContain(mp3Fixture.toString("hex"));
      expect(surface).not.toContain("fake-trace-not-persisted");
      expect(surface).not.toContain("fairy-minimax-tts-");
    }
    expect(rawLog).not.toContain("tts.request");
    expect(rawLog).not.toContain("tts-output.mp3");
    expect(rawLog).not.toContain("base_resp");
    const replay = runReplay(created.sid, dataDir);
    expect(replay.status, String(replay.stderr)).toBe(0);
    expect(replay.stdout).toContain(String(payloadRecord(chunks[0] as EventEnvelope).audio_ref));
    expect(replay.stdout).toContain("Visible MiniMax artifact answer.");
    expect(await tempSpeechRoots()).toEqual(rootsBefore);
  }, TEST_TIMEOUT_MS);

  it("Case C gives an under-cleared primary zero connections and selects one cleared fallback", async () => {
    const model = await MockOpenAIChatServer.start({ text: ["Visible fallback TTS answer."] });
    modelServers.push(model);
    const primary = await FakeMiniMaxServer.start();
    const fallback = await FakeMiniMaxServer.start();
    miniMaxServers.push(primary, fallback);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-fallback-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-fallback-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [
      { id: "under-cleared", maxSensitivity: "public", regions: [], residency: ["global-ok"] },
      { endpointProfile: "cn-backup", id: "cleared-fallback" }
    ], ["under-cleared", "cleared-fallback"]);
    const started = await startGateway(configPath, {
      speechProviderLoopbackPorts: { "cleared-fallback": fallback.port, "under-cleared": primary.port }
    });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 fallback");
    const result = await runVoiceWorker(client, created.sid, "fallback clearance input");
    client.close();

    expect(primary.connections).toBe(0);
    expect(primary.requestBytes).toBe(0);
    expect(primary.requests).toHaveLength(0);
    expect(fallback.connections).toBe(1);
    expect(fallback.requests).toHaveLength(1);
    expect(result.ack).toMatchObject({
      error_status: "none",
      provider_request_count: 1,
      provider_route: ["under-cleared:denied", "cleared-fallback:selected"],
      tts_provider: { endpoint_profile: "cn-backup", provider_id: "cleared-fallback" }
    });
    expect(result.events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "voice.tts.route-denied")).toMatchObject({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      payload: { candidate_id: "under-cleared" }
    });
    expect(result.events.find((event) => event.type === "turn.input")).toMatchObject({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      payload: { routing_hints: { prefer_local: true } }
    });
    expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(1);
  }, TEST_TIMEOUT_MS);

  it("Case C makes zero provider requests and no artifact when every candidate is under-cleared", async () => {
    const model = await MockOpenAIChatServer.start({ text: ["Text turn survives TTS denial."] });
    modelServers.push(model);
    const first = await FakeMiniMaxServer.start();
    const second = await FakeMiniMaxServer.start();
    miniMaxServers.push(first, second);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-no-route-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-no-route-token";
    const denied = { maxSensitivity: "public" as const, regions: [] as const, residency: ["global-ok"] as const };
    await writeGatewayConfig(configPath, dataDir, model.url, token, [
      { id: "denied-one", ...denied },
      { endpointProfile: "cn-backup", id: "denied-two", ...denied }
    ], ["denied-one", "denied-two"]);
    const started = await startGateway(configPath, {
      speechProviderLoopbackPorts: { "denied-one": first.port, "denied-two": second.port }
    });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 no route");
    const result = await runVoiceWorker(client, created.sid, "no provider route input");
    client.close();

    expect(first.connections + second.connections).toBe(0);
    expect(first.requestBytes + second.requestBytes).toBe(0);
    expect(result.ack).toMatchObject({ provider_request_count: 0, tts_chunk_count: 0 });
    expect(result.ack).not.toHaveProperty("tts_provider.success_checks");
    expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(0);
    expect(payloadText(result.events.find((event) => event.type === "turn.final"))).toBe("Text turn survives TTS denial.");
    expect(await new ArtifactRegistry(join(dataDir, "artifacts")).list()).toHaveLength(0);
    const replay = runReplay(created.sid, dataDir);
    expect(replay.status, String(replay.stderr)).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("Cases C and G apply speech egress before a provider that otherwise has secret clearance", async () => {
    const deniedSecret = "sk_test_1234567890abcdef";
    const model = await MockOpenAIChatServer.start({ text: [`Visible final contains API_KEY=${deniedSecret}`] });
    modelServers.push(model);
    const miniMax = await FakeMiniMaxServer.start();
    miniMaxServers.push(miniMax);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-egress-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-egress-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [{
      id: "secret-cleared",
      maxSensitivity: "secret",
      residency: ["local-only"]
    }], ["secret-cleared"]);
    const started = await startGateway(configPath, { speechProviderLoopbackPorts: { "secret-cleared": miniMax.port } });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 speech egress");
    const result = await runVoiceWorker(client, created.sid, "egress input");
    client.close();

    expect(miniMax.connections).toBe(0);
    expect(miniMax.requestBytes).toBe(0);
    expect(result.ack).toMatchObject({ error_status: "tts_egress_denied", provider_request_count: 0, tts_chunk_count: 0 });
    expect(result.ack).not.toHaveProperty("tts_provider.success_checks");
    expect(result.events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "voice.tts.egress-denied")).toMatchObject({
      payload: { error_code: "tts_egress_denied" }
    });
    expect(JSON.stringify(result.events.filter((event) => event.type === "progress.update"))).not.toContain(deniedSecret);
    expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(0);
    expect(await new ArtifactRegistry(join(dataDir, "artifacts")).list()).toHaveLength(0);
  }, TEST_TIMEOUT_MS);

  it("Case E classifies every required MiniMax error and rejects malformed success envelopes", async () => {
    const requiredCodes: readonly [number, string][] = [
      [1001, "SPEECH_WORKER_PROVIDER_TIMEOUT"],
      [1002, "SPEECH_WORKER_RATE_LIMIT"],
      [1004, "SPEECH_WORKER_UNAUTHORIZED"],
      [1008, "SPEECH_WORKER_INSUFFICIENT_BALANCE"],
      [1024, "SPEECH_WORKER_PROVIDER_INTERNAL"],
      [1026, "SPEECH_WORKER_CONTENT_SAFETY"],
      [1027, "SPEECH_WORKER_CONTENT_SAFETY"],
      [1033, "SPEECH_WORKER_PROVIDER_DOWNSTREAM"],
      [1042, "SPEECH_WORKER_INVALID_CHARACTER_RATIO"],
      [2013, "SPEECH_WORKER_INVALID_PARAMETER"],
      [20132, "SPEECH_WORKER_INVALID_VOICE"],
      [2042, "SPEECH_WORKER_INVALID_VOICE"],
      [2049, "SPEECH_WORKER_INVALID_API_KEY"],
      [2056, "SPEECH_WORKER_TOKEN_PLAN_RESOURCE_LIMIT"]
    ];
    const rejectionPlans: readonly { readonly expected: string; readonly plan: FakePlan; readonly provider?: MiniMaxTtsProviderConfig }[] = [
      ...requiredCodes.map(([code, expected]) => ({ expected, plan: { body: providerErrorEnvelope(code) } })),
      { expected: "SPEECH_WORKER_MALFORMED_PROVIDER_JSON", plan: { body: "{not-json" } },
      { expected: "SPEECH_WORKER_PROVIDER_DATA_MISSING", plan: { body: successEnvelope(mp3Fixture, { data: null }) } },
      { expected: "SPEECH_WORKER_PROVIDER_INCOMPLETE", plan: { body: successEnvelope(mp3Fixture, { data: { audio: mp3Fixture.toString("hex"), status: 1 } }) } },
      { expected: "SPEECH_WORKER_INVALID_AUDIO_HEX", plan: { body: successEnvelope(mp3Fixture, { data: { audio: "", status: 2 } }) } },
      { expected: "SPEECH_WORKER_INVALID_AUDIO_HEX", plan: { body: successEnvelope(mp3Fixture, { data: { audio: "abc", status: 2 } }) } },
      { expected: "SPEECH_WORKER_INVALID_AUDIO_HEX", plan: { body: successEnvelope(mp3Fixture, { data: { audio: "zz", status: 2 } }) } },
      {
        expected: "SPEECH_WORKER_AUDIO_METADATA_MISMATCH",
        plan: { body: successEnvelope(mp3Fixture, { extra_info: { audio_channel: 2, audio_format: "mp3", audio_sample_rate: 32_000, audio_size: mp3Fixture.byteLength, bitrate: 128_000 } }) }
      },
      {
        expected: "SPEECH_WORKER_AUDIO_SIZE_MISMATCH",
        plan: { body: successEnvelope(mp3Fixture, { extra_info: { audio_channel: 1, audio_format: "mp3", audio_sample_rate: 32_000, audio_size: mp3Fixture.byteLength + 1, bitrate: 128_000 } }) }
      },
      {
        expected: "SPEECH_WORKER_RESPONSE_TOO_LARGE",
        plan: { body: Buffer.alloc(512, 0x78) },
        provider: { ...baseProviderConfig(), limits: { ...baseProviderConfig().limits, maxResponseBytes: 64 } }
      },
      {
        expected: "SPEECH_WORKER_AUDIO_TOO_LARGE",
        plan: { body: successEnvelope() },
        provider: { ...baseProviderConfig(), limits: { ...baseProviderConfig().limits, maxAudioBytes: 10 } }
      },
      { expected: "SPEECH_WORKER_REDIRECT_REJECTED", plan: { body: { redirect: "forbidden" }, status: 302 } },
      { expected: "SPEECH_WORKER_PROVIDER_HTTP_ERROR", plan: { body: { error: "untrusted" }, status: 500 } }
    ];
    const miniMax = await FakeMiniMaxServer.start(rejectionPlans.map((item) => item.plan));
    miniMaxServers.push(miniMax);
    const root = await mkdtemp(join(tmpdir(), "fairy-m305-errors-"));
    const worker = new SpeechWorkerProcess({
      provider: { credential: fakeCredential, outputRoot: root, testLoopbackPort: miniMax.port }
    });
    const ready = await worker.start();
    const observed: string[] = [];
    for (const [index, item] of rejectionPlans.entries()) {
      let failure: unknown;
      try {
        await worker.requestProviderTts({
          labels: { residency: "region-restricted", sensitivity: "personal" },
          provider: item.provider ?? baseProviderConfig(),
          requestId: `req-error-${index}`,
          text: `visible error fixture ${index}`,
          utteranceId: `utt-error-${index}`
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: item.expected });
      expect(String(failure)).not.toContain(fakeCredential);
      expect(String(failure)).not.toContain("Authorization");
      observed.push((failure as SpeechWorkerProcessError).code);
    }
    expect(observed).toHaveLength(rejectionPlans.length);
    expect(miniMax.requests).toHaveLength(rejectionPlans.length);
    expect(await readdir(root)).toEqual([]);
    await worker.shutdown();
    await waitForProcessGone(ready.processId);
    await rm(root, { force: true, recursive: true });
  }, TEST_TIMEOUT_MS);

  it("Case E never retries auth, quota, or safety failures and attempts a transient fallback once", async () => {
    const model = await MockOpenAIChatServer.start({ text: ["visible auth failure text"] });
    model.enqueueScript({ text: ["visible quota failure text"] });
    model.enqueueScript({ text: ["visible safety failure text"] });
    modelServers.push(model);
    const primary = await FakeMiniMaxServer.start([
      { body: providerErrorEnvelope(1004) },
      { body: providerErrorEnvelope(2056) },
      { body: providerErrorEnvelope(1026) }
    ]);
    const fallback = await FakeMiniMaxServer.start();
    miniMaxServers.push(primary, fallback);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-no-retry-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-no-retry-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [
      { id: "error-primary" },
      { endpointProfile: "cn-backup", id: "must-not-run" }
    ], ["error-primary", "must-not-run"]);
    const started = await startGateway(configPath, {
      speechProviderLoopbackPorts: { "error-primary": primary.port, "must-not-run": fallback.port }
    });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 no retries");
    for (const input of ["auth failure", "quota failure", "safety failure"]) {
      const result = await runVoiceWorker(client, created.sid, input);
      expect(result.events.filter((event) => event.type === "turn.final")).toHaveLength(1);
      expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(0);
      expect(result.ack.provider_request_count).toBe(1);
      expect(result.ack.provider_route).toEqual([expect.stringMatching(/^error-primary:failed:/)]);
      expect(result.ack).not.toHaveProperty("tts_provider.success_checks");
    }
    client.close();
    expect(primary.requests).toHaveLength(3);
    expect(fallback.connections).toBe(0);
    expect(fallback.requestBytes).toBe(0);

    const transientModel = await MockOpenAIChatServer.start({ text: ["visible transient fallback"] });
    modelServers.push(transientModel);
    const transientPrimary = await FakeMiniMaxServer.start([{ body: providerErrorEnvelope(1024) }]);
    const transientFallback = await FakeMiniMaxServer.start([{ body: successEnvelope() }]);
    miniMaxServers.push(transientPrimary, transientFallback);
    const transientTemp = await mkdtemp(join(tmpdir(), "fairy-m305-transient-"));
    const transientData = join(transientTemp, "data");
    const transientConfig = join(transientTemp, "fairy.yaml");
    const transientToken = "m305-transient-token";
    await writeGatewayConfig(transientConfig, transientData, transientModel.url, transientToken, [
      { id: "transient-primary" },
      { endpointProfile: "cn-backup", id: "transient-fallback" }
    ], ["transient-primary", "transient-fallback"]);
    const transientStarted = await startGateway(transientConfig, {
      speechProviderLoopbackPorts: { "transient-fallback": transientFallback.port, "transient-primary": transientPrimary.port }
    });
    gateways.push(transientStarted.gateway);
    const transientClient = await MockFairyClient.connect({ token: transientToken, url: `ws://127.0.0.1:${transientStarted.port}` });
    const transientSession = await transientClient.createSession("M3-05 transient fallback");
    const transientResult = await runVoiceWorker(transientClient, transientSession.sid, "transient input");
    transientClient.close();
    expect(transientPrimary.requests).toHaveLength(1);
    expect(transientFallback.requests).toHaveLength(1);
    expect(transientResult.ack).toMatchObject({
      provider_request_count: 2,
      provider_route: [
        expect.stringMatching(/^transient-primary:failed:SPEECH_WORKER_PROVIDER_INTERNAL$/),
        "transient-fallback:selected"
      ],
      tts_chunk_count: 1
    });
  }, TEST_TIMEOUT_MS);

  it("Case E rejects unsupported adapter input before provider I/O", async () => {
    const miniMax = await FakeMiniMaxServer.start();
    miniMaxServers.push(miniMax);
    const root = await mkdtemp(join(tmpdir(), "fairy-m305-pre-io-"));
    const worker = new SpeechWorkerProcess({
      provider: { credential: fakeCredential, outputRoot: root, testLoopbackPort: miniMax.port }
    });
    const ready = await worker.start();
    const base = baseProviderConfig();
    const invalidRequests: readonly { readonly provider: MiniMaxTtsProviderConfig; readonly text: string }[] = [
      { provider: base, text: "" },
      { provider: base, text: "x".repeat(3_001) },
      { provider: { ...base, model: "unsupported-model" as MiniMaxTtsProviderConfig["model"] }, text: "visible" },
      { provider: { ...base, voice: { ...base.voice, speed: 99 } }, text: "visible" },
      { provider: { ...base, audio: { ...base.audio, sampleRate: 44_100 as 32000 } }, text: "visible" }
    ];
    for (const [index, invalid] of invalidRequests.entries()) {
      await expect(worker.requestProviderTts({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        provider: invalid.provider,
        requestId: `req-pre-io-${index}`,
        text: invalid.text,
        utteranceId: `utt-pre-io-${index}`
      })).rejects.toBeInstanceOf(SpeechWorkerProcessError);
    }
    expect(miniMax.connections).toBe(0);
    expect(miniMax.requestBytes).toBe(0);
    expect(await readdir(root)).toEqual([]);
    await worker.shutdown();
    await waitForProcessGone(ready.processId);
    await rm(root, { force: true, recursive: true });
  }, TEST_TIMEOUT_MS);

  it("Cases D and F reject unsafe, partial, mismatched, and non-regular worker outputs", async () => {
    for (const token of [
      "../tts-output.mp3",
      "..\\tts-output.mp3",
      "/tmp/tts-output.mp3",
      "C:\\tmp\\tts-output.mp3",
      "C:tts-output.mp3",
      "\\\\server\\share\\tts-output.mp3",
      "//server/share/tts-output.mp3",
      "tts-output.mp3:alternate",
      "nested/tts-output.mp3"
    ]) {
      expect(() => resolveSpeechWorkerOutput(tmpdir(), token)).toThrow(SpeechArtifactValidationError);
    }

    const chunkFor = (bytes: Buffer, overrides: Partial<SpeechWorkerTtsChunk> = {}): SpeechWorkerTtsChunk => ({
      audioFormat: "mp3",
      audioRef: "tts-output.mp3",
      chunkId: "utt-artifact:tts:001",
      mime: "audio/mpeg",
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      sizeBytes: bytes.byteLength,
      text: "visible artifact text",
      ...overrides
    });

    const validRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-valid-"));
    await writeFile(join(validRoot, "tts-output.mp3"), mp3Fixture);
    await expect(validateSpeechWorkerArtifact(validRoot, chunkFor(mp3Fixture), 1_024)).resolves.toMatchObject({
      sizeBytes: mp3Fixture.byteLength
    });

    const hashRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-hash-"));
    await writeFile(join(hashRoot, "tts-output.mp3"), mp3Fixture);
    await expect(validateSpeechWorkerArtifact(hashRoot, chunkFor(mp3Fixture, { sha256: `sha256:${"0".repeat(64)}` }), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_HASH_MISMATCH"
    });

    const sizeRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-size-"));
    await writeFile(join(sizeRoot, "tts-output.mp3"), mp3Fixture);
    await expect(validateSpeechWorkerArtifact(sizeRoot, chunkFor(mp3Fixture, { sizeBytes: mp3Fixture.byteLength + 1 }), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_SIZE_MISMATCH"
    });

    const formatRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-format-"));
    const notMp3 = Buffer.from("not an mp3 file", "ascii");
    await writeFile(join(formatRoot, "tts-output.mp3"), notMp3);
    await expect(validateSpeechWorkerArtifact(formatRoot, chunkFor(notMp3), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_FORMAT_MISMATCH"
    });

    const partialRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-partial-"));
    await writeFile(join(partialRoot, "tts-output.mp3.partial"), mp3Fixture);
    await expect(validateSpeechWorkerArtifact(partialRoot, chunkFor(mp3Fixture), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_MISSING"
    });

    const directoryRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-directory-"));
    await mkdir(join(directoryRoot, "tts-output.mp3"));
    await expect(validateSpeechWorkerArtifact(directoryRoot, chunkFor(mp3Fixture), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_NOT_REGULAR"
    });

    const symlinkRoot = await mkdtemp(join(tmpdir(), "fairy-m305-artifact-symlink-"));
    const symlinkTarget = join(symlinkRoot, "real-directory");
    await mkdir(symlinkTarget);
    await symlink(symlinkTarget, join(symlinkRoot, "tts-output.mp3"), "junction");
    await expect(validateSpeechWorkerArtifact(symlinkRoot, chunkFor(mp3Fixture), 1_024)).rejects.toMatchObject({
      code: "SPEECH_ARTIFACT_SYMLINK"
    });

    await Promise.all([validRoot, hashRoot, sizeRoot, formatRoot, partialRoot, directoryRoot, symlinkRoot]
      .map((root) => rm(root, { force: true, recursive: true })));
  }, TEST_TIMEOUT_MS);

  it("Case F preserves and replays the text turn with zero artifacts after crash, malformed output, timeout, and partial output", async () => {
    const modes: readonly SpeechProviderWorkerTestMode[] = ["crash", "malformed", "timeout", "partial"];
    for (const mode of modes) {
      const model = await MockOpenAIChatServer.start({ text: [`visible ${mode} text survives`] });
      modelServers.push(model);
      const miniMax = await FakeMiniMaxServer.start();
      miniMaxServers.push(miniMax);
      const temp = await mkdtemp(join(tmpdir(), `fairy-m305-${mode}-`));
      const dataDir = join(temp, "data");
      const configPath = join(temp, "fairy.yaml");
      const token = `m305-${mode}-token`;
      const providerId = `provider-${mode}`;
      await writeGatewayConfig(configPath, dataDir, model.url, token, [{ id: providerId }], [providerId]);
      const rootsBefore = await tempSpeechRoots();
      const started = await startGateway(configPath, {
        speechProviderLoopbackPorts: { [providerId]: miniMax.port },
        ...(mode === "timeout" ? { speechProviderRequestDeadlineMs: { [providerId]: 200 } } : {}),
        speechProviderWorkerModes: { [providerId]: mode }
      });
      gateways.push(started.gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
      const created = await client.createSession(`M3-05 ${mode}`);
      const result = await runVoiceWorker(client, created.sid, `${mode} input`);
      client.close();

      expect(result.ack.error_status).not.toBe("none");
      expect(result.events.filter((event) => event.type === "turn.final")).toHaveLength(1);
      expect(payloadText(result.events.find((event) => event.type === "turn.final"))).toBe(`visible ${mode} text survives`);
      expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(0);
      expect(result.events.find((event) => event.type === "progress.update" && payloadRecord(event).stage === "voice.tts.failed")).toBeDefined();
      expect(await new ArtifactRegistry(join(dataDir, "artifacts")).list()).toHaveLength(0);
      expect(miniMax.requests).toHaveLength(0);
      const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
      expect(rawLog).toContain(`visible ${mode} text survives`);
      expect(rawLog).not.toContain("speech.tts.provider");
      expect(rawLog).not.toContain(fakeCredential);
      expect(rawLog).not.toContain("tts-output.mp3");
      const replay = runReplay(created.sid, dataDir);
      expect(replay.status, String(replay.stderr)).toBe(0);
      expect(replay.stdout).toContain(`visible ${mode} text survives`);
      await waitForProcessGone(Number(result.ack.worker_process_id));
      expect(await tempSpeechRoots()).toEqual(rootsBefore);
    }
  }, TEST_TIMEOUT_MS);

  it("Case F leaves no artifact after an invalid provider response", async () => {
    const model = await MockOpenAIChatServer.start({ text: ["visible invalid-response text survives"] });
    modelServers.push(model);
    const miniMax = await FakeMiniMaxServer.start([{ body: successEnvelope(mp3Fixture, { data: { audio: "abc", status: 2 } }) }]);
    miniMaxServers.push(miniMax);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-invalid-response-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-invalid-response-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [{ id: "invalid-response" }], ["invalid-response"]);
    const rootsBefore = await tempSpeechRoots();
    const started = await startGateway(configPath, { speechProviderLoopbackPorts: { "invalid-response": miniMax.port } });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 invalid provider response");
    const result = await runVoiceWorker(client, created.sid, "invalid response input");
    client.close();
    expect(miniMax.requests).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "speech.tts.chunk")).toHaveLength(0);
    expect(payloadText(result.events.find((event) => event.type === "turn.final"))).toBe("visible invalid-response text survives");
    expect(await new ArtifactRegistry(join(dataDir, "artifacts")).list()).toHaveLength(0);
    expect(await tempSpeechRoots()).toEqual(rootsBefore);
    expect(runReplay(created.sid, dataDir).status).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("Case F cleans cancellation and forced gateway shutdown without temporary residue", async () => {
    const cancellingServer = await FakeMiniMaxServer.start([{ hang: true }]);
    miniMaxServers.push(cancellingServer);
    const cancellingRoot = await mkdtemp(join(tmpdir(), "fairy-m305-cancel-"));
    const cancelling = new SpeechWorkerProcess({
      deadlines: { cancellationMs: 200, requestMs: 5_000 },
      provider: { credential: fakeCredential, outputRoot: cancellingRoot, testLoopbackPort: cancellingServer.port }
    });
    const cancellingReady = await cancelling.start();
    const request = cancelling.requestProviderTts({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      provider: baseProviderConfig(),
      requestId: "req-cancel-provider",
      text: "visible cancellation text",
      utteranceId: "utt-cancel-provider"
    });
    await waitForCondition("provider cancellation request", () => cancellingServer.requests.length === 1);
    await expect(cancelling.cancel("req-cancel-control", "req-cancel-provider", "tts")).rejects.toMatchObject({
      code: "SPEECH_WORKER_CANCEL_TIMEOUT"
    });
    await expect(request).rejects.toBeInstanceOf(SpeechWorkerProcessError);
    await waitForProcessGone(cancellingReady.processId);
    expect(await readdir(cancellingRoot)).toEqual([]);
    await rm(cancellingRoot, { force: true, recursive: true });

    const model = await MockOpenAIChatServer.start({ text: ["visible forced-shutdown text survives"] });
    modelServers.push(model);
    const hangingServer = await FakeMiniMaxServer.start([{ hang: true }]);
    miniMaxServers.push(hangingServer);
    const temp = await mkdtemp(join(tmpdir(), "fairy-m305-forced-shutdown-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "m305-forced-shutdown-token";
    await writeGatewayConfig(configPath, dataDir, model.url, token, [{ id: "forced-shutdown" }], ["forced-shutdown"]);
    const rootsBefore = await tempSpeechRoots();
    const started = await startGateway(configPath, { speechProviderLoopbackPorts: { "forced-shutdown": hangingServer.port } });
    gateways.push(started.gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${started.port}` });
    const created = await client.createSession("M3-05 forced shutdown");
    client.sendRaw({
      op: "voice.worker",
      script: { partials: ["forced"], text: "forced shutdown input", utterance_id: "utt-forced-shutdown" },
      sid: created.sid
    });
    await client.waitFor((event) => event.sid === created.sid && event.type === "turn.final", 30_000);
    await waitForCondition("forced-shutdown provider request", () => hangingServer.requests.length === 1);
    gateways = gateways.filter((gateway) => gateway !== started.gateway);
    await started.gateway.stop();
    client.close();

    const rawLog = await readFile(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8");
    expect(rawLog).toContain("visible forced-shutdown text survives");
    expect(rawLog).not.toContain("speech.tts.chunk");
    expect(rawLog).not.toContain(fakeCredential);
    expect(await new ArtifactRegistry(join(dataDir, "artifacts")).list()).toHaveLength(0);
    expect(await tempSpeechRoots()).toEqual(rootsBefore);
    expect(runReplay(created.sid, dataDir).status).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("Cases B and H disable inherited proxies twice and keep worker sources and architecture guards closed", async () => {
    const miniMax = await FakeMiniMaxServer.start([{ body: successEnvelope() }]);
    miniMaxServers.push(miniMax);
    const root = await mkdtemp(join(tmpdir(), "fairy-m305-proxy-"));
    const proxyNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"] as const;
    const originals = new Map(proxyNames.map((name) => [name, process.env[name]]));
    for (const name of proxyNames) {
      process.env[name] = name.toLowerCase().includes("no_proxy") ? "" : "http://127.0.0.1:1";
    }
    let worker: SpeechWorkerProcess | undefined;
    let pid: number | undefined;
    try {
      worker = new SpeechWorkerProcess({
        provider: { credential: fakeCredential, outputRoot: root, testLoopbackPort: miniMax.port }
      });
      const ready = await worker.start();
      pid = ready.processId;
      const result = await worker.requestProviderTts({
        labels: { residency: "region-restricted", sensitivity: "personal" },
        provider: baseProviderConfig(),
        requestId: "req-proxy-disabled",
        text: "visible direct connection",
        utteranceId: "utt-proxy-disabled"
      });
      expect(result.chunks).toHaveLength(1);
      await worker.shutdown();
    } finally {
      for (const [name, value] of originals) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      await worker?.terminateForTest("proxy test cleanup").catch(() => undefined);
    }
    expect(miniMax.requests).toHaveLength(1);
    expect(pid).toBeDefined();
    await waitForProcessGone(pid as number);
    await rm(root, { force: true, recursive: true });

    const providerSource = await readFile(join(repoRoot, "workers", "speech", "minimax_tts_worker.py"), "utf8");
    const mockSource = await readFile(join(repoRoot, "workers", "speech", "mock_worker.py"));
    const supervisorSource = await readFile(join(repoRoot, "apps", "gateway", "src", "speech-worker-process.ts"), "utf8");
    const serverSource = await readFile(join(repoRoot, "apps", "gateway", "src", "server.ts"), "utf8");
    const perceptionTest = await readFile(join(repoRoot, "packages", "perception", "test", "index.test.ts"));
    const workerProcessTest = await readFile(join(repoRoot, "packages", "testing", "test", "voice.worker-process.test.ts"));
    const registrySchema = await readFile(join(repoRoot, "packages", "protocol", "schemas", "registry.v1.json"));
    const protocolPackage = await readFile(join(repoRoot, "packages", "protocol", "package.json"), "utf8");
    const artifactPackage = JSON.parse(await readFile(join(repoRoot, "packages", "artifacts", "package.json"), "utf8")) as Record<string, unknown>;
    expect([...providerSource].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    const imports = [...providerSource.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)].map((match) => match[1]);
    expect(new Set(imports)).toEqual(new Set(["hashlib", "json", "os", "re", "ssl", "sys", "time", "urllib.error", "urllib.request"]));
    expect(providerSource).not.toMatch(/^\s*(?:from|import)\s+(?:socket|subprocess|pyaudio|sounddevice|requests|httpx|minimax|openai)\b/m);
    expect(providerSource).not.toContain("_sock");
    expect(providerSource).not.toMatch(/\b(?:microphone|speaker|playback|pip\s+install)\b/i);
    expect(providerSource).toContain("urllib.request.ProxyHandler({})");
    expect(providerSource).toContain("class NoRedirectHandler");
    expect(providerSource).toContain("ssl.create_default_context()");
    expect(providerSource).toContain('sys.stdout.buffer.write(encoded + b"\\n")');
    expect(createHash("sha256").update(mockSource).digest("hex")).toBe("03767b90259b4a02eaf3f3810916ee55fd09c867ef3abd220c788ad59482f135");
    expect(createHash("sha256").update(perceptionTest).digest("hex")).toBe("47832dcd7c5a4cca9b2dc4f914b2d53274869f90ecbaba5a771038ea387e25db");
    expect(createHash("sha256").update(workerProcessTest).digest("hex")).toBe("e7c1b4b5e2ffa749c05ff6fbed5f765c12efb550daa68f43061faccb25706096");
    expect(createHash("sha256").update(registrySchema).digest("hex")).toBe("88dbf2e6db4fe9e068cde9ede7ca06ef78e4d7cdbda47352e9a54eeef0dee0b4");
    expect(supervisorSource).toContain("shell: false");
    expect(supervisorSource).not.toContain("shell: true");
    expect(supervisorSource).not.toContain("...process.env");
    expect((supervisorSource.match(/FAIRY_TEST_PYTHON/g) ?? [])).toHaveLength(1);
    expect((supervisorSource.match(/FAIRY_MINIMAX_T2A_TOKEN/g) ?? [])).toHaveLength(1);
    expect(supervisorSource).not.toMatch(/FAIRY_(?:MINIMAX_)?(?:ENDPOINT|BASE_URL)/);
    expect((serverSource.match(/new TurnRunner\(/g) ?? [])).toHaveLength(1);
    expect(protocolPackage).not.toContain("@fairy/artifacts");
    expect(JSON.stringify(artifactPackage)).toContain("./src/index.ts");
  }, TEST_TIMEOUT_MS);
});
