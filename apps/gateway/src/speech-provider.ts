import { EgressGuard, sensitiveFingerprint } from "@fairy/kernel";
import { canRouteToClearance, resolveSecretRef, type DataClearance, type GovernanceConfig, type RequestLabels, type RoutingHints } from "@fairy/model-gateway";

export const miniMaxEndpointProfiles = {
  "cn-primary": "https://api.minimaxi.com/v1/t2a_v2",
  "cn-backup": "https://api-bj.minimaxi.com/v1/t2a_v2"
} as const;

export type MiniMaxEndpointProfile = keyof typeof miniMaxEndpointProfiles;
export type MiniMaxModel = "speech-2.8-turbo" | "speech-2.8-hd";
export type MiniMaxLanguageBoost = "auto" | "Chinese" | "English";

export const miniMaxTtsDefaults = {
  audio: {
    bitrate: 128_000,
    channel: 1,
    format: "mp3" as const,
    sampleRate: 32_000
  },
  deadlinesMs: {
    connect: 5_000,
    read: 5_000,
    total: 30_000
  },
  limits: {
    maxAudioBytes: 33_554_432,
    maxResponseBytes: 67_108_864,
    maxTextChars: 3_000
  },
  model: "speech-2.8-turbo" as const
} as const;

export interface MiniMaxTtsProviderConfig {
  readonly apiKeyRef: `secret://${string}`;
  readonly audio: {
    readonly bitrate: 128000;
    readonly channel: 1;
    readonly format: "mp3";
    readonly sampleRate: 32000;
  };
  readonly dataClearance: DataClearance;
  readonly endpointProfile: MiniMaxEndpointProfile;
  readonly id: string;
  readonly languageBoost: MiniMaxLanguageBoost;
  readonly limits: {
    readonly maxAudioBytes: number;
    readonly maxResponseBytes: number;
    readonly maxTextChars: number;
  };
  readonly model: MiniMaxModel;
  readonly stage: "tts";
  readonly transport: "minimax-t2a-v2-http";
  readonly voice: {
    readonly pitch: number;
    readonly speed: number;
    readonly voiceId: string;
    readonly volume: number;
  };
}

export interface SpeechProviderRuntimeConfig {
  readonly providers: readonly MiniMaxTtsProviderConfig[];
  readonly ttsCandidates: readonly MiniMaxTtsProviderConfig[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const requiredRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
};

const requiredString = (record: Record<string, unknown>, key: string, path: string): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value;
};

const requiredNumber = (record: Record<string, unknown>, key: string, path: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return value;
};

const parseClearance = (record: Record<string, unknown>, path: string): DataClearance => {
  const clearance = requiredRecord(record.data_clearance, `${path}.data_clearance`);
  const maxSensitivity = requiredString(clearance, "max_sensitivity", `${path}.data_clearance`);
  const residency = clearance.residency;
  if (!(["public", "internal", "personal", "secret"] as const).includes(maxSensitivity as DataClearance["max_sensitivity"])) {
    throw new Error(`${path}.data_clearance.max_sensitivity is invalid`);
  }
  if (!Array.isArray(residency) || residency.length === 0 || !residency.every((item) =>
    item === "local-only" || item === "region-restricted" || item === "global-ok")) {
    throw new Error(`${path}.data_clearance.residency is invalid`);
  }
  const regions = Array.isArray(clearance.regions)
    ? clearance.regions.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
  if (residency.includes("region-restricted") && (!regions || regions.length === 0)) {
    throw new Error(`${path}.data_clearance.regions is required for region-restricted clearance`);
  }
  return {
    max_sensitivity: maxSensitivity as DataClearance["max_sensitivity"],
    residency: residency as DataClearance["residency"],
    ...(regions ? { regions } : {})
  };
};

