import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { ArtifactRegistry } from "@fairy/artifacts";
import { createEventId, createSessionId, validateEvent, type EventEnvelope, type Labels } from "@fairy/protocol";
import {
  MinimalGateway,
  WebVoiceHttp,
  parseCanonicalWebWav,
  projectEventForWeb,
  webVoiceMaximumSamples,
  webVoiceMaximumWavBytes
} from "../../../apps/gateway/src/index.js";
import { loadGatewayConfig } from "../../../apps/gateway/src/config.js";
import { MockFairyClient, MockOpenAIChatServer } from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const labels: Labels = { residency: "region-restricted", sensitivity: "personal" };
const fakeMimoCredential = "sk-R09_WEB_FAKE_PAYGO_DO_NOT_USE";
const fakeMiniMaxCredential = "R09_WEB_FAKE_MINIMAX_DO_NOT_USE";
const mp3Fixture = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 4, 0xff, 0xfb, 0x90, 0x64]);

const canonicalWav = (sampleCount: number, fill = 0): Buffer => {
  const bytes = Buffer.alloc(44 + sampleCount * 2, fill);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
};

const readJson = async (response: Response): Promise<Record<string, unknown>> => await response.json() as Record<string, unknown>;

const withDeadline = async <T>(name: string, promise: Promise<T>, ms = 10_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${name}`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

class FakeSpeechProvider {
  readonly kind: "mimo" | "minimax";
  readonly requests: { readonly body: string; readonly headers: IncomingMessage["headers"] }[] = [];
  readonly #server: Server;
  readonly #fail: boolean;
  #connections = 0;
  #port = 0;

  private constructor(kind: "mimo" | "minimax", fail: boolean) {
    this.kind = kind;
    this.#fail = fail;
    this.#server = createServer((request, response) => this.#handle(request, response));
    this.#server.on("connection", () => { this.#connections += 1; });
  }

  static async start(kind: "mimo" | "minimax", fail = false): Promise<FakeSpeechProvider> {
    const fake = new FakeSpeechProvider(kind, fail);
    await withDeadline(`${kind} fake listen`, new Promise<void>((resolvePromise, reject) => {
      fake.#server.once("error", reject);
      fake.#server.listen(0, "127.0.0.1", () => {
        const address = fake.#server.address();
        if (!address || typeof address !== "object") {
          reject(new Error(`${kind} fake did not bind`));
          return;
        }
        fake.#port = address.port;
        resolvePromise();
      });
    }));
    return fake;
  }

  get connections(): number { return this.#connections; }
  get port(): number { return this.#port; }

  async stop(): Promise<void> {
    this.#server.closeAllConnections?.();
    if (this.#server.listening) {
      await withDeadline(`${this.kind} fake close`, new Promise<void>((resolvePromise) => this.#server.close(() => resolvePromise())));
    }
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      this.requests.push({ body, headers: request.headers });
      if (this.kind === "mimo") {
        const value = {
          choices: [{ finish_reason: "stop", index: 0, message: { audio: null, content: "web gateway transcript", role: "assistant", tool_calls: null } }],
          id: "mimo_web_fake_request",
          model: "mimo-v2.5-asr",
          object: "chat.completion",
          usage: { audio_seconds: 0.1 }
        };
        const encoded = Buffer.from(JSON.stringify(value));
        response.writeHead(200, { "content-length": encoded.byteLength, "content-type": "application/json" });
        response.end(encoded);
        return;
      }
      const value = this.#fail
        ? { base_resp: { status_code: 1004, status_msg: `denied ${fakeMiniMaxCredential}` }, data: null }
        : {
            base_resp: { status_code: 0, status_msg: "success" },
            data: { audio: mp3Fixture.toString("hex"), status: 2 },
            extra_info: { audio_channel: 1, audio_format: "mp3", audio_sample_rate: 32_000, audio_size: mp3Fixture.byteLength, bitrate: 128_000 },
            trace_id: "web-fake-trace"
          };
      const encoded = Buffer.from(JSON.stringify(value));
      response.writeHead(200, { "content-length": encoded.byteLength, "content-type": "application/json" });
      response.end(encoded);
    });
  }
}

interface WebClient {
  readonly close: () => Promise<void>;
  readonly messages: readonly Record<string, unknown>[];
  readonly send: (value: unknown) => void;
  readonly waitFor: (predicate: (value: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

const connectWeb = (port: number, token: string): Promise<WebClient> => withDeadline("web socket open", new Promise((resolvePromise, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}&surface=web-v0`);
  const messages: Record<string, unknown>[] = [];
  const waiters: { readonly predicate: (value: Record<string, unknown>) => boolean; readonly resolve: (value: Record<string, unknown>) => void }[] = [];
  socket.on("message", (data) => {
    const value = JSON.parse(data.toString()) as Record<string, unknown>;
    messages.push(value);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter?.predicate(value)) {
        waiters.splice(index, 1);
        waiter.resolve(value);
      }
    }
  });
  socket.once("error", reject);
  socket.once("open", () => resolvePromise({
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>((resolveClosed) => socket.once("close", () => resolveClosed()));
      socket.close(1000, "test complete");
      await withDeadline("web socket close", closed);
    },
    messages,
    send: (value) => socket.send(JSON.stringify(value)),
    waitFor: (predicate, timeoutMs = 90_000) => {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return withDeadline("projected web message", new Promise<Record<string, unknown>>((resolveValue) => waiters.push({ predicate, resolve: resolveValue })), timeoutMs);
    }
  }));
}));

