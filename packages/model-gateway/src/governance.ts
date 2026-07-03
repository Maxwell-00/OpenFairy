import type { ChatMessage, GovernanceConfig, ModelConfig, RequestLabels, RoutingHints } from "./types.js";

export const defaultRequestLabels: RequestLabels = {
  residency: "global-ok",
  sensitivity: "internal"
};

export const sensitivityRank: Record<RequestLabels["sensitivity"], number> = {
  public: 0,
  internal: 1,
  personal: 2,
  secret: 3
};

const residencyRank: Record<RequestLabels["residency"], number> = {
  "global-ok": 0,
  "region-restricted": 1,
  "local-only": 2
};

const residencyByRank = ["global-ok", "region-restricted", "local-only"] as const;

export interface ClearanceDecision {
  readonly ok: boolean;
  readonly reason?: string;
}

export const deriveLabels = (
  items: readonly { readonly labels?: RequestLabels }[],
  fallback: RequestLabels = defaultRequestLabels
): RequestLabels => {
  let sensitivity = fallback.sensitivity;
  let residency = fallback.residency;

  for (const item of items) {
    const labels = item.labels;
    if (!labels) {
      continue;
    }
    if (sensitivityRank[labels.sensitivity] > sensitivityRank[sensitivity]) {
      sensitivity = labels.sensitivity;
    }
    if (residencyRank[labels.residency] > residencyRank[residency]) {
      residency = labels.residency;
    }
  }

  return { residency, sensitivity };
};

export const deriveMessageLabels = (
  messages: readonly ChatMessage[],
  fallback: RequestLabels = defaultRequestLabels
): RequestLabels => deriveLabels(messages, fallback);

const regionSetAllowed = (modelRegions: readonly string[] | undefined, homeRegions: readonly string[]): boolean => {
  if (!modelRegions || modelRegions.length === 0) {
    return false;
  }
  const home = new Set(homeRegions);
  return modelRegions.every((region) => home.has(region));
};

const residencyAllowed = (
  request: RequestLabels["residency"],
  model: ModelConfig,
  governance: GovernanceConfig
): ClearanceDecision => {
  const allowed = new Set(model.data_clearance.residency);

  if (request === "local-only") {
    return allowed.has("local-only")
      ? { ok: true }
      : { ok: false, reason: "residency local-only requires a local-only model" };
  }

  if (request === "region-restricted") {
    if (allowed.has("local-only")) {
      return { ok: true };
    }
    if (!allowed.has("region-restricted")) {
      return { ok: false, reason: "residency region-restricted requires local-only or region-restricted model clearance" };
    }
    return regionSetAllowed(model.data_clearance.regions, governance.home_regions)
      ? { ok: true }
      : { ok: false, reason: "model regions are not within governance.home_regions" };
  }

  return allowed.size > 0
    ? { ok: true }
    : { ok: false, reason: "model declares no residency clearance" };
};

export const canRouteToModel = (
  labels: RequestLabels,
  model: ModelConfig,
  governance: GovernanceConfig,
  hints: RoutingHints = {}
): ClearanceDecision => {
  if (sensitivityRank[labels.sensitivity] > sensitivityRank[model.data_clearance.max_sensitivity]) {
    return {
      ok: false,
      reason: `request sensitivity ${labels.sensitivity} exceeds model max ${model.data_clearance.max_sensitivity}`
    };
  }

  const decision = residencyAllowed(labels.residency, model, governance);
  if (hints.prefer_local === true) {
    return decision;
  }
  return decision;
};

export const stricterResidency = (
  left: RequestLabels["residency"],
  right: RequestLabels["residency"]
): RequestLabels["residency"] => residencyByRank[Math.max(residencyRank[left], residencyRank[right])] ?? "local-only";
