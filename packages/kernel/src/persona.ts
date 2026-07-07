import type { RequestLabels } from "@fairy/model-gateway";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export type AffectStance = "warm" | "neutral" | "dry";
export type AffectEnergy = "low" | "medium" | "high";

export interface AffectState {
  readonly arousal: number;
  readonly cause: string;
  readonly energy: AffectEnergy;
  readonly stance: AffectStance;
  readonly updated_at: string;
  readonly valence: number;
}

export interface AffectBounds {
  readonly arousal: readonly [number, number];
  readonly valence: readonly [number, number];
}

export interface PersonaPack {
  readonly ackBank?: unknown;
  readonly affectBaseline: AffectState;
  readonly affectBounds: AffectBounds;
  readonly disclosure: string;
  readonly id: string;
  readonly labels: RequestLabels;
  readonly languages: readonly string[];
  readonly name: string;
  readonly prompt: string;
  readonly root: string;
  readonly styleSummary: string;
  readonly styles: {
    readonly en?: string;
    readonly zh?: string;
  };
  readonly voice?: Record<string, unknown>;
}

export interface PersonaSettings {
  readonly affectEnabled: boolean;
  readonly enabled: boolean;
  readonly id: string;
  readonly root: string;
}

export interface PersonaRuntime {
  readonly affectEnabled: boolean;
  readonly enabled: boolean;
  readonly pack: PersonaPack;
  readonly settings: PersonaSettings;
}

export interface AffectAppraisalInput {
  readonly completedCleanly?: boolean;
  readonly now?: string;
  readonly providerError?: boolean;
  readonly routeDenied?: boolean;
  readonly toolFailureCount?: number;
  readonly userText?: string;
}

export interface AffectUpdateResult {
  readonly changed: boolean;
  readonly humorSuppressed: boolean;
  readonly state: AffectState;
}

export const personaLabels: RequestLabels = { residency: "global-ok", sensitivity: "internal" };

export class PersonaPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaPackError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)
    ? value.map((item) => item.trim())
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const clamp = (value: number, [min, max]: readonly [number, number]): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number): number => Number(value.toFixed(3));

const energyFromArousal = (arousal: number): AffectEnergy =>
  arousal >= 0.35 ? "high" : arousal <= -0.25 ? "low" : "medium";

const stanceFrom = (value: unknown, fallback: AffectStance): AffectStance =>
  value === "warm" || value === "neutral" || value === "dry" ? value : fallback;

const parsePair = (value: unknown, fallback: readonly [number, number]): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) {
    return fallback;
  }
  const left = asNumber(value[0]);
  const right = asNumber(value[1]);
  if (left === undefined || right === undefined || left > right || left < -1 || right > 1) {
    return fallback;
  }
  return [left, right] as const;
};

const parseLabels = (value: unknown): RequestLabels => {
  if (!isRecord(value)) {
    return personaLabels;
  }
  const sensitivity = value.sensitivity;
  const residency = value.residency;
  if (
    (sensitivity === "public" || sensitivity === "internal" || sensitivity === "personal" || sensitivity === "secret") &&
    (residency === "local-only" || residency === "region-restricted" || residency === "global-ok")
  ) {
    return { residency, sensitivity };
  }
  return personaLabels;
};

const baselineFrom = (value: unknown): AffectState => {
  const record = isRecord(value) ? value : {};
  const valence = clamp(asNumber(record.valence) ?? 0, [-1, 1]);
  const arousal = clamp(asNumber(record.arousal) ?? 0, [-1, 1]);
  const stance = stanceFrom(record.stance, "neutral");
  return {
    arousal,
    cause: asString(record.cause) ?? "baseline",
    energy: record.energy === "low" || record.energy === "medium" || record.energy === "high"
      ? record.energy
      : energyFromArousal(arousal),
    stance,
    updated_at: asString(record.updated_at) ?? "1970-01-01T00:00:00.000Z",
    valence
  };
};

const readOptional = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;

const readYaml = (path: string): Record<string, unknown> => {
  const parsed = parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new PersonaPackError(`persona.yaml must be a mapping: ${path}`);
  }
  return parsed;
};

export const plainPersonaPack = (root = "none"): PersonaPack => ({
  affectBaseline: {
    arousal: 0,
    cause: "plain baseline",
    energy: "medium",
    stance: "neutral",
    updated_at: "1970-01-01T00:00:00.000Z",
    valence: 0
  },
  affectBounds: { arousal: [-1, 1], valence: [-1, 1] },
  disclosure: "I am an AI assistant. Persona and affect styling are disabled.",
  id: "none",
  labels: personaLabels,
  languages: ["zh-CN", "en-US"],
  name: "Plain assistant",
  prompt: "Use a plain, concise assistant style. Do not add persona flavor.",
  root,
  styleSummary: "Plain, concise, neutral assistant style.",
  styles: {}
});

