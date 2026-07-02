import type { DataClearance, ModelConfig, ModelGatewayConfig, RoleBinding } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readString = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === "string" ? record[key] : undefined;

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
    if (!id || transport !== "openai-chat" || !baseUrl || !model) {
      throw new Error("model entries require id, transport=openai-chat, base_url, and model");
    }
    return {
      base_url: baseUrl,
      data_clearance: readClearance(item),
      id,
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
      return [role, { model: binding.model }];
    })
  );

  if (!roles.main) {
    throw new Error("roles.main is required for M1-01");
  }
  const modelIds = new Set(models.map((model) => model.id));
  for (const [role, binding] of Object.entries(roles)) {
    if (!modelIds.has(binding.model)) {
      throw new Error(`roles.${role} binds unknown model ${binding.model}`);
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