const parseProvider = (value: unknown, index: number): MiniMaxTtsProviderConfig => {
  const path = `speech.providers[${index}]`;
  const record = requiredRecord(value, path);
  const id = requiredString(record, "id", path);
  if (record.stage !== "tts") {
    throw new Error(`${path}.stage must be tts`);
  }
  if (record.transport !== "minimax-t2a-v2-http") {
    throw new Error(`${path}.transport must be minimax-t2a-v2-http`);
  }
  const endpointProfile = requiredString(record, "endpoint_profile", path);
  if (!(endpointProfile in miniMaxEndpointProfiles)) {
    throw new Error(`${path}.endpoint_profile must be cn-primary or cn-backup`);
  }
  const model = record.model ?? miniMaxTtsDefaults.model;
  if (model !== "speech-2.8-turbo" && model !== "speech-2.8-hd") {
    throw new Error(`${path}.model is unsupported`);
  }
  const apiKeyRef = requiredString(record, "api_key_ref", path);
  if (!/^secret:\/\/[A-Za-z0-9_.-]+$/.test(apiKeyRef)) {
    throw new Error(`${path}.api_key_ref must be a secret:// reference`);
  }
  const languageBoost = requiredString(record, "language_boost", path);
  if (languageBoost !== "auto" && languageBoost !== "Chinese" && languageBoost !== "English") {
    throw new Error(`${path}.language_boost is unsupported`);
  }
  const voice = requiredRecord(record.voice, `${path}.voice`);
  const voiceId = requiredString(voice, "voice_id", `${path}.voice`);
  const speed = requiredNumber(voice, "speed", `${path}.voice`);
  const volume = requiredNumber(voice, "volume", `${path}.voice`);
  const pitch = requiredNumber(voice, "pitch", `${path}.voice`);
  if (speed < 0.5 || speed > 2 || volume < 0 || volume > 10 || !Number.isInteger(pitch) || pitch < -12 || pitch > 12) {
    throw new Error(`${path}.voice settings are outside the supported bounds`);
  }
  const audio = requiredRecord(record.audio, `${path}.audio`);
  if (audio.format !== "mp3" || audio.sample_rate !== 32_000 || audio.bitrate !== 128_000 || audio.channel !== 1) {
    throw new Error(`${path}.audio must be MP3 / 32000 Hz / 128000 bps / mono`);
  }
  const limits = isRecord(record.limits) ? record.limits : {};
  const maxTextChars = typeof limits.max_text_chars === "number" ? limits.max_text_chars : miniMaxTtsDefaults.limits.maxTextChars;
  const maxResponseBytes = typeof limits.max_response_bytes === "number" ? limits.max_response_bytes : miniMaxTtsDefaults.limits.maxResponseBytes;
  const maxAudioBytes = typeof limits.max_audio_bytes === "number" ? limits.max_audio_bytes : miniMaxTtsDefaults.limits.maxAudioBytes;
  if (!Number.isInteger(maxTextChars) || maxTextChars < 1 || maxTextChars > miniMaxTtsDefaults.limits.maxTextChars) {
    throw new Error(`${path}.limits.max_text_chars must be an integer from 1 to 3000`);
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > miniMaxTtsDefaults.limits.maxResponseBytes) {
    throw new Error(`${path}.limits.max_response_bytes is outside the supported bound`);
  }
  if (!Number.isInteger(maxAudioBytes) || maxAudioBytes < 1 || maxAudioBytes > miniMaxTtsDefaults.limits.maxAudioBytes) {
    throw new Error(`${path}.limits.max_audio_bytes is outside the supported bound`);
  }
  return {
    apiKeyRef: apiKeyRef as `secret://${string}`,
    audio: { bitrate: 128_000, channel: 1, format: "mp3", sampleRate: 32_000 },
    dataClearance: parseClearance(record, path),
    endpointProfile: endpointProfile as MiniMaxEndpointProfile,
    id,
    languageBoost,
    limits: { maxAudioBytes, maxResponseBytes, maxTextChars },
    model,
    stage: "tts",
    transport: "minimax-t2a-v2-http",
    voice: { pitch, speed, voiceId, volume }
  };
};

export const parseSpeechProviderConfig = (config: Record<string, unknown>): SpeechProviderRuntimeConfig => {
  if (config.speech === undefined) {
    return { providers: [], ttsCandidates: [] };
  }
  const speech = requiredRecord(config.speech, "speech");
  if (!Array.isArray(speech.providers)) {
    throw new Error("speech.providers must be an array");
  }
  const providers = speech.providers.map(parseProvider);
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      throw new Error(`speech.providers contains duplicate id ${provider.id}`);
    }
    ids.add(provider.id);
  }
  const roles = requiredRecord(speech.roles, "speech.roles");
  const tts = requiredRecord(roles.tts, "speech.roles.tts");
  const primary = requiredString(tts, "primary", "speech.roles.tts");
  const fallback = Array.isArray(tts.fallback)
    ? tts.fallback.map((item, index) => {
        if (typeof item !== "string" || item.length === 0) {
          throw new Error(`speech.roles.tts.fallback[${index}] must be a provider id`);
        }
        return item;
      })
    : [];
  const routeIds = [primary, ...fallback];
  if (new Set(routeIds).size !== routeIds.length) {
    throw new Error("speech.roles.tts candidates must be unique");
  }
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ttsCandidates = routeIds.map((id) => {
    const provider = byId.get(id);
    if (!provider) {
      throw new Error(`speech.roles.tts binds unknown provider ${id}`);
    }
    return provider;
  });
  return { providers, ttsCandidates };
};

export const resolveMiniMaxCredential = (provider: MiniMaxTtsProviderConfig, env: NodeJS.ProcessEnv): string => {
  const credential = resolveSecretRef(provider.apiKeyRef, env);
  if (!credential) {
    throw new Error(`speech provider ${provider.id} credential was not found`);
  }
  return credential;
};

export const speechProviderClearance = (
  labels: RequestLabels,
  provider: MiniMaxTtsProviderConfig,
  governance: GovernanceConfig,
  hints: RoutingHints = {}
) => canRouteToClearance(labels, provider.dataClearance, governance, hints);

const speechEgressGuard = new EgressGuard({
  externalTools: ["speech.tts"],
  personalAllowedTools: ["speech.tts"]
});

export const speechProviderEgress = (text: string, labels: RequestLabels) => speechEgressGuard.evaluate(
  "speech.tts",
  { text },
  {
    currentLabels: labels,
    sensitiveContext: labels.sensitivity === "secret"
      ? [{ fingerprint: sensitiveFingerprint(text), labelClass: "secret", provenance: "agent", text }]
      : []
  }
);

export const governanceForSpeech = (config: Record<string, unknown>): GovernanceConfig => {
  const governance = isRecord(config.governance) ? config.governance : {};
  const profile = governance.profile === "sovereign" || governance.profile === "cloud-friendly"
    ? governance.profile
    : "balanced";
  const homeRegions = Array.isArray(governance.home_regions)
    ? governance.home_regions.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return { home_regions: homeRegions, profile };
};
