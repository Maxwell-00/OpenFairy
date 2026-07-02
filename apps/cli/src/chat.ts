import { validateEvent, type EventEnvelope } from "@fairy/protocol";
import { createInterface } from "node:readline";
import WebSocket from "ws";

interface ChatOptions {
  readonly gateway: string;
  readonly session?: string;
  readonly showReasoning: boolean;
  readonly token: string;
}

interface SessionsOptions {
  readonly gateway: string;
  readonly token: string;
}

const dim = "\x1b[2m";
const reset = "\x1b[0m";

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

export const parseChatOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): ChatOptions => {
  const session = readOption(args, "--session");
  return {
    gateway: readOption(args, "--gateway") ?? env.FAIRY_GATEWAY_URL ?? "ws://127.0.0.1:8787",
    ...(session ? { session } : {}),
    showReasoning: !hasFlag(args, "--hide-reasoning"),
    token: readOption(args, "--token") ?? env.FAIRY_GATEWAY_TOKEN ?? "dev-token"
  };
};

export const parseSessionsOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): SessionsOptions => ({
  gateway: readOption(args, "--gateway") ?? env.FAIRY_GATEWAY_URL ?? "ws://127.0.0.1:8787",
  token: readOption(args, "--token") ?? env.FAIRY_GATEWAY_TOKEN ?? "dev-token"
});

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

const httpUrl = (gateway: string, token: string, path: string): string => {
  const url = new URL(gateway);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }
  url.pathname = path;
  url.searchParams.set("token", token);
  return url.toString();
};

const payloadText = (payload: unknown): string => {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return "";
  }
  return payload.content
    .map((part) =>
      part && typeof part === "object" && "kind" in part && part.kind === "text" && "text" in part && typeof part.text === "string"
        ? part.text
        : ""
    )
    .filter((part) => part.length > 0)
    .join("\n");
};

const connect = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("close", (code, reason) => {
      if (code !== 1000 && code !== 1001) {
        reject(new Error(`gateway closed before open: ${code} ${reason.toString()}`));
      }
    });
  });

const waitForEvent = (socket: WebSocket, predicate: (event: EventEnvelope) => boolean): Promise<EventEnvelope> =>
  new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = JSON.parse(data.toString()) as unknown;
      const result = validateEvent(parsed);
      if (result.ok && predicate(result.event)) {
        socket.off("message", onMessage);
        resolve(result.event);
      }
    };
    socket.on("message", onMessage);
  });

const usageLine = (payload: Record<string, unknown>): string => {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") {
    return "";
  }
  const input = "input_tokens" in usage && typeof usage.input_tokens === "number" ? usage.input_tokens : "?";
  const output = "output_tokens" in usage && typeof usage.output_tokens === "number" ? usage.output_tokens : "?";
  const estimated = "estimated" in usage && usage.estimated === true ? " est" : "";
  return `\nusage: tokens in ${input} / out ${output}${estimated}\n`;
};

export const runChat = async (args: readonly string[]): Promise<void> => {
  const options = parseChatOptions(args);
  const socket = await connect(websocketUrl(options.gateway, options.token));
  const textSeenByTurn = new Set<string>();
  let sid = options.session;
  let activeTurn = false;
  let cancelRequested = false;

  socket.on("message", (data) => {
    const parsed = JSON.parse(data.toString()) as unknown;
    const result = validateEvent(parsed);
    if (!result.ok) {
      return;
    }

    const event = result.event;
    if (event.type === "session.created") {
      sid = event.sid;
      process.stdout.write(`session ${event.sid}\n`);
      return;
    }

    if (event.type === "turn.input") {
      const text = payloadText(event.payload);
      process.stdout.write(`\n> ${text}\n`);
      return;
    }

    if (event.type === "reasoning.delta") {
      if (options.showReasoning && isRecord(event.payload) && typeof event.payload.text === "string") {
        process.stdout.write(`${dim}[reasoning] ${event.payload.text}${reset}\n`);
      }
      return;
    }

    if (event.type === "turn.delta") {
      if (isRecord(event.payload) && typeof event.payload.text === "string") {
        textSeenByTurn.add(`${event.sid}:${event.turn}`);
        process.stdout.write(event.payload.text);
      }
      return;
    }

    if (event.type === "turn.final") {
      if (!textSeenByTurn.has(`${event.sid}:${event.turn}`)) {
        process.stdout.write(payloadText(event.payload));
      }
      process.stdout.write(usageLine(isRecord(event.payload) ? event.payload : {}));
      activeTurn = false;
      cancelRequested = false;
      return;
    }

    if (event.type === "turn.interrupted") {
      const reason = isRecord(event.payload) && typeof event.payload.reason === "string" ? event.payload.reason : "interrupted";
      process.stdout.write(`\n[interrupted: ${reason}]\n`);
      activeTurn = false;
      cancelRequested = false;
      return;
    }

    if (event.type === "error") {
      const message = isRecord(event.payload) && typeof event.payload.message === "string" ? event.payload.message : "unknown error";
      process.stderr.write(`\nerror: ${message}\n`);
      activeTurn = false;
      cancelRequested = false;
    }
  });

  if (sid) {
    socket.send(JSON.stringify({ op: "session.attach", sid }));
  } else {
    socket.send(JSON.stringify({ op: "session.create" }));
    const created = await waitForEvent(socket, (event) => event.type === "session.created");
    sid = created.sid;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\nfairy> " });
  rl.prompt();

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (!sid) {
      process.stderr.write("session is not ready yet\n");
      rl.prompt();
      return;
    }
    activeTurn = true;
    cancelRequested = false;
    socket.send(JSON.stringify({
      channel: "cli",
      content: [{ kind: "text", text: trimmed }],
      op: "turn.input",
      sid
    }));
  });

  rl.on("SIGINT", () => {
    if (activeTurn && sid && !cancelRequested) {
      cancelRequested = true;
      socket.send(JSON.stringify({ op: "turn.cancel", sid }));
      process.stdout.write("\n[cancel requested]\n");
      return;
    }
    socket.close(1000, "cli exit");
    rl.close();
  });

  await new Promise<void>((resolve) => rl.once("close", resolve));
};

export const runSessions = async (args: readonly string[]): Promise<void> => {
  const options = parseSessionsOptions(args);
  const response = await fetch(httpUrl(options.gateway, options.token, "/sessions"));
  if (!response.ok) {
    throw new Error(`gateway /sessions failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    sessions?: readonly { id: string; created: string; last_active: string; turn_count: number; title?: string | null }[];
  };
  const sessions = body.sessions ?? [];
  if (sessions.length === 0) {
    console.log("No sessions.");
    return;
  }
  for (const session of sessions) {
    console.log(`${session.id}  turns=${session.turn_count}  last=${session.last_active}  ${session.title ?? ""}`);
  }
};
