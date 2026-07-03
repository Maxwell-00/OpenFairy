import {
  ProviderError,
  type ChatMessage,
  type ModelConfig,
  type NormalizedModelEvent,
  type ToolDefinition,
  type UsageSnapshot
} from "./types.js";
import { parseSseDataBlocks } from "./sse.js";
import { estimateTextTokens } from "./tokens.js";

interface OpenAIChunk {
  readonly choices?: readonly {
    readonly index?: number;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly OpenAIToolCallDelta[];
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  } | null;
  readonly error?: {
    readonly message?: string;
    readonly type?: string;
    readonly code?: string;
  };
}

interface OpenAIToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/$/, "")}/chat/completions`;

const mapFinishReason = (finish: string | null | undefined): "stop" | "cancelled" | "error" | "tool-limit" => {
  if (finish === "stop" || finish === "length") {
    return finish === "length" ? "error" : "stop";
  }
  if (finish === "tool_calls") {
    return "tool-limit";
  }
  return finish ? "error" : "stop";
};

const responseError = async (response: Response): Promise<ProviderError> => {
  const text = await response.text().catch(() => "");
  const message = text || `provider returned HTTP ${response.status}`;
  return new ProviderError(message, {
    auth: response.status === 401 || response.status === 403,
    context_overflow: response.status === 400 && /context|token/i.test(message),
    rate_limited: response.status === 429,
    retryable: response.status === 429 || response.status >= 500
  });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// OpenAI/DeepSeek require function names to match ^[a-zA-Z0-9_-]+$, but Fairy's internal
// tool namespace uses dots (fs.read, shell.run) — load-bearing for permission globs,
// `tool:<name>` provenance, and audit. Map names bijectively at the wire boundary ONLY.
// "__" is the reserved dot-encoding sentinel (internal tool names never contain "__").
export const toWireName = (name: string): string => name.replaceAll(".", "__");
export const fromWireName = (name: string): string => name.replaceAll("__", ".");

const buildTools = (tools: readonly ToolDefinition[] | undefined): unknown[] | undefined =>
  tools?.map((tool) => ({
    function: {
      description: tool.description,
      name: toWireName(tool.name),
      parameters: tool.params
    },
    type: "function"
  }));

const buildMessages = (messages: readonly ChatMessage[]): unknown[] =>
  messages.map((message) => ({
    content: message.content,
    role: message.role,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            function: {
              arguments: JSON.stringify(call.arguments),
              name: toWireName(call.name)
            },
            id: call.id,
            type: "function"
          }))
        }
      : {})
  }));

interface PendingToolCall {
  args: string;
  callId?: string;
  emitted: boolean;
  name?: string;
  order: number;
}

const parseToolArgs = (raw: string, allowEmpty = false): Record<string, unknown> | undefined => {
  if (raw.trim().length === 0 && allowEmpty) {
    return {};
  }
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

class ToolCallReassembler {
  readonly #pending = new Map<string, PendingToolCall>();
  #order = 0;

  #completedFor(pending: PendingToolCall, allowEmpty: boolean): Extract<NormalizedModelEvent, { type: "tool_call" }> | undefined {
    const args = parseToolArgs(pending.args, allowEmpty);
    if (!args || !pending.name || pending.emitted) {
      return undefined;
    }
    pending.emitted = true;
    return {
      args,
      call_id: pending.callId ?? `call_${pending.order}`,
      name: fromWireName(pending.name),
      type: "tool_call"
    };
  }

  consume(choiceIndex: number, deltas: readonly OpenAIToolCallDelta[]): NormalizedModelEvent[] {
    const completed: Extract<NormalizedModelEvent, { type: "tool_call" }>[] = [];
    for (const [position, delta] of deltas.entries()) {
      const index = delta.index ?? position;
      const key = `${choiceIndex}:${index}`;
      const pending = this.#pending.get(key) ?? { args: "", emitted: false, order: this.#order };
      if (!this.#pending.has(key)) {
        this.#order += 1;
      }

      pending.callId = delta.id ?? pending.callId ?? `call_${choiceIndex}_${index}`;
      if (delta.function?.name) {
        pending.name = delta.function.name;
      }
      pending.args += delta.function?.arguments ?? "";
      this.#pending.set(key, pending);

      const completedCall = this.#completedFor(pending, false);
      if (completedCall) {
        completed.push(completedCall);
      }
    }

    return completed.sort((left, right) => this.#orderFor(left.call_id) - this.#orderFor(right.call_id));
  }

  flushCompleted(): NormalizedModelEvent[] {
    return [...this.#pending.values()]
      .sort((left, right) => left.order - right.order)
      .map((pending) => this.#completedFor(pending, true))
      .filter((event): event is Extract<NormalizedModelEvent, { type: "tool_call" }> => Boolean(event));
  }

  assertComplete(): void {
    const incomplete = [...this.#pending.values()].find((pending) => !pending.emitted && (pending.name || pending.args));
    if (incomplete) {
      throw new ProviderError(`malformed tool call arguments for ${incomplete.name ?? incomplete.callId ?? "unknown tool"}`, {
        retryable: false
      });
    }
  }

  #orderFor(callId: string): number {
    return [...this.#pending.values()].find((pending) => pending.callId === callId)?.order ?? 0;
  }
}

class ThinkExtractor {
  #inThink = false;

  consume(text: string): { text?: string; reasoning?: string }[] {
    const out: { text?: string; reasoning?: string }[] = [];
    let rest = text;
    while (rest.length > 0) {
      if (this.#inThink) {
        const close = rest.indexOf("</think>");
        if (close === -1) {
          out.push({ reasoning: rest });
          rest = "";
        } else {
          out.push({ reasoning: rest.slice(0, close) });
          rest = rest.slice(close + "</think>".length);
          this.#inThink = false;
        }
      } else {
        const open = rest.indexOf("<think>");
        if (open === -1) {
          out.push({ text: rest });
          rest = "";
        } else {
          if (open > 0) {
            out.push({ text: rest.slice(0, open) });
          }
          rest = rest.slice(open + "<think>".length);
          this.#inThink = true;
        }
      }
    }
    return out;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const combineUsage = (left: UsageSnapshot | undefined, right: UsageSnapshot): UsageSnapshot => ({
  estimated: (left?.estimated ?? false) || right.estimated,
  input_tokens: (left?.input_tokens ?? 0) + right.input_tokens,
  output_tokens: (left?.output_tokens ?? 0) + right.output_tokens
});

const renderPromptedToolInstruction = (tools: readonly ToolDefinition[], repairError?: string): string =>
  [
    "Tool calling is available through a textual fallback grammar.",
    "When you need a tool, return exactly one fenced block and no user-visible prose:",
    "```tool_call",
    "{\"name\":\"fs.read\",\"arguments\":{\"path\":\"example.txt\"}}",
    "```",
    "Use the internal tool name exactly as listed. If no tool is needed, answer normally.",
    "Available tools:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}; schema=${JSON.stringify(tool.params)}`),
    ...(repairError
      ? [
          "The previous tool_call was invalid.",
          `Validation error: ${repairError}`,
          "Return a corrected fenced tool_call only."
        ]
      : [])
  ].join("\n");

