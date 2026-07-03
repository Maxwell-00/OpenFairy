import { AuditLog, escalateLabelsForContent, PermissionEngine, TurnRunner, type KernelEventType, type TurnRunnerHistory } from "@fairy/kernel";
import { createModelGateway, type ChatMessage, type RoutingHints } from "@fairy/model-gateway";
import {
  createEventId,
  createSessionId,
  eventRegistry,
  protocolVersion,
  validateEvent,
  validateFrame,
  type Actor,
  type EventEnvelope,
  type Labels,
  type Provenance
} from "@fairy/protocol";
import { createStandardToolRegistry } from "@fairy/tools-std";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { EventLog } from "./event-log.js";
import type { GatewayRuntimeConfig } from "./config.js";

export const gatewayVersion = "0.1.0-m1";

const balancedDefaultLabels: Labels = { sensitivity: "internal", residency: "global-ok" };
const sovereignDefaultLabels: Labels = { sensitivity: "personal", residency: "local-only" };
const cloudFriendlyDefaultLabels: Labels = { sensitivity: "personal", residency: "global-ok" };

interface SessionState {
  readonly sid: `ses_${string}`;
  createdAt: string;
  history: ChatMessage[];
  lastActive: string;
  title?: string;
  turn: number;
  turnCount: number;
}

interface ClientMessage {
  readonly op?: unknown;
  readonly sid?: unknown;
  readonly title?: unknown;
  readonly payload?: unknown;
  readonly content?: unknown;
  readonly channel?: unknown;
  readonly decision?: unknown;
  readonly event?: unknown;
  readonly labels?: unknown;
  readonly replay_from?: unknown;
  readonly request_id?: unknown;
  readonly routing_hints?: unknown;
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

const isSessionId = (value: unknown): value is `ses_${string}` =>
  typeof value === "string" && /^ses_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isLabels = (value: unknown): value is Labels =>
  isRecord(value) &&
  (value.sensitivity === "public" || value.sensitivity === "internal" || value.sensitivity === "personal" || value.sensitivity === "secret") &&
  (value.residency === "local-only" || value.residency === "region-restricted" || value.residency === "global-ok");

const isRoutingHints = (value: unknown): value is RoutingHints =>
  isRecord(value) &&
  (!("prefer_local" in value) || typeof value.prefer_local === "boolean");

const routingHintsFrom = (value: unknown): RoutingHints | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRoutingHints(value)) {
    return undefined;
  }
  return typeof value.prefer_local === "boolean" ? { prefer_local: value.prefer_local } : {};
};

const textFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (isRecord(part) && part.kind === "text" && typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.length > 0)
    .join("\n");
};

const payloadText = (payload: unknown): string =>
  isRecord(payload) ? textFromContent(payload.content) : "";

const governanceProfile = (config: Record<string, unknown>): "balanced" | "sovereign" | "cloud-friendly" => {
  const governance = config.governance;
  const profile = isRecord(governance) ? governance.profile : undefined;
  return profile === "sovereign" || profile === "cloud-friendly" ? profile : "balanced";
};

const defaultLabelsForProfile = (profile: "balanced" | "sovereign" | "cloud-friendly"): Labels => {
  if (profile === "sovereign") {
    return sovereignDefaultLabels;
  }
  if (profile === "cloud-friendly") {
    return cloudFriendlyDefaultLabels;
  }
  return balancedDefaultLabels;
};

const stablePayload = (payload: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right))));

const turnPayload = (message: ClientMessage): Record<string, unknown> => {
  if (isRecord(message.payload)) {
    return message.payload;
  }

  if (Array.isArray(message.content)) {
    return {
      ...(typeof message.channel === "string" ? { channel: message.channel } : {}),
      content: message.content
    };
  }

  if (typeof message.content === "string") {
    return {
      ...(typeof message.channel === "string" ? { channel: message.channel } : {}),
      content: [{ kind: "text", text: message.content }]
    };
  }

  throw new Error("turn.input requires content");
};

