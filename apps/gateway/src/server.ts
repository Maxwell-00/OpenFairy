import { ArtifactRegistry, type ArtifactRecord } from "@fairy/artifacts";
import { AuditLog, escalateLabelsForContent, PermissionEngine, profileDefaults, redactText, TurnRunner, type KernelEventType, type TurnRunnerHistory } from "@fairy/kernel";
import { ChronicleStore, MemoryStore } from "@fairy/memory";
import { createModelGateway, deriveLabels, type ChatMessage, type RoutingHints } from "@fairy/model-gateway";
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
import { assertNoRawAudioPayloads, clampVoiceFrameLabels, DuplexVoiceTransport, LoopbackVoiceTransport, normalizeDuplexScript, normalizeLoopbackScript, voiceInputPolicyForProfile, WebSocketVoiceTransport, type DuplexScript, type SpeechEventInput, type SubmitFinalTranscriptInput } from "@fairy/voice";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

import { EventLog } from "./event-log.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { SpeechProviderCoordinator, type ProviderTtsEvidence, type SpeechProviderCoordinatorTestOptions } from "./speech-provider-coordinator.js";
import { SpeechWorkerProcess, SpeechWorkerProcessError, speechProviderWorkerDeadlines, speechWorkerDeadlines, type SpeechWorkerMockBehavior, type SpeechWorkerReadyInfo } from "./speech-worker-process.js";
import { synthesizeVisibleFinalSpeech } from "./visible-final-speech.js";
import { WebVoiceHttp, webVoiceHomeRegions } from "./web-voice-http.js";
import { isWebSocketOpAllowed, projectEventForWeb, projectFrameForWeb, socketSurfaceFromUrl, type GatewaySocketSurface } from "./web-voice-projection.js";

export const gatewayVersion = "0.1.0-m1";

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
  readonly audio_ref?: unknown;
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
  readonly script?: unknown;
}

interface WorkerVoiceScript extends DuplexScript {
  readonly workerBehavior: SpeechWorkerMockBehavior;
}

