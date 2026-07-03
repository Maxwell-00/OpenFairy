import type { ChatMessage, ModelGateway, ModelMetadata, ToolDefinition } from "@fairy/model-gateway";
import { createHash } from "node:crypto";

export type ContextZoneName = "system" | "persona" | "tools" | "memory" | "skills" | "task" | "history" | "input";
export type ReductionStage = "L1" | "L2" | "L3" | "L4" | "L5";

export interface ContextConfig {
  readonly minRecentTurns: number;
  readonly outputReserve?: number;
  readonly reduceAt: number;
}

export interface ContextManifestPayload {
  readonly [key: string]: unknown;
  readonly zones: readonly { name: ContextZoneName; tokens: number; estimated: boolean }[];
  readonly budget: number;
  readonly window: number;
  readonly output_reserve: number;
  readonly projected_tokens: number;
  readonly reduction_stages_applied: readonly ReductionStage[];
  readonly prefix_hash: string;
  readonly model: string;
}

export interface AssemblePromptOptions {
  readonly config: ContextConfig;
  readonly currentTurnMessages?: readonly ChatMessage[];
  readonly currentInput: string;
  readonly history: readonly ChatMessage[];
  readonly model: ModelMetadata;
  readonly modelGateway: ModelGateway;
  readonly systemPrompt: string;
  readonly toolSafetyPrompt?: string;
  readonly tools: readonly ToolDefinition[];
}

export interface AssembledPrompt {
  readonly manifest: ContextManifestPayload;
  readonly messages: readonly ChatMessage[];
}

const zoneOrder: readonly ContextZoneName[] = ["system", "persona", "tools", "memory", "skills", "task", "history", "input"];

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
};

const estimate = (modelGateway: ModelGateway, value: unknown): number =>
  modelGateway.estimateTokens(typeof value === "string" ? value : stableSerialize(value)).tokens;