const waitForRejectedSocket = (port: number, token: string): Promise<number> => withDeadline("rejected web socket", new Promise((resolvePromise, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}&surface=web-v0`);
  socket.once("open", () => socket.send(JSON.stringify({ op: "session.create", title: "must-not-exist" })));
  socket.once("error", () => undefined);
  socket.once("close", (code) => resolvePromise(code));
  setTimeout(() => reject(new Error("unauthorized socket stayed open")), 5_000).unref();
}));

const writeGatewayConfig = async (path: string, dataDir: string, modelUrl: string, token: string, withSpeech: boolean): Promise<void> => {
  const speech = withSpeech ? [
    "speech:",
    "  providers:",
    "    - id: mimo-web",
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
    "        regions: [cn]",
    "    - id: minimax-web",
    "      stage: tts",
    "      transport: minimax-t2a-v2-http",
    "      endpoint_profile: cn-primary",
    "      model: speech-2.8-turbo",
    "      voice: { voice_id: male-qn-qingse, speed: 1, volume: 1, pitch: 0 }",
    "      api_key_ref: secret://minimax_token_plan",
    "      language_boost: auto",
    "      audio: { format: mp3, sample_rate: 32000, bitrate: 128000, channel: 1 }",
    "      limits: { max_text_chars: 3000, max_response_bytes: 67108864, max_audio_bytes: 33554432 }",
    "      data_clearance:",
    "        max_sensitivity: personal",
    "        residency: [region-restricted, global-ok]",
    "        regions: [cn]",
    "  roles:",
    "    asr: { primary: mimo-web, fallback: [] }",
    "    tts: { primary: minimax-web, fallback: [] }"
  ] : [];
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
    "  main: { model: mock-main }",
    "gateway:",
    "  port: 0",
    `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
    "  auth:",
    `    token: ${JSON.stringify(token)}`,
    "governance:",
    "  profile: balanced",
    "  home_regions: [cn]",
    "persona: { enabled: false }",
    "affect: { enabled: false }",
    ...speech
  ].join("\n"), "utf8");
};

const roots: string[] = [];
const gateways: MinimalGateway[] = [];
const models: MockOpenAIChatServer[] = [];
const providers: FakeSpeechProvider[] = [];
const sockets: { close: () => Promise<void> }[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.allSettled(sockets.splice(0).map((socket) => socket.close()));
  await Promise.allSettled(gateways.splice(0).map((gateway) => gateway.stop()));
  await Promise.allSettled(providers.splice(0).map((provider) => provider.stop()));
  await Promise.allSettled(models.splice(0).map((model) => model.stop()));
  await Promise.allSettled(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))));
  await Promise.allSettled(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const startGateway = async (withSpeech = false, ttsFailure = false): Promise<{
  readonly dataDir: string;
  readonly gateway: MinimalGateway;
  readonly mimo?: FakeSpeechProvider;
  readonly minimax?: FakeSpeechProvider;
  readonly model: MockOpenAIChatServer;
  readonly port: number;
  readonly token: string;
}> => {
  const root = await mkdtemp(join(tmpdir(), "fairy-web-ptt-testroot-"));
  roots.push(root);
  const dataDir = join(root, "data");
  const configPath = join(root, "fairy.yaml");
  const token = "web-test-token";
  const model = await MockOpenAIChatServer.start({ text: ["visible web answer"] });
  models.push(model);
  let mimo: FakeSpeechProvider | undefined;
  let minimax: FakeSpeechProvider | undefined;
  if (withSpeech) {
    mimo = await FakeSpeechProvider.start("mimo");
    minimax = await FakeSpeechProvider.start("minimax", ttsFailure);
    providers.push(mimo, minimax);
  }
  await writeGatewayConfig(configPath, dataDir, model.url, token, withSpeech);
  const config = loadGatewayConfig({ configPath }, repoRoot, {
    ...process.env,
    mimo_paygo: fakeMimoCredential,
    minimax_token_plan: fakeMiniMaxCredential
  });
  const gateway = new MinimalGateway(config, withSpeech && mimo && minimax ? {
    speechProviderLoopbackPorts: { "mimo-web": mimo.port, "minimax-web": minimax.port },
    speechProviderTempPrefix: "fairy-web-speech-"
  } : {});
  gateways.push(gateway);
  const address = await gateway.start();
  return { dataDir, gateway, ...(mimo ? { mimo } : {}), ...(minimax ? { minimax } : {}), model, port: address.port, token };
};

const createWebSession = async (client: WebClient): Promise<string> => {
  client.send({ op: "session.create", title: "Web test" });
  const created = await client.waitFor((message) => message.type === "session.created");
  if (typeof created.sid !== "string") throw new Error("projected session did not include sid");
  return created.sid;
};

const uploadWav = async (port: number, token: string, sid: string, wav: Buffer): Promise<Response> => fetch(
  `http://127.0.0.1:${port}/web/api/sessions/${sid}/input-audio`,
  { body: wav, headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/wav" }, method: "POST" }
);

const webHttpHarness = async (artifactsDir: string, options: {
  readonly afterUploadReservation?: (sid: `ses_${string}`) => Promise<void>;
  readonly busy?: () => boolean;
} = {}): Promise<{ readonly port: number; readonly sid: `ses_${string}`; readonly token: string }> => {
  const sid = createSessionId();
  const token = "http-harness-token";
  const controller = new WebVoiceHttp({
    artifactsDir,
    authToken: token,
    homeRegions: ["cn"],
    isSessionBusy: () => options.busy?.() ?? false,
    readSessionEvents: async () => [],
    sessionExists: (candidate) => candidate === sid,
    ...(options.afterUploadReservation ? { testOptions: { afterUploadReservation: options.afterUploadReservation } } : {}),
    voiceEnabled: true,
    voiceLabels: labels
  });
  const server = createServer((request, response) => { void controller.handle(request, response); });
  servers.push(server);
  await withDeadline("Web HTTP harness listen", new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  }));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Web HTTP harness did not bind");
  return { port: address.port, sid, token };
};

