import { EgressGuard, sensitiveFingerprint } from "@fairy/kernel";
import { canRouteToClearance, resolveSecretRef, type DataClearance, type GovernanceConfig, type RequestLabels, type RoutingHints } from "@fairy/model-gateway";

export const miniMaxEndpointProfiles = {
  "cn-primary": "https://api.minimaxi.com/v1/t2a_v2",
  "cn-backup": "https://api-bj.minimaxi.com/v1/t2a_v2"
} as const;

export const mimoAsrEndpointProfiles = {
  "mimo-paygo-cn": "https://api.xiaomimimo.com/v1/chat/completions"
} as const;

export type MiniMaxEndpointProfile = keyof typeof miniMaxEndpointProfiles;
export type MiniMaxModel = "speech-2.8-turbo" | "speech-2.8-hd";
export type MiniMaxLanguageBoost = "auto" | "Chinese" | "English";
export type MimoAsrEndpointProfile = keyof typeof mimoAsrEndpointProfiles;
export type MimoAsrLanguage = "auto" | "zh" | "en";

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

export const mimoAsrDefaults = {
  deadlinesMs: {
    connect: 10_000,
    read: 60_000,
    total: 75_000
  },
  limits: {
    maxEncodedRequestBytes: 10_000_000,
    maxInputBytes: 7_000_000,
    maxResponseBytes: 1_048_576,
    maxTranscriptChars: 20_000
  },
  model: "mimo-v2.5-asr" as const
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

export interface MimoAsrProviderConfig {
  readonly apiKeyRef: `secret://${string}`;
  readonly dataClearance: DataClearance;
  readonly endpointProfile: "mimo-paygo-cn";
  readonly id: string;
  readonly language: MimoAsrLanguage;
  readonly limits: {
    readonly maxEncodedRequestBytes: 10_000_000;
    readonly maxInputBytes: number;
    readonly maxResponseBytes: number;
    readonly maxTranscriptChars: number;
  };
  readonly model: "mimo-v2.5-asr";
  readonly stage: "asr";
  readonly transport: "mimo-v2.5-asr-chat-http";
}

export type SpeechProviderConfig = MiniMaxTtsProviderConfig | MimoAsrProviderConfig;

export interface SpeechProviderRuntimeConfig {
  readonly asrCandidates: readonly MimoAsrProviderConfig[];
  readonly providers: readonly SpeechProviderConfig[];
  readonly ttsCandidates: readonly MiniMaxTtsProviderConfig[];
}

export class SpeechProviderCredentialError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SpeechProviderCredentialError";
  }
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
  if (!( ["public", "internal", "personal", "secret"] as const).includes(maxSensitivity as DataClearance["max_sensitivity"])) {
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

const parseMiniMaxProvider = (record: Record<string, unknown>, index: number): MiniMaxTtsProviderConfig => {
  const path = `speech.providers[${index}]`;
  const id = requiredString(record, "id", path);
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

const parseMimoProvider = (record: Record<string, unknown>, index: number): MimoAsrProviderConfig => {
  const path = `speech.providers[${index}]`;
  const id = requiredString(record, "id", path);
  if (record.transport !== "mimo-v2.5-asr-chat-http") {
    throw new Error(`${path}.transport must be mimo-v2.5-asr-chat-http`);
  }
  if (record.endpoint_profile !== "mimo-paygo-cn") {
    throw new Error(`${path}.endpoint_profile must be mimo-paygo-cn`);
  }
  if (record.model !== "mimo-v2.5-asr") {
    throw new Error(`${path}.model must be mimo-v2.5-asr`);
  }
  const apiKeyRef = requiredString(record, "api_key_ref", path);
  if (!/^secret:\/\/[A-Za-z0-9_.-]+$/.test(apiKeyRef)) {
    throw new Error(`${path}.api_key_ref must be a secret:// reference`);
  }
  const language = requiredString(record, "language", path);
  if (language !== "auto" && language !== "zh" && language !== "en") {
    throw new Error(`${path}.language must be auto, zh, or en`);
  }
  const limits = isRecord(record.limits) ? record.limits : {};
  const maxInputBytes = typeof limits.max_input_bytes === "number" ? limits.max_input_bytes : mimoAsrDefaults.limits.maxInputBytes;
  const maxResponseBytes = typeof limits.max_response_bytes === "number" ? limits.max_response_bytes : mimoAsrDefaults.limits.maxResponseBytes;
  const maxTranscriptChars = typeof limits.max_transcript_chars === "number" ? limits.max_transcript_chars : mimoAsrDefaults.limits.maxTranscriptChars;
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > mimoAsrDefaults.limits.maxInputBytes) {
    throw new Error(`${path}.limits.max_input_bytes must be an integer from 1 to 7000000`);
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > mimoAsrDefaults.limits.maxResponseBytes) {
    throw new Error(`${path}.limits.max_response_bytes is outside the supported bound`);
  }
  if (!Number.isInteger(maxTranscriptChars) || maxTranscriptChars < 1 || maxTranscriptChars > mimoAsrDefaults.limits.maxTranscriptChars) {
    throw new Error(`${path}.limits.max_transcript_chars is outside the supported bound`);
  }
  return {
    apiKeyRef: apiKeyRef as `secret://${string}`,
    dataClearance: parseClearance(record, path),
    endpointProfile: "mimo-paygo-cn",
    id,
    language,
    limits: {
      maxEncodedRequestBytes: mimoAsrDefaults.limits.maxEncodedRequestBytes,
      maxInputBytes,
      maxResponseBytes,
      maxTranscriptChars
    },
    model: "mimo-v2.5-asr",
    stage: "asr",
    transport: "mimo-v2.5-asr-chat-http"
  };
};

const parseProvider = (value: unknown, index: number): SpeechProviderConfig => {
  const path = `speech.providers[${index}]`;
  const record = requiredRecord(value, path);
  if (record.stage === "tts") {
    return parseMiniMaxProvider(record, index);
  }
  if (record.stage === "asr") {
    return parseMimoProvider(record, index);
  }
  throw new Error(`${path}.stage must be asr or tts`);
};

const parseRoleIds = (roles: Record<string, unknown>, stage: "asr" | "tts"): string[] => {
  if (roles[stage] === undefined) {
    return [];
  }
  const role = requiredRecord(roles[stage], `speech.roles.${stage}`);
  const primary = requiredString(role, "primary", `speech.roles.${stage}`);
  const fallback = Array.isArray(role.fallback)
    ? role.fallback.map((item, index) => {
        if (typeof item !== "string" || item.length === 0) {
          throw new Error(`speech.roles.${stage}.fallback[${index}] must be a provider id`);
        }
        return item;
      })
    : [];
  if (stage === "asr" && fallback.length > 0) {
    throw new Error("speech.roles.asr.fallback must be empty in R0.9-01");
  }
  const ids = [primary, ...fallback];
  if (new Set(ids).size !== ids.length) {
    throw new Error(`speech.roles.${stage} candidates must be unique`);
  }
  return ids;
};

export const parseSpeechProviderConfig = (config: Record<string, unknown>): SpeechProviderRuntimeConfig => {
  if (config.speech === undefined) {
    return { asrCandidates: [], providers: [], ttsCandidates: [] };
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
  const asrIds = parseRoleIds(roles, "asr");
  const ttsIds = parseRoleIds(roles, "tts");
  if (providers.some((provider) => provider.stage === "asr") && asrIds.length === 0) {
    throw new Error("speech.roles.asr is required when an ASR provider is configured");
  }
  if (providers.some((provider) => provider.stage === "tts") && ttsIds.length === 0) {
    throw new Error("speech.roles.tts is required when a TTS provider is configured");
  }
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const resolveRole = <TStage extends "asr" | "tts">(stage: TStage, roleIds: readonly string[]): Extract<SpeechProviderConfig, { readonly stage: TStage }>[] =>
    roleIds.map((id) => {
      const provider = byId.get(id);
      if (!provider) {
        throw new Error(`speech.roles.${stage} binds unknown provider ${id}`);
      }
      if (provider.stage !== stage) {
        throw new Error(`speech.roles.${stage} binds provider ${id} with stage ${provider.stage}`);
      }
      return provider as Extract<SpeechProviderConfig, { readonly stage: TStage }>;
    });
  return {
    asrCandidates: resolveRole("asr", asrIds),
    providers,
    ttsCandidates: resolveRole("tts", ttsIds)
  };
};

export const resolveMiniMaxCredential = (provider: MiniMaxTtsProviderConfig, env: NodeJS.ProcessEnv): string => {
  const credential = resolveSecretRef(provider.apiKeyRef, env);
  if (!credential) {
    throw new SpeechProviderCredentialError("MINIMAX_TTS_CREDENTIAL_MISSING", `speech provider ${provider.id} credential was not found`);
  }
  return credential;
};

export const resolveMimoCredential = (provider: MimoAsrProviderConfig, env: NodeJS.ProcessEnv): string => {
  const credential = resolveSecretRef(provider.apiKeyRef, env);
  if (!credential) {
    throw new SpeechProviderCredentialError("MIMO_ASR_CREDENTIAL_MISSING", `speech provider ${provider.id} credential was not found`);
  }
  if (!/^sk-[A-Za-z0-9._-]+$/.test(credential)) {
    throw new SpeechProviderCredentialError("MIMO_ASR_CREDENTIAL_KIND_MISMATCH", "MiMo ASR requires a pay-as-you-go credential");
  }
  return credential;
};

export const speechProviderClearance = (
  labels: RequestLabels,
  provider: SpeechProviderConfig,
  governance: GovernanceConfig,
  hints: RoutingHints = {}
) => canRouteToClearance(labels, provider.dataClearance, governance, hints);

const speechEgressGuard = new EgressGuard({
  externalTools: ["speech.asr", "speech.tts"],
  personalAllowedTools: ["speech.asr", "speech.tts"]
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

export const speechAsrProviderEgress = (audioRef: string, labels: RequestLabels) => speechEgressGuard.evaluate(
  "speech.asr",
  { audio_ref: audioRef },
  {
    currentLabels: labels,
    sensitiveContext: labels.sensitivity === "secret"
      ? [{ fingerprint: sensitiveFingerprint(audioRef), labelClass: "secret", provenance: "user", text: audioRef }]
      : []
  }
);

export const predictedMimoAsrRequestBytes = (rawBytes: number, mime: "audio/wav" | "audio/mpeg", language: MimoAsrLanguage): number => {
  if (!Number.isInteger(rawBytes) || rawBytes < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const prefix = `data:${mime};base64,`;
  const envelope = JSON.stringify({
    model: "mimo-v2.5-asr",
    messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: prefix } }] }],
    asr_options: { language }
  });
  return Buffer.byteLength(envelope, "utf8") + (4 * Math.ceil(rawBytes / 3));
};

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
