import { createHash } from "node:crypto";
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
  mimoAsrDefaults,
  mimoAsrEndpointProfiles,
  parseSpeechProviderConfig,
  predictedMimoAsrRequestBytes,
  resolveMimoCredential,
  resolveSpeechWorkerInput,
  SpeechInputArtifactValidationError,
  SpeechWorkerProcess,
  stageSpeechInputArtifact,
  validateSpeechInputArtifact,
  validateSpeechWorkerWireMessage,
  type MimoAsrProviderConfig,
  type SpeechProviderWorkerTestMode,
  type SpeechWorkerAsrResult
} from "../../../apps/gateway/src/index.js";
import { loadGatewayConfig } from "../../../apps/gateway/src/config.js";
import { MinimalGateway } from "../../../apps/gateway/src/server.js";
import { MockFairyClient, MockOpenAIChatServer } from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const fakeCredential = "sk-R09_FAKE_MIMO_PAYGO_DO_NOT_USE";
const wavFixture = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);
const mp3Fixture = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xfb]);
const digest = (value: Buffer): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface FakePlan {
  readonly body?: Record<string, unknown> | string | Buffer;
  readonly contentType?: string;
  readonly hang?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly status?: number;
}

interface SanitizedRequest {
  readonly audioHash?: string;
  readonly body?: Record<string, unknown>;
  readonly bodyBytes: number;
  readonly headers: IncomingMessage["headers"];
  readonly method?: string;
  readonly path?: string;
}

const successResponse = (text = "hello from MiMo"): Record<string, unknown> => ({
  choices: [{
    finish_reason: "stop",
    index: 0,
    message: { audio: null, content: text, role: "assistant", tool_calls: null }
  }],
  id: "mimo_fake_request_1",
  model: "mimo-v2.5-asr",
  object: "chat.completion",
  usage: { audio_seconds: 1.25 }
});

class FakeMimoServer {
  readonly requests: SanitizedRequest[] = [];
  readonly #plans: FakePlan[];
  readonly #server: Server;
  #connections = 0;
  #port = 0;
  #requestBytes = 0;

  private constructor(plans: readonly FakePlan[]) {
    this.#plans = [...plans];
    this.#server = createServer((request, response) => this.#handle(request, response));
    this.#server.on("connection", () => { this.#connections += 1; });
  }

  static async start(plans: readonly FakePlan[] = [{ body: successResponse() }]): Promise<FakeMimoServer> {
    const fake = new FakeMimoServer(plans);
    await new Promise<void>((resolvePromise, reject) => {
      fake.#server.once("error", reject);
      fake.#server.listen(0, "127.0.0.1", () => {
        const address = fake.#server.address();
        if (!address || typeof address !== "object") {
          reject(new Error("fake MiMo server did not bind"));
          return;
        }
        fake.#port = address.port;
        resolvePromise();
      });
    });
    return fake;
  }

  get connections(): number { return this.#connections; }
  get port(): number { return this.#port; }
  get requestBytes(): number { return this.#requestBytes; }

  async stop(): Promise<void> {
    this.#server.closeAllConnections?.();
    if (this.#server.listening) {
      await new Promise<void>((resolvePromise) => this.#server.close(() => resolvePromise()));
    }
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      this.#requestBytes += chunk.byteLength;
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      const messages = parsed.messages as Array<Record<string, unknown>> | undefined;
      const content = messages?.[0]?.content as Array<Record<string, unknown>> | undefined;
      const inputAudio = content?.[0]?.input_audio as Record<string, unknown> | undefined;
      const data = typeof inputAudio?.data === "string" ? inputAudio.data : undefined;
      let audioHash: string | undefined;
      if (data) {
        const comma = data.indexOf(",");
        audioHash = comma >= 0 ? digest(Buffer.from(data.slice(comma + 1), "base64")) : undefined;
        inputAudio!.data = `${data.slice(0, comma + 1)}[REDACTED]`;
      }
      this.requests.push({
        ...(audioHash ? { audioHash } : {}),
        body: parsed,
        bodyBytes: raw.byteLength,
        headers: request.headers,
        ...(request.method ? { method: request.method } : {}),
        ...(request.url ? { path: request.url } : {})
      });
      const plan = this.#plans.shift() ?? { body: successResponse() };
      if (plan.hang) {
        return;
      }
      const body = Buffer.isBuffer(plan.body)
        ? plan.body
        : Buffer.from(typeof plan.body === "string" ? plan.body : JSON.stringify(plan.body ?? successResponse()), "utf8");
      response.writeHead(plan.status ?? 200, {
        "content-length": body.byteLength,
        "content-type": plan.contentType ?? "application/json",
        ...(plan.headers ?? {})
      });
      response.end(body);
    });
  }
}

const baseProvider = (): MimoAsrProviderConfig => parseSpeechProviderConfig({
  speech: {
    providers: [{
      api_key_ref: "secret://mimo_paygo",
      data_clearance: { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] },
      endpoint_profile: "mimo-paygo-cn",
      id: "mimo-asr",
      language: "auto",
      limits: { max_input_bytes: 7_000_000, max_response_bytes: 1_048_576, max_transcript_chars: 20_000 },
      model: "mimo-v2.5-asr",
      stage: "asr",
      transport: "mimo-v2.5-asr-chat-http"
    }],
    roles: { asr: { fallback: [], primary: "mimo-asr" } }
  }
}).asrCandidates[0] as MimoAsrProviderConfig;

