import { parseModelGatewayConfig, resolveSecretRef } from "./config.js";
import { streamOpenAIChat } from "./openai-chat.js";
import { estimateTextTokens } from "./tokens.js";
import { ProviderError, type GenerateOptions, type GenerateRequest, type ModelConfig, type ModelGateway, type ModelMetadata, type ModelTrace, type NormalizedModelEvent, type TokenEstimate } from "./types.js";

const sensitivityRank = {
  public: 0,
  internal: 1,
  personal: 2,
  secret: 3
} as const;

const clearanceTrace = (model: ModelConfig, request: GenerateRequest): ModelTrace | undefined => {
  if (!request.labels) {
    return undefined;
  }

  if (sensitivityRank[request.labels.sensitivity] > sensitivityRank[model.data_clearance.max_sensitivity]) {
    return {
      clearance: {
        reason: `request sensitivity ${request.labels.sensitivity} exceeds model max ${model.data_clearance.max_sensitivity}`,
        violation: true
      }
    };
  }

  if (!model.data_clearance.residency.includes(request.labels.residency)) {
    return {
      clearance: {
        reason: `request residency ${request.labels.residency} is not in model residency clearance`,
        violation: true
      }
    };
  }

  return { clearance: { violation: false } };
};

const shouldFallback = (error: ProviderError): boolean =>
  error.auth || error.rate_limited || error.retryable;

type FallbackTrace = NonNullable<ModelTrace["fallbacks"]>[number];

const traceFor = (
  model: ModelConfig,
  request: GenerateRequest,
  fallbacks: readonly FallbackTrace[]
): ModelTrace => ({
  ...(clearanceTrace(model, request) ?? {}),
  ...(fallbacks.length > 0 ? { fallbacks } : {}),
  model_id: model.id
});

export class ConfiguredModelGateway implements ModelGateway {
  readonly #config;
  readonly #env: NodeJS.ProcessEnv;

  constructor(config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env) {
    this.#config = parseModelGatewayConfig(config);
    this.#env = env;
  }

  estimateTokens(input: string): TokenEstimate {
    return { estimated: true, tokens: estimateTextTokens(input) };
  }

  modelInfo(role: string): ModelMetadata {
    const [model] = this.#modelsForRole(role);
    return {
      context_window: model.context_window,
      id: model.id,
      ...(model.max_output ? { max_output: model.max_output } : {}),
      model: model.model
    };
  }

  async *generate(role: string, request: GenerateRequest, options: GenerateOptions = {}): AsyncIterable<NormalizedModelEvent> {
    const candidates = this.#modelsForRole(role);
    const fallbacks: FallbackTrace[] = [];
    let lastError: ProviderError | undefined;

    for (const [index, model] of candidates.entries()) {
      const apiKey = resolveSecretRef(model.api_key_ref, this.#env);
      const next = candidates[index + 1];
      if (!next) {
        const trace = traceFor(model, request, fallbacks);
        for await (const event of streamOpenAIChat({
          ...(options.abort ? { abort: options.abort } : {}),
          ...(apiKey ? { apiKey } : {}),
          messages: request.messages,
          model,
          ...(request.tools ? { tools: request.tools } : {}),
          watchdogMs: this.#config.watchdogMs
        })) {
          if (event.type === "done") {
            yield { ...event, trace };
            continue;
          }
          yield event;
        }
        return;
      }

      const buffered: NormalizedModelEvent[] = [];

      try {
        for await (const event of streamOpenAIChat({
          ...(options.abort ? { abort: options.abort } : {}),
          ...(apiKey ? { apiKey } : {}),
          messages: request.messages,
          model,
          ...(request.tools ? { tools: request.tools } : {}),
          watchdogMs: this.#config.watchdogMs
        })) {
          buffered.push(event);
        }
      } catch (error) {
        const providerError = error instanceof ProviderError
          ? error
          : new ProviderError(error instanceof Error ? error.message : String(error), { retryable: false });
        lastError = providerError;
        if (!shouldFallback(providerError)) {
          throw providerError;
        }

        const reason = providerError.auth
          ? "auth"
          : providerError.rate_limited
            ? "rate_limited"
            : "retryable";
        fallbacks.push({ from: model.id, reason, to: next.id });
        yield {
          payload: {
            detail: `model fallback from ${model.id} to ${next.id}: ${reason}`,
            from: model.id,
            reason,
            stage: "model-fallback",
            to: next.id
          },
          type: "progress"
        };
        continue;
      }

      const trace = traceFor(model, request, fallbacks);
      for (const event of buffered) {
        if (event.type === "done") {
          yield { ...event, trace };
          continue;
        }
        yield event;
      }
      return;
    }

    throw lastError ?? new ProviderError(`all models failed for role ${role}`, { retryable: false });
  }

  #modelsForRole(role: string): readonly [ModelConfig, ...ModelConfig[]] {
    const binding = this.#config.roles[role];
    if (!binding) {
      throw new Error(`unknown model role ${role}`);
    }
    const models = [binding.model, ...binding.fallback].map((modelId) => {
      const model = this.#config.models.find((candidate) => candidate.id === modelId);
      if (!model) {
        throw new Error(`role ${role} binds missing model ${modelId}`);
      }
      return model;
    });
    if (models.length === 0) {
      throw new Error(`role ${role} has no model candidates`);
    }
    return models as [ModelConfig, ...ModelConfig[]];
  }
}

export const createModelGateway = (config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): ModelGateway =>
  new ConfiguredModelGateway(config, env);