const createEmptySession = (sid: `ses_${string}`): SessionState => {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    history: [],
    lastActive: now,
    sid,
    turn: 0,
    turnCount: 0
  };
};

const hasOpenTurn = (events: readonly EventEnvelope[]): EventEnvelope | undefined => {
  const inputs = new Map<number, EventEnvelope>();
  const terminal = new Set<number>();
  for (const event of events) {
    if (event.type === "turn.input") {
      inputs.set(event.turn, event);
    }
    if (event.type === "turn.final" || event.type === "turn.interrupted" || event.type === "error") {
      terminal.add(event.turn);
    }
  }

  const openTurns = [...inputs.values()].filter((event) => !terminal.has(event.turn));
  return openTurns.at(-1);
};

const actorForKernelEvent = (type: KernelEventType): Actor => {
  if (type === "tool.call" || type === "tool.result") {
    return "tool";
  }
  if (type === "approval.request" || type === "approval.resolved" || type === "artifact.created" || type === "context.manifest" || type === "error" || type === "memory.gate.decision" || type === "memory.written" || type === "progress.update" || type === "route.denied" || type === "turn.interrupted") {
    return "system";
  }
  return "agent";
};

export class MinimalGateway {
  readonly #config: GatewayRuntimeConfig;
  readonly #log: EventLog;
  readonly #server: Server;
  readonly #wss: WebSocketServer;
  readonly #startedAt = Date.now();
  readonly #auditLog: AuditLog;
  readonly #sessions = new Map<string, SessionState>();
  readonly #connections = new Set<WebSocket>();
  readonly #subscriptions = new Map<string, Set<WebSocket>>();
  readonly #turns = new Set<Promise<unknown>>();
  readonly #runner: TurnRunner;

