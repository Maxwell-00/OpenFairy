import { ArtifactRegistry, detectMime, hasAudioMagic, isSupportedAudioMime } from "@fairy/artifacts";
import { defaultDataDir, loadConfig } from "@fairy/config";
import { validateEvent, validateFrame, type EventEnvelope, type TransportFrame } from "@fairy/protocol";
import { assertNoRawAudioPayloads, clampVoiceFrameLabels, voiceInputPolicyForProfile } from "@fairy/voice";
import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import WebSocket from "ws";

interface VoiceCommonOptions {
  readonly command: "asr" | "duplex" | "import-audio" | "loopback" | "worker" | "ws";
  readonly json: boolean;
}

interface VoiceScriptOptions extends VoiceCommonOptions {
  readonly command: "duplex" | "loopback" | "worker" | "ws";
  readonly gateway: string;
  readonly scriptPath: string;
  readonly session?: string;
  readonly token: string;
}

interface VoiceAsrOptions extends VoiceCommonOptions {
  readonly audioRef: string;
  readonly command: "asr";
  readonly gateway: string;
  readonly session?: string;
  readonly token: string;
}

interface VoiceImportOptions extends VoiceCommonOptions {
  readonly command: "import-audio";
  readonly configPath?: string;
  readonly dataDir: string;
  readonly file: string;
  readonly labels: {
    readonly residency: "local-only" | "region-restricted" | "global-ok";
    readonly sensitivity: "public" | "internal" | "personal" | "secret";
  };
  readonly region?: "cn";
}

export type VoiceOptions = VoiceScriptOptions | VoiceAsrOptions | VoiceImportOptions;

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const hasFlag = (args: readonly string[], name: string): boolean => args.includes(name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const configuredDataDir = (config: Record<string, unknown>, env: NodeJS.ProcessEnv): string => {
  const gateway = isRecord(config.gateway) ? config.gateway : {};
  return typeof gateway.data_dir === "string" ? gateway.data_dir : defaultDataDir(env);
};

const governanceProfile = (config: Record<string, unknown>): "balanced" | "sovereign" | "cloud-friendly" => {
  const governance = isRecord(config.governance) ? config.governance : {};
  return governance.profile === "sovereign" || governance.profile === "cloud-friendly" ? governance.profile : "balanced";
};

const payloadText = (payload: unknown): string => {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return "";
  }
  return payload.content
    .map((part) => isRecord(part) && part.kind === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
};

const eventCounts = (events: readonly EventEnvelope[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
};

const websocketUrl = (gateway: string, token: string): string => {
  const url = new URL(gateway);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.searchParams.set("token", token);
  return url.toString();
};

class VoiceGatewayClient {
  readonly #socket: WebSocket;
  readonly #events: EventEnvelope[] = [];
  readonly #frames: TransportFrame[] = [];
  readonly #eventWaiters: ((event: EventEnvelope) => void)[] = [];
  readonly #frameWaiters: ((frame: TransportFrame) => void)[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as unknown;
      const event = validateEvent(parsed);
      if (event.ok) {
        this.#events.push(event.event);
        for (const waiter of this.#eventWaiters.splice(0)) {
          waiter(event.event);
        }
        return;
      }
      const frame = validateFrame(parsed);
      if (frame.ok) {
        this.#frames.push(frame.frame);
        for (const waiter of this.#frameWaiters.splice(0)) {
          waiter(frame.frame);
        }
      }
    });
  }

  static connect(url: string): Promise<VoiceGatewayClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => resolve(new VoiceGatewayClient(socket)));
      socket.once("error", reject);
      socket.once("close", (code, reason) => {
        if (code !== 1000 && code !== 1001) {
          reject(new Error(`gateway closed before open: ${code} ${reason.toString()}`));
        }
      });
    });
  }

  events(): readonly EventEnvelope[] {
    return this.#events;
  }

  frames(): readonly TransportFrame[] {
    return this.#frames;
  }

  send(value: unknown): void {
    this.#socket.send(JSON.stringify(value));
  }

  close(): void {
    this.#socket.close(1000, "voice command done");
    this.#socket.terminate();
  }

  waitForEvent(predicate: (event: EventEnvelope) => boolean, timeoutMs = 30000): Promise<EventEnvelope> {
    const existing = this.#events.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#eventWaiters.indexOf(onEvent);
        if (index >= 0) {
          this.#eventWaiters.splice(index, 1);
        }
        reject(new Error(`timed out waiting for gateway event after ${timeoutMs} ms`));
      }, timeoutMs);
      const onEvent = (event: EventEnvelope): void => {
        if (!predicate(event)) {
          this.#eventWaiters.push(onEvent);
          return;
        }
        clearTimeout(timer);
        resolve(event);
      };
      this.#eventWaiters.push(onEvent);
    });
  }

  waitForFrame(predicate: (frame: TransportFrame) => boolean, timeoutMs = 30000): Promise<TransportFrame> {
    const existing = this.#frames.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#frameWaiters.indexOf(onFrame);
        if (index >= 0) {
          this.#frameWaiters.splice(index, 1);
        }
        reject(new Error(`timed out waiting for gateway frame after ${timeoutMs} ms`));
      }, timeoutMs);
      const onFrame = (frame: TransportFrame): void => {
        if (frame.kind === "op-error") {
          clearTimeout(timer);
          reject(new Error(`${frame.op}: ${frame.message}`));
          return;
        }
        if (!predicate(frame)) {
          this.#frameWaiters.push(onFrame);
          return;
        }
        clearTimeout(timer);
        resolve(frame);
      };
      this.#frameWaiters.push(onFrame);
    });
  }
}