const requestDirect = async (
  fake: FakeMimoServer,
  options: {
    readonly audio?: Buffer;
    readonly deadlineMs?: number;
    readonly mime?: "audio/mpeg" | "audio/wav";
    readonly mode?: SpeechProviderWorkerTestMode;
  } = {}
): Promise<{ readonly interpreterSource: "discovered" | "test-override"; readonly pythonVersion: string; readonly result: SpeechWorkerAsrResult; readonly workerPid: number }> => {
  const audio = options.audio ?? wavFixture;
  const root = await mkdtemp(join(tmpdir(), "fairy-mimo-test-input-"));
  await writeFile(join(root, "asr-input.bin"), audio);
  const worker = new SpeechWorkerProcess({
    ...(options.deadlineMs ? { deadlines: { requestMs: options.deadlineMs } } : {}),
    provider: {
      credential: fakeCredential,
      inputRoot: root,
      kind: "mimo-asr",
      testLoopbackPort: fake.port,
      ...(options.mode ? { testMode: options.mode } : {})
    }
  });
  try {
    const ready = await worker.start();
    const result = await worker.requestProviderAsr({
      artifact: {
        audioRef: "art_aaaaaaaaaaaaaaaaaaaa",
        inputToken: "asr-input.bin",
        mime: options.mime ?? "audio/wav",
        sha256: digest(audio),
        sizeBytes: audio.byteLength
      },
      provider: baseProvider(),
      requestId: `req_${Date.now()}_${Math.random()}`,
      utteranceId: "utt_direct"
    });
    return { interpreterSource: ready.interpreter.source, pythonVersion: ready.pythonVersion, result, workerPid: ready.processId };
  } finally {
    await worker.shutdown("test cleanup").catch(() => worker.terminateForTest("test forced cleanup"));
    await rm(root, { force: true, recursive: true });
  }
};

const providerBlock = (): string[] => [
  "    - id: mimo-asr",
  "      stage: asr",
  "      transport: mimo-v2.5-asr-chat-http",
  "      endpoint_profile: mimo-paygo-cn",
  "      model: mimo-v2.5-asr",
  "      api_key_ref: secret://mimo_paygo",
  "      language: auto",
  "      limits:",
  "        max_input_bytes: 7000000",
  "        max_response_bytes: 1048576",
  "        max_transcript_chars: 20000",
  "      data_clearance:",
  "        max_sensitivity: personal",
  "        residency: [region-restricted, global-ok]",
  "        regions: [cn]"
];