  constructor(config: GatewayRuntimeConfig) {
    this.#config = config;
    this.#log = new EventLog(config.dataDir);
    this.#auditLog = new AuditLog(config.dataDir);
    const tools = createStandardToolRegistry({
      artifactsDir: config.artifactsDir,
      config: config.config,
      workspaceRoot: config.workspaceRoot
    });
    const permissionEngine = new PermissionEngine({
      auditLog: this.#auditLog,
      rules: config.permissionRules
    });
    const modelGateway = createModelGateway(config.config);
    this.#runner = new TurnRunner({
      artifactsDir: config.artifactsDir,
      auditLog: this.#auditLog,
      contextConfig: config.contextConfig,
      maxToolIterations: config.maxToolIterations,
      modelGateway,
      permissionAskTimeoutMs: config.askTimeoutMs,
      permissionEngine,
      toolContext: {
        artifactsDir: config.artifactsDir,
        env: process.env,
        workspaceRoot: config.workspaceRoot
      },
      tools,
      systemPrompt: config.systemPrompt
    });
    this.#server = createServer((request, response) => this.#handleHttp(request, response));
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#wss.on("connection", (socket, request) => this.#handleConnection(socket, request));
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.#recoverSessions();
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

  abortActiveTurns(reason: string): void {
    this.#runner.abortAll(reason);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.#turns]);

    for (const socket of this.#connections) {
      socket.close(1001, "gateway shutting down");
    }

    await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await this.#log.flush();
  }

  async #recoverSessions(): Promise<void> {
    for (const sid of await this.#log.listSessionIds()) {
      const events = await this.#log.readSessionEvents(sid);
      const open = hasOpenTurn(events);
      if (open) {
        const interrupted = this.#makeEnvelope({
          actor: "system",
          payload: {
            last_heard_mark: events.at(-1)?.id ?? "gateway_restart",
            reason: "gateway_restart"
          },
          provenance: "agent",
          sid,
          turn: open.turn,
          type: "turn.interrupted"
        });
        await this.#log.append(interrupted);
        events.push(interrupted);
      }

      this.#sessions.set(sid, this.#stateFromEvents(sid, events));
    }
  }

  #stateFromEvents(sid: `ses_${string}`, events: readonly EventEnvelope[]): SessionState {
    const state = createEmptySession(sid);
    for (const event of events) {
      this.#recordEventInState(state, event);
    }
    return state;
  }

  #recordEventInState(state: SessionState, event: EventEnvelope): void {
    state.turn = Math.max(state.turn, event.turn);
    state.lastActive = event.ts;

    if (event.type === "session.created") {
      if (isRecord(event.payload)) {
        state.createdAt = typeof event.payload.created_at === "string" ? event.payload.created_at : event.ts;
        if (typeof event.payload.title === "string") {
          state.title = event.payload.title;
        } else {
          delete state.title;
        }
      }
      return;
    }

    if (event.type === "turn.input") {
      state.turnCount += 1;
      const text = payloadText(event.payload);
      if (text) {
        state.history.push({ content: text, labels: event.labels, role: "user", turn: event.turn });
      }
      return;
    }

    if (event.type === "tool.call" && isRecord(event.payload)) {
      const callId = typeof event.payload.call_id === "string" ? event.payload.call_id : undefined;
      const tool = typeof event.payload.tool === "string" ? event.payload.tool : undefined;
      const args = isRecord(event.payload.args) ? event.payload.args : {};
      if (callId && tool) {
        state.history.push({
          content: "",
          labels: event.labels,
          role: "assistant",
          tool_calls: [{ arguments: args, id: callId, name: tool }],
          turn: event.turn
        });
      }
      return;
    }

    if (event.type === "tool.result" && isRecord(event.payload)) {
      const callId = typeof event.payload.call_id === "string" ? event.payload.call_id : undefined;
      if (callId) {
        state.history.push({
          content: stablePayload(event.payload),
          labels: event.labels,
          role: "tool",
          tool_call_id: callId,
          turn: event.turn
        });
      }
      return;
    }

    if (event.type === "turn.final") {
      const text = payloadText(event.payload);
      if (text) {
        state.history.push({ content: text, labels: event.labels, role: "assistant", turn: event.turn });
      }
    }
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
          echo_responder: false,
          kernel: true,
          model_calls: true,
          permissions: true,
          session_attach: true,
          session_resume: true,
          tools: true,
          turn_cancel: true
        },
        protocol_version: protocolVersion,
        supported_event_families: supportedEventFamilies()
      });
      return;
    }

    if (path === "/sessions") {
      const token = queryToken(request) ?? bearerToken(request);
      if (token !== this.#config.authToken) {
        json(response, 401, { error: "unauthorized" });
        return;
      }
      json(response, 200, {
        sessions: [...this.#sessions.values()]
          .map((session) => ({
            created: session.createdAt,
            id: session.sid,
            last_active: session.lastActive,
            title: session.title ?? null,
            turn_count: session.turnCount
          }))
          .sort((left, right) => right.last_active.localeCompare(left.last_active))
      });
      return;
    }

    if (path === "/audit") {
      const token = queryToken(request) ?? bearerToken(request);
      if (token !== this.#config.authToken) {
        json(response, 401, { error: "unauthorized" });
        return;
      }
      const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
      const limit = Math.min(100, Math.max(1, Number(parsed.searchParams.get("limit") ?? 20)));
      json(response, 200, { entries: this.#auditLog.list(Number.isFinite(limit) ? limit : 20) });
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
    socket.on("close", () => {
      this.#connections.delete(socket);
      for (const subscribers of this.#subscriptions.values()) {
        subscribers.delete(socket);
      }
    });
    socket.on("message", (data) => {
      void this.#handleMessage(socket, data.toString()).catch((error: unknown) => {
        this.#sendOpError(socket, "unknown", String((error as Error).message ?? error));
      });
    });
  }

  async #handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.#sendOpError(socket, "unknown", "malformed JSON op frame");
      return;
    }
    const op = typeof message.op === "string" && message.op.length > 0 ? message.op : "unknown";

    if (message.op === "session.create") {
      await this.#createSession(socket, typeof message.title === "string" ? message.title : undefined);
      return;
    }

    if (message.op === "session.attach") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "session.attach requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      await this.#attachSession(socket, message.sid, typeof message.replay_from === "string" ? message.replay_from : undefined);
      return;
    }

    if (message.op === "turn.input") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "turn.input requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      let payload: Record<string, unknown>;
      try {
        payload = turnPayload(message);
      } catch (error) {
        this.#sendOpError(socket, op, error instanceof Error ? error.message : String(error), { sid: message.sid });
        return;
      }
      if (message.labels !== undefined && !isLabels(message.labels)) {
        this.#sendOpError(socket, op, "turn.input labels must include valid sensitivity and residency.", { sid: message.sid });
        return;
      }
      if (message.routing_hints !== undefined && !isRoutingHints(message.routing_hints)) {
        this.#sendOpError(socket, op, "turn.input routing_hints.prefer_local must be boolean when present.", { sid: message.sid });
        return;
      }
      await this.#acceptTurnInput(socket, message.sid, payload, message.labels, routingHintsFrom(message.routing_hints));
      return;
    }

    if (message.op === "event") {
      const result = validateEvent(message.event);
      if (!result.ok || result.event.type !== "turn.input") {
        this.#sendOpError(socket, op, "event op requires a valid turn.input envelope");
        return;
      }
      if (!this.#sessions.has(result.event.sid)) {
        this.#sendOpError(socket, op, `unknown session ${result.event.sid}`, { sid: result.event.sid });
        return;
      }
      const routingHints = isRecord(result.event.payload)
        ? routingHintsFrom(result.event.payload.routing_hints)
        : undefined;
      await this.#acceptTurnInput(
        socket,
        result.event.sid as `ses_${string}`,
        result.event.payload as Record<string, unknown>,
        result.event.labels,
        routingHints
      );
      return;
    }

    if (message.op === "turn.cancel") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "turn.cancel requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      const cancelled = this.#runner.cancel(message.sid);
      this.#sendAck(socket, op, { cancelled, sid: message.sid });
      return;
    }

    if (message.op === "approval.resolve") {
      if (!isSessionId(message.sid) || typeof message.request_id !== "string") {
        this.#sendOpError(socket, op, "approval.resolve requires sid and request_id");
        return;
      }
      if (message.decision !== "once" && message.decision !== "session" && message.decision !== "deny") {
        this.#sendOpError(socket, op, "approval.resolve decision must be once, session, or deny", { sid: message.sid });
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      const resolved = this.#runner.resolveApproval(message.sid, message.request_id, message.decision, "cli");
      if (!resolved) {
        this.#sendOpError(socket, op, "approval.resolve request_id not found", {
          request_id: message.request_id,
          sid: message.sid
        });
        return;
      }
      this.#sendAck(socket, op, { request_id: message.request_id, resolved, sid: message.sid });
      return;
    }

    this.#sendOpError(socket, op, `unknown op ${String(message.op)}`);
  }

  async #createSession(socket: WebSocket, title?: string): Promise<EventEnvelope> {
    const sid = createSessionId();
    this.#sessions.set(sid, createEmptySession(sid));
    this.#subscribe(socket, sid);

    return this.#emit({
      actor: "system",
      payload: {
        created_at: new Date().toISOString(),
        title: title ?? "Fairy session"
      },
      provenance: "agent",
      sid,
      turn: 0,
      type: "session.created"
    });
  }

  async #attachSession(socket: WebSocket, sid: `ses_${string}`, replayFrom?: string): Promise<void> {
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }

    const events = await this.#log.readSessionEvents(sid);
    const replayIndex = replayFrom ? events.findIndex((event) => event.id >= replayFrom) : 0;
    const start = replayIndex < 0 ? events.length : replayIndex;
    for (const event of events.slice(start)) {
      this.#sendEvent(socket, event);
    }
    this.#subscribe(socket, sid);
    state.lastActive = events.at(-1)?.ts ?? state.lastActive;
    await this.#emit({
      actor: "system",
      payload: { resumed_at: new Date().toISOString() },
      provenance: "agent",
      sid,
      turn: state.turn,
      type: "session.resumed"
    });
  }

  async #acceptTurnInput(
    socket: WebSocket,
    sid: `ses_${string}`,
    payload: Record<string, unknown>,
    inputLabels?: Labels,
    routingHints?: RoutingHints
  ): Promise<void> {
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }

    this.#subscribe(socket, sid);
    if (this.#runner.isRunning(sid)) {
      await this.#emitError(socket, sid, "A turn is already in flight for this session.");
      return;
    }

    const text = payloadText(payload);
    if (!text) {
      this.#sendOpError(socket, "turn.input", "turn.input content must include at least one text part.", { sid });
      return;
    }

    const labelEscalation = escalateLabelsForContent(text, inputLabels ?? this.#defaultLabels());
    const labels = labelEscalation.labels;
    const history: TurnRunnerHistory = { messages: [...state.history] };
    const turn = state.turn + 1;
    await this.#emit({
      actor: "user",
      labels,
      payload: {
        ...payload,
        ...(labelEscalation.escalations.length > 0 ? { label_escalations: labelEscalation.escalations } : {})
      },
      provenance: "user",
      sid,
      turn,
      type: "turn.input"
    });

    const run = this.#runner.runTurn({
      emit: (event) =>
        this.#emit({
          actor: actorForKernelEvent(event.type),
          ...(event.labels ? { labels: event.labels } : {}),
          payload: event.payload,
          provenance: "agent",
          sid,
          turn,
          type: event.type
        }),
      history,
      input: text,
      labels,
      ...(routingHints ? { routingHints } : {}),
      sid,
      turn
    });
    this.#turns.add(run);
    await run.finally(() => this.#turns.delete(run));
  }

  #subscribe(socket: WebSocket, sid: `ses_${string}`): void {
    const subscribers = this.#subscriptions.get(sid) ?? new Set<WebSocket>();
    subscribers.add(socket);
    this.#subscriptions.set(sid, subscribers);
  }

  #defaultLabels(): Labels {
    return defaultLabelsForProfile(governanceProfile(this.#config.config));
  }

  #makeEnvelope(event: {
    actor: Actor;
    labels?: Labels;
    payload: Record<string, unknown>;
    provenance: Provenance;
    sid: `ses_${string}`;
    turn: number;
    type: string;
  }): EventEnvelope {
    const envelope: EventEnvelope = {
      actor: event.actor,
      id: createEventId(),
      labels: event.labels ?? this.#defaultLabels(),
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
    return envelope;
  }

  async #emit(event: {
    actor: Actor;
    labels?: Labels;
    payload: Record<string, unknown>;
    provenance: Provenance;
    sid: `ses_${string}`;
    turn: number;
    type: string;
  }): Promise<EventEnvelope> {
    const envelope = this.#makeEnvelope(event);
    await this.#log.append(envelope);
    const state = this.#sessions.get(envelope.sid);
    if (state) {
      this.#recordEventInState(state, envelope);
    }

    for (const subscriber of this.#subscriptions.get(envelope.sid) ?? []) {
      this.#sendEvent(subscriber, envelope);
    }

    return envelope;
  }

  #sendEvent(socket: WebSocket, event: EventEnvelope): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  #sendRaw(socket: WebSocket, value: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(value));
    }
  }

  #sendAck(socket: WebSocket, op: string, fields: Record<string, unknown> = {}): void {
    this.#sendFrame(socket, { kind: "ack", op, ...fields });
  }

  #sendOpError(socket: WebSocket, op: string, message: string, fields: Record<string, unknown> = {}): void {
    this.#sendFrame(socket, { kind: "op-error", op, message, ...fields });
  }

  #sendFrame(socket: WebSocket, value: unknown): void {
    const result = validateFrame(value);
    if (!result.ok) {
      throw new Error(`invalid transport frame: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }
    this.#sendRaw(socket, result.frame);
  }

  async #emitError(socket: WebSocket, sid: `ses_${string}`, message: string): Promise<void> {
    await this.#emit({
      actor: "system",
      payload: { class: "UserError", message, retryable: false },
      provenance: "agent",
      sid,
      turn: this.#sessions.get(sid)?.turn ?? 0,
      type: "error"
    });
  }
}