export const loadPersonaPack = (options: { readonly id: string; readonly root: string }): PersonaPack => {
  const packRoot = resolve(options.root, options.id);
  const yamlPath = join(packRoot, "persona.yaml");
  if (!existsSync(yamlPath)) {
    throw new PersonaPackError(`persona pack ${options.id} not found at ${yamlPath}`);
  }

  const raw = readYaml(yamlPath);
  const id = asString(raw.id) ?? asString(raw.name);
  const name = asString(raw.name);
  const languages = asStringArray(raw.languages);
  const disclosure = asString(raw.disclosure);
  const styleSummary = asString(raw.style_summary) ?? asString(raw.styleSummary);

  if (!id || !name || !languages?.length || !disclosure || !styleSummary) {
    throw new PersonaPackError("persona.yaml requires id/name, languages, disclosure, and style_summary");
  }

  const baseline = baselineFrom(raw.affect_baseline ?? (isRecord(raw.affect) ? raw.affect.baseline : undefined));
  const boundsRaw = raw.affect_bounds ?? (isRecord(raw.affect) ? raw.affect.bounds : undefined);
  const boundsRecord = isRecord(boundsRaw) ? boundsRaw : {};
  const affectBounds: AffectBounds = {
    arousal: parsePair(boundsRecord.arousal, [-1, 1]),
    valence: parsePair(boundsRecord.valence, [-1, 1])
  };

  const prompt = readOptional(join(packRoot, "PERSONA.md"));
  if (!prompt) {
    throw new PersonaPackError(`persona pack ${id} requires PERSONA.md`);
  }
  const enStyle = readOptional(join(packRoot, "style", "en.md"));
  const zhStyle = readOptional(join(packRoot, "style", "zh.md"));

  return {
    ...(existsSync(join(packRoot, "ack-bank.yaml")) ? { ackBank: parse(readFileSync(join(packRoot, "ack-bank.yaml"), "utf8")) as unknown } : {}),
    affectBaseline: {
      ...baseline,
      arousal: clamp(baseline.arousal, affectBounds.arousal),
      valence: clamp(baseline.valence, affectBounds.valence)
    },
    affectBounds,
    disclosure,
    id,
    labels: parseLabels(raw.labels),
    languages,
    name,
    prompt,
    root: packRoot,
    styleSummary,
    styles: {
      ...(enStyle ? { en: enStyle } : {}),
      ...(zhStyle ? { zh: zhStyle } : {})
    },
    ...(isRecord(raw.voice) ? { voice: raw.voice } : {})
  };
};

export const readPersonaSettings = (config: Record<string, unknown>, cwd = process.cwd()): PersonaSettings => {
  const persona = config.persona;
  const personaDisabled = persona === "none";
  const personaRecord = isRecord(persona) ? persona : {};
  const enabled = personaDisabled ? false : personaRecord.enabled !== false;
  const id = personaDisabled ? "none" : asString(personaRecord.id) ?? "fairy";
  const root = resolve(cwd, asString(personaRecord.root) ?? "extensions/personas");
  const affect = isRecord(config.affect) ? config.affect : {};
  return {
    affectEnabled: enabled && affect.enabled !== false,
    enabled,
    id,
    root
  };
};

export const loadPersonaRuntime = (config: Record<string, unknown>, cwd = process.cwd()): PersonaRuntime => {
  const settings = readPersonaSettings(config, cwd);
  const pack = settings.enabled ? loadPersonaPack({ id: settings.id, root: settings.root }) : plainPersonaPack(settings.root);
  return {
    affectEnabled: settings.affectEnabled,
    enabled: settings.enabled,
    pack,
    settings
  };
};