const writeGatewayConfig = async (path: string, dataDir: string, modelUrl: string, token: string, homeRegion = "cn"): Promise<void> => {
  await writeFile(path, [
    "models:",
    "  - id: mock-main",
    "    transport: openai-chat",
    `    base_url: ${JSON.stringify(modelUrl)}`,
    "    model: mock-model",
    "    data_clearance:",
    "      max_sensitivity: personal",
    "      residency: [region-restricted]",
    `      regions: [${homeRegion}]`,
    "roles:",
    "  main:",
    "    model: mock-main",
    "gateway:",
    "  port: 0",
    `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
    "  auth:",
    `    token: ${JSON.stringify(token)}`,
    "governance:",
    "  profile: balanced",
    `  home_regions: [${homeRegion}]`,
    "persona:",
    "  enabled: false",
    "affect:",
    "  enabled: false",
    "speech:",
    "  providers:",
    ...providerBlock(),
    "  roles:",
    "    asr:",
    "      primary: mimo-asr",
    "      fallback: []"
  ].join("\n"), "utf8");
};

const runGatewayAsr = async (client: MockFairyClient, sid: string, audioRef: string): Promise<{ readonly ack: Record<string, unknown>; readonly events: readonly EventEnvelope[] }> => {
  const beforeEvents = client.events().length;
  const beforeFrames = client.frames().length;
  client.sendRaw({ audio_ref: audioRef, op: "voice.asr", sid });
  const ack = await client.waitForFrame((frame) => frame.kind === "ack" && frame.op === "voice.asr" && client.frames().indexOf(frame) >= beforeFrames, 90_000);
  return { ack: ack as Record<string, unknown>, events: client.events().slice(beforeEvents) };
};

const tempAsrRoots = async (): Promise<string[]> => (await readdir(tmpdir(), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("fairy-mimo-asr-"))
  .map((entry) => entry.name)
  .sort();

const waitUntil = async (condition: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for deterministic test condition");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
};

const createAsrBarrier = (): {
  readonly pause: () => Promise<void>;
  readonly reached: Promise<void>;
  readonly release: () => void;
} => {
  let markReached: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>((resolvePromise) => {
    markReached = resolvePromise;
  });
  const released = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return {
    pause: async () => {
      markReached();
      await released;
    },
    reached,
    release
  };
};

const mimoServers: FakeMimoServer[] = [];
const modelServers: MockOpenAIChatServer[] = [];
const gateways: MinimalGateway[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.allSettled(gateways.splice(0).map((gateway) => gateway.stop()));
  await Promise.allSettled(mimoServers.splice(0).map((server) => server.stop()));
  await Promise.allSettled(modelServers.splice(0).map((server) => server.stop()));
  await Promise.allSettled(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe.sequential("voice.mimo-asr-provider-v0", () => {
  it("Case A extracts provider orchestration while keeping one TurnRunner and a smaller server", async () => {
    const server = await readFile(join(repoRoot, "apps/gateway/src/server.ts"), "utf8");
    const coordinator = await readFile(join(repoRoot, "apps/gateway/src/speech-provider-coordinator.ts"), "utf8");
    expect(server.split(/\r?\n/).filter((line) => line.length > 0).length).toBeLessThan(1_629);
    expect((server.match(/new TurnRunner\(/g) ?? [])).toHaveLength(1);
    expect(server).toContain("#submitVoiceFinalTranscript");
    expect(server).not.toContain("minimax-t2a-v2-http");
    expect(server).not.toContain("mimo-v2.5-asr-chat-http");
    expect(server).toContain("const runnerCancelled = this.#runner.cancel(message.sid)");
    expect(server).toContain("const asrCancelled = await this.#speechProviders.cancelAsr(message.sid)");
    expect(server).toContain("gateway ASR barriers are available only to code-gated tests");
    expect(server).not.toMatch(/#runner\.cancel\([^)]*\)\s*\|\|/);
    expect(coordinator).toContain("runTts");
    expect(coordinator).toContain("runAsr");
    expect(coordinator).not.toContain("TurnRunner");
  });

  it("Case B accepts only the closed pay-go config and never discloses credential mismatch", () => {
    const provider = baseProvider();
    expect(provider).toMatchObject({ endpointProfile: "mimo-paygo-cn", model: "mimo-v2.5-asr", stage: "asr" });
    expect(provider.dataClearance).toEqual({ max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] });
    expect(mimoAsrEndpointProfiles).toEqual({ "mimo-paygo-cn": "https://api.xiaomimimo.com/v1/chat/completions" });
    expect(resolveMimoCredential(provider, { mimo_paygo: fakeCredential })).toBe(fakeCredential);
    expect(() => resolveMimoCredential(provider, { mimo_paygo: "tp-token-plan" })).toThrowError(expect.objectContaining({ code: "MIMO_ASR_CREDENTIAL_KIND_MISMATCH" }));
    for (const patch of [
      { endpoint_profile: "mimo-token-plan-cn" },
      { model: "mimo-other" },
      { transport: "openai-chat" },
      { language: "fr" },
      { endpoint_url: "https://evil.invalid" },
      { authorization: "Bearer" },
      { stream: false }
    ]) {
      const speech = { providers: [{ ...{
        api_key_ref: "secret://mimo_paygo", data_clearance: { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] }, endpoint_profile: "mimo-paygo-cn", id: "mimo-asr", language: "auto", model: "mimo-v2.5-asr", stage: "asr", transport: "mimo-v2.5-asr-chat-http"
      }, ...patch }], roles: { asr: { fallback: [], primary: "mimo-asr" } } };
      expect(() => loadConfig({ sessionOverrides: { speech } })).toThrow();
    }
    for (const dataClearance of [
      { max_sensitivity: "secret", regions: ["cn"], residency: ["region-restricted", "global-ok"] },
      { max_sensitivity: "personal", regions: ["cn"], residency: ["local-only"] },
      { max_sensitivity: "personal", regions: ["us"], residency: ["region-restricted", "global-ok"] },
      { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted"] },
      { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "region-restricted"] },
      { max_sensitivity: "personal", residency: ["region-restricted", "global-ok"] },
      { max_sensitivity: "personal", regions: ["cn", "us"], residency: ["region-restricted", "global-ok"] },
      { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"], scope: "broader" }
    ]) {
      const speech = { providers: [{
        api_key_ref: "secret://mimo_paygo", data_clearance: dataClearance, endpoint_profile: "mimo-paygo-cn", id: "mimo-asr", language: "auto", model: "mimo-v2.5-asr", stage: "asr", transport: "mimo-v2.5-asr-chat-http"
      }], roles: { asr: { fallback: [], primary: "mimo-asr" } } };
      expect(() => loadConfig({ sessionOverrides: { speech } })).toThrow();
      expect(() => parseSpeechProviderConfig({ speech })).toThrow();
    }
  });

  it("Case B rejects unknown, duplicate, cross-stage, and fallback ASR role bindings", () => {
    const provider = { api_key_ref: "secret://mimo_paygo", data_clearance: { max_sensitivity: "personal", regions: ["cn"], residency: ["region-restricted", "global-ok"] }, endpoint_profile: "mimo-paygo-cn", id: "mimo", language: "auto", model: "mimo-v2.5-asr", stage: "asr", transport: "mimo-v2.5-asr-chat-http" };
    expect(() => parseSpeechProviderConfig({ speech: { providers: [provider, provider], roles: { asr: { fallback: [], primary: "mimo" } } } })).toThrow(/duplicate/);
    expect(() => parseSpeechProviderConfig({ speech: { providers: [provider], roles: { asr: { fallback: [], primary: "missing" } } } })).toThrow(/unknown/);
    expect(() => parseSpeechProviderConfig({ speech: { providers: [provider], roles: { asr: { fallback: ["mimo"], primary: "mimo" } } } })).toThrow(/fallback/);
  });

  it("Case C validates WAV and MP3 input artifacts and rejects wrong kind, magic, size, and hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-mimo-artifacts-"));
    tempRoots.push(root);
    const registry = new ArtifactRegistry(join(root, "artifacts"));
    const labels: Labels = { residency: "region-restricted", sensitivity: "personal" };
    const wav = await registry.register({ content: wavFixture, kind: "input", labels, mime: "audio/wav", origin: "test", sourceFilename: "input.wav" });
    const mp3 = await registry.register({ content: mp3Fixture, kind: "input", labels, mime: "audio/mpeg", origin: "test", sourceFilename: "input.mp3" });
    expect(await validateSpeechInputArtifact(registry, wav.record.artifact_id, 7_000_000)).toMatchObject({ mime: "audio/wav", sizeBytes: wavFixture.byteLength });
    expect(await validateSpeechInputArtifact(registry, mp3.record.artifact_id, 7_000_000)).toMatchObject({ mime: "audio/mpeg", sizeBytes: mp3Fixture.byteLength });
    const aliasRoot = await mkdtemp(join(tmpdir(), "fairy-mimo-artifact-alias-"));
    tempRoots.push(aliasRoot);
    const physical = join(aliasRoot, "physical");
    const logical = join(aliasRoot, "logical");
    await mkdir(physical);
    await symlink(physical, logical, process.platform === "win32" ? "junction" : "dir");
    const aliasRegistry = new ArtifactRegistry(join(logical, "artifacts"));
    const aliased = await aliasRegistry.register({ content: wavFixture, kind: "input", labels, mime: "audio/wav", origin: "test", sourceFilename: "alias.wav" });
    expect(await validateSpeechInputArtifact(aliasRegistry, aliased.record.artifact_id, 7_000_000)).toMatchObject({ mime: "audio/wav", sizeBytes: wavFixture.byteLength });
    const speech = await registry.register({ content: Buffer.concat([mp3Fixture, Buffer.from([1])]), kind: "speech", labels, mime: "audio/mpeg", origin: "test", sourceFilename: "speech.mp3" });
    await expect(validateSpeechInputArtifact(registry, speech.record.artifact_id, 7_000_000)).rejects.toMatchObject({ code: "SPEECH_ASR_ARTIFACT_KIND_INVALID" });
    const wrongMagic = await registry.register({ content: Buffer.from("not a wav"), kind: "input", labels, mime: "audio/wav", origin: "test", sourceFilename: "bad.wav" });
    await expect(validateSpeechInputArtifact(registry, wrongMagic.record.artifact_id, 7_000_000)).rejects.toMatchObject({ code: "SPEECH_ASR_ARTIFACT_FORMAT_MISMATCH" });
    await expect(validateSpeechInputArtifact(registry, wav.record.artifact_id, 4)).rejects.toMatchObject({ code: "SPEECH_ASR_ARTIFACT_SIZE_INVALID" });
    await writeFile(wav.record.path, Buffer.concat([wavFixture, Buffer.from([9])]));
    await expect(validateSpeechInputArtifact(registry, wav.record.artifact_id, 7_000_000)).rejects.toMatchObject({ code: "SPEECH_ASR_ARTIFACT_SIZE_MISMATCH" });
  });

  it("Case C stages one fixed token and rejects traversal, absolute, UNC, drive, ADS, symlinks, and partial files", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-mimo-stage-"));
    tempRoots.push(root);
    const artifact = { audioRef: "art_aaaaaaaaaaaaaaaaaaaa", bytes: wavFixture, mime: "audio/wav" as const, record: {} as never, sha256: digest(wavFixture), sizeBytes: wavFixture.byteLength };
    expect(await stageSpeechInputArtifact(root, artifact)).toEqual({ stagedBytes: wavFixture.byteLength, token: "asr-input.bin" });
    for (const token of ["../asr-input.bin", "C:asr-input.bin", "C:\\asr-input.bin", "\\\\server\\share", "asr-input.bin:stream", "nested/asr-input.bin"]) {
      expect(() => resolveSpeechWorkerInput(root, token)).toThrow(SpeechInputArtifactValidationError);
    }
    const symlinkRoot = await mkdtemp(join(tmpdir(), "fairy-mimo-symlink-"));
    tempRoots.push(symlinkRoot);
    await symlink(join(root, "asr-input.bin"), join(symlinkRoot, "asr-input.bin")).catch(() => undefined);
    if ((await readdir(symlinkRoot)).length > 0) {
      await expect(stageSpeechInputArtifact(symlinkRoot, artifact)).rejects.toMatchObject({ code: "SPEECH_ASR_STAGE_INVALID" });
    }
    const partialRoot = await mkdtemp(join(tmpdir(), "fairy-mimo-partial-"));
    tempRoots.push(partialRoot);
    await writeFile(join(partialRoot, "asr-input.bin.partial"), wavFixture);
    await expect(stageSpeechInputArtifact(partialRoot, artifact)).rejects.toMatchObject({ code: "SPEECH_ASR_STAGE_INVALID" });
    expect(await readFile(join(partialRoot, "asr-input.bin.partial"))).toEqual(wavFixture);
  });

  it("Case D denies under-cleared audio before spawn, stage, connection, request, final, turn, or model", async () => {
    const mimo = await FakeMimoServer.start();
    mimoServers.push(mimo);
    const model = await MockOpenAIChatServer.start({ delayMs: 500, text: ["delayed turn answer"] });
    modelServers.push(model);
    const root = await mkdtemp(join(tmpdir(), "fairy-mimo-denial-"));
    tempRoots.push(root);
    const dataDir = join(root, "data");
    const configPath = join(root, "fairy.yaml");
    await writeGatewayConfig(configPath, dataDir, model.url, "denial-token");
    const registry = new ArtifactRegistry(join(dataDir, "artifacts"));
    const registered = await registry.register({ content: wavFixture, kind: "input", labels: { residency: "local-only", sensitivity: "secret" }, mime: "audio/wav", origin: "test", sourceFilename: "secret.wav" });
    const gateway = new MinimalGateway(loadGatewayConfig({ configPath }, repoRoot, { ...process.env, mimo_paygo: fakeCredential }), { speechProviderLoopbackPorts: { "mimo-asr": mimo.port } });
    gateways.push(gateway);
    const address = await gateway.start();
    const client = await MockFairyClient.connect({ token: "denial-token", url: `ws://127.0.0.1:${address.port}` });
    const session = await client.createSession("MiMo denial");
    const result = await runGatewayAsr(client, session.sid, registered.record.artifact_id);
    expect(result.ack).toMatchObject({ asr_final_count: 0, model_request_count: 0, provider_connection_count: 0, provider_request_count: 0, staged_input_bytes: 0, turn_input_count: 0, worker_spawn_count: 0 });
    expect(result.events.some((event) => event.type === "speech.asr.final" || event.type === "turn.input")).toBe(false);
    expect(mimo.connections).toBe(0);
    expect(mimo.requestBytes).toBe(0);
    expect(model.requests).toBe(0);
    const beforeRoots = await tempAsrRoots();
    const beforeEvents = client.events().length;
    const beforeFrames = client.frames().length;
    client.sendTurnInputNoWait(session.sid, { content: [{ kind: "text", text: "hold the turn reservation" }] });
    await client.waitFor((event) => event.sid === session.sid && event.type === "turn.input", 10_000);
    client.sendRaw({ audio_ref: registered.record.artifact_id, op: "voice.asr", sid: session.sid });
    const rejected = await client.waitForFrame((frame) => frame.kind === "op-error" && frame.op === "voice.asr" && client.frames().indexOf(frame) >= beforeFrames, 10_000);
    expect(rejected).toMatchObject({ kind: "op-error", op: "voice.asr", sid: session.sid });
    expect(client.events().slice(beforeEvents).some((event) => event.type === "speech.asr.final")).toBe(false);
    expect(mimo.connections).toBe(0);
    expect(mimo.requestBytes).toBe(0);
    expect(await tempAsrRoots()).toEqual(beforeRoots);
    await client.waitFor((event) => event.sid === session.sid && event.type === "turn.final", 10_000);
    expect(model.requests).toBe(1);
    client.close();
  }, 120_000);

  it("Case E sends one exact api-key request with only the closed MiMo envelope", async () => {
    const mimo = await FakeMimoServer.start();
    mimoServers.push(mimo);
    const { interpreterSource, pythonVersion, result } = await requestDirect(mimo);
    expect(result).toMatchObject({ audioRef: "art_aaaaaaaaaaaaaaaaaaaa", text: "hello from MiMo", providerEvidence: { finishReason: "stop", model: "mimo-v2.5-asr", requestId: "mimo_fake_request_1", usageSeconds: 1.25 } });
    expect(mimo.requests).toHaveLength(1);
    const request = mimo.requests[0]!;
    expect(request).toMatchObject({ audioHash: digest(wavFixture), method: "POST", path: "/v1/chat/completions" });
    expect(request.headers["api-key"]).toBe(fakeCredential);
    expect(request.headers.authorization).toBeUndefined();
    expect(request.body).toEqual({
      asr_options: { language: "auto" },
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "data:audio/wav;base64,[REDACTED]" } }] }],
      model: "mimo-v2.5-asr"
    });
    expect(mimo.connections).toBe(1);
    expect(interpreterSource).toBe(process.env.FAIRY_TEST_PYTHON ? "test-override" : "discovered");
    expect(Number(pythonVersion.split(".")[0])).toBe(3);
    expect(Number(pythonVersion.split(".")[1])).toBeGreaterThanOrEqual(11);
  }, 120_000);

  it("Case E supports MP3 without adding another MIME or request shape", async () => {
    const mimo = await FakeMimoServer.start();
    mimoServers.push(mimo);
    await requestDirect(mimo, { audio: mp3Fixture, mime: "audio/mpeg" });
    expect(mimo.requests[0]).toMatchObject({ audioHash: digest(mp3Fixture) });
    expect(JSON.stringify(mimo.requests[0]?.body)).toContain("data:audio/mpeg;base64,[REDACTED]");
    expect(predictedMimoAsrRequestBytes(7_000_000, "audio/mpeg", "auto")).toBeLessThanOrEqual(mimoAsrDefaults.limits.maxEncodedRequestBytes);
  }, 120_000);

  it("Case F emits one canonical final, one turn, one model request, replayable JSONL, and no residue", async () => {
    const beforeRoots = await tempAsrRoots();
    const mimo = await FakeMimoServer.start([{ body: successResponse("gateway transcript") }]);
    mimoServers.push(mimo);
    const model = await MockOpenAIChatServer.start({ text: ["visible model answer"] });
    modelServers.push(model);
    const root = await mkdtemp(join(tmpdir(), "fairy-mimo-success-"));
    tempRoots.push(root);
    const dataDir = join(root, "data");
    const configPath = join(root, "fairy.yaml");
    await writeGatewayConfig(configPath, dataDir, model.url, "success-token");
    const registered = await new ArtifactRegistry(join(dataDir, "artifacts")).register({ content: wavFixture, kind: "input", labels: { residency: "region-restricted", sensitivity: "personal" }, mime: "audio/wav", origin: "test", sourceFilename: "input.wav" });
    const gateway = new MinimalGateway(loadGatewayConfig({ configPath }, repoRoot, { ...process.env, mimo_paygo: fakeCredential }), { speechProviderLoopbackPorts: { "mimo-asr": mimo.port } });
    gateways.push(gateway);
    const address = await gateway.start();
    const client = await MockFairyClient.connect({ token: "success-token", url: `ws://127.0.0.1:${address.port}` });
    const session = await client.createSession("MiMo success");
    const result = await runGatewayAsr(client, session.sid, registered.record.artifact_id);
    client.close();
    expect(result.ack).toMatchObject({ asr_final_count: 1, error_category: "none", error_status: "none", model_request_count: 1, provider_connection_count: 1, provider_request_count: 1, transcript_text: "gateway transcript", turn_input_count: 1, worker_spawn_count: 1 });
    expect(result.events.filter((event) => event.type === "speech.asr.final")).toHaveLength(1);
    expect(result.events.find((event) => event.type === "speech.asr.final")).toMatchObject({ labels: { residency: "region-restricted", sensitivity: "personal" }, payload: { audio_ref: registered.record.artifact_id, text: "gateway transcript" } });
    expect(result.events.filter((event) => event.type === "turn.input")).toHaveLength(1);
    expect(model.requests).toBe(1);
    const log = await readFile(join(dataDir, "sessions", session.sid, "log.jsonl"), "utf8");
    expect(log).toContain('"type":"speech.asr.final"');
    expect(log).not.toContain(fakeCredential);
    expect(log).not.toContain("data:audio/");
    expect(log).not.toMatch(/[A-Za-z0-9+/]{120,}={0,2}/);
    expect(await tempAsrRoots()).toEqual(beforeRoots);
  }, 120_000);

  it("Cases G-H reject malformed successes and map every required HTTP status without retry", async () => {
    const statusCases = [[400, "INVALID_REQUEST"], [401, "UNAUTHORIZED"], [402, "BALANCE_EXHAUSTED"], [403, "ACCESS_DENIED"], [404, "ENDPOINT_OR_MODEL"], [421, "SAFETY_BLOCKED"], [429, "RATE_LIMITED"], [500, "PROVIDER_TRANSIENT"], [503, "PROVIDER_UNAVAILABLE"]] as const;
    const plans: FakePlan[] = statusCases.map(([status]) => ({ body: { error: "bounded" }, status }));
    plans.push(
      { body: { ...successResponse(), model: "wrong-model" } },
      { body: { ...successResponse(), choices: [] } },
      { body: "data: chunk\n\n", contentType: "text/event-stream" },
      { body: "not-json" },
      { body: Buffer.alloc(1_048_577, 0x20) },
      { body: successResponse(), headers: { location: "http://127.0.0.1:1/redirect" }, status: 302 }
    );
    const mimo = await FakeMimoServer.start(plans);
    mimoServers.push(mimo);
    for (const [, expected] of statusCases) {
      await expect(requestDirect(mimo)).rejects.toMatchObject({ code: `SPEECH_WORKER_${expected}` });
    }
    for (let index = 0; index < 6; index += 1) {
      await expect(requestDirect(mimo)).rejects.toMatchObject({ code: expect.stringMatching(/SPEECH_WORKER_(PROVIDER_PROTOCOL|INVALID_OUTPUT)/) });
    }
    expect(mimo.requests).toHaveLength(statusCases.length + 6);
  }, 240_000);

  it("Case I bounds crash, malformed output, and supervisor timeout with no staging residue", async () => {
    const beforeRoots = await tempAsrRoots();
    const mimo = await FakeMimoServer.start([{ hang: true }]);
    mimoServers.push(mimo);
    await expect(requestDirect(mimo, { mode: "crash" })).rejects.toMatchObject({ code: "SPEECH_WORKER_EXITED" });
    await expect(requestDirect(mimo, { mode: "malformed" })).rejects.toMatchObject({ code: expect.stringMatching(/SPEECH_WORKER_(MALFORMED_OUTPUT|PROTOCOL_FAILED)/) });
    await expect(requestDirect(mimo, { deadlineMs: 250, mode: "timeout" })).rejects.toMatchObject({ code: "SPEECH_WORKER_REQUEST_TIMEOUT" });

    const preWorkerBarrier = createAsrBarrier();
    const immediateMimo = await FakeMimoServer.start();
    mimoServers.push(immediateMimo);
    const immediateModel = await MockOpenAIChatServer.start({ text: ["must not run"] });
    modelServers.push(immediateModel);
    const immediateRoot = await mkdtemp(join(tmpdir(), "fairy-mimo-immediate-cancel-"));
    tempRoots.push(immediateRoot);
    const immediateDataDir = join(immediateRoot, "data");
    const immediateConfigPath = join(immediateRoot, "fairy.yaml");
    await writeGatewayConfig(immediateConfigPath, immediateDataDir, immediateModel.url, "immediate-cancel-token");
    const immediateArtifact = await new ArtifactRegistry(join(immediateDataDir, "artifacts")).register({ content: wavFixture, kind: "input", labels: { residency: "region-restricted", sensitivity: "personal" }, mime: "audio/wav", origin: "test", sourceFilename: "immediate.wav" });
    const immediateGateway = new MinimalGateway(loadGatewayConfig({ configPath: immediateConfigPath }, repoRoot, { ...process.env, mimo_paygo: fakeCredential }), {
      beforeAsrCoordinator: preWorkerBarrier.pause,
      speechProviderLoopbackPorts: { "mimo-asr": immediateMimo.port }
    });
    gateways.push(immediateGateway);
    const immediateAddress = await immediateGateway.start();
    const immediateClient = await MockFairyClient.connect({ token: "immediate-cancel-token", url: `ws://127.0.0.1:${immediateAddress.port}` });
    const immediateSession = await immediateClient.createSession("MiMo immediate cancel");
    immediateClient.sendRaw({ audio_ref: immediateArtifact.record.artifact_id, op: "voice.asr", sid: immediateSession.sid });
    await preWorkerBarrier.reached;
    immediateClient.sendRaw({ op: "turn.cancel", sid: immediateSession.sid });
    const immediateCancelAck = await immediateClient.waitForFrame((frame) => frame.kind === "ack" && frame.op === "turn.cancel", 10_000);
    preWorkerBarrier.release();
    const immediateAsrAck = await immediateClient.waitForFrame((frame) => frame.kind === "ack" && frame.op === "voice.asr", 10_000);
    expect(immediateCancelAck).toMatchObject({ cancelled: true });
    expect(immediateAsrAck).toMatchObject({ asr_final_count: 0, cancelled: true, error_category: "cancelled", model_request_count: 0, provider_connection_count: 0, provider_request_count: 0, staged_input_bytes: 0, transcript_text: "", turn_input_count: 0, worker_spawn_count: 0 });
    expect(immediateClient.events().some((event) => event.type === "speech.asr.final" || event.type === "turn.input")).toBe(false);
    expect(immediateMimo.connections).toBe(0);
    expect(immediateMimo.requestBytes).toBe(0);
    expect(immediateMimo.requests).toHaveLength(0);
    expect(immediateModel.requests).toBe(0);
    immediateClient.close();
    expect(await tempAsrRoots()).toEqual(beforeRoots);

    const preCanonicalBarrier = createAsrBarrier();
    const completedMimo = await FakeMimoServer.start([{ body: successResponse("discarded transcript") }]);
    mimoServers.push(completedMimo);
    const completedModel = await MockOpenAIChatServer.start({ text: ["must not run"] });
    modelServers.push(completedModel);
    const completedRoot = await mkdtemp(join(tmpdir(), "fairy-mimo-pre-canonical-cancel-"));
    tempRoots.push(completedRoot);
    const completedDataDir = join(completedRoot, "data");
    const completedConfigPath = join(completedRoot, "fairy.yaml");
    await writeGatewayConfig(completedConfigPath, completedDataDir, completedModel.url, "pre-canonical-cancel-token");
    const completedArtifact = await new ArtifactRegistry(join(completedDataDir, "artifacts")).register({ content: wavFixture, kind: "input", labels: { residency: "region-restricted", sensitivity: "personal" }, mime: "audio/wav", origin: "test", sourceFilename: "completed.wav" });
    const completedGateway = new MinimalGateway(loadGatewayConfig({ configPath: completedConfigPath }, repoRoot, { ...process.env, mimo_paygo: fakeCredential }), {
      beforeAsrCanonicalFinal: preCanonicalBarrier.pause,
      speechProviderLoopbackPorts: { "mimo-asr": completedMimo.port }
    });
    gateways.push(completedGateway);
    const completedAddress = await completedGateway.start();
    const completedClient = await MockFairyClient.connect({ token: "pre-canonical-cancel-token", url: `ws://127.0.0.1:${completedAddress.port}` });
    const completedSession = await completedClient.createSession("MiMo pre-canonical cancel");
    completedClient.sendRaw({ audio_ref: completedArtifact.record.artifact_id, op: "voice.asr", sid: completedSession.sid });
    await preCanonicalBarrier.reached;
    expect(completedMimo.requests).toHaveLength(1);
    completedClient.sendRaw({ op: "turn.cancel", sid: completedSession.sid });
    const completedCancelAck = await completedClient.waitForFrame((frame) => frame.kind === "ack" && frame.op === "turn.cancel", 10_000);
    preCanonicalBarrier.release();
    const completedAsrAck = await completedClient.waitForFrame((frame) => frame.kind === "ack" && frame.op === "voice.asr", 10_000);
    expect(completedCancelAck).toMatchObject({ cancelled: true });
    expect(completedAsrAck).toMatchObject({ asr_final_count: 0, cancelled: true, error_category: "cancelled", error_status: "asr_cancelled", model_request_count: 0, provider_connection_count: 1, provider_request_count: 1, staged_input_bytes: wavFixture.length, transcript_text: "", turn_input_count: 0, worker_spawn_count: 1 });
    expect(completedClient.events().some((event) => event.type === "speech.asr.final" || event.type === "turn.input")).toBe(false);
    expect(completedModel.requests).toBe(0);
    completedClient.close();
    expect(await tempAsrRoots()).toEqual(beforeRoots);

    const cancelMimo = await FakeMimoServer.start([{ hang: true }]);
    mimoServers.push(cancelMimo);
    const model = await MockOpenAIChatServer.start({ text: ["must not run"] });
    modelServers.push(model);
    const root = await mkdtemp(join(tmpdir(), "fairy-mimo-cancel-"));
    tempRoots.push(root);
    const dataDir = join(root, "data");
    const configPath = join(root, "fairy.yaml");
    await writeGatewayConfig(configPath, dataDir, model.url, "cancel-token");
    const registered = await new ArtifactRegistry(join(dataDir, "artifacts")).register({ content: wavFixture, kind: "input", labels: { residency: "region-restricted", sensitivity: "personal" }, mime: "audio/wav", origin: "test", sourceFilename: "cancel.wav" });
    const gateway = new MinimalGateway(loadGatewayConfig({ configPath }, repoRoot, { ...process.env, mimo_paygo: fakeCredential }), { speechProviderLoopbackPorts: { "mimo-asr": cancelMimo.port } });
    gateways.push(gateway);
    const address = await gateway.start();
    const client = await MockFairyClient.connect({ token: "cancel-token", url: `ws://127.0.0.1:${address.port}` });
    const session = await client.createSession("MiMo cancel");
    client.sendRaw({ audio_ref: registered.record.artifact_id, op: "voice.asr", sid: session.sid });
    await waitUntil(() => cancelMimo.requests.length === 1);
    const beforeTurnEvents = client.events().length;
    const beforeTurnFrames = client.frames().length;
    client.sendTurnInputNoWait(session.sid, { content: [{ kind: "text", text: "must not overlap active ASR" }] });
    const turnRejected = await client.waitForFrame((frame) => frame.kind === "op-error" && frame.op === "turn.input" && client.frames().indexOf(frame) >= beforeTurnFrames, 10_000);
    expect(turnRejected).toMatchObject({ kind: "op-error", op: "turn.input", sid: session.sid });
    expect(client.events().slice(beforeTurnEvents).some((event) => event.type === "turn.input")).toBe(false);
    expect(model.requests).toBe(0);
    client.sendRaw({ op: "turn.cancel", sid: session.sid });
    const cancelAck = await client.waitForFrame((frame) => frame.kind === "ack" && frame.op === "turn.cancel", 10_000);
    const asrAck = await client.waitForFrame((frame) => frame.kind === "ack" && frame.op === "voice.asr", 10_000);
    client.close();
    expect(cancelAck).toMatchObject({ cancelled: true });
    expect(asrAck).toMatchObject({ asr_final_count: 0, cancelled: true, error_category: "cancelled", model_request_count: 0, turn_input_count: 0 });
    expect(model.requests).toBe(0);
    expect(await tempAsrRoots()).toEqual(beforeRoots);
  }, 120_000);

  it("Case J keeps credentials, audio, base64, paths, and provider bodies out of wire and source diagnostics", async () => {
    const fixture = JSON.parse(await readFile(join(repoRoot, "packages/testing/fixtures/speech/asr.request.valid-wav.json"), "utf8")) as Record<string, unknown>;
    const encoded = encodeSpeechWorkerWireMessage(fixture as never);
    expect(encoded).not.toContain(fakeCredential);
    expect(encoded).not.toContain("base64");
    expect(encoded).not.toContain("data:audio/");
    expect(encoded).not.toContain(tmpdir());
    const workerSource = await readFile(join(repoRoot, "workers/speech/mimo_asr_worker.py"), "utf8");
    expect(workerSource).not.toContain("print(");
    expect(workerSource).not.toContain("response_body.decode");
    expect(workerSource).not.toContain("Authorization");
  });

  it("Cases K-L enforce Python 3.11, golden wire fixtures, source policy, and residual boundaries", async () => {
    expect(() => assertSupportedSpeechWorkerPythonVersion("3.10.99")).toThrow();
    expect(() => assertSupportedSpeechWorkerPythonVersion("3.11.0")).not.toThrow();
    const wav = JSON.parse(await readFile(join(repoRoot, "packages/testing/fixtures/speech/asr.request.valid-wav.json"), "utf8")) as Record<string, unknown>;
    const mp3 = JSON.parse(await readFile(join(repoRoot, "packages/testing/fixtures/speech/asr.request.valid-mp3.json"), "utf8")) as Record<string, unknown>;
    const invalid = JSON.parse(await readFile(join(repoRoot, "packages/testing/fixtures/speech/asr.request.invalid.json"), "utf8")) as Array<{ patch: Record<string, unknown> }>;
    expect(validateSpeechWorkerWireMessage(wav)).toMatchObject({ ok: true });
    expect(validateSpeechWorkerWireMessage(mp3)).toMatchObject({ ok: true });
    expect(decodeSpeechWorkerWireMessage(`${encodeSpeechWorkerWireMessage(wav as never)}\r`)).toEqual(wav);
    for (const fixture of invalid) {
      expect(validateSpeechWorkerWireMessage({ ...wav, ...fixture.patch })).toMatchObject({ ok: false });
    }
    const sourceBytes = await readFile(join(repoRoot, "workers/speech/mimo_asr_worker.py"));
    const source = sourceBytes.toString("ascii");
    expect([...sourceBytes].every((byte) => byte <= 0x7f)).toBe(true);
    expect(source).toContain("urllib.request.ProxyHandler({})");
    expect(source).toContain("NoRedirectHandler()");
    expect(source).toContain("ssl.create_default_context()");
    expect(source).not.toMatch(/^\s*(?:from|import)\s+(?:socket|subprocess|requests|openai|pyaudio|sounddevice)\b/m);
    expect(source).not.toMatch(/\b(?:microphone|speaker|websocket|pip install|ffmpeg)\b/i);
    expect(source).toContain('ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions"');
  });
});