const withPromptedToolInstruction = (
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[],
  repairError?: string
): readonly ChatMessage[] => [
  {
    content: renderPromptedToolInstruction(tools, repairError),
    role: "system"
  },
  ...messages
];

const normalizeJsonish = (input: string): string =>
  input
    .trim()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/｛/g, "{")
    .replace(/｝/g, "}")
    .replace(/［/g, "[")
    .replace(/］/g, "]");

const singleQuotedToJson = (input: string): string =>
  input.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) => JSON.stringify(value.replace(/\\'/g, "'")));

const parseJsonishObject = (input: string): Record<string, unknown> | undefined => {
  const normalized = normalizeJsonish(input);
  for (const candidate of [normalized, singleQuotedToJson(normalized)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next tolerant form.
    }
  }
  return undefined;
};

const extractPromptedCandidate = (text: string): { candidate?: string; explicit: boolean } => {
  const fenced = /```(?:\s*tool_call)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    return { candidate: fenced[1], explicit: true };
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return { candidate: text.slice(start, end + 1), explicit: /tool[_ -]?call|arguments|args|name/i.test(text) };
  }

  return { explicit: /tool[_ -]?call/i.test(text) };
};

const schemaTypeMatches = (type: string, value: unknown): boolean => {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "object") {
    return isRecord(value);
  }
  return typeof value === type;
};

const validateJsonSchema = (schema: unknown, value: unknown, path = "$"): string[] => {
  if (!isRecord(schema)) {
    return [];
  }

  const errors: string[] = [];
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.some((item) => item === value)) {
    errors.push(`${path} must be one of ${enumValues.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type && !schemaTypeMatches(type, value)) {
    errors.push(`${path} must be ${type}`);
    return errors;
  }

  if (type === "string" && typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path} must be at least ${schema.minLength} characters`);
  }

  if (type === "object" && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) {
        errors.push(...validateJsonSchema(childSchema, value[key], `${path}.${key}`));
      }
    }
  }

  return errors;
};

type PromptedToolParseResult =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "ok"; readonly event: Extract<NormalizedModelEvent, { type: "tool_call" }> };

const parsePromptedToolCall = (text: string, tools: readonly ToolDefinition[]): PromptedToolParseResult => {
  const extracted = extractPromptedCandidate(text);
  if (!extracted.candidate) {
    return extracted.explicit ? { error: "tool_call block did not contain JSON", kind: "invalid" } : { kind: "none" };
  }

  let parsed = parseJsonishObject(extracted.candidate);
  if (parsed && isRecord(parsed.tool_call)) {
    parsed = parsed.tool_call;
  }
  if (!parsed) {
    return extracted.explicit ? { error: "tool_call JSON could not be parsed", kind: "invalid" } : { kind: "none" };
  }

  const name = typeof parsed.name === "string"
    ? parsed.name
    : typeof parsed.tool === "string"
      ? parsed.tool
      : undefined;
  if (!name) {
    return { error: "tool_call.name is required", kind: "invalid" };
  }

  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return { error: `unknown tool ${name}`, kind: "invalid" };
  }

  const rawArgs = parsed.arguments ?? parsed.args ?? {};
  const args = typeof rawArgs === "string" ? parseJsonishObject(rawArgs) : rawArgs;
  if (!isRecord(args)) {
    return { error: "tool_call.arguments must be an object", kind: "invalid" };
  }

  const errors = validateJsonSchema(tool.params, args);
  if (errors.length > 0) {
    return { error: errors.join("; "), kind: "invalid" };
  }

  return {
    event: {
      args,
      call_id: `call_prompted_${Date.now().toString(36)}`,
      name,
      type: "tool_call"
    },
    kind: "ok"
  };
};

async function* streamPromptedToolsChat(options: StreamOpenAIChatOptions): AsyncIterable<NormalizedModelEvent> {
  if (!options.tools || options.tools.length === 0) {
    yield* streamNativeOpenAIChat(options);
    return;
  }

  let repairError: string | undefined;
  let accumulatedUsage: UsageSnapshot | undefined;

  for (let repair = 0; repair <= 2; repair += 1) {
    const textEvents: Extract<NormalizedModelEvent, { type: "text" }>[] = [];
    const reasoningEvents: Extract<NormalizedModelEvent, { type: "reasoning" }>[] = [];
    let attemptUsage: UsageSnapshot | undefined;
    let doneEvent: Extract<NormalizedModelEvent, { type: "done" }> | undefined;
    for await (const event of streamNativeOpenAIChat({
      ...(options.abort ? { abort: options.abort } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      messages: withPromptedToolInstruction(options.messages, options.tools, repairError),
      model: options.model,
      watchdogMs: options.watchdogMs
    })) {
      if (event.type === "text") {
        textEvents.push(event);
      } else if (event.type === "reasoning") {
        reasoningEvents.push(event);
      } else if (event.type === "usage") {
        attemptUsage = event.usage;
      } else if (event.type === "done") {
        doneEvent = event;
      }
    }

    const finalAttemptUsage = attemptUsage ?? doneEvent?.usage;
    if (finalAttemptUsage) {
      accumulatedUsage = combineUsage(accumulatedUsage, finalAttemptUsage);
    }

    const text = textEvents.map((event) => event.text).join("");
    const parsed = parsePromptedToolCall(text, options.tools);
    if (parsed.kind === "ok") {
      for (const event of reasoningEvents) {
        yield event;
      }
      yield parsed.event;
      if (accumulatedUsage) {
        yield { type: "usage", usage: accumulatedUsage };
      }
      return;
    }

    if (parsed.kind === "none") {
      for (const event of reasoningEvents) {
        yield event;
      }
      for (const event of textEvents) {
        yield event;
      }
      if (attemptUsage) {
        yield { type: "usage", usage: accumulatedUsage ?? attemptUsage };
      }
      if (doneEvent) {
        yield { ...doneEvent, usage: accumulatedUsage ?? doneEvent.usage };
      }
      return;
    }

    repairError = parsed.error;
  }

  throw new ProviderError(`prompted tool call failed validation after repair: ${repairError ?? "unknown error"}`, {
    retryable: false
  });
}

interface StreamOpenAIChatOptions {
  readonly abort?: AbortSignal;
  readonly apiKey?: string;
  readonly messages: readonly ChatMessage[];
  readonly model: ModelConfig;
  readonly tools?: readonly ToolDefinition[];
  readonly watchdogMs: number;
}

async function* streamNativeOpenAIChat(options: StreamOpenAIChatOptions): AsyncIterable<NormalizedModelEvent> {
  let attempt = 0;
  let lastError: ProviderError | undefined;

  while (attempt < 3) {
    attempt += 1;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(options.abort?.reason);
    options.abort?.addEventListener("abort", onAbort, { once: true });
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => controller.abort(new Error("provider stream idle timeout")), options.watchdogMs);
    };

    try {
      resetIdle();
      const tools = buildTools(options.tools);
      const response = await fetch(endpoint(options.model.base_url), {
        body: JSON.stringify({
          messages: buildMessages(options.messages),
          model: options.model.model,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools && tools.length > 0 ? { tools } : {})
        }),
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
        },
        method: "POST",
        signal: controller.signal
      });
      resetIdle();
      if (!response.ok || !response.body) {
        throw await responseError(response);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const extractor = new ThinkExtractor();
      const toolCalls = new ToolCallReassembler();
      let carry = "";
      let outputText = "";
      let usage: UsageSnapshot | undefined;
      let finish: "stop" | "cancelled" | "error" | "tool-limit" = "stop";
      let finishedForTools = false;
      let emittedToolCalls = false;

      while (true) {
        const read = await reader.read();
        resetIdle();
        if (read.done) {
          break;
        }
        const parsed = parseSseDataBlocks(decoder.decode(read.value, { stream: true }), carry);
        carry = parsed.carry;
        for (const block of parsed.blocks) {
          if (block === "[DONE]") {
            continue;
          }
          const chunk = JSON.parse(block) as OpenAIChunk;
          if (chunk.error) {
            throw new ProviderError(chunk.error.message ?? "provider stream error", { retryable: false });
          }
          if (chunk.usage) {
            usage = {
              estimated: false,
              input_tokens: chunk.usage.prompt_tokens ?? estimateTextTokens(options.messages.map((message) => message.content).join("")),
              output_tokens: chunk.usage.completion_tokens ?? estimateTextTokens(outputText)
            };
            yield { type: "usage", usage };
          }
          for (const choice of chunk.choices ?? []) {
            if (choice.finish_reason) {
              if (choice.finish_reason === "tool_calls") {
                finishedForTools = true;
              } else {
                finish = mapFinishReason(choice.finish_reason);
              }
            }
            const completedToolCalls = toolCalls.consume(choice.index ?? 0, choice.delta?.tool_calls ?? []);
            for (const toolCall of completedToolCalls) {
              emittedToolCalls = true;
              yield toolCall;
            }
            const reasoning = choice.delta?.reasoning_content;
            if (reasoning) {
              yield { text: reasoning, type: "reasoning" };
            }
            const content = choice.delta?.content;
            if (content) {
              for (const part of extractor.consume(content)) {
                if (part.reasoning) {
                  yield { text: part.reasoning, type: "reasoning" };
                }
                if (part.text) {
                  outputText += part.text;
                  yield { text: part.text, type: "text" };
                }
              }
            }
          }
        }
      }

      const finalUsage = usage ?? {
        estimated: true,
        input_tokens: estimateTextTokens(options.messages.map((message) => message.content).join("")),
        output_tokens: estimateTextTokens(outputText)
      };
      for (const toolCall of toolCalls.flushCompleted()) {
        emittedToolCalls = true;
        yield toolCall;
      }
      toolCalls.assertComplete();
      if (finishedForTools || emittedToolCalls) {
        return;
      }
      yield { finish_reason: finish, type: "done", usage: finalUsage };
      return;
    } catch (error) {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      options.abort?.removeEventListener("abort", onAbort);
      if (options.abort?.aborted) {
        throw new ProviderError("model stream aborted", { retryable: false });
      }
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError((error as Error).message, { retryable: true });
      lastError = providerError;
      if (!providerError.retryable || attempt >= 3) {
        throw providerError;
      }
      await sleep(10 * attempt);
    } finally {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      options.abort?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new ProviderError("provider failed", { retryable: false });
}

export async function* streamOpenAIChat(options: StreamOpenAIChatOptions): AsyncIterable<NormalizedModelEvent> {
  const hasTools = (options.tools?.length ?? 0) > 0;
  if (hasTools && options.model.capabilities.tools === "none") {
    throw new ProviderError(`model ${options.model.id} declares capabilities.tools=none`, { retryable: false });
  }

  if (hasTools && options.model.capabilities.tools === "prompted") {
    yield* streamPromptedToolsChat(options);
    return;
  }

  yield* streamNativeOpenAIChat(options);
}