const summaryFromEvents = (sid: string, op: string, events: readonly EventEnvelope[]): TransportFrame => {
  const finalAsr = events.find((event) => event.type === "speech.asr.final");
  const finalTurn = events.filter((event) => event.type === "turn.final").at(-1);
  const asrPayload = isRecord(finalAsr?.payload) ? finalAsr.payload : {};
  return {
    assistant_final_text: finalTurn ? payloadText(finalTurn.payload) : "",
    event_counts: eventCounts(events),
    kind: "ack",
    op,
    replay_command: `fairy replay ${sid}`,
    sid,
    transcript_text: typeof asrPayload.text === "string" ? asrPayload.text : "",
    tts_chunk_count: events.filter((event) => event.type === "speech.tts.chunk").length
  };
};

export const parseVoiceOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): VoiceOptions => {
  const [subcommand] = args;
  for (const forbidden of [
    "--artifact-path",
    "--base64",
    "--endpoint",
    "--endpoint-url",
    "--header",
    "--key",
    "--model",
    "--output-dir",
    "--provider-executable",
    "--python",
    "--worker-command",
    "--worker-path"
  ]) {
    if (args.includes(forbidden)) {
      throw new Error(`${forbidden} is not supported; speech worker executables, endpoints, and artifact destinations are repository-controlled`);
    }
  }
  if (subcommand === "import-audio") {
    const file = readOption(args, "--file");
    if (!file) {
      throw new Error("fairy voice import-audio requires --file path");
    }
    const sensitivity = readOption(args, "--sensitivity") ?? "personal";
    const residency = readOption(args, "--residency") ?? "region-restricted";
    const region = readOption(args, "--region");
    if (!(sensitivity === "public" || sensitivity === "internal" || sensitivity === "personal" || sensitivity === "secret")) {
      throw new Error("--sensitivity must be public, internal, personal, or secret");
    }
    if (!(residency === "local-only" || residency === "region-restricted" || residency === "global-ok")) {
      throw new Error("--residency must be local-only, region-restricted, or global-ok");
    }
    if (region !== undefined && region !== "cn") {
      throw new Error("R0.9-01 audio import supports only --region cn");
    }
    if (residency === "region-restricted" && region !== "cn") {
      throw new Error("region-restricted audio import requires --region cn");
    }
    const configPath = readOption(args, "--config");
    const loaded = loadConfig(configPath ? { configPath, env } : { env });
    const labels = clampVoiceFrameLabels(voiceInputPolicyForProfile(governanceProfile(loaded.config)).labels, { residency, sensitivity });
    return {
      command: "import-audio",
      ...(configPath ? { configPath } : {}),
      dataDir: resolve(readOption(args, "--data-dir") ?? configuredDataDir(loaded.config, env)),
      file: resolve(file),
      json: hasFlag(args, "--json"),
      labels,
      ...(region === "cn" ? { region } : {})
    };
  }
  if (subcommand === "asr") {
    const audioRef = readOption(args, "--audio-ref");
    if (!audioRef || !/^art_[a-f0-9]{20}$/.test(audioRef)) {
      throw new Error("fairy voice asr requires a content-addressed --audio-ref");
    }
    const session = readOption(args, "--session");
    return {
      audioRef,
      command: "asr",
      gateway: readOption(args, "--gateway") ?? env.FAIRY_GATEWAY_URL ?? "ws://127.0.0.1:8787",
      json: hasFlag(args, "--json"),
      ...(session ? { session } : {}),
      token: readOption(args, "--token") ?? env.FAIRY_GATEWAY_TOKEN ?? "dev-token"
    };
  }
  if (subcommand !== "loopback" && subcommand !== "duplex" && subcommand !== "worker" && subcommand !== "ws") {
    throw new Error("Usage: fairy voice <import-audio|asr|loopback|duplex|worker|ws> [options]");
  }
  const session = readOption(args, "--session");
  const scriptPath = readOption(args, "--script");
  if (!scriptPath) {
    throw new Error(`fairy voice ${subcommand} requires --script path`);
  }
  return {
    command: subcommand,
    gateway: readOption(args, "--gateway") ?? env.FAIRY_GATEWAY_URL ?? "ws://127.0.0.1:8787",
    json: hasFlag(args, "--json"),
    scriptPath,
    ...(session ? { session } : {}),
    token: readOption(args, "--token") ?? env.FAIRY_GATEWAY_TOKEN ?? "dev-token"
  };
};

