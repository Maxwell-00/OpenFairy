import { validateEvent, validateFrame, type EventEnvelope, type TransportFrame } from "@fairy/protocol";
import { assertNoRawAudioPayloads } from "@fairy/voice";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";

interface VoiceOptions {
  readonly command: "duplex" | "loopback" | "worker" | "ws";
  readonly gateway: string;
  readonly json: boolean;
  readonly scriptPath: string;
  readonly session?: string;
  readonly token: string;
}

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
  if (subcommand !== "loopback" && subcommand !== "duplex" && subcommand !== "worker" && subcommand !== "ws") {
    throw new Error("Usage: fairy voice <loopback|duplex|worker|ws> --script path [--session sid] [--gateway url] [--token token] [--json]");
  }
  const session = readOption(args, "--session");
  const scriptPath = readOption(args, "--script");
  if (!scriptPath) {
    throw new Error(`fairy voice ${subcommand} requires --script path`);
  }
  for (const forbidden of ["--python", "--worker-command", "--worker-path"]) {
    if (args.includes(forbidden)) {
      throw new Error(`${forbidden} is not supported; the speech worker executable and script are repository-controlled`);
    }
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
  const script = JSON.parse(await readFile(options.scriptPath, "utf8")) as unknown;
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
  client.send({ op, script, sid });
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
