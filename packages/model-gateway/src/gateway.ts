import { canRouteToModel, defaultRequestLabels } from "./governance.js";
import { parseModelGatewayConfig, resolveSecretRef } from "./config.js";
import { streamOpenAIChat } from "./openai-chat.js";
import { estimateTextTokens } from "./tokens.js";
import { ProviderError, type GenerateOptions, type GenerateRequest, type ModelConfig, type ModelGateway, type ModelMetadata, type ModelRouteCheck, type ModelTrace, type NormalizedModelEvent, type RequestLabels, type RoutingHints, type TokenEstimate } from "./types.js";

const shouldFallback = (error: ProviderError): boolean =>
  error.auth || error.rate_limited || error.retryable;

type FallbackTrace = NonNullable<ModelTrace["fallbacks"]>[number];
type DeniedCandidateTrace = NonNullable<ModelTrace["denied_candidates"]>[number];

const traceFor = (
  model: ModelConfig,
  request: GenerateRequest,
  fallbacks: readonly FallbackTrace[],
  deniedCandidates: readonly DeniedCandidateTrace[]
): ModelTrace => ({
  clearance: { violation: false },
  ...(deniedCandidates.length > 0 ? { denied_candidates: deniedCandidates } : {}),
  ...(fallbacks.length > 0 ? { fallbacks } : {}),
  model_id: model.id
});

const hasAllowedLaterCandidate = (
  candidates: readonly ModelConfig[],
  startIndex: number,
  request: GenerateRequest,
  governance: ReturnType<typeof parseModelGatewayConfig>["governance"]
): boolean =>
  candidates.slice(startIndex).some((candidate) =>
    canRouteToModel(request.labels ?? defaultRequestLabels, candidate, governance, request.routing_hints).ok
  );

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

  canRoute(role: string, labels: RequestLabels, routingHints?: RoutingHints): ModelRouteCheck {
    const denied: DeniedCandidateTrace[] = [];
    for (const model of this.#modelsForRole(role)) {
      const clearance = canRouteToModel(labels, model, this.#config.governance, routingHints);
      if (clearance.ok) {
        return {
          denied_candidates: denied,
          model_id: model.id,
          ok: true
        };
      }
      denied.push({
        model_id: model.id,
        reason: clearance.reason ?? "model clearance does not satisfy request labels"
      });
    }
    return {
      denied_candidates: denied,
      ok: false
    };
  }

  async *generate(role: string, request: GenerateRequest, options: GenerateOptions = {}): AsyncIterable<NormalizedModelEvent> {
    const candidates = this.#modelsForRole(role);
    const fallbacks: FallbackTrace[] = [];
    const deniedCandidates: DeniedCandidateTrace[] = [];
    let lastError: ProviderError | undefined;

    for (const [index, model] of candidates.entries()) {
      const labels = request.labels ?? defaultRequestLabels;
      const clearance = canRouteToModel(labels, model, this.#config.governance, request.routing_hints);
      if (!clearance.ok) {
        const reason = clearance.reason ?? "model clearance does not satisfy request labels";
        deniedCandidates.push({ model_id: model.id, reason });
        yield {
          payload: {
            detail: `model ${model.id} denied by clearance: ${reason}`,
            model_id: model.id,
            reason,
            stage: "route-denied"
          },
          type: "progress"
        };
        continue;
      }

      const apiKey = resolveSecretRef(model.api_key_ref, this.#env);
      const hasFallbackCandidate = hasAllowedLaterCandidate(candidates, index + 1, request, this.#config.governance);
      if (!hasFallbackCandidate) {
        const trace = traceFor(model, request, fallbacks, deniedCandidates);
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

        const nextAllowed = candidates.slice(index + 1).find((candidate) =>
          canRouteToModel(request.labels ?? defaultRequestLabels, candidate, this.#config.governance, request.routing_hints).ok
        );
        if (!nextAllowed) {
          throw providerError;
        }
        const reason = providerError.auth
          ? "auth"
          : providerError.rate_limited
            ? "rate_limited"
            : "retryable";
        fallbacks.push({ from: model.id, reason, to: nextAllowed.id });
        yield {
          payload: {
            detail: `model fallback from ${model.id} to ${nextAllowed.id}: ${reason}`,
            from: model.id,
            reason,
            stage: "model-fallback",
            to: nextAllowed.id
          },
          type: "progress"
        };
        continue;
      }

      const trace = traceFor(model, request, fallbacks, deniedCandidates);
      for (const event of buffered) {
        if (event.type === "done") {
          yield { ...event, trace };
          continue;
        }
        yield event;
      }
      return;
    }

    if (lastError) {
      throw lastError;
    }
    yield {
      payload: {
        denied_candidates: deniedCandidates,
        reason: "No configured model satisfies request labels.",
        required_clearance: request.labels ?? defaultRequestLabels,
        role
      },
      type: "route_denied"
    };
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
