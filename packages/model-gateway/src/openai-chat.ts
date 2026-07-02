import { ProviderError, type ChatMessage, type ModelConfig, type NormalizedModelEvent, type UsageSnapshot } from "./types.js";
import { parseSseDataBlocks } from "./sse.js";

interface OpenAIChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
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

const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/$/, "")}/chat/completions`;

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

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

export async function* streamOpenAIChat(options: {
  readonly abort?: AbortSignal;
  readonly apiKey?: string;
  readonly messages: readonly ChatMessage[];
  readonly model: ModelConfig;
  readonly watchdogMs: number;
}): AsyncIterable<NormalizedModelEvent> {
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
      const response = await fetch(endpoint(options.model.base_url), {
        body: JSON.stringify({
          messages: options.messages,
          model: options.model.model,
          stream: true,
          stream_options: { include_usage: true }
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
      let carry = "";
      let outputText = "";
      let usage: UsageSnapshot | undefined;
      let finish: "stop" | "cancelled" | "error" | "tool-limit" = "stop";

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
              input_tokens: chunk.usage.prompt_tokens ?? estimateTokens(options.messages.map((message) => message.content).join("")),
              output_tokens: chunk.usage.completion_tokens ?? estimateTokens(outputText)
            };
            yield { type: "usage", usage };
          }
          for (const choice of chunk.choices ?? []) {
            if (choice.finish_reason) {
              finish = mapFinishReason(choice.finish_reason);
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
        input_tokens: estimateTokens(options.messages.map((message) => message.content).join("")),
        output_tokens: estimateTokens(outputText)
      };
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
