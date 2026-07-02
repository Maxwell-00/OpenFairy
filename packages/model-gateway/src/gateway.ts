import { parseModelGatewayConfig, resolveSecretRef } from "./config.js";
import { streamOpenAIChat } from "./openai-chat.js";
import type { GenerateOptions, GenerateRequest, ModelConfig, ModelGateway, ModelTrace, NormalizedModelEvent } from "./types.js";

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

export class ConfiguredModelGateway implements ModelGateway {
  readonly #config;
  readonly #env: NodeJS.ProcessEnv;

  constructor(config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env) {
    this.#config = parseModelGatewayConfig(config);
    this.#env = env;
  }

  async *generate(role: string, request: GenerateRequest, options: GenerateOptions = {}): AsyncIterable<NormalizedModelEvent> {
    const binding = this.#config.roles[role];
    if (!binding) {
      throw new Error(`unknown model role ${role}`);
    }
    const model = this.#config.models.find((candidate) => candidate.id === binding.model);
    if (!model) {
      throw new Error(`role ${role} binds missing model ${binding.model}`);
    }

    const apiKey = resolveSecretRef(model.api_key_ref, this.#env);
    const trace = clearanceTrace(model, request);
    for await (const event of streamOpenAIChat({
      ...(options.abort ? { abort: options.abort } : {}),
      ...(apiKey ? { apiKey } : {}),
      messages: request.messages,
      model,
      watchdogMs: this.#config.watchdogMs
    })) {
      if (event.type === "done" && trace) {
        yield { ...event, trace };
        continue;
      }
      yield event;
    }
  }
}

export const createModelGateway = (config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): ModelGateway =>
  new ConfiguredModelGateway(config, env);