export const runVoice = async (args: readonly string[]): Promise<void> => {
  const options = parseVoiceOptions(args);
  if (options.command === "import-audio") {
    const info = await lstat(options.file);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("audio import requires a non-symlink regular file");
    }
    if (info.size < 1 || info.size > 7_000_000) {
      throw new Error("audio import must contain 1 to 7000000 bytes");
    }
    const mime = detectMime(options.file);
    if (!isSupportedAudioMime(mime)) {
      throw new Error("audio import accepts only .wav or .mp3 files");
    }
    const content = await readFile(options.file);
    if (content.byteLength !== info.size || !hasAudioMagic(content, mime)) {
      throw new Error("audio import MIME, magic, or size validation failed");
    }
    const registered = await new ArtifactRegistry(resolve(options.dataDir, "artifacts")).register({
      content,
      kind: "input",
      labels: options.labels,
      metadata: { ...(options.region ? { region: options.region } : {}), source: "voice-import-audio" },
      mime,
      origin: "voice:import-audio",
      sourceFilename: basename(options.file)
    });
    const record = registered.record;
    if (record.kind !== "input" || record.mime !== mime || record.size_bytes !== content.byteLength) {
      throw new Error("registered audio artifact did not preserve validated input metadata");
    }
    const coveredLabels = clampVoiceFrameLabels(record.labels, options.labels);
    if (coveredLabels.sensitivity !== record.labels.sensitivity || coveredLabels.residency !== record.labels.residency) {
      throw new Error("registered audio artifact does not cover the requested labels");
    }
    if (options.region && record.metadata?.region !== options.region) {
      throw new Error("registered audio artifact did not preserve the requested region");
    }
    const summary = {
      artifact_id: record.artifact_id,
      hash: record.hash,
      kind: record.kind,
      labels: record.labels,
      mime: record.mime,
      size_bytes: record.size_bytes
    };
    console.log(options.json ? JSON.stringify(summary) : `${record.artifact_id} ${record.mime} ${record.size_bytes} ${record.hash}`);
    return;
  }
  const script = options.command === "asr"
    ? undefined
    : JSON.parse(await readFile(options.scriptPath, "utf8")) as unknown;
  const client = await VoiceGatewayClient.connect(websocketUrl(options.gateway, options.token));
  let sid = options.session;

  if (sid) {
    client.send({ op: "session.attach", sid });
    await client.waitForEvent((event) => event.sid === sid && event.type === "session.resumed");
  } else {
    client.send({ op: "session.create", title: `Voice ${options.command}` });
    const created = await client.waitForEvent((event) => event.type === "session.created");
    sid = created.sid;
  }

  const before = client.events().length;
  const beforeFrames = client.frames().length;
  const op = `voice.${options.command}`;
  client.send(options.command === "asr"
    ? { audio_ref: options.audioRef, op, sid }
    : { op, script, sid });
  const ack = await client.waitForFrame((frame) =>
    frame.kind === "ack" &&
    frame.op === op &&
    client.frames().indexOf(frame) >= beforeFrames);
  const voiceEvents = client.events().slice(before);
  client.close();
  assertNoRawAudioPayloads(voiceEvents);
  const summary = isRecord(ack) ? ack : summaryFromEvents(sid, op, voiceEvents);

  if (options.json) {
    console.log(JSON.stringify(summary));
    return;
  }

  console.log(`session ${String(summary.sid)}`);
  console.log(`transcript: ${String(summary.transcript_text ?? "")}`);
  console.log(`assistant: ${String(summary.assistant_final_text ?? "")}`);
  console.log(`tts chunks: ${String(summary.tts_chunk_count ?? 0)}`);
  if (summary.worker_id) {
    console.log(`worker: ${String(summary.worker_id)} (pid ${String(summary.worker_process_id ?? "?")})`);
    console.log(`python: ${String(summary.python_version ?? "unknown")} via ${String(isRecord(summary.interpreter) ? summary.interpreter.argv0 ?? "unknown" : "unknown")}`);
  }
  console.log(`replay: ${String(summary.replay_command ?? "")}`);
};
