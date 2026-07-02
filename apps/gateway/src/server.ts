import {
  createEventId,
  createSessionId,
  eventRegistry,
  protocolVersion,
  validateEvent,
  type Actor,
  type EventEnvelope,
  type Labels,
  type Provenance
} from "@fairy/protocol";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { runDevEchoResponder } from "./dev/echo-responder.js";
import { EventLog } from "./event-log.js";
import type { GatewayRuntimeConfig } from "./config.js";

export const gatewayVersion = "0.0.0-m0";

const defaultLabels: Labels = { sensitivity: "internal", residency: "global-ok" };

interface SessionState {
  readonly sid: `ses_${string}`;
  turn: number;
}

interface ClientMessage {
  readonly op?: unknown;
  readonly sid?: unknown;
  readonly title?: unknown;
  readonly payload?: unknown;
  readonly event?: unknown;
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(encoded);
};

const bearerToken = (request: IncomingMessage): string | undefined => {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return undefined;
};

const queryToken = (request: IncomingMessage): string | undefined => {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  return parsed.searchParams.get("token") ?? undefined;
};

const supportedEventFamilies = (): string[] =>
  [...new Set(eventRegistry.map((entry) => entry.family))].sort();

export class MinimalGateway {
  readonly #config: GatewayRuntimeConfig;
  readonly #log: EventLog;
  readonly #server: Server;
  readonly #wss: WebSocketServer;
  readonly #startedAt = Date.now();
  readonly #sessions = new Map<string, SessionState>();
  readonly #connections = new Set<WebSocket>();

  constructor(config: GatewayRuntimeConfig) {
    this.#config = config;
    this.#log = new EventLog(config.dataDir);
    this.#server = createServer((request, response) => this.#handleHttp(request, response));
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#wss.on("connection", (socket, request) => this.#handleConnection(socket, request));
  }

  async start(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(this.#config.port, this.#config.host, () => {
        this.#server.off("error", reject);
        resolve();
      });
    });

    const address = this.#server.address();
    const port = typeof address === "object" && address ? address.port : this.#config.port;
    return { host: this.#config.host, port };
  }

  async stop(): Promise<void> {
    for (const socket of this.#connections) {
      socket.close(1001, "gateway shutting down");
    }

    await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await this.#log.flush();
  }

  #handleHttp(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== "GET") {
      json(response, 405, { error: "method_not_allowed" });
      return;
    }

    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/health") {
      json(response, 200, {
        gateway_version: gatewayVersion,
        protocol_version: protocolVersion,
        status: "ok",
        uptime_s: Math.floor((Date.now() - this.#startedAt) / 1000)
      });
      return;
    }

    if (path === "/meta") {
      json(response, 200, {
        capabilities: {
          echo_responder: true,
          kernel: false,
          model_calls: false,
          session_resume: false
        },
        protocol_version: protocolVersion,
        supported_event_families: supportedEventFamilies()
      });
      return;
    }

    json(response, 404, { error: "not_found" });
  }

  #handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const token = queryToken(request) ?? bearerToken(request);
    if (token !== this.#config.authToken) {
      socket.close(4401, "unauthorized");
      return;
    }

    this.#connections.add(socket);
    socket.on("close", () => this.#connections.delete(socket));
    socket.on("message", (data) => {
      void this.#handleMessage(socket, data.toString()).catch((error: unknown) => {
        void this.#emitError(socket, undefined, String((error as Error).message ?? error));
      });
    });
  }

  async #handleMessage(socket: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as ClientMessage;

    if (message.op === "session.create") {
      await this.#createSession(socket, typeof message.title === "string" ? message.title : undefined);
      return;
    }

    if (message.op === "turn.input") {
      if (typeof message.sid !== "string") {
        throw new Error("turn.input requires sid");
      }
      await this.#acceptTurnInput(socket, message.sid, message.payload);
      return;
    }

    if (message.op === "event") {
      const result = validateEvent(message.event);
      if (!result.ok || result.event.type !== "turn.input") {
        throw new Error("event op requires a valid turn.input envelope");
      }
      await this.#acceptTurnInput(socket, result.event.sid, result.event.payload);
      return;
    }

    throw new Error(`unknown op ${String(message.op)}`);
  }

  async #createSession(socket: WebSocket, title?: string): Promise<EventEnvelope> {
    const sid = createSessionId();
    this.#sessions.set(sid, { sid, turn: 0 });

    return this.#emit(socket, {
      actor: "system",
      payload: {
        created_at: new Date().toISOString(),
        title: title ?? "M0 session"
      },
      provenance: "agent",
      sid,
      turn: 0,
      type: "session.created"
    });
  }

  async #acceptTurnInput(socket: WebSocket, sid: string, payload: unknown): Promise<void> {
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }

    state.turn += 1;
    const input = await this.#emit(socket, {
      actor: "user",
      payload: payload as Record<string, unknown>,
      provenance: "user",
      sid: state.sid,
      turn: state.turn,
      type: "turn.input"
    });

    await runDevEchoResponder(input, (type, responsePayload) =>
      this.#emit(socket, {
        actor: "agent",
        payload: responsePayload,
        provenance: "agent",
        sid: state.sid,
        turn: state.turn,
        type
      })
    );
  }

  async #emit(
    socket: WebSocket,
    event: {
      actor: Actor;
      payload: Record<string, unknown>;
      provenance: Provenance;
      sid: `ses_${string}`;
      turn: number;
      type: string;
    }
  ): Promise<EventEnvelope> {
    const envelope: EventEnvelope = {
      actor: event.actor,
      id: createEventId(),
      labels: defaultLabels,
      payload: event.payload,
      provenance: event.provenance,
      sid: event.sid,
      ts: new Date().toISOString(),
      turn: event.turn,
      type: event.type,
      v: 1
    };

    const result = validateEvent(envelope);
    if (!result.ok) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }

    await this.#log.append(envelope);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(envelope));
    }

    return envelope;
  }

  async #emitError(socket: WebSocket, sid: `ses_${string}` | undefined, message: string): Promise<void> {
    if (!sid) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ error: message }));
      }
      return;
    }

    await this.#emit(socket, {
      actor: "system",
      payload: { class: "UserError", message, retryable: false },
      provenance: "agent",
      sid,
      turn: this.#sessions.get(sid)?.turn ?? 0,
      type: "error"
    });
  }
}