const textPreview = (text: string, max = 100): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`;

const turnOf = (message: ChatMessage, fallback: number): number =>
  typeof message.turn === "number" && Number.isInteger(message.turn) ? message.turn : fallback;

const userText = (message: ChatMessage): string => textPreview(message.content.replace(/\s+/g, " ").trim());

const parseToolContext = (message: ChatMessage): Record<string, unknown> | undefined => {
  if (message.role !== "tool") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(message.content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
};

const containsL1Artifact = (messages: readonly ChatMessage[]): boolean =>
  messages.some((message) => {
    const parsed = parseToolContext(message);
    const result = parsed?.result;
    return Array.isArray(parsed?.artifacts) ||
      (result && typeof result === "object" && "truncated" in result && result.truncated === true);
  });

const isToolBodyCandidate = (message: ChatMessage, protectedTurns: ReadonlySet<number>, fallbackTurn: number): boolean =>
  message.role === "tool" && !protectedTurns.has(turnOf(message, fallbackTurn));

const artifactRefFrom = (parsed: Record<string, unknown> | undefined): string | undefined => {
  const result = parsed?.result;
  if (result && typeof result === "object" && "artifact_ref" in result && typeof result.artifact_ref === "string") {
    return result.artifact_ref;
  }
  const artifact = Array.isArray(parsed?.artifacts) ? parsed.artifacts[0] : undefined;
  return artifact && typeof artifact === "object" && "ref" in artifact && typeof artifact.ref === "string"
    ? artifact.ref
    : undefined;
};

const elideOldToolBodies = (
  messages: readonly ChatMessage[],
  protectedTurns: ReadonlySet<number>,
  modelGateway: ModelGateway
): { messages: ChatMessage[]; changed: boolean } => {
  let fallbackTurn = 0;
  let changed = false;
  const elided = messages.map((message) => {
    if (message.role === "user") {
      fallbackTurn += 1;
    }
    const messageTurn = turnOf(message, fallbackTurn);
    if (!isToolBodyCandidate(message, protectedTurns, messageTurn)) {
      return message;
    }
    const before = estimate(modelGateway, message.content);
    const parsed = parseToolContext(message);
    const digest = stableSerialize({
      call_id: parsed?.call_id ?? message.tool_call_id ?? "unknown",
      digest: `tool result body elided; original approx ${before} tokens`,
      provenance: parsed?.provenance ?? "tool",
      status: parsed?.status ?? "ok",
      ...(artifactRefFrom(parsed) ? { artifact_ref: artifactRefFrom(parsed) } : {})
    });
    if (digest === message.content) {
      return message;
    }
    changed = true;
    return { ...message, content: digest };
  });
  return {
    changed,
    messages: elided
  };
};

const protectedRecentTurns = (history: readonly ChatMessage[], minRecentTurns: number): ReadonlySet<number> => {
  const turns = [...new Set(history.map((message, index) => turnOf(message, index + 1)).filter((turn) => turn > 0))].sort((a, b) => a - b);
  return new Set(turns.slice(Math.max(0, turns.length - minRecentTurns)));
};

const snipOldTurns = (
  messages: readonly ChatMessage[],
  protectedTurns: ReadonlySet<number>,
  modelGateway: ModelGateway
): { messages: ChatMessage[]; changed: boolean } => {
  const byTurn = new Map<number, ChatMessage[]>();
  for (const [index, message] of messages.entries()) {
    const turn = turnOf(message, index + 1);
    byTurn.set(turn, [...(byTurn.get(turn) ?? []), message]);
  }

  let changed = false;
  const output: ChatMessage[] = [];
  for (const [turn, turnMessages] of [...byTurn.entries()].sort(([left], [right]) => left - right)) {
    if (protectedTurns.has(turn)) {
      output.push(...turnMessages);
      continue;
    }

    const userMessages = turnMessages.filter((message) => message.role === "user");
    const reducible = turnMessages.filter((message) => message.role !== "user");
    if (reducible.length === 0) {
      output.push(...turnMessages);
      continue;
    }
    changed = true;
    output.push(...userMessages);
    const before = estimate(modelGateway, reducible);
    const users = userMessages.map((message) => `"${userText(message)}"`).join("; ") || "(no user text)";
    const placeholder = `[turn ${turn} elided: tool/assistant bodies dropped, approx ${before} tokens reclaimed; user said: ${users}]`;
    output.push({ content: placeholder, role: "assistant", turn });
  }
  return { changed, messages: output };
};

const tokenZones = (
  modelGateway: ModelGateway,
  systemContent: string,
  tools: readonly ToolDefinition[],
  history: readonly ChatMessage[],
  input: string
): ContextManifestPayload["zones"] => {
  const tokensByZone: Record<ContextZoneName, number> = {
    history: estimate(modelGateway, history),
    input: estimate(modelGateway, input),
    memory: 0,
    persona: 0,
    skills: 0,
    system: estimate(modelGateway, systemContent),
    task: 0,
    tools: tools.length > 0 ? estimate(modelGateway, tools) : 0
  };
  return zoneOrder.map((name) => ({ estimated: true, name, tokens: tokensByZone[name] }));
};

const totalZoneTokens = (zones: ContextManifestPayload["zones"]): number =>
  zones.reduce((sum, zone) => sum + zone.tokens, 0);

export const assemblePrompt = (options: AssemblePromptOptions): AssembledPrompt => {
  const systemContent = options.toolSafetyPrompt
    ? `${options.systemPrompt}\n\n${options.toolSafetyPrompt}`
    : options.systemPrompt;
  const outputReserve = options.config.outputReserve ?? options.model.max_output ?? 4096;
  const window = options.model.context_window;
  const budget = Math.max(1, Math.floor(window * options.config.reduceAt));
  const stages = new Set<ReductionStage>();

  const currentTurnMessages = options.currentTurnMessages?.map((message) => ({ ...message })) ?? [];
  let history = options.history.map((message) => ({ ...message }));
  if (containsL1Artifact([...history, ...currentTurnMessages])) {
    stages.add("L1");
  }

  let zones = tokenZones(options.modelGateway, systemContent, options.tools, [...history, ...currentTurnMessages], options.currentInput);
  let projected = totalZoneTokens(zones) + outputReserve;
  const protectedTurns = protectedRecentTurns(history, options.config.minRecentTurns);

  if (projected > budget) {
    const l2 = elideOldToolBodies(history, protectedTurns, options.modelGateway);
    history = l2.messages;
    if (l2.changed) {
      stages.add("L2");
    }
    zones = tokenZones(options.modelGateway, systemContent, options.tools, [...history, ...currentTurnMessages], options.currentInput);
    projected = totalZoneTokens(zones) + outputReserve;
  }

  if (projected > budget) {
    const l3 = snipOldTurns(history, protectedTurns, options.modelGateway);
    history = l3.messages;
    if (l3.changed) {
      stages.add("L3");
    }
    zones = tokenZones(options.modelGateway, systemContent, options.tools, [...history, ...currentTurnMessages], options.currentInput);
    projected = totalZoneTokens(zones) + outputReserve;
  }

  const prefixHash = createHash("sha256")
    .update(stableSerialize({ system: systemContent, tools: options.tools }))
    .digest("hex")
    .slice(0, 16);

  return {
    manifest: {
      budget,
      model: options.model.model,
      output_reserve: outputReserve,
      prefix_hash: `sha256:${prefixHash}`,
      projected_tokens: projected,
      reduction_stages_applied: [...stages],
      window,
      zones
    },
    messages: [
      { content: systemContent, role: "system" },
      ...history,
      { content: options.currentInput, role: "user" },
      ...currentTurnMessages
    ]
  };
};
