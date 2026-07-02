import { ProviderError, type ChatMessage, type ModelGateway, type UsageSnapshot } from "@fairy/model-gateway";
import type { Labels } from "@fairy/protocol";

export const defaultSystemPrompt =
  "You are Fairy, Chidi's helpful bilingual AI companion. Be concise, capable, and honest.";

export type KernelEventType = "turn.delta" | "reasoning.delta" | "turn.final" | "turn.interrupted" | "error";

export interface KernelEvent {
  readonly type: KernelEventType;
  readonly payload: Record<string, unknown>;
}

export interface TurnRunnerHistory {
  readonly messages: readonly ChatMessage[];
}

export interface TurnRunnerOptions {
  readonly modelGateway: ModelGateway;
  readonly systemPrompt?: string;
  readonly tools?: readonly never[];
}

export interface RunTurnOptions {
  readonly sid: `ses_${string}`;
  readonly turn: number;
  readonly input: string;
  readonly history: TurnRunnerHistory;
  readonly labels: Labels;
  readonly emit: (event: KernelEvent) => Promise<void>;
}

export interface RunTurnResult {
  readonly content: string;
  readonly usage?: UsageSnapshot;
  readonly finish_reason?: "stop" | "cancelled" | "error" | "tool-limit";
}

interface ActiveTurn {
  readonly controller: AbortController;
  reasoningIndex: number;
  textIndex: number;
  lastHeardMark: string;
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && /abort|aborted|cancel/i.test(error.message);

export class TurnRunner {
  readonly #modelGateway: ModelGateway;
  readonly #systemPrompt: string;
  readonly #active = new Map<string, ActiveTurn>();

  constructor(options: TurnRunnerOptions) {
    this.#modelGateway = options.modelGateway;
    this.#systemPrompt = options.systemPrompt ?? defaultSystemPrompt;
    void options.tools;
  }

  isRunning(sid: string): boolean {
    return this.#active.has(sid);
  }

  cancel(sid: string): boolean {
    const active = this.#active.get(sid);
    if (!active) {
      return false;
    }
    active.controller.abort(new Error("user_cancelled"));
    return true;
  }

  async runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
    if (this.#active.has(options.sid)) {
      await options.emit({
        payload: {
          class: "UserError",
          message: "A turn is already in flight for this session.",
          retryable: false
        },
        type: "error"
      });
      return { content: "", finish_reason: "error" };
    }

    const active: ActiveTurn = {
      controller: new AbortController(),
      lastHeardMark: "start",
      reasoningIndex: 0,
      textIndex: 0
    };
    this.#active.set(options.sid, active);

    let content = "";
    let usage: UsageSnapshot | undefined;
    let finishReason: RunTurnResult["finish_reason"] = "stop";
    let interrupted = false;

    try {
      const messages: ChatMessage[] = [
        { content: this.#systemPrompt, role: "system" },
        ...options.history.messages,
        { content: options.input, role: "user" }
      ];

      for await (const event of this.#modelGateway.generate(
        "main",
        { labels: options.labels, messages },
        { abort: active.controller.signal }
      )) {
        if (event.type === "text") {
          content += event.text;
          active.lastHeardMark = `text:${active.textIndex}`;
          await options.emit({
            payload: { index: active.textIndex, text: event.text },
            type: "turn.delta"
          });
          active.textIndex += 1;
          continue;
        }

        if (event.type === "reasoning") {
          active.lastHeardMark = `reasoning:${active.reasoningIndex}`;
          await options.emit({
            payload: { index: active.reasoningIndex, text: event.text },
            type: "reasoning.delta"
          });
          active.reasoningIndex += 1;
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          continue;
        }

        usage = event.usage;
        finishReason = event.finish_reason;
        await options.emit({
          payload: {
            content: [{ kind: "text", text: content || "(empty response)" }],
            finish_reason: event.finish_reason,
            ...(event.trace ? { model_trace: event.trace } : {}),
            usage: event.usage
          },
          type: "turn.final"
        });
      }
    } catch (error) {
      if (active.controller.signal.aborted || isAbortError(error)) {
        interrupted = true;
        finishReason = "cancelled";
        await options.emit({
          payload: {
            last_heard_mark: active.lastHeardMark,
            reason: "user_cancelled"
          },
          type: "turn.interrupted"
        });
      } else {
        const providerError = error instanceof ProviderError ? error : undefined;
        finishReason = "error";
        await options.emit({
          payload: {
            auth: providerError?.auth ?? false,
            class: "ProviderError",
            context_overflow: providerError?.context_overflow ?? false,
            message: error instanceof Error ? error.message : String(error),
            rate_limited: providerError?.rate_limited ?? false,
            retryable: providerError?.retryable ?? false
          },
          type: "error"
        });
      }
    } finally {
      this.#active.delete(options.sid);
    }

    return {
      content,
      ...(finishReason ? { finish_reason: finishReason } : {}),
      ...(usage ? { usage } : {}),
      ...(interrupted ? { finish_reason: "cancelled" as const } : {})
    };
  }
}