const event = (sid: `ses_${string}`, type: string, payload: Record<string, unknown>, turn: number): EventEnvelope => {
  const value = {
    actor: type === "speech.asr.final" ? "user" : type === "session.created" ? "system" : "agent",
    id: createEventId(),
    labels,
    payload,
    provenance: type === "speech.asr.final" ? "user" : "agent",
    sid,
    ts: new Date().toISOString(),
    turn,
    type,
    v: 1
  };
  const validated = validateEvent(value);
  if (!validated.ok) throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return validated.event;
};

describe.sequential("voice.web-ptt-v0", () => {
  it("Case A — architecture and static source policy", async () => {
    const server = await readFile(join(repoRoot, "apps/gateway/src/server.ts"), "utf8");
    const http = await readFile(join(repoRoot, "apps/gateway/src/web-voice-http.ts"), "utf8");
    const webRoot = join(repoRoot, "apps/web");
    const webPackage = JSON.parse(await readFile(join(webRoot, "package.json"), "utf8") as string) as Record<string, unknown>;
    const productionFiles = ["index.html", "styles.css", "app.js", "recorder.js", "wav.js", "audio-worklet.js"];
    const sources = (await Promise.all(productionFiles.map((file) => readFile(join(webRoot, file), "utf8")))).join("\n");
    expect((server.match(/new TurnRunner\(/g) ?? [])).toHaveLength(1);
    expect(server.split(/\r?\n/).filter(Boolean).length).toBeLessThan(1_629);
    expect(server).not.toMatch(/api\.minimaxi|api\.xiaomimimo|mimo-paygo-cn|cn-primary/);
    expect(sources).not.toMatch(/react|vite|https?:\/\/|MediaRecorder|WebM|Opus/i);
    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(sources).not.toMatch(/<style\b|<script(?![^>]*\bsrc=)/i);
    expect(await readdir(webRoot)).not.toContain("dist");
    expect(webPackage).not.toHaveProperty("dependencies");
    expect(http).toContain("staticAssets");
    expect(http).toContain("afterUploadReservation");
    expect(http).toContain("Web voice HTTP test seams are available only to code-gated tests");
    expect(http).not.toMatch(/join\([^\n]*(request|pathname|path)\b/);
    const started = await startGateway();
    for (const route of ["/web/", "/web/index.html", "/web/styles.css", "/web/app.js", "/web/recorder.js", "/web/wav.js", "/web/audio-worklet.js"]) {
      const response = await fetch(`http://127.0.0.1:${started.port}${route}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("content-security-policy")).toContain("connect-src 'self' ws://127.0.0.1:*");
    }
    const html = await (await fetch(`http://127.0.0.1:${started.port}/web/`)).text();
    expect(html).toContain("30 seconds or less");
    expect(html).toContain('id="replay-link"');
    expect(html).toContain('id="reset"');
    expect((await fetch(`http://127.0.0.1:${started.port}/web/server.ts`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${started.port}/web/%2e%2e%2fserver.ts`)).status).toBe(404);
  });

  it("Case B — PCM16 WAV encoder", async () => {
    const source = await readFile(join(repoRoot, "apps/web/wav.js"), "utf8");
    const wav = canonicalWav(3);
    expect(parseCanonicalWebWav(wav)).toMatchObject({ sampleCount: 3, sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(wav.readUInt32LE(4)).toBe(wav.byteLength - 8);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(source).toContain("floatToPcm16");
    expect(source).toContain("setInt16");
    expect(source).not.toMatch(/WebM|Opus/);
  });

  it("Case C — recorder sample clock and auto-stop", async () => {
    const source = await readFile(join(repoRoot, "apps/web/recorder.js"), "utf8");
    const app = await readFile(join(repoRoot, "apps/web/app.js"), "utf8");
    expect(source).toContain("WARNING_SAMPLES");
    expect(source).toContain("COUNTDOWN_SAMPLES");
    expect(source).toContain("MAXIMUM_SAMPLES - this.samples");
    expect(source).toContain("void this.finalizeAndSend()");
    expect(source.match(/async finalizeAndSend\(/g)).toHaveLength(1);
    expect(source).toContain("A recording is already active");
    expect(source).not.toMatch(/setTimeout|setInterval/);
    expect(app).toContain("if (!holdActive) finishRecording();");
    expect(app).toContain("if (recorder !== activeRecorder)");
    expect(app).toContain("window.addEventListener(\"pagehide\"");
    expect(app).not.toContain("let selectedSession");
    expect(app).toContain("binding.sid");
    expect(app).toContain("canChangeSelectedSession");
  });

  it("Case D — strict WAV parser boundaries", () => {
    expect(parseCanonicalWebWav(canonicalWav(1)).sampleCount).toBe(1);
    expect(parseCanonicalWebWav(canonicalWav(958_400)).durationMs).toBe(59_900);
    expect(parseCanonicalWebWav(canonicalWav(webVoiceMaximumSamples)).durationMs).toBe(60_000);
    const invalid: Buffer[] = [];
    invalid.push(canonicalWav(webVoiceMaximumSamples + 1));
    const wrongMagic = canonicalWav(2); wrongMagic.write("NOPE", 0, "ascii"); invalid.push(wrongMagic);
    const wrongData = canonicalWav(2); wrongData.write("JUNK", 36, "ascii"); invalid.push(wrongData);
    for (const [offset, value, width] of [[24, 8_000, 4], [22, 2, 2], [34, 8, 2], [20, 3, 2], [32, 4, 2], [28, 64_000, 4]] as const) {
      const copy = canonicalWav(2);
      if (width === 4) copy.writeUInt32LE(value, offset);
      else copy.writeUInt16LE(value, offset);
      invalid.push(copy);
    }
    invalid.push(canonicalWav(2).subarray(0, 43));
    const mismatch = canonicalWav(2); mismatch.writeUInt32LE(100, 40); invalid.push(mismatch);
    invalid.push(Buffer.concat([canonicalWav(2), Buffer.from([0, 0])]));
    const odd = canonicalWav(2).subarray(0, 47); odd.writeUInt32LE(39, 4); odd.writeUInt32LE(3, 40); invalid.push(odd);
    invalid.push(canonicalWav(0));
    for (const wav of invalid) expect(() => parseCanonicalWebWav(wav)).toThrow();
  });

  it("Case E — upload authentication and bounded body", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-web-http-")); roots.push(root);
    let busy = false;
    let barrierArmed = false;
    let signalReservation = (): void => undefined;
    let releaseReservation = (): void => undefined;
    const reservationReached = new Promise<void>((resolvePromise) => { signalReservation = resolvePromise; });
    const reservationRelease = new Promise<void>((resolvePromise) => { releaseReservation = resolvePromise; });
    const harness = await webHttpHarness(join(root, "artifacts"), {
      afterUploadReservation: async () => {
        if (!barrierArmed) return;
        signalReservation();
        await reservationRelease;
      },
      busy: () => busy
    });
    const url = `http://127.0.0.1:${harness.port}/web/api/sessions/${harness.sid}/input-audio`;
    const post = (body: Buffer, token = harness.token, contentType = "audio/wav") => fetch(url, { body, headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, method: "POST" });
    expect((await post(canonicalWav(2), "wrong")).status).toBe(401);
    expect((await fetch(url, { body: canonicalWav(2), headers: { "Content-Type": "audio/wav" }, method: "POST" })).status).toBe(401);
    expect((await fetch(url.replace(harness.sid, createSessionId()), { body: canonicalWav(2), headers: { Authorization: `Bearer ${harness.token}`, "Content-Type": "audio/wav" }, method: "POST" })).status).toBe(404);
    expect((await fetch(url.replace(harness.sid, "bad-session"), { body: canonicalWav(2), headers: { Authorization: `Bearer ${harness.token}`, "Content-Type": "audio/wav" }, method: "POST" })).status).toBe(400);
    busy = true; expect((await post(canonicalWav(2))).status).toBe(409); busy = false;
    expect((await post(canonicalWav(2), harness.token, "application/octet-stream")).status).toBe(415);
    expect((await fetch(url, { body: canonicalWav(2), headers: { Authorization: `Bearer ${harness.token}`, "Content-Encoding": "identity", "Content-Type": "audio/wav" }, method: "POST" })).status).toBe(415);
    expect((await post(Buffer.alloc(webVoiceMaximumWavBytes + 1))).status).toBe(413);
    expect((await post(Buffer.from("not a wav"))).status).toBe(400);
    expect((await new ArtifactRegistry(join(root, "artifacts")).list())).toHaveLength(0);
    const wav = canonicalWav(8_000);
    barrierArmed = true;
    const first = httpRequest(url, { headers: { Authorization: `Bearer ${harness.token}`, "Content-Length": wav.byteLength, "Content-Type": "audio/wav" }, method: "POST" });
    first.write(wav.subarray(0, 44));
    await withDeadline("first upload reservation", reservationReached);
    expect((await post(canonicalWav(2))).status).toBe(409);
    const firstResponse = new Promise<number>((resolvePromise) => first.on("response", (response) => { response.resume(); resolvePromise(response.statusCode ?? 0); }));
    releaseReservation();
    first.end(wav.subarray(44));
    expect(await withDeadline("first concurrent upload", firstResponse)).toBe(201);
    expect((await new ArtifactRegistry(join(root, "artifacts")).list())).toHaveLength(1);
  });

  it("Case F — upload success and governance", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-web-success-")); roots.push(root);
    const artifactsDir = join(root, "artifacts");
    const harness = await webHttpHarness(artifactsDir);
    const response = await uploadWav(harness.port, harness.token, harness.sid, canonicalWav(16_000));
    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body).toMatchObject({ duration_ms: 1_000, labels, mime: "audio/wav", sample_count: 16_000, size_bytes: 32_044 });
    const record = (await new ArtifactRegistry(artifactsDir).list())[0];
    expect(record).toMatchObject({ kind: "input", labels, mime: "audio/wav", origin: "web:push-to-talk", metadata: { region: "cn", source: "web-push-to-talk" } });
    expect(JSON.stringify(body)).not.toMatch(/path|hash|provider|token/);
  });

  it("Case G — repeated-content collision fail-closed", async () => {
    const wav = canonicalWav(32);
    const variants = [
      { kind: "input" as const, labels: { residency: "global-ok", sensitivity: "public" } as Labels, metadata: { region: "cn" } },
      { kind: "speech" as const, labels, metadata: { region: "cn" } },
      { kind: "input" as const, labels, metadata: {} },
      { kind: "input" as const, labels, metadata: { region: "us" } }
    ];
    for (const [index, variant] of variants.entries()) {
      const root = await mkdtemp(join(tmpdir(), `fairy-web-collision-${index}-`)); roots.push(root);
      const artifactsDir = join(root, "artifacts");
      await new ArtifactRegistry(artifactsDir).register({
        content: wav,
        kind: variant.kind,
        labels: variant.labels,
        metadata: { bits_per_sample: 16, channels: 1, duration_ms: 2, sample_count: 32, sample_rate: 16_000, source: "web-push-to-talk", ...variant.metadata },
        mime: "audio/wav",
        origin: "test",
        sourceFilename: "input.wav"
      });
      const harness = await webHttpHarness(artifactsDir);
      const response = await uploadWav(harness.port, harness.token, harness.sid, wav);
      expect(response.status).toBe(409);
      expect((await new ArtifactRegistry(artifactsDir).list())).toHaveLength(1);
    }
  });

  it("Case H — Web socket authentication and projection", async () => {
    const started = await startGateway();
    expect(await waitForRejectedSocket(started.port, "wrong-token")).toBe(4401);
    expect(await readdir(join(started.dataDir, "sessions")).catch(() => [])).toHaveLength(0);
    expect(await new ArtifactRegistry(join(started.dataDir, "artifacts")).list()).toHaveLength(0);
    const web = await connectWeb(started.port, started.token); sockets.push(web);
    const sid = await createWebSession(web);
    web.send({ content: "not allowed", op: "turn.input", sid });
    expect(await web.waitFor((message) => message.kind === "op-error" && message.op === "turn.input")).toMatchObject({ error_status: "request_failed" });
    const projected = projectEventForWeb(event(sid as `ses_${string}`, "progress.update", {
      candidate_id: "POISON_PROVIDER",
      detail: "bounded detail",
      endpoint_profile: "POISON_ENDPOINT",
      model_trace: "POISON_MODEL",
      path: "C:\\POISON_PATH",
      stage: "voice.tts.failed",
      worker_id: "POISON_WORKER"
    }, 1));
    expect(JSON.stringify(projected)).toContain("bounded detail");
    expect(JSON.stringify(projected)).not.toMatch(/POISON_PROVIDER|POISON_ENDPOINT|POISON_MODEL|POISON_PATH|POISON_WORKER/);
    const app = await readFile(join(repoRoot, "apps/web/app.js"), "utf8");
    const resetBody = app.match(/const resetLocalFailure = \(\) => \{([\s\S]*?)\n\};/)?.[1] ?? "";
    expect(resetBody).toContain("invalidateBrowserSessionOperation");
    expect(resetBody).not.toMatch(/socket|send|cancel|interrupt/);
    expect(app).toContain('frame.kind === "op-error"');
    expect(app).toContain('renderState("failed"');
    expect(app).toContain("Voice routing is unavailable for this recording.");
    expect(app).toContain("projectedFrameMatchesBrowserSession");
    expect(app).toContain("isCurrentBrowserSessionBinding");
    expect(app).toContain("canChangeSelectedSession");
    const defaultClient = await MockFairyClient.connect({ token: started.token, url: `ws://127.0.0.1:${started.port}` });
    const defaultCreated = await defaultClient.createSession();
    defaultClient.close();
    expect(defaultCreated).toHaveProperty("actor");
    expect(web.messages.find((message) => message.type === "session.created")).not.toHaveProperty("actor");
  });

  it("Case I — full fake Web voice turn", async () => {
    const started = await startGateway(true);
    const web = await connectWeb(started.port, started.token); sockets.push(web);
    const sid = await createWebSession(web);
    const upload = await uploadWav(started.port, started.token, sid, canonicalWav(1_600, 1));
    expect(upload.status).toBe(201);
    const uploaded = await readJson(upload);
    web.send({ audio_ref: uploaded.artifact_id, op: "voice.asr", sid });
    const ack = await web.waitFor((message) => message.kind === "ack" && message.op === "voice.asr", 120_000);
    expect(ack).toMatchObject({ asr_final_count: 1, model_request_count: 1, transcript_text: "web gateway transcript", tts_chunk_count: 1, turn_input_count: 1 });
    expect(started.mimo?.requests).toHaveLength(1);
    expect(started.minimax?.requests).toHaveLength(1);
    expect(JSON.parse(started.minimax?.requests[0]?.body ?? "{}")).toMatchObject({ stream: false, text: "visible web answer" });
    expect(started.model.requests).toBe(1);
    const records = await new ArtifactRegistry(join(started.dataDir, "artifacts")).list();
    expect(records.filter((record) => record.kind === "input")).toHaveLength(1);
    expect(records.filter((record) => record.kind === "speech")).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "speech.asr.final")).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "turn.input")).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "turn.final")).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "speech.tts.chunk")).toHaveLength(1);
    expect(JSON.stringify(web.messages)).not.toMatch(/mimo-web|minimax-web|mimo-paygo-cn|cn-primary|worker_id|provider_route|model_trace|FAKE_/);
    const rawLog = await readFile(join(started.dataDir, "sessions", sid, "log.jsonl"), "utf8");
    expect(rawLog).not.toMatch(/data:audio|;base64|RIFF|FAKE_MIMO|FAKE_MINIMAX/);
  }, 150_000);

  it("Case J — TTS failure preserves the text turn", async () => {
    const started = await startGateway(true, true);
    const web = await connectWeb(started.port, started.token); sockets.push(web);
    const sid = await createWebSession(web);
    const uploaded = await readJson(await uploadWav(started.port, started.token, sid, canonicalWav(800)));
    web.send({ audio_ref: uploaded.artifact_id, op: "voice.asr", sid });
    const ack = await web.waitFor((message) => message.kind === "ack" && message.op === "voice.asr", 120_000);
    expect(ack).toMatchObject({ asr_final_count: 1, assistant_final_text: "visible web answer", error_status: "request_failed", model_request_count: 1, tts_chunk_count: 0, turn_input_count: 1 });
    expect(await readFile(join(repoRoot, "apps/web/app.js"), "utf8")).toContain("The text answer is ready, but speech playback failed.");
    expect(started.minimax?.requests).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "turn.final")).toHaveLength(1);
    expect(web.messages.filter((message) => message.type === "speech.tts.chunk")).toHaveLength(0);
    expect(JSON.stringify(web.messages)).not.toContain(fakeMiniMaxCredential);
  }, 150_000);

  it("Case K — authenticated MP3 fetch and ownership", async () => {
    const started = await startGateway();
    const sid = createSessionId();
    const otherSid = createSessionId();
    const registry = new ArtifactRegistry(join(started.dataDir, "artifacts"));
    const speech = await registry.register({ content: mp3Fixture, kind: "speech", labels, mime: "audio/mpeg", origin: "test", sourceFilename: "speech.mp3" });
    const input = await registry.register({ content: canonicalWav(2), kind: "input", labels, mime: "audio/wav", origin: "test", sourceFilename: "input.wav" });
    const wrongMime = await registry.register({ content: canonicalWav(3, 2), kind: "speech", labels, mime: "audio/wav", origin: "test", sourceFilename: "wrong.wav" });
    const unreferenced = await registry.register({ content: Buffer.concat([mp3Fixture, Buffer.from([1])]), kind: "speech", labels, mime: "audio/mpeg", origin: "test", sourceFilename: "other.mp3" });
    for (const session of [sid, otherSid]) {
      const events = [event(session, "session.created", { created_at: new Date().toISOString(), title: "fetch" }, 0)];
      if (session === sid) {
        events.push(event(session, "speech.tts.chunk", { audio_ref: speech.record.artifact_id, chunk_id: "chunk-1", text: "answer" }, 1));
        events.push(event(session, "speech.tts.chunk", { audio_ref: input.record.artifact_id, chunk_id: "chunk-input", text: "answer" }, 1));
        events.push(event(session, "speech.tts.chunk", { audio_ref: wrongMime.record.artifact_id, chunk_id: "chunk-wrong", text: "answer" }, 1));
      }
      await mkdir(join(started.dataDir, "sessions", session), { recursive: true });
      await writeFile(join(started.dataDir, "sessions", session, "log.jsonl"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
    }
    await started.gateway.stop(); gateways.splice(gateways.indexOf(started.gateway), 1);
    const configPath = join(resolve(started.dataDir, ".."), "fairy.yaml");
    const restarted = new MinimalGateway(loadGatewayConfig({ configPath }, repoRoot, process.env));
    gateways.push(restarted);
    const address = await restarted.start();
    const route = (session: string, artifact: string, token = started.token) => fetch(`http://127.0.0.1:${address.port}/web/api/sessions/${session}/speech/${artifact}`, { headers: { Authorization: `Bearer ${token}` } });
    const logPath = join(started.dataDir, "sessions", sid, "log.jsonl");
    const before = await readFile(logPath, "utf8");
    const ok = await route(sid, speech.record.artifact_id);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(mp3Fixture);
    expect(Object.fromEntries(ok.headers)).toMatchObject({ "cache-control": "no-store", "content-disposition": "inline", "content-type": "audio/mpeg", "x-content-type-options": "nosniff" });
    expect((await route(sid, speech.record.artifact_id, "wrong")).status).toBe(401);
    expect((await route(otherSid, speech.record.artifact_id)).status).toBe(404);
    expect((await route(sid, unreferenced.record.artifact_id)).status).toBe(404);
    expect((await route(sid, input.record.artifact_id)).status).toBe(404);
    expect((await route(sid, wrongMime.record.artifact_id)).status).toBe(404);
    expect(await readFile(logPath, "utf8")).toBe(before);
    await unlink(speech.record.path);
    const missing = await route(sid, speech.record.artifact_id); expect(missing.status).toBe(404);
    await writeFile(speech.record.path, mp3Fixture);
    await writeFile(speech.record.path, Buffer.from(mp3Fixture.map((byte, index) => index === mp3Fixture.length - 1 ? byte ^ 1 : byte)));
    expect((await route(sid, speech.record.artifact_id)).status).toBe(404);
    await writeFile(speech.record.path, mp3Fixture);
    const linkTarget = join(resolve(started.dataDir, ".."), "outside.mp3");
    await writeFile(linkTarget, mp3Fixture);
    await unlink(speech.record.path);
    let linked = false;
    try { await symlink(linkTarget, speech.record.path); linked = true; } catch { /* platform policy may forbid symlink creation */ }
    if (linked) expect((await route(sid, speech.record.artifact_id)).status).toBe(404);
    await rm(speech.record.path, { force: true });
    await writeFile(speech.record.path, mp3Fixture);
    const registryPath = join(started.dataDir, "artifacts", "artifacts.jsonl");
    const originalRegistry = await readFile(registryPath, "utf8");
    const escapedRegistry = originalRegistry.split(/\r?\n/).filter(Boolean).map((line) => {
      const record = JSON.parse(line) as Record<string, unknown>;
      return JSON.stringify(record.artifact_id === speech.record.artifact_id ? { ...record, path: linkTarget } : record);
    }).join("\n") + "\n";
    await writeFile(registryPath, escapedRegistry);
    const escaped = await route(sid, speech.record.artifact_id); expect(escaped.status).toBe(404);
    expect(JSON.stringify(await readJson(escaped))).not.toMatch(/path|mime|hash|label/);
    await writeFile(registryPath, originalRegistry);
  });

  it("Case L — local playback stop contract", async () => {
    const app = await readFile(join(repoRoot, "apps/web/app.js"), "utf8");
    const stopBody = app.match(/stop\(\) \{([\s\S]*?)\n\s{4}\}/)?.[1] ?? "";
    expect(stopBody).toContain("audio.pause()");
    expect(stopBody).toContain("audio.currentTime = 0");
    expect(stopBody).toContain("revoke(objectUrl)");
    expect(stopBody).not.toMatch(/send|cancel|interrupt|socket|fetch/);
  });

  it("Case M — reload and canonical replay", async () => {
    const started = await startGateway();
    const sid = createSessionId();
    const events = [
      event(sid, "session.created", { created_at: new Date().toISOString(), title: "replay" }, 0),
      event(sid, "speech.asr.final", { audio_ref: "art_0123456789abcdef0123", text: "replayed transcript", utterance_id: "utt-replay" }, 1),
      event(sid, "turn.final", { content: [{ kind: "text", text: "replayed answer" }], finish_reason: "stop" }, 1),
      event(sid, "speech.tts.chunk", { audio_ref: "art_00000000000000000000", chunk_id: "chunk-old", text: "old answer" }, 1),
      event(sid, "speech.tts.chunk", { audio_ref: "art_abcdef0123456789abcd", chunk_id: "chunk-replay", text: "replayed answer" }, 1)
    ];
    await mkdir(join(started.dataDir, "sessions", sid), { recursive: true });
    await writeFile(join(started.dataDir, "sessions", sid, "log.jsonl"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
    await started.gateway.stop(); gateways.splice(gateways.indexOf(started.gateway), 1);
    const configPath = join(resolve(started.dataDir, ".."), "fairy.yaml");
    const restarted = new MinimalGateway(loadGatewayConfig({ configPath }, repoRoot, process.env)); gateways.push(restarted);
    const address = await restarted.start();
    const web = await connectWeb(address.port, started.token); sockets.push(web);
    web.send({ op: "session.attach", sid });
    await web.waitFor((message) => message.type === "session.resumed");
    expect(web.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ sid, type: "speech.asr.final", payload: expect.objectContaining({ text: "replayed transcript" }) }),
      expect.objectContaining({ sid, type: "turn.final", payload: { text: "replayed answer" } }),
      expect.objectContaining({ sid, type: "speech.tts.chunk", payload: expect.objectContaining({ audio_ref: "art_abcdef0123456789abcd" }) })
    ]));
    const app = await readFile(join(repoRoot, "apps/web/app.js"), "utf8");
    expect(app).toContain("completeBrowserReplay");
    expect(app.match(/void loadSpeech\(binding, replayAudioRef\)/g)).toHaveLength(1);
  });

  it("Case N — regression and cleanup", async () => {
    const before = (await readdir(tmpdir(), { withFileTypes: true })).filter((entry) => entry.name.startsWith("fairy-web-speech-")).map((entry) => entry.name).sort();
    const started = await startGateway(true);
    const web = await connectWeb(started.port, started.token); sockets.push(web);
    const sid = await createWebSession(web);
    const denied = await uploadWav(started.port, started.token, sid, canonicalWav(webVoiceMaximumSamples + 1));
    expect(denied.status).toBe(413);
    expect(await new ArtifactRegistry(join(started.dataDir, "artifacts")).list()).toHaveLength(0);
    expect(started.mimo?.connections).toBe(0);
    expect(started.mimo?.requests).toHaveLength(0);
    expect(started.minimax?.connections).toBe(0);
    expect(started.minimax?.requests).toHaveLength(0);
    expect(started.model.requests).toBe(0);
    const log = await readFile(join(started.dataDir, "sessions", sid, "log.jsonl"), "utf8");
    expect(log).not.toMatch(/artifact\.created|speech\.asr\.final|turn\.input|turn\.final|speech\.tts\.chunk|;base64|RIFF/);
    const server = await readFile(join(repoRoot, "apps/gateway/src/server.ts"), "utf8");
    const coordinator = await readFile(join(repoRoot, "apps/gateway/src/speech-provider-coordinator.ts"), "utf8");
    const mockWorker = await readFile(join(repoRoot, "workers/speech/mock_worker.py"), "utf8");
    expect((server.match(/#submitVoiceFinalTranscript\(/g) ?? []).length).toBeGreaterThan(0);
    expect((server.match(/new TurnRunner\(/g) ?? [])).toHaveLength(1);
    expect(coordinator).toContain("runAsr");
    expect(coordinator).toContain("runTts");
    expect(mockWorker).not.toMatch(/urllib|http\.client|socket|subprocess/);
    expect(await readFile(join(repoRoot, "packages/testing/test/voice.mimo-asr-provider.test.ts"), "utf8")).toContain("voice.mimo-asr-provider-v0");
    expect(await readFile(join(repoRoot, "packages/testing/test/voice.tts-provider.test.ts"), "utf8")).toContain("voice.tts-provider-v0");
    expect(await readFile(join(repoRoot, "packages/testing/test/voice.websocket-transport.test.ts"), "utf8")).toContain("voice.websocket-transport-v0");
    const after = (await readdir(tmpdir(), { withFileTypes: true })).filter((entry) => entry.name.startsWith("fairy-web-speech-")).map((entry) => entry.name).sort();
    expect(after).toEqual(before);
  });
});
