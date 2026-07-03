import type { DataClearance, ModelCapabilities, ModelConfig, ModelGatewayConfig, RoleBinding, ToolCapability } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readString = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === "string" ? record[key] : undefined;

const readPositiveInteger = (record: Record<string, unknown>, key: string): number | undefined =>
  typeof record[key] === "number" && Number.isInteger(record[key]) && record[key] > 0 ? record[key] : undefined;

const readCapabilitiesNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const capabilities = record.capabilities;
  if (!isRecord(capabilities)) {
    return undefined;
  }
  return readPositiveInteger(capabilities, key);
};

const readCapabilities = (record: Record<string, unknown>): ModelCapabilities => {
  const capabilities = record.capabilities;
  if (!isRecord(capabilities)) {
    return { tools: "native" };
  }

  const tools = typeof capabilities.tools === "string" ? capabilities.tools : "native";
  if (tools !== "native" && tools !== "prompted" && tools !== "none") {
    throw new Error(`model ${String(record.id)} has invalid capabilities.tools`);
  }

  return { tools: tools as ToolCapability };
};

const readClearance = (record: Record<string, unknown>): DataClearance => {
  const clearance = record.data_clearance;
  if (!isRecord(clearance)) {
    throw new Error(`model ${String(record.id)} is missing data_clearance`);
  }
  const maxSensitivity = readString(clearance, "max_sensitivity");
  const residency = clearance.residency;
  if (
    !["public", "internal", "personal", "secret"].includes(maxSensitivity ?? "") ||
    !Array.isArray(residency) ||
    !residency.every((item) => ["local-only", "region-restricted", "global-ok"].includes(String(item)))
  ) {
    throw new Error(`model ${String(record.id)} has invalid data_clearance`);
  }

  const regions = Array.isArray(clearance.regions)
    ? clearance.regions.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    max_sensitivity: maxSensitivity as DataClearance["max_sensitivity"],
    residency: residency as DataClearance["residency"],
    ...(regions ? { regions } : {})
  };
};

export const parseModelGatewayConfig = (config: Record<string, unknown>): ModelGatewayConfig => {
  const modelsRaw = config.models;
  const rolesRaw = config.roles;
  if (!Array.isArray(modelsRaw)) {
    throw new Error("config.models must be an array");
  }
  if (!isRecord(rolesRaw)) {
    throw new Error("config.roles must be an object");
  }

  const models = modelsRaw.map((item): ModelConfig => {
    if (!isRecord(item)) {
      throw new Error("each model entry must be an object");
    }
    const id = readString(item, "id");
    const transport = readString(item, "transport");
    const baseUrl = readString(item, "base_url");
    const model = readString(item, "model");
    const apiKeyRef = readString(item, "api_key_ref");
    const maxOutput = readPositiveInteger(item, "max_output") ?? readCapabilitiesNumber(item, "max_output");
    if (!id || transport !== "openai-chat" || !baseUrl || !model) {
      throw new Error("model entries require id, transport=openai-chat, base_url, and model");
    }
    return {
      base_url: baseUrl,
      capabilities: readCapabilities(item),
      context_window: readPositiveInteger(item, "context_window") ?? readCapabilitiesNumber(item, "context_window") ?? 128_000,
      data_clearance: readClearance(item),
      id,
      ...(maxOutput !== undefined ? { max_output: maxOutput } : {}),
      model,
      ...(apiKeyRef ? { api_key_ref: apiKeyRef } : {}),
      transport
    };
  });

  const roles = Object.fromEntries(
    Object.entries(rolesRaw).map(([role, binding]): [string, RoleBinding] => {
      if (!isRecord(binding) || typeof binding.model !== "string") {
        throw new Error(`roles.${role}.model is required`);
      }
      const fallback = Array.isArray(binding.fallback)
        ? binding.fallback.map((item) => {
            if (typeof item !== "string" || item.length === 0) {
              throw new Error(`roles.${role}.fallback entries must be model ids`);
            }
            return item;
          })
        : [];
      return [role, { fallback, model: binding.model }];
    })
  );

  if (!roles.main) {
    throw new Error("roles.main is required for M1-01");
  }
  const modelIds = new Set(models.map((model) => model.id));
  const modelById = new Map(models.map((model) => [model.id, model]));
  for (const [role, binding] of Object.entries(roles)) {
    if (!modelIds.has(binding.model)) {
      throw new Error(`roles.${role} binds unknown model ${binding.model}`);
    }
    for (const fallback of binding.fallback) {
      if (!modelIds.has(fallback)) {
        throw new Error(`roles.${role}.fallback binds unknown model ${fallback}`);
      }
    }
    if (role === "main") {
      const incapable = [binding.model, ...binding.fallback]
        .map((modelId) => modelById.get(modelId))
        .find((model) => model?.capabilities.tools === "none");
      if (incapable) {
        throw new Error(`roles.${role} requires tools but model ${incapable.id} declares capabilities.tools=none`);
      }
    }
  }

  const gateway = isRecord(config.gateway) ? config.gateway : {};
  const watchdogS = typeof gateway.watchdog_s === "number" ? gateway.watchdog_s : 60;

  return { models, roles, watchdogMs: watchdogS * 1000 };
};

export const resolveSecretRef = (ref: string | undefined, env: NodeJS.ProcessEnv): string | undefined => {
  if (!ref) {
    return undefined;
  }
  if (!ref.startsWith("secret://")) {
    return ref;
  }
  const name = ref.slice("secret://".length);
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const candidates = [name, normalized, `FAIRY_SECRET_${normalized}`];
  const value = candidates.map((candidate) => env[candidate]).find((candidate) => candidate && candidate.length > 0);
  if (!value) {
    throw new Error(`model secret ${ref} was not found in env (${candidates.join(", ")})`);
  }
  return value;
};