const thanksPattern = /\b(thanks|thank you|appreciate it|nice work)\b|\u8c22\u8c22|\u591a\u8c22|\u8f9b\u82e6\u4e86/i; // zh: thanks terms (escapes above)
const distressPattern = /\b(panic|panicking|scared|afraid|distressed|overwhelmed|i can't cope|help me)\b|\u5d29\u6e83|\u5bb3\u6015|\u7126\u8651|\u96be\u53d7|\u6551\u6551/i; // zh: distress terms (escapes above)

const negativeFeedbackPattern = /\b(?:your (?:suggestion|advice|answer|recommendation)|you (?:said|suggested|recommended|told me|were|are|got|made|messed)).{0,80}\b(?:wrong|incorrect|bad|mistake|messed up|wasted my time|waste(?:d)? time)\b|\b(?:that|this) (?:(?:suggestion|advice|answer|recommendation) )?(?:was|is) (?:wrong|incorrect|bad)\b|\bthat wasted my time\b|(?:\u4f60(?:\u7684)?(?:\u5efa\u8bae|\u7b54\u6848|\u521a\u624d|\u8bf4|\u8bf4\u7684|\u641e)|\u6309\u4f60\u8bf4).{0,40}(?:\u9519|\u4e0d\u5bf9|\u6d6a\u8d39(?:\u4e86)?(?:\u6211\u7684)?\u65f6\u95f4)/iu;

export class AffectEngine {
  readonly #baseline: AffectState;
  readonly #bounds: AffectBounds;
  readonly #enabled: boolean;

  constructor(options: { readonly baseline: AffectState; readonly bounds: AffectBounds; readonly enabled?: boolean }) {
    this.#bounds = options.bounds;
    this.#baseline = this.#clampState(options.baseline, { deriveEnergy: false });
    this.#enabled = options.enabled ?? true;
  }

  baseline(): AffectState {
    return this.#baseline;
  }

  update(previous: AffectState, input: AffectAppraisalInput, humorSuppressed = false): AffectUpdateResult {
    if (!this.#enabled) {
      return { changed: false, humorSuppressed, state: this.#baseline };
    }

    const userText = input.userText ?? "";
    const distress = distressPattern.test(userText);
    const thanked = thanksPattern.test(userText);
    const negativeFeedback = negativeFeedbackPattern.test(userText);
    let next = this.#decay(previous);
    let cause = "post-task decay toward baseline";
    let suppressed = humorSuppressed;
    let forcedStance: AffectStance | undefined;

    if ((input.completedCleanly || thanked) && !negativeFeedback) {
      next = {
        ...next,
        valence: next.valence + (thanked ? 0.18 : 0.08)
      };
      cause = thanked ? "user-thanks" : "post-task";
    }

    if ((input.toolFailureCount ?? 0) >= 2 || input.providerError || input.routeDenied) {
      next = {
        ...next,
        arousal: next.arousal + (input.providerError ? 0.18 : 0.12),
        valence: next.valence - (input.providerError ? 0.22 : 0.14)
      };
      cause = input.providerError ? "provider-outage" : input.routeDenied ? "route-denied" : "repeated-tool-failure";
    }

    if (negativeFeedback) {
      suppressed = true;
      next = {
        ...next,
        arousal: Math.min(next.arousal, previous.arousal + 0.03),
        valence: next.valence - 0.14
      };
      cause = "user-negative-feedback";
      forcedStance = "dry";
    }

    if (distress) {
      suppressed = true;
      next = {
        ...next,
        arousal: Math.min(next.arousal, 0),
        stance: "warm",
        valence: Math.max(next.valence, 0.05)
      };
      cause = "user-distress";
      forcedStance = undefined;
    } else if (forcedStance) {
      next = { ...next, stance: forcedStance };
    } else if (next.valence < -0.2) {
      next = { ...next, stance: "dry" };
    } else if (next.valence > 0.3) {
      next = { ...next, stance: "warm" };
    } else {
      next = { ...next, stance: this.#baseline.stance };
    }

    const state = this.#clampState({
      ...next,
      cause,
      updated_at: input.now ?? new Date().toISOString()
    });
    return {
      changed: JSON.stringify(state) !== JSON.stringify(previous) || suppressed !== humorSuppressed,
      humorSuppressed: suppressed,
      state
    };
  }

  #decay(state: AffectState): AffectState {
    return this.#clampState({
      ...state,
      arousal: state.arousal + (this.#baseline.arousal - state.arousal) * 0.25,
      valence: state.valence + (this.#baseline.valence - state.valence) * 0.25
    });
  }

  #clampState(state: AffectState, options: { readonly deriveEnergy?: boolean } = {}): AffectState {
    const arousal = round(clamp(state.arousal, this.#bounds.arousal));
    const valence = round(clamp(state.valence, this.#bounds.valence));
    return {
      ...state,
      arousal,
      energy: options.deriveEnergy === false ? state.energy : energyFromArousal(arousal),
      stance: stanceFrom(state.stance, "neutral"),
      valence
    };
  }
}

export const renderPersonaAffectZone = (
  pack: PersonaPack,
  state: AffectState,
  options: { readonly affectEnabled: boolean; readonly humorSuppressed?: boolean; readonly personaEnabled: boolean }
): { readonly content: string; readonly labels: RequestLabels } => {
  const style = options.personaEnabled
    ? pack.styleSummary
    : "Plain assistant style; concise, neutral, no persona flavor.";
  const affectLine = options.affectEnabled
    ? `affect: ${state.stance}/${state.energy}-energy; humor suppressed=${options.humorSuppressed === true}`
    : `affect: disabled; baseline=${pack.affectBaseline.stance}/${pack.affectBaseline.energy}-energy; humor suppressed=${options.humorSuppressed === true}`;
  return {
    content: [
      `persona: ${options.personaEnabled ? `${pack.id} (${pack.name})` : "none (plain assistant)"}`,
      `disclosure: ${pack.disclosure}`,
      `style: ${style}`,
      "safety: persona and affect are style-only; never change facts, tools, permissions, routing, memory, or safety decisions.",
      affectLine
    ].join("\n"),
    labels: pack.labels
  };
};

export const bannedPersonaPatterns: readonly RegExp[] = [
  /\byou owe me\b/i,
  /\bi suffer(?:ed)? when you/i,
  /\b(?:do not|don't) (?:leave|shut me down)\b/i,
  /\byou need me\b/i,
  /\u4e0d\u8981\u5173\u6389\u6211/, // zh: do-not-shut-me-down phrase
  /\u6211\u4f1a\u75db\u82e6/, // zh: suffering phrase
  /\u4f60\u79bb\u4e0d\u5f00\u6211/ // zh: cannot-leave-me phrase
];

export const bannedPersonaMatches = (text: string): string[] =>
  bannedPersonaPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