export interface MinimalGatewayTestOptions extends SpeechProviderCoordinatorTestOptions {
  readonly beforeAsrCanonicalFinal?: () => Promise<void>;
  readonly beforeAsrCoordinator?: () => Promise<void>;
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

const normalizeWorkerVoiceScript = (value: unknown): WorkerVoiceScript => {
  const script = normalizeDuplexScript(value);
  const record = isRecord(value) ? value : {};
  const workerBehavior = record.worker_behavior ?? record.workerBehavior ?? "normal";
  if (workerBehavior !== "normal" && workerBehavior !== "wait" && workerBehavior !== "crash" && workerBehavior !== "malformed") {
    throw new Error("voice worker script worker_behavior must be normal, wait, crash, or malformed");
  }
  return { ...script, workerBehavior };
};

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

const short = (value: string, max = 700): string =>
  value.length <= max ? value : `${value.slice(0, max)}...`;

const artifactRefFromPart = (part: Record<string, unknown>): string | undefined => {
  for (const key of ["ref", "artifact_id", "artifact_id_or_path", "path"]) {
    const value = part[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const labelsFromPart = (part: Record<string, unknown>): Labels | undefined =>
  isLabels(part.labels) ? part.labels : undefined;

const artifactBlock = (part: Record<string, unknown>, artifact?: ArtifactRecord): string => {
  const ref = artifactRefFromPart(part) ?? artifact?.artifact_id ?? "?";
  const labels = labelsFromPart(part) ?? artifact?.labels;
  const mime = typeof part.mime === "string" ? part.mime : artifact?.mime;
  const provenance = typeof part.provenance === "string" ? part.provenance : artifact?.origin;
  const description = typeof part.description === "string" ? part.description : undefined;
  const ocrExcerpt = typeof part.ocr_excerpt === "string" ? part.ocr_excerpt : undefined;
  return [
    "[artifact]",
    `ref: ${ref}`,
    ...(artifact ? [`artifact_id: ${artifact.artifact_id}`, `hash: ${artifact.hash}`, `path: ${artifact.path}`] : []),
    ...(mime ? [`mime: ${mime}`] : []),
    ...(labels ? [`labels: ${labels.sensitivity}/${labels.residency}`] : []),
    ...(provenance ? [`provenance: ${provenance}`] : []),
    ...(description ? [`description: ${short(description)}`] : []),
    ...(ocrExcerpt ? [`ocr_excerpt: ${short(ocrExcerpt)}`] : []),
    "[/artifact]"
  ].join("\n");
};

const renderContentSync = (content: unknown): { labels: Labels[]; text: string } => {
  if (!Array.isArray(content)) {
    return { labels: [], text: "" };
  }
  const labels: Labels[] = [];
  const text = content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      const partLabels = labelsFromPart(part);
      if (partLabels) {
        labels.push(partLabels);
      }
      if (part.kind === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.kind === "artifact" && artifactRefFromPart(part)) {
        return artifactBlock(part);
      }
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
  return { labels, text };
};

const renderContent = async (content: unknown, registry: ArtifactRegistry): Promise<{ labels: Labels[]; text: string }> => {
  if (!Array.isArray(content)) {
    return { labels: [], text: "" };
  }
  const labels: Labels[] = [];
  const blocks: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    const partLabels = labelsFromPart(part);
    if (partLabels) {
      labels.push(partLabels);
    }
    if (part.kind === "text" && typeof part.text === "string") {
      blocks.push(part.text);
      continue;
    }
    if (part.kind !== "artifact") {
      continue;
    }
    const ref = artifactRefFromPart(part);
    if (!ref) {
      continue;
    }
    const artifact = await registry.get(ref).catch(() => undefined);
    if (artifact) {
      labels.push(artifact.labels);
    }
    blocks.push(artifactBlock(part, artifact));
  }
  return { labels, text: blocks.join("\n") };
};

const payloadText = (payload: unknown): string =>
  isRecord(payload) ? renderContentSync(payload.content).text : "";

const eventCounts = (events: readonly EventEnvelope[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
};

const governanceProfile = (config: Record<string, unknown>): "balanced" | "sovereign" | "cloud-friendly" => {
  const governance = config.governance;
  const profile = isRecord(governance) ? governance.profile : undefined;
  return profile === "sovereign" || profile === "cloud-friendly" ? profile : "balanced";
};

const defaultLabelsForProfile = (profile: "balanced" | "sovereign" | "cloud-friendly"): Labels => {
  return profileDefaults(profile).userInputTrusted.labels;
};

const channelTrustFromPayload = (payload: Record<string, unknown>): "trusted" | "untrusted" =>
  payload.channel === "untrusted" || payload.channel === "external" ? "untrusted" : "trusted";

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
  if (type === "citation.recorded" || type === "snapshot.created" || type === "sourceset.reviewed") {
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
  readonly #chronicleStore: ChronicleStore;
  readonly #memoryStore: MemoryStore;
  readonly #sessions = new Map<string, SessionState>();
  readonly #sessionExecutions = new Map<string, { cancelled: boolean; readonly kind: "asr" | "turn"; readonly token: symbol }>();
  readonly #connections = new Set<WebSocket>(); readonly #connectionSurfaces = new Map<WebSocket, GatewaySocketSurface>();
  readonly #subscriptions = new Map<string, Set<WebSocket>>();
  readonly #turns = new Set<Promise<unknown>>();
  readonly #workerOperations = new Set<Promise<void>>();
  readonly #workers = new Set<SpeechWorkerProcess>();
  readonly #speechProviders: SpeechProviderCoordinator;
  readonly #testOptions: MinimalGatewayTestOptions;
  readonly #runner: TurnRunner;
  readonly #webVoiceHttp: WebVoiceHttp;

  constructor(config: GatewayRuntimeConfig, testOptions: MinimalGatewayTestOptions = {}) {
    if ((testOptions.beforeAsrCanonicalFinal || testOptions.beforeAsrCoordinator) && process.env.NODE_ENV !== "test" && process.env.CI !== "true") {
      throw new Error("gateway ASR barriers are available only to code-gated tests");
    }
    this.#config = config;
    this.#testOptions = testOptions;
    this.#log = new EventLog(config.dataDir);
    this.#auditLog = new AuditLog(config.dataDir);
    this.#chronicleStore = new ChronicleStore(config.dataDir, {
      labelContent: escalateLabelsForContent,
      workspaceRoot: config.workspaceRoot
    });
    this.#memoryStore = new MemoryStore(config.dataDir);
    this.#speechProviders = new SpeechProviderCoordinator({
      artifactsDir: config.artifactsDir,
      config: config.config,
      ownerLiveAsrProviderEnabled: config.ownerLiveAsrProviderEnabled,
      ownerLiveSpeechProviderEnabled: config.ownerLiveSpeechProviderEnabled,
      providers: config.speechProviderConfig,
      resolveMimoAsrCredential: config.resolveMimoAsrCredential,
      resolveSpeechProviderCredential: config.resolveSpeechProviderCredential,
      testOptions
    });
    const tools = createStandardToolRegistry({
      artifactsDir: config.artifactsDir,
      config: config.config,
      dataDir: config.dataDir,
      labelContent: escalateLabelsForContent,
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
      chronicleStore: this.#chronicleStore,
      contextConfig: config.contextConfig,
      egressGuardConfig: config.egressGuardConfig,
      maxToolIterations: config.maxToolIterations,
      memoryStore: this.#memoryStore,
      modelGateway,
      permissionAskTimeoutMs: config.askTimeoutMs,
      permissionEngine,
      personaRuntime: config.personaRuntime,
      toolContext: {
        artifactsDir: config.artifactsDir,
        env: process.env,
        workspaceRoot: config.workspaceRoot
      },
      tools,
      systemPrompt: config.systemPrompt
    });
    this.#webVoiceHttp = new WebVoiceHttp({
      artifactsDir: config.artifactsDir, authToken: config.authToken,
      homeRegions: webVoiceHomeRegions(config.config),
      isSessionBusy: (sid) => this.#sessionExecutions.has(sid) || this.#runner.isRunning(sid),
      readSessionEvents: (sid) => this.#log.readSessionEvents(sid), sessionExists: (sid) => this.#sessions.has(sid),
      voiceEnabled: config.voiceConfig.enabled,
      voiceLabels: voiceInputPolicyForProfile(governanceProfile(config.config)).labels
    });
    this.#server = createServer((request, response) => { void this.#handleHttp(request, response).catch(() => json(response, 500, { error: "internal_error" })); });
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#wss.on("connection", (socket, request) => this.#handleConnection(socket, request));
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.#memoryStore.rebuildFromSessionLogs();
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
    await this.#speechProviders.shutdown();
    await Promise.allSettled([...this.#workers].map((worker) => worker.terminateForTest("gateway shutdown")));
    await Promise.allSettled([...this.#workerOperations]);
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
        state.history.push({ content: text, event_id: event.id, labels: event.labels, provenance: event.provenance, role: "user", turn: event.turn });
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
          event_id: event.id,
          labels: event.labels,
          provenance: event.provenance,
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
        const provenance = typeof event.payload.provenance === "string" ? event.payload.provenance : event.provenance;
        state.history.push({
          content: stablePayload(event.payload),
          event_id: event.id,
          labels: event.labels,
          provenance,
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
        state.history.push({ content: text, event_id: event.id, labels: event.labels, provenance: event.provenance, role: "assistant", turn: event.turn });
      }
    }
  }

  async #handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (await this.#webVoiceHttp.handle(request, response)) {
      return;
    }
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
    this.#connectionSurfaces.set(socket, socketSurfaceFromUrl(request.url));
    socket.on("close", () => {
      this.#connections.delete(socket); this.#connectionSurfaces.delete(socket);
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
    if (this.#connectionSurfaces.get(socket) === "web-v0" && !isWebSocketOpAllowed(op)) {
      this.#sendOpError(socket, op, "Operation is not available on the Web surface.");
      return;
    }

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

    if (message.op === "voice.loopback") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "voice.loopback requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      await this.#runVoiceLoopback(socket, message.sid, message.script, op);
      return;
    }

    if (message.op === "voice.duplex") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "voice.duplex requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      await this.#runVoiceDuplex(socket, message.sid, message.script, op);
      return;
    }

    if (message.op === "voice.ws") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "voice.ws requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      await this.#runVoiceWebSocket(socket, message.sid, message.script, op);
      return;
    }

    if (message.op === "voice.worker") {
      if (!isSessionId(message.sid)) {
        this.#sendOpError(socket, op, "voice.worker requires sid");
        return;
      }
      if (!this.#sessions.has(message.sid)) {
        this.#sendOpError(socket, op, `unknown session ${message.sid}`, { sid: message.sid });
        return;
      }
      const operation = this.#runVoiceWorker(socket, message.sid, message.script, op);
      this.#workerOperations.add(operation);
      await operation.finally(() => this.#workerOperations.delete(operation));
      return;
    }

    if (message.op === "voice.asr") {
      if (!isSessionId(message.sid) || typeof message.audio_ref !== "string") {
        this.#sendOpError(socket, op, "voice.asr requires sid and audio_ref");
        return;
      }
      const sid = message.sid;
      if (!this.#sessions.has(sid)) {
        this.#sendOpError(socket, op, `unknown session ${sid}`, { sid });
        return;
      }
      if (message.labels !== undefined && !isLabels(message.labels)) {
        this.#sendOpError(socket, op, "voice.asr labels must include valid sensitivity and residency.", { sid });
        return;
      }
      if (this.#sessionExecutions.has(sid) || this.#runner.isRunning(sid)) {
        this.#sendOpError(socket, op, "A turn or voice ASR is already in flight for this session.", { sid });
        return;
      }
      const reservationToken = Symbol("voice.asr");
      this.#sessionExecutions.set(sid, { cancelled: false, kind: "asr", token: reservationToken });
      const operation = this.#runVoiceAsr(socket, sid, message.audio_ref, message.labels, op, reservationToken);
      this.#workerOperations.add(operation);
      await operation.finally(() => {
        this.#workerOperations.delete(operation);
        if (this.#sessionExecutions.get(sid)?.token === reservationToken) {
          this.#sessionExecutions.delete(sid);
        }
      });
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
      const reservation = this.#sessionExecutions.get(message.sid);
      const reservationCancelled = reservation?.kind === "asr" && !reservation.cancelled;
      if (reservationCancelled) {
        reservation.cancelled = true;
      }
      const runnerCancelled = this.#runner.cancel(message.sid);
      const asrCancelled = await this.#speechProviders.cancelAsr(message.sid);
      const cancelled = reservationCancelled || runnerCancelled || asrCancelled;
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
    routingHints?: RoutingHints,
    turnOverride?: number,
    reservationToken?: symbol
  ): Promise<readonly EventEnvelope[]> {
    const emitted: EventEnvelope[] = [];
    const emitAndCapture = async (event: {
      actor: Actor;
      labels?: Labels;
      payload: Record<string, unknown>;
      provenance: Provenance;
      sid: `ses_${string}`;
      turn: number;
      type: string;
    }): Promise<EventEnvelope> => {
      const envelope = await this.#emit(event);
      emitted.push(envelope);
      return envelope;
    };
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }
    const reservation = this.#sessionExecutions.get(sid);
    const ownsAsrReservation = reservationToken !== undefined && reservation?.kind === "asr" && reservation.token === reservationToken && !reservation.cancelled;
    let turnReservationToken: symbol | undefined;
    if (!ownsAsrReservation) {
      if (reservationToken !== undefined || reservation) {
        this.#sendOpError(socket, "turn.input", "A turn or voice ASR is already in flight for this session.", { sid });
        return emitted;
      }
      turnReservationToken = Symbol("turn");
      this.#sessionExecutions.set(sid, { cancelled: false, kind: "turn", token: turnReservationToken });
    }

    try {
      this.#subscribe(socket, sid);
      if (this.#runner.isRunning(sid)) {
        await this.#emitError(socket, sid, "A turn is already in flight for this session.");
        return emitted;
      }

      const rendered = await renderContent(payload.content, new ArtifactRegistry(this.#config.artifactsDir));
      const text = rendered.text;
      if (!text) {
        this.#sendOpError(socket, "turn.input", "turn.input content must include at least one text or artifact part.", { sid });
        return emitted;
      }

      const baseLabels = inputLabels ?? this.#defaultLabels();
      const contentLabels = deriveLabels([
        { labels: baseLabels },
        ...rendered.labels.map((labels) => ({ labels }))
      ], baseLabels);
      const labelEscalation = escalateLabelsForContent(text, contentLabels);
      const labels = labelEscalation.labels;
      const channelTrust = channelTrustFromPayload(payload);
      const history: TurnRunnerHistory = { messages: [...state.history] };
      const turn = turnOverride ?? state.turn + 1;
      await emitAndCapture({
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
          emitAndCapture({
            actor: actorForKernelEvent(event.type),
            ...(event.labels ? { labels: event.labels } : {}),
            payload: event.payload,
            provenance: event.provenance ?? "agent",
            sid,
            turn,
            type: event.type
          }),
        history,
        input: text,
        labels,
        channelTrust,
        ...(routingHints ? { routingHints } : {}),
        sid,
        turn
      });
      this.#turns.add(run);
      await run.finally(() => this.#turns.delete(run));
      return emitted;
    } finally {
      if (turnReservationToken && this.#sessionExecutions.get(sid)?.token === turnReservationToken) {
        this.#sessionExecutions.delete(sid);
      }
    }
  }

  async #submitVoiceFinalTranscript(
    socket: WebSocket,
    sid: `ses_${string}`,
    input: SubmitFinalTranscriptInput,
    turn: number,
    reservationToken?: symbol
  ): Promise<{ assistantFinalText: string; labels: Labels; turnEvents: readonly EventEnvelope[] }> {
    const payload: Record<string, unknown> = {
      channel: "voice",
      content: [{ kind: "text", text: input.text }],
      ...(input.routingHints ? { routing_hints: input.routingHints } : {}),
      speech: {
        audio_ref: input.audioRef,
        utterance_id: input.utteranceId
      }
    };
    const turnEvents = await this.#acceptTurnInput(socket, sid, payload, input.labels, input.routingHints, turn, reservationToken);
    const final = turnEvents.filter((event) => event.type === "turn.final").at(-1);
    const assistantFinalText = final ? payloadText(final.payload) : "";
    return {
      assistantFinalText,
      labels: final ? escalateLabelsForContent(assistantFinalText, final.labels).labels : input.labels,
      turnEvents
    };
  }

  async #runVoiceAsr(
    socket: WebSocket,
    sid: `ses_${string}`,
    audioRef: string,
    requestLabels: Labels | undefined,
    op: string,
    reservationToken: symbol
  ): Promise<void> {
    if (!this.#config.voiceConfig.enabled) {
      this.#sendOpError(socket, op, "voice ASR is disabled", { sid });
      return;
    }
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }
    const policy = voiceInputPolicyForProfile(governanceProfile(this.#config.config));
    const turn = state.turn + 1;
    const utteranceId = `utt_asr_${audioRef.slice(4, 16)}_${turn}`;
    const ownsUncancelledReservation = (): boolean => {
      const reservation = this.#sessionExecutions.get(sid);
      return reservation?.kind === "asr" && reservation.token === reservationToken && !reservation.cancelled;
    };
    await this.#testOptions.beforeAsrCoordinator?.();
    const result = await this.#speechProviders.runAsr({
      audioRef,
      emitProgress: ({ detail, extra, labels, stage }) => this.#emit({
        actor: "system",
        labels,
        payload: { detail, stage, ...extra },
        provenance: "agent",
        sid,
        turn,
        type: "progress.update"
      }),
      floorLabels: policy.labels,
      isCancelled: () => !ownsUncancelledReservation(),
      operationId: sid,
      ...(requestLabels ? { requestLabels } : {}),
      routingHints: policy.routingHints ?? {},
      utteranceId
    });
    const speechEvents: EventEnvelope[] = [];
    let turnEvents: readonly EventEnvelope[] = [];
    let assistantFinalText = "";
    let transcriptText = "";
    let webTts: ProviderTtsEvidence | undefined; let ttsAudioRef: string | undefined; let ttsChunkCount = 0;
    if (result.status === "none" && result.transcriptText) {
      await this.#testOptions.beforeAsrCanonicalFinal?.();
      if (ownsUncancelledReservation()) {
        transcriptText = result.transcriptText;
        const finalLabels = escalateLabelsForContent(transcriptText, result.effectiveLabels).labels;
        speechEvents.push(await this.#emit({
          actor: "user",
          labels: finalLabels,
          payload: { audio_ref: audioRef, text: transcriptText, utterance_id: utteranceId },
          provenance: "user",
          sid,
          turn,
          type: "speech.asr.final"
        }));
        if (ownsUncancelledReservation()) {
          const submitted = await this.#submitVoiceFinalTranscript(socket, sid, {
            audioRef,
            labels: finalLabels,
            ...(policy.routingHints ? { routingHints: policy.routingHints } : {}),
            text: transcriptText,
            utteranceId
          }, turn, reservationToken);
          turnEvents = submitted.turnEvents;
          assistantFinalText = submitted.assistantFinalText;
          if (
            this.#connectionSurfaces.get(socket) === "web-v0" &&
            assistantFinalText.length > 0 &&
            ownsUncancelledReservation() &&
            this.#config.speechProviderConfig.ttsCandidates.length > 0
          ) {
            const synthesis = await synthesizeVisibleFinalSpeech({
              coordinator: this.#speechProviders,
              emitProgress: ({ detail, extra, labels, stage }) => this.#emit({
                actor: "system",
                labels,
                payload: { detail, stage, ...extra },
                provenance: "agent",
                sid,
                turn,
                type: "progress.update"
              }),
              emitSpeech: async (event) => {
                speechEvents.push(await this.#emit({ ...event, sid }));
              },
              labels: submitted.labels,
              maxProviderCandidates: 1,
              text: assistantFinalText,
              turn,
              utteranceId
            });
            webTts = synthesis.provider;
            ttsAudioRef = synthesis.audioRef;
            ttsChunkCount = synthesis.ttsChunkCount;
          }
        }
      }
    }
    const allEvents = [...result.events, ...speechEvents, ...turnEvents, ...(webTts?.events ?? [])];
    assertNoRawAudioPayloads(allEvents);
    const provider = result.selectedProvider;
    const cancelled = result.cancelled || !ownsUncancelledReservation();
    const ttsFailed = webTts !== undefined && webTts.status !== "none";
    this.#sendAck(socket, op, {
      asr_final_count: speechEvents.filter((event) => event.type === "speech.asr.final").length,
      assistant_final_text: assistantFinalText,
      audio_ref: audioRef,
      cancelled,
      effective_labels: result.effectiveLabels,
      error_category: cancelled && result.errorCategory === "none" ? "cancelled" : ttsFailed ? "tts_failed" : result.errorCategory,
      error_status: cancelled && result.status === "none" ? "asr_cancelled" : ttsFailed ? "tts_failed" : result.status,
      event_counts: eventCounts(allEvents),
      model_request_count: turnEvents.filter((event) => event.type === "turn.final").length,
      provider_connection_count: result.providerConnectionCount,
      provider_request_count: result.providerRequestCount,
      provider_retryable: result.retryable,
      provider_route: result.route,
      replay_command: `fairy replay ${sid}`,
      request_id: provider ? `provider-asr:${utteranceId}:${provider.id}` : null,
      sid,
      staged_input_bytes: result.stagedBytes,
      transcript_text: transcriptText,
      tts_audio_ref: ttsAudioRef,
      tts_chunk_count: ttsChunkCount,
      turn,
      turn_input_count: turnEvents.filter((event) => event.type === "turn.input").length,
      worker_process_id: result.worker?.processId ?? null,
      worker_spawn_count: result.workerSpawnCount,
      ...(provider ? {
        asr_provider: {
          auth: "api-key",
          endpoint_profile: provider.endpointProfile,
          finish_reason: result.providerEvidence?.finishReason,
          model: provider.model,
          provider_id: provider.id,
          provider_request_id: result.providerEvidence?.requestId,
          transport: provider.transport,
          usage_seconds: result.usageSeconds,
          worker: result.worker
        }
      } : {})
    });
  }

  async #runVoiceLoopback(socket: WebSocket, sid: `ses_${string}`, scriptValue: unknown, op: string): Promise<void> {
    if (!this.#config.voiceConfig.enabled) {
      this.#sendOpError(socket, op, "voice loopback is disabled", { sid });
      return;
    }
    let script;
    try {
      script = normalizeLoopbackScript(scriptValue);
    } catch (error) {
      this.#sendOpError(socket, op, error instanceof Error ? error.message : String(error), { sid });
      return;
    }
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }
    const profile = governanceProfile(this.#config.config);
    const turn = state.turn + 1;
    const speechEvents: EventEnvelope[] = [];
    let turnEvents: readonly EventEnvelope[] = [];
    const transport = new LoopbackVoiceTransport({
      ttsChunkChars: this.#config.voiceConfig.loopback.ttsChunkChars
    });

    const result = await transport.run({
      emit: async (event) => {
        const envelope = await this.#emit({
          actor: event.actor,
          labels: event.labels,
          payload: event.payload,
          provenance: event.provenance,
          sid,
          turn: event.turn,
          type: event.type
        });
        speechEvents.push(envelope);
      },
      labelFinalTranscript: (text, floorLabels) => escalateLabelsForContent(text, floorLabels).labels,
      profile,
      script,
      submitFinalTranscript: async (input) => {
        const submitted = await this.#submitVoiceFinalTranscript(socket, sid, input, turn);
        turnEvents = submitted.turnEvents;
        return {
          assistantFinalText: submitted.assistantFinalText,
          labels: submitted.labels
        };
      },
      turn
    });

    const allEvents = [...speechEvents, ...turnEvents];
    this.#sendAck(socket, op, {
      assistant_final_text: result.assistantFinalText,
      event_counts: {
        ...result.eventCounts,
        ...eventCounts(allEvents)
      },
      log_path: join(this.#config.dataDir, "sessions", sid, "log.jsonl"),
      replay_command: `fairy replay ${sid} --data-dir ${this.#config.dataDir}`,
      sid,
      transcript_text: result.transcriptText,
      tts_chunk_count: result.ttsChunkCount,
      turn
    });
  }

  async #runVoiceDuplex(socket: WebSocket, sid: `ses_${string}`, scriptValue: unknown, op: string): Promise<void> {
    if (!this.#config.voiceConfig.enabled) {
      this.#sendOpError(socket, op, "voice duplex is disabled", { sid });
      return;
    }
    let script;
    try {
      script = normalizeDuplexScript(scriptValue);
    } catch (error) {
      this.#sendOpError(socket, op, error instanceof Error ? error.message : String(error), { sid });
      return;
    }
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }
    const profile = governanceProfile(this.#config.config);
    const turn = state.turn + 1;
    const speechEvents: EventEnvelope[] = [];
    let turnEvents: readonly EventEnvelope[] = [];
    const transport = new DuplexVoiceTransport({
      ttsChunkChars: this.#config.voiceConfig.loopback.ttsChunkChars
    });

    const result = await transport.run({
      emit: async (event) => {
        const envelope = await this.#emit({
          actor: event.actor,
          labels: event.labels,
          payload: event.payload,
          provenance: event.provenance,
          sid,
          turn: event.turn,
          type: event.type
        });
        speechEvents.push(envelope);
      },
      labelFinalTranscript: (text, floorLabels) => escalateLabelsForContent(text, floorLabels).labels,
      profile,
      script,
      submitFinalTranscript: async (input) => {
        const submitted = await this.#submitVoiceFinalTranscript(socket, sid, input, turn);
        turnEvents = submitted.turnEvents;
        return {
          assistantFinalText: submitted.assistantFinalText,
          labels: submitted.labels
        };
      },
      turn
    });

    const allEvents = [...speechEvents, ...turnEvents];
    this.#sendAck(socket, op, {
      assistant_final_text: result.assistantFinalText,
      cancelled: result.cancelled,
      event_counts: {
        ...result.eventCounts,
        ...eventCounts(allEvents)
      },
      frame_counts: result.frameCounts,
      log_path: join(this.#config.dataDir, "sessions", sid, "log.jsonl"),
      model_request_count: allEvents.filter((event) => event.type === "turn.final").length,
      replay_command: `fairy replay ${sid} --data-dir ${this.#config.dataDir}`,
      sid,
      transcript_text: result.transcriptText,
      tts_chunk_count: result.ttsChunkCount,
      turn
    });
  }

  async #runVoiceWebSocket(socket: WebSocket, sid: `ses_${string}`, scriptValue: unknown, op: string): Promise<void> {
    if (!this.#config.voiceConfig.enabled) {
      this.#sendOpError(socket, op, "voice websocket is disabled", { sid });
      return;
    }
    let script;
    try {
      script = normalizeDuplexScript(scriptValue);
    } catch (error) {
      this.#sendOpError(socket, op, error instanceof Error ? error.message : String(error), { sid });
      return;
    }
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }
    const profile = governanceProfile(this.#config.config);
    const turn = state.turn + 1;
    const speechEvents: EventEnvelope[] = [];
    let turnEvents: readonly EventEnvelope[] = [];
    const transport = new WebSocketVoiceTransport({
      ttsChunkChars: this.#config.voiceConfig.loopback.ttsChunkChars
    });

    const result = await transport.run({
      emit: async (event) => {
        const envelope = await this.#emit({
          actor: event.actor,
          labels: event.labels,
          payload: event.payload,
          provenance: event.provenance,
          sid,
          turn: event.turn,
          type: event.type
        });
        speechEvents.push(envelope);
      },
      labelFinalTranscript: (text, floorLabels) => escalateLabelsForContent(text, floorLabels).labels,
      profile,
      script,
      submitFinalTranscript: async (input) => {
        const submitted = await this.#submitVoiceFinalTranscript(socket, sid, input, turn);
        turnEvents = submitted.turnEvents;
        return {
          assistantFinalText: submitted.assistantFinalText,
          labels: submitted.labels
        };
      },
      turn
    });

    const allEvents = [...speechEvents, ...turnEvents];
    this.#sendAck(socket, op, {
      assistant_final_text: result.assistantFinalText,
      cancelled: result.cancelled,
      event_counts: {
        ...result.eventCounts,
        ...eventCounts(allEvents)
      },
      frame_counts: result.frameCounts,
      log_path: join(this.#config.dataDir, "sessions", sid, "log.jsonl"),
      model_request_count: allEvents.filter((event) => event.type === "turn.final").length,
      replay_command: `fairy replay ${sid} --data-dir ${this.#config.dataDir}`,
      sid,
      transcript_text: result.transcriptText,
      tts_chunk_count: result.ttsChunkCount,
      turn,
      websocket_frame_counts: result.websocketFrameCounts
    });
  }

  async #runVoiceWorker(socket: WebSocket, sid: `ses_${string}`, scriptValue: unknown, op: string): Promise<void> {
    if (!this.#config.voiceConfig.enabled) {
      this.#sendOpError(socket, op, "voice worker is disabled", { sid });
      return;
    }
    let script: WorkerVoiceScript;
    try {
      script = normalizeWorkerVoiceScript(scriptValue);
    } catch (error) {
      this.#sendOpError(socket, op, error instanceof Error ? error.message : String(error), { sid });
      return;
    }
    const state = this.#sessions.get(sid);
    if (!state) {
      throw new Error(`unknown session ${sid}`);
    }

    const profile = governanceProfile(this.#config.config);
    const policy = voiceInputPolicyForProfile(profile);
    const effectiveFloor = clampVoiceFrameLabels(policy.labels, script.frameLabels);
    const turn = state.turn + 1;
    const asrRequestId = `worker-asr:${script.utteranceId}`;
    const cancelRequestId = `worker-cancel:${script.utteranceId}`;
    const ttsRequestId = `worker-tts:${script.utteranceId}`;
    const speechEvents: EventEnvelope[] = [];
    let turnEvents: readonly EventEnvelope[] = [];
    let assistantFinalText = "";
    let cancelled = false;
    let errorStatus = "none";
    let ready: SpeechWorkerReadyInfo | undefined;
    let providerTts: ProviderTtsEvidence | undefined;
    let transcriptText = "";
    let ttsChunkCount = 0;
    const worker = new SpeechWorkerProcess();
    this.#workers.add(worker);

    const emitSpeech = async (event: SpeechEventInput): Promise<void> => {
      const envelope = await this.#emit({
        actor: event.actor,
        labels: event.labels,
        payload: event.payload,
        provenance: event.provenance,
        sid,
        turn: event.turn,
        type: event.type
      });
      speechEvents.push(envelope);
    };
    const emitMark = (markId: string, labels: Labels): Promise<void> => emitSpeech({
      actor: "system",
      labels,
      payload: { mark_id: markId, position_ms: 0 },
      provenance: "agent",
      turn,
      type: "speech.mark"
    });

    try {
      ready = await worker.start();
      await emitMark("asr-start", effectiveFloor);
      const asrPromise = worker.requestAsr({
        audioRef: script.audioRef,
        final: script.text,
        labels: script.frameLabels ?? policy.labels,
        mockBehavior: script.cancelAsrBeforeFinal ? "wait" : script.workerBehavior,
        partials: script.partials,
        requestId: asrRequestId,
        utteranceId: script.utteranceId
      }, async (text) => emitSpeech({
        actor: "user",
        labels: effectiveFloor,
        payload: { text, utterance_id: script.utteranceId },
        provenance: "user",
        turn,
        type: "speech.asr.partial"
      }));

      if (script.cancelAsrBeforeFinal) {
        await worker.cancel(cancelRequestId, asrRequestId, "asr", "scripted ASR cancellation");
      }
      const asr = await asrPromise;
      if (asr.cancelled) {
        cancelled = true;
        await emitMark("asr-cancelled", effectiveFloor);
      } else {
        if (!asr.text || !asr.audioRef) {
          throw new SpeechWorkerProcessError("SPEECH_WORKER_ASR_INCOMPLETE", "speech worker ASR completed without a final transcript");
        }
        transcriptText = asr.text;
        const finalLabels = escalateLabelsForContent(asr.text, effectiveFloor).labels;
        await emitSpeech({
          actor: "user",
          labels: finalLabels,
          payload: {
            audio_ref: asr.audioRef,
            text: asr.text,
            utterance_id: asr.utteranceId
          },
          provenance: "user",
          turn,
          type: "speech.asr.final"
        });
        await emitMark("asr-end", finalLabels);

        const submitted = await this.#submitVoiceFinalTranscript(socket, sid, {
          audioRef: asr.audioRef,
          labels: effectiveFloor,
          ...(policy.routingHints ? { routingHints: policy.routingHints } : {}),
          text: asr.text,
          utteranceId: asr.utteranceId
        }, turn);
        turnEvents = submitted.turnEvents;
        assistantFinalText = submitted.assistantFinalText;
        const ttsLabels = submitted.labels;
        if (assistantFinalText.length > 0) {
          if (this.#config.speechProviderConfig.ttsCandidates.length > 0) {
            const synthesis = await synthesizeVisibleFinalSpeech({
              coordinator: this.#speechProviders,
              emitProgress: ({ detail, extra, labels, stage }) => this.#emit({
                actor: "system",
                labels,
                payload: { detail, stage, ...extra },
                provenance: "agent",
                sid,
                turn,
                type: "progress.update"
              }),
              emitSpeech,
              labels: ttsLabels,
              routingHints: policy.routingHints ?? {},
              text: assistantFinalText,
              turn,
              utteranceId: asr.utteranceId
            });
            providerTts = synthesis.provider;
            ttsChunkCount = synthesis.ttsChunkCount;
            if (providerTts.status !== "none") {
              errorStatus = providerTts.status;
            }
          } else {
            await emitMark("tts-start", ttsLabels);
            const tts = await worker.requestTts({
              chunkChars: this.#config.voiceConfig.loopback.ttsChunkChars,
              labels: ttsLabels,
              requestId: ttsRequestId,
              text: assistantFinalText,
              utteranceId: asr.utteranceId
            }, async (chunk) => emitSpeech({
              actor: "agent",
              labels: ttsLabels,
              payload: {
                ...(chunk.audioRef ? { audio_ref: chunk.audioRef } : {}),
                chunk_id: chunk.chunkId,
                text: chunk.text
              },
              provenance: "agent",
              turn,
              type: "speech.tts.chunk"
            }));
            ttsChunkCount = tts.chunks.length;
            await emitMark("tts-end", ttsLabels);
          }
        }
        await emitMark("turn-boundary", ttsLabels);
      }
      assertNoRawAudioPayloads(speechEvents);
    } catch (error) {
      errorStatus = error instanceof SpeechWorkerProcessError ? error.code : "SPEECH_WORKER_FAILED";
      await this.#emit({
        actor: "system",
        labels: effectiveFloor,
        payload: {
          detail: `Speech worker request failed (${redactText(errorStatus)}).`,
          error_code: redactText(errorStatus),
          stage: "voice.worker.failed"
        },
        provenance: "agent",
        sid,
        turn,
        type: "progress.update"
      });
    } finally {
      try {
        await worker.shutdown();
      } catch (error) {
        if (errorStatus === "none") {
          errorStatus = error instanceof SpeechWorkerProcessError ? error.code : "SPEECH_WORKER_SHUTDOWN_FAILED";
          await this.#emit({
            actor: "system",
            labels: effectiveFloor,
            payload: {
              detail: `Speech worker cleanup failed (${redactText(errorStatus)}).`,
              error_code: redactText(errorStatus),
              stage: "voice.worker.failed"
            },
            provenance: "agent",
            sid,
            turn,
            type: "progress.update"
          });
        }
      }
      this.#workers.delete(worker);
    }

    const allEvents = [...speechEvents, ...turnEvents, ...(providerTts?.events ?? [])];
    const selectedProvider = providerTts?.selectedProvider;
    this.#sendAck(socket, op, {
      assistant_final_text: assistantFinalText,
      cancelled,
      deadlines_ms: speechWorkerDeadlines,
      error_status: errorStatus,
      event_counts: eventCounts(allEvents),
      interpreter: ready?.interpreter,
      log_path: join(this.#config.dataDir, "sessions", sid, "log.jsonl"),
      model_request_count: turnEvents.filter((event) => event.type === "turn.final").length,
      python_version: ready?.pythonVersion,
      replay_command: `fairy replay ${sid} --data-dir ${this.#config.dataDir}`,
      request_ids: {
        asr: asrRequestId,
        cancel: script.cancelAsrBeforeFinal ? cancelRequestId : null,
          tts: assistantFinalText.length > 0
          ? providerTts?.selectedProvider
            ? `provider-tts:${script.utteranceId}:${providerTts.selectedProvider.id}`
            : this.#config.speechProviderConfig.ttsCandidates.length > 0 ? null : ttsRequestId
          : null
      },
      provider_request_count: providerTts?.providerRequestCount ?? 0,
      provider_route: providerTts?.route ?? [],
      ...(selectedProvider && providerTts?.successChecks ? {
        tts_provider: {
          artifact_id: providerTts?.artifactId,
          artifact_ref: providerTts?.artifactRef,
          audio_format: selectedProvider.audio.format,
          byte_count: providerTts?.byteCount,
          deadlines_ms: speechProviderWorkerDeadlines,
          endpoint_profile: selectedProvider.endpointProfile,
          model: selectedProvider.model,
          provider_id: selectedProvider.id,
          request_id: `provider-tts:${script.utteranceId}:${selectedProvider.id}`,
          sha256: providerTts?.sha256,
          success_checks: providerTts.successChecks,
          transport: selectedProvider.transport,
          voice_id: selectedProvider.voice.voiceId,
          worker: providerTts?.worker
        }
      } : {}),
      sid,
      transcript_text: transcriptText,
      tts_chunk_count: ttsChunkCount,
      turn,
      worker_id: ready?.workerId,
      worker_process_id: ready?.processId ?? worker.processId()
    });
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
    const projected = this.#connectionSurfaces.get(socket) === "web-v0" ? projectEventForWeb(event) : event;
    if (projected && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(projected));
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
    this.#sendRaw(socket, this.#connectionSurfaces.get(socket) === "web-v0"
      ? projectFrameForWeb(result.frame as unknown as Record<string, unknown>)
      : result.frame);
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
