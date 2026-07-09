import { stableStringify, type Actor, type EventEnvelope, type Labels, type Provenance } from "@fairy/protocol";

export type GovernanceProfile = "balanced" | "sovereign" | "cloud-friendly";

export interface VoiceInputPolicy {
  readonly labels: Labels;
  readonly routingHints?: { readonly prefer_local?: boolean };
}

export const loopbackMarkVocabulary = [
  "asr-start",
  "asr-end",
  "tts-start",
  "tts-end",
  "turn-boundary",
  "barge-in-placeholder"
] as const;

export type LoopbackMarkId = typeof loopbackMarkVocabulary[number];

export type SpeechEventType =
  | "speech.asr.partial"
  | "speech.asr.final"
  | "speech.tts.chunk"
  | "speech.mark";

export interface SpeechEventInput {
  readonly actor: Actor;
  readonly labels: Labels;
  readonly payload: Record<string, unknown>;
  readonly provenance: Provenance;
  readonly turn: number;
  readonly type: SpeechEventType;
}

export interface LoopbackScript {
  readonly audioRef: string;
  readonly partials: readonly string[];
  readonly text: string;
  readonly utteranceId: string;
}

export interface SubmitFinalTranscriptInput {
  readonly audioRef: string;
  readonly labels: Labels;
  readonly routingHints?: { readonly prefer_local?: boolean };
  readonly text: string;
  readonly utteranceId: string;
}

export interface SubmitFinalTranscriptResult {
  readonly assistantFinalText: string;
  readonly labels?: Labels;
}

export interface VoiceTransportRunOptions {
  readonly emit: (event: SpeechEventInput) => Promise<void>;
  readonly labelFinalTranscript?: (text: string, floorLabels: Labels) => Labels;
  readonly profile: GovernanceProfile;
  readonly script: LoopbackScript;
  readonly submitFinalTranscript: (input: SubmitFinalTranscriptInput) => Promise<SubmitFinalTranscriptResult>;
  readonly turn: number;
}

export interface VoiceTransportRunResult {
  readonly assistantFinalText: string;
  readonly eventCounts: Readonly<Record<SpeechEventType, number>>;
  readonly transcriptText: string;
  readonly ttsChunkCount: number;
}

export interface VoiceTransport {
  run(options: VoiceTransportRunOptions): Promise<VoiceTransportRunResult>;
}

export interface LoopbackVoiceTransportOptions {
  readonly ttsChunkChars?: number;
}

const defaultTtsChunkChars = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isLabels = (value: unknown): value is Labels =>
  isRecord(value) &&
  (value.sensitivity === "public" || value.sensitivity === "internal" || value.sensitivity === "personal" || value.sensitivity === "secret") &&
  (value.residency === "local-only" || value.residency === "region-restricted" || value.residency === "global-ok");

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const firstString = (...values: readonly unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

export const voiceInputPolicyForProfile = (profile: GovernanceProfile): VoiceInputPolicy => {
  if (profile === "sovereign") {
    return { labels: { residency: "local-only", sensitivity: "personal" } };
  }
  if (profile === "cloud-friendly") {
    return { labels: { residency: "global-ok", sensitivity: "personal" } };
  }
  return {
    labels: { residency: "region-restricted", sensitivity: "personal" },
    routingHints: { prefer_local: true }
  };
};

export const normalizeLoopbackScript = (value: unknown): LoopbackScript => {
  if (!isRecord(value)) {
    throw new Error("voice loopback script must be a JSON object");
  }
  const text = firstString(value.text, value.final_text, value.final, value.transcript);
  if (!text) {
    throw new Error("voice loopback script requires a non-empty text/final_text/final/transcript field");
  }
  const utteranceId = firstString(value.utterance_id, value.utteranceId) ?? "utt_loopback_1";
  const audioRef = firstString(value.audio_ref, value.audioRef) ?? `loopback://audio/${utteranceId}`;
  const partials = stringArray(value.partials);
  return {
    audioRef,
    partials: partials.length > 0 ? partials : [text],
    text,
    utteranceId
  };
};

export const chunkText = (text: string, chunkChars = defaultTtsChunkChars): string[] => {
  const size = Math.max(1, Math.floor(chunkChars));
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    const chunk = text.slice(index, index + size);
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }
  return chunks;
};

const countEvents = (events: readonly SpeechEventInput[]): Readonly<Record<SpeechEventType, number>> => ({
  "speech.asr.final": events.filter((event) => event.type === "speech.asr.final").length,
  "speech.asr.partial": events.filter((event) => event.type === "speech.asr.partial").length,
  "speech.mark": events.filter((event) => event.type === "speech.mark").length,
  "speech.tts.chunk": events.filter((event) => event.type === "speech.tts.chunk").length
});

const containsRawAudioString = (value: string): boolean =>
  /^data:audio\//i.test(value) || /^[A-Za-z0-9+/]{120,}={0,2}$/.test(value);

const payloadContainsRawAudio = (value: unknown): boolean => {
  if (typeof value === "string") {
    return containsRawAudioString(value);
  }
  if (Array.isArray(value)) {
    return value.some(payloadContainsRawAudio);
  }
  if (isRecord(value)) {
    return Object.values(value).some(payloadContainsRawAudio);
  }
  return false;
};

export const assertNoRawAudioPayloads = (
  events: readonly (SpeechEventInput | EventEnvelope)[]
): void => {
  for (const event of events) {
    if (!String(event.type).startsWith("speech.")) {
      continue;
    }
    if (payloadContainsRawAudio(event.payload)) {
      throw new Error(`raw audio/base64 payload found in ${event.type}`);
    }
  }
};

const markEvent = (turn: number, labels: Labels, markId: LoopbackMarkId, positionMs: number): SpeechEventInput => ({
  actor: "system",
  labels,
  payload: { mark_id: markId, position_ms: positionMs },
  provenance: "agent",
  turn,
  type: "speech.mark"
});

export class LoopbackVoiceTransport implements VoiceTransport {
  readonly #ttsChunkChars: number;

  constructor(options: LoopbackVoiceTransportOptions = {}) {
    this.#ttsChunkChars = options.ttsChunkChars ?? defaultTtsChunkChars;
  }

  async run(options: VoiceTransportRunOptions): Promise<VoiceTransportRunResult> {
    const policy = voiceInputPolicyForProfile(options.profile);
    const finalLabels = options.labelFinalTranscript?.(options.script.text, policy.labels) ?? policy.labels;
    const emitted: SpeechEventInput[] = [];
    const emit = async (event: SpeechEventInput): Promise<void> => {
      emitted.push(event);
      await options.emit(event);
    };

    await emit(markEvent(options.turn, policy.labels, "asr-start", 0));
    for (const partial of options.script.partials) {
      await emit({
        actor: "user",
        labels: policy.labels,
        payload: {
          text: partial,
          utterance_id: options.script.utteranceId
        },
        provenance: "user",
        turn: options.turn,
        type: "speech.asr.partial"
      });
    }
    await emit({
      actor: "user",
      labels: finalLabels,
      payload: {
        audio_ref: options.script.audioRef,
        text: options.script.text,
        utterance_id: options.script.utteranceId
      },
      provenance: "user",
      turn: options.turn,
      type: "speech.asr.final"
    });
    await emit(markEvent(options.turn, finalLabels, "asr-end", 0));

    const turn = await options.submitFinalTranscript({
      audioRef: options.script.audioRef,
      labels: policy.labels,
      ...(policy.routingHints ? { routingHints: policy.routingHints } : {}),
      text: options.script.text,
      utteranceId: options.script.utteranceId
    });
    const ttsLabels = turn.labels ?? finalLabels;
    const chunks = chunkText(turn.assistantFinalText, this.#ttsChunkChars);
    if (chunks.length > 0) {
      await emit(markEvent(options.turn, ttsLabels, "tts-start", 0));
      for (const [index, text] of chunks.entries()) {
        const chunkId = `${options.script.utteranceId}:tts:${String(index + 1).padStart(3, "0")}`;
        await emit({
          actor: "agent",
          labels: ttsLabels,
          payload: {
            audio_ref: `loopback://tts/${chunkId}`,
            chunk_id: chunkId,
            text
          },
          provenance: "agent",
          turn: options.turn,
          type: "speech.tts.chunk"
        });
      }
      await emit(markEvent(options.turn, ttsLabels, "tts-end", 0));
    }
    await emit(markEvent(options.turn, ttsLabels, "turn-boundary", 0));
    assertNoRawAudioPayloads(emitted);

    return {
      assistantFinalText: turn.assistantFinalText,
      eventCounts: countEvents(emitted),
      transcriptText: options.script.text,
      ttsChunkCount: chunks.length
    };
  }
}

export type VoiceCancelTarget = "asr" | "tts" | "turn";

export type VoiceControlFrame =
  | { readonly kind: "session.start"; readonly labels: Labels; readonly profile?: GovernanceProfile; readonly session_id?: string; readonly stream_id: string }
  | { readonly kind: "utterance.start"; readonly audio_ref: string; readonly labels: Labels; readonly stream_id?: string; readonly utterance_id: string }
  | { readonly kind: "asr.partial"; readonly text: string; readonly utterance_id: string }
  | { readonly kind: "asr.final"; readonly audio_ref: string; readonly text: string; readonly utterance_id: string }
  | { readonly kind: "tts.request"; readonly labels: Labels; readonly text: string; readonly utterance_id: string }
  | { readonly kind: "tts.chunk"; readonly audio_ref?: string; readonly chunk_id: string; readonly text: string }
  | { readonly kind: "mark"; readonly chunk_id?: string; readonly mark_id: string; readonly position_ms: number; readonly utterance_id?: string }
  | { readonly kind: "cancel"; readonly reason: string; readonly target: VoiceCancelTarget }
  | { readonly kind: "error"; readonly code: string; readonly message: string; readonly retryable?: boolean }
  | { readonly kind: "session.end"; readonly reason?: string };

export interface VoiceAudioFrame {
  readonly data: Uint8Array;
  readonly final?: boolean;
  readonly sequence: number;
  readonly stream_id: string;
}

export interface VoiceFrameValidationIssue {
  readonly message: string;
  readonly path: string;
}

export type VoiceControlFrameValidationResult =
  | { readonly ok: true; readonly frame: VoiceControlFrame }
  | { readonly ok: false; readonly issues: readonly VoiceFrameValidationIssue[] };

export type VoiceAudioFrameValidationResult =
  | { readonly ok: true; readonly frame: VoiceAudioFrame }
  | { readonly ok: false; readonly issues: readonly VoiceFrameValidationIssue[] };

export interface VoiceDuplexTransport {
  sendControl(frame: VoiceControlFrame): Promise<void>;
  sendAudio(frame: VoiceAudioFrame): Promise<void>;
  close(reason?: string): Promise<void>;
  onControl(handler: (frame: VoiceControlFrame) => void | Promise<void>): () => void;
  onAudio(handler: (frame: VoiceAudioFrame) => void | Promise<void>): () => void;
}

export interface InMemoryVoiceDuplexOptions {
  readonly maxQueueFrames?: number;
}

export interface VoiceAudioFrameValidationOptions {
  readonly maxBytes?: number;
}

export interface VoiceDuplexPairOptions extends InMemoryVoiceDuplexOptions {
  readonly maxFrameBytes?: number;
}

export interface VoiceAudioFrameMetadata {
  readonly byte_length: number;
  readonly final?: boolean;
  readonly sequence: number;
  readonly stream_id: string;
}

export interface DuplexScript extends LoopbackScript {
  readonly audioFrameBytes: readonly number[];
  readonly cancelAsrBeforeFinal: boolean;
  readonly frameLabels?: Labels;
  readonly streamId: string;
}

export interface DuplexVoiceTransportOptions {
  readonly maxFrameBytes?: number;
  readonly maxQueueFrames?: number;
  readonly ttsChunkChars?: number;
}

export interface DuplexVoiceTransportRunOptions extends Omit<VoiceTransportRunOptions, "script"> {
  readonly script: DuplexScript;
}

export interface DuplexVoiceTransportRunResult extends VoiceTransportRunResult {
  readonly cancelled: boolean;
  readonly frameCounts: Readonly<Record<string, number>>;
}

export interface MockSpeechDuplexWorkerOptions {
  readonly pauseTtsAfterChunks?: number;
  readonly ttsChunkChars?: number;
}

export const defaultVoiceMaxFrameBytes = 65_536;
export const defaultVoiceMaxQueueFrames = 64;

export const duplexMarkVocabulary = [
  "asr-start",
  "asr-end",
  "asr-cancelled",
  "tts-start",
  "tts-end",
  "tts-cancelled",
  "turn-boundary"
] as const;

const sensitivityRank: Record<Labels["sensitivity"], number> = {
  public: 0,
  internal: 1,
  personal: 2,
  secret: 3
};

const residencyRank: Record<Labels["residency"], number> = {
  "global-ok": 0,
  "region-restricted": 1,
  "local-only": 2
};

const sensitivityByRank = ["public", "internal", "personal", "secret"] as const;
const residencyByRank = ["global-ok", "region-restricted", "local-only"] as const;

const validationIssue = (path: string, message: string): VoiceFrameValidationIssue => ({ message, path });

const unknownFieldIssues = (value: Record<string, unknown>, allowed: readonly string[]): VoiceFrameValidationIssue[] => {
  const allowedSet = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .map((key) => validationIssue(`$.${key}`, "unknown field"));
};

const stringIssue = (value: Record<string, unknown>, key: string): VoiceFrameValidationIssue[] =>
  typeof value[key] === "string" && value[key].length > 0
    ? []
    : [validationIssue(`$.${key}`, "must be a non-empty string")];

const stringTypeIssue = (value: Record<string, unknown>, key: string): VoiceFrameValidationIssue[] =>
  typeof value[key] === "string"
    ? []
    : [validationIssue(`$.${key}`, "must be a string")];

const optionalStringIssue = (value: Record<string, unknown>, key: string): VoiceFrameValidationIssue[] =>
  value[key] === undefined || (typeof value[key] === "string" && value[key].length > 0)
    ? []
    : [validationIssue(`$.${key}`, "must be a non-empty string when present")];

const booleanIssue = (value: Record<string, unknown>, key: string): VoiceFrameValidationIssue[] =>
  value[key] === undefined || typeof value[key] === "boolean"
    ? []
    : [validationIssue(`$.${key}`, "must be a boolean when present")];

const labelsIssue = (value: Record<string, unknown>, key: string): VoiceFrameValidationIssue[] =>
  isLabels(value[key]) ? [] : [validationIssue(`$.${key}`, "must include valid sensitivity and residency")];

const positionIssue = (value: Record<string, unknown>): VoiceFrameValidationIssue[] =>
  typeof value.position_ms === "number" && Number.isFinite(value.position_ms) && value.position_ms >= 0
    ? []
    : [validationIssue("$.position_ms", "must be a non-negative number")];

const profileIssue = (value: Record<string, unknown>): VoiceFrameValidationIssue[] =>
  value.profile === undefined || value.profile === "balanced" || value.profile === "sovereign" || value.profile === "cloud-friendly"
    ? []
    : [validationIssue("$.profile", "must be balanced, sovereign, or cloud-friendly when present")];

const cancelTargetIssue = (value: Record<string, unknown>): VoiceFrameValidationIssue[] =>
  value.target === "asr" || value.target === "tts" || value.target === "turn"
    ? []
    : [validationIssue("$.target", "must be asr, tts, or turn")];

const controlFrameIssues = (value: Record<string, unknown>): VoiceFrameValidationIssue[] => {
  const kind = value.kind;
  if (typeof kind !== "string") {
    return [validationIssue("$.kind", "must be a string")];
  }

  if (kind === "session.start") {
    return [
      ...unknownFieldIssues(value, ["kind", "labels", "profile", "session_id", "stream_id"]),
      ...stringIssue(value, "stream_id"),
      ...optionalStringIssue(value, "session_id"),
      ...labelsIssue(value, "labels"),
      ...profileIssue(value)
    ];
  }
  if (kind === "utterance.start") {
    return [
      ...unknownFieldIssues(value, ["kind", "audio_ref", "labels", "stream_id", "utterance_id"]),
      ...stringIssue(value, "utterance_id"),
      ...stringIssue(value, "audio_ref"),
      ...optionalStringIssue(value, "stream_id"),
      ...labelsIssue(value, "labels")
    ];
  }
  if (kind === "asr.partial") {
    return [
      ...unknownFieldIssues(value, ["kind", "text", "utterance_id"]),
      ...stringIssue(value, "utterance_id"),
      ...stringIssue(value, "text")
    ];
  }
  if (kind === "asr.final") {
    return [
      ...unknownFieldIssues(value, ["kind", "audio_ref", "text", "utterance_id"]),
      ...stringIssue(value, "utterance_id"),
      ...stringIssue(value, "text"),
      ...stringIssue(value, "audio_ref")
    ];
  }
  if (kind === "tts.request") {
    return [
      ...unknownFieldIssues(value, ["kind", "labels", "text", "utterance_id"]),
      ...stringIssue(value, "utterance_id"),
      ...stringTypeIssue(value, "text"),
      ...labelsIssue(value, "labels")
    ];
  }
  if (kind === "tts.chunk") {
    return [
      ...unknownFieldIssues(value, ["kind", "audio_ref", "chunk_id", "text"]),
      ...stringIssue(value, "chunk_id"),
      ...stringIssue(value, "text"),
      ...optionalStringIssue(value, "audio_ref")
    ];
  }
  if (kind === "mark") {
    return [
      ...unknownFieldIssues(value, ["kind", "chunk_id", "mark_id", "position_ms", "utterance_id"]),
      ...stringIssue(value, "mark_id"),
      ...positionIssue(value),
      ...optionalStringIssue(value, "utterance_id"),
      ...optionalStringIssue(value, "chunk_id")
    ];
  }
  if (kind === "cancel") {
    return [
      ...unknownFieldIssues(value, ["kind", "reason", "target"]),
      ...cancelTargetIssue(value),
      ...stringIssue(value, "reason")
    ];
  }
  if (kind === "error") {
    return [
      ...unknownFieldIssues(value, ["kind", "code", "message", "retryable"]),
      ...stringIssue(value, "code"),
      ...stringIssue(value, "message"),
      ...booleanIssue(value, "retryable")
    ];
  }
  if (kind === "session.end") {
    return [
      ...unknownFieldIssues(value, ["kind", "reason"]),
      ...optionalStringIssue(value, "reason")
    ];
  }
  return [validationIssue("$.kind", `unknown voice control frame kind ${kind}`)];
};

export const validateVoiceControlFrame = (value: unknown): VoiceControlFrameValidationResult => {
  if (!isRecord(value)) {
    return { issues: [validationIssue("$", "must be an object")], ok: false };
  }
  const issues = controlFrameIssues(value);
  if (issues.length > 0) {
    return { issues, ok: false };
  }
  return { frame: value as unknown as VoiceControlFrame, ok: true };
};

export const encodeVoiceControlFrame = (frame: VoiceControlFrame): string => {
  const result = validateVoiceControlFrame(frame);
  if (!result.ok) {
    throw new Error(`invalid voice control frame: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  return stableStringify(result.frame);
};

export const decodeVoiceControlFrame = (serialized: string): VoiceControlFrame => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`invalid voice control frame JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = validateVoiceControlFrame(parsed);
  if (!result.ok) {
    throw new Error(`invalid voice control frame: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  return result.frame;
};

export const validateVoiceAudioFrame = (
  value: unknown,
  options: VoiceAudioFrameValidationOptions = {}
): VoiceAudioFrameValidationResult => {
  if (!isRecord(value)) {
    return { issues: [validationIssue("$", "must be an object")], ok: false };
  }
  const maxBytes = options.maxBytes ?? defaultVoiceMaxFrameBytes;
  const issues: VoiceFrameValidationIssue[] = [
    ...unknownFieldIssues(value, ["data", "final", "sequence", "stream_id"]),
    ...stringIssue(value, "stream_id")
  ];
  if (!Number.isInteger(value.sequence) || typeof value.sequence !== "number" || value.sequence < 0) {
    issues.push(validationIssue("$.sequence", "must be a non-negative integer"));
  }
  if (!(value.data instanceof Uint8Array)) {
    issues.push(validationIssue("$.data", "must be a Uint8Array"));
  } else if (value.data.byteLength > maxBytes) {
    issues.push(validationIssue("$.data", `must be at most ${maxBytes} bytes`));
  }
  if (value.final !== undefined && typeof value.final !== "boolean") {
    issues.push(validationIssue("$.final", "must be a boolean when present"));
  }
  if (issues.length > 0) {
    return { issues, ok: false };
  }
  return { frame: value as unknown as VoiceAudioFrame, ok: true };
};

export const voiceAudioFrameMetadata = (frame: VoiceAudioFrame): VoiceAudioFrameMetadata => ({
  byte_length: frame.data.byteLength,
  ...(frame.final !== undefined ? { final: frame.final } : {}),
  sequence: frame.sequence,
  stream_id: frame.stream_id
});

export const clampVoiceFrameLabels = (floor: Labels, advisory?: Labels): Labels => {
  if (!advisory) {
    return floor;
  }
  return {
    residency: residencyByRank[Math.max(residencyRank[floor.residency], residencyRank[advisory.residency])] ?? floor.residency,
    sensitivity: sensitivityByRank[Math.max(sensitivityRank[floor.sensitivity], sensitivityRank[advisory.sensitivity])] ?? floor.sensitivity
  };
};

export class InMemoryVoiceDuplexTransport implements VoiceDuplexTransport {
  readonly #audioHandlers = new Set<(frame: VoiceAudioFrame) => void | Promise<void>>();
  readonly #controlHandlers = new Set<(frame: VoiceControlFrame) => void | Promise<void>>();
  readonly #maxFrameBytes: number;
  readonly #maxQueueFrames: number;
  #audioChains = new Map<string, Promise<void>>();
  #closed = false;
  #controlChain = Promise.resolve();
  #peer: InMemoryVoiceDuplexTransport | undefined;
  #queuedFrames = 0;

  constructor(options: VoiceDuplexPairOptions = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? defaultVoiceMaxFrameBytes;
    this.#maxQueueFrames = options.maxQueueFrames ?? defaultVoiceMaxQueueFrames;
  }

  attachPeer(peer: InMemoryVoiceDuplexTransport): void {
    this.#peer = peer;
  }

  onControl(handler: (frame: VoiceControlFrame) => void | Promise<void>): () => void {
    this.#controlHandlers.add(handler);
    return () => this.#controlHandlers.delete(handler);
  }

  onAudio(handler: (frame: VoiceAudioFrame) => void | Promise<void>): () => void {
    this.#audioHandlers.add(handler);
    return () => this.#audioHandlers.delete(handler);
  }

  async sendControl(frame: VoiceControlFrame): Promise<void> {
    if (this.#closed) {
      throw new Error("voice duplex transport is closed");
    }
    const result = validateVoiceControlFrame(frame);
    if (!result.ok) {
      throw new Error(`invalid voice control frame: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
    if (!this.#peer) {
      throw new Error("voice duplex transport is not paired");
    }
    await this.#peer.enqueueControl(result.frame);
  }

  async sendAudio(frame: VoiceAudioFrame): Promise<void> {
    if (this.#closed) {
      throw new Error("voice duplex transport is closed");
    }
    const result = validateVoiceAudioFrame(frame, { maxBytes: this.#maxFrameBytes });
    if (!result.ok) {
      throw new Error(`invalid voice audio frame: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
    if (!this.#peer) {
      throw new Error("voice duplex transport is not paired");
    }
    await this.#peer.enqueueAudio(result.frame);
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#controlChain.catch(() => undefined);
    await Promise.all([...this.#audioChains.values()].map((chain) => chain.catch(() => undefined)));
  }

  private enqueueControl(frame: VoiceControlFrame): Promise<void> {
    this.#ensureReceivable();
    this.#queuedFrames += 1;
    const delivery = this.#controlChain.then(async () => {
      try {
        for (const handler of this.#controlHandlers) {
          await handler(frame);
        }
      } finally {
        this.#queuedFrames -= 1;
      }
    });
    this.#controlChain = delivery.catch(() => undefined);
    return delivery;
  }

  private enqueueAudio(frame: VoiceAudioFrame): Promise<void> {
    this.#ensureReceivable();
    this.#queuedFrames += 1;
    const previous = this.#audioChains.get(frame.stream_id) ?? Promise.resolve();
    const delivery = previous.then(async () => {
      try {
        for (const handler of this.#audioHandlers) {
          await handler(frame);
        }
      } finally {
        this.#queuedFrames -= 1;
      }
    });
    this.#audioChains.set(frame.stream_id, delivery.catch(() => undefined));
    return delivery;
  }

  #ensureReceivable(): void {
    if (this.#closed) {
      throw new Error("voice duplex transport is closed");
    }
    if (this.#queuedFrames >= this.#maxQueueFrames) {
      throw new Error("voice duplex transport queue overflow");
    }
  }
}

export const createVoiceDuplexPair = (
  options: VoiceDuplexPairOptions = {}
): readonly [VoiceDuplexTransport, VoiceDuplexTransport] => {
  const left = new InMemoryVoiceDuplexTransport(options);
  const right = new InMemoryVoiceDuplexTransport(options);
  left.attachPeer(right);
  right.attachPeer(left);
  return [left, right];
};

const numberArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];

const labelsFromUnknown = (value: unknown): Labels | undefined => isLabels(value) ? value : undefined;

export const normalizeDuplexScript = (value: unknown): DuplexScript => {
  const loopback = normalizeLoopbackScript(value);
  const record = isRecord(value) ? value : {};
  const streamId = firstString(record.stream_id, record.streamId) ?? "stream_duplex_1";
  const audioRef = firstString(record.audio_ref, record.audioRef) ?? `duplex://audio/${loopback.utteranceId}`;
  const audioFrameBytes = numberArray(record.audio_frame_bytes ?? record.audioFrameBytes);
  const frameLabels = labelsFromUnknown(record.frame_labels ?? record.frameLabels);
  return {
    ...loopback,
    audioRef,
    audioFrameBytes: audioFrameBytes.length > 0 ? audioFrameBytes : [16],
    cancelAsrBeforeFinal: record.cancel_asr_before_final === true || record.cancelAsrBeforeFinal === true,
    ...(frameLabels ? { frameLabels } : {}),
    streamId
  };
};

const syntheticAudioFrame = (
  streamId: string,
  sequence: number,
  byteLength: number,
  final = false
): VoiceAudioFrame => ({
  data: Uint8Array.from({ length: byteLength }, (_value, index) => (sequence + index) % 251),
  ...(final ? { final } : {}),
  sequence,
  stream_id: streamId
});

interface ActiveUtterance {
  readonly audioRef: string;
  cancelled: boolean;
  finalEmitted: boolean;
  readonly utteranceId: string;
}

export class MockSpeechDuplexWorker {
  readonly #options: Required<MockSpeechDuplexWorkerOptions>;
  #active: ActiveUtterance | undefined;
  #pendingTts: VoiceControlFrame[] = [];
  #ttsCancelled = false;
  readonly #script: LoopbackScript;
  readonly #transport: VoiceDuplexTransport;

  constructor(transport: VoiceDuplexTransport, script: LoopbackScript, options: MockSpeechDuplexWorkerOptions = {}) {
    this.#options = {
      pauseTtsAfterChunks: options.pauseTtsAfterChunks ?? Number.POSITIVE_INFINITY,
      ttsChunkChars: options.ttsChunkChars ?? defaultTtsChunkChars
    };
    this.#script = script;
    this.#transport = transport;
    this.#transport.onControl((frame) => this.#handleControl(frame));
    this.#transport.onAudio((frame) => this.#handleAudio(frame));
  }

  async flushPendingTts(): Promise<void> {
    if (this.#ttsCancelled) {
      this.#pendingTts = [];
      return;
    }
    const pending = this.#pendingTts;
    this.#pendingTts = [];
    for (const frame of pending) {
      await this.#transport.sendControl(frame);
    }
  }

  async #handleControl(frame: VoiceControlFrame): Promise<void> {
    if (frame.kind === "session.start" || frame.kind === "session.end") {
      return;
    }
    if (frame.kind === "utterance.start") {
      this.#active = {
        audioRef: frame.audio_ref,
        cancelled: false,
        finalEmitted: false,
        utteranceId: frame.utterance_id
      };
      await this.#emitMark("asr-start", { utterance_id: frame.utterance_id });
      for (const partial of this.#script.partials) {
        await this.#transport.sendControl({
          kind: "asr.partial",
          text: partial,
          utterance_id: frame.utterance_id
        });
      }
      return;
    }
    if (frame.kind === "tts.request") {
      await this.#handleTtsRequest(frame);
      return;
    }
    if (frame.kind === "cancel") {
      await this.#handleCancel(frame);
      return;
    }
  }

  async #handleAudio(frame: VoiceAudioFrame): Promise<void> {
    if (!frame.final) {
      return;
    }
    if (!this.#active) {
      await this.#emitError("no_active_utterance", "speech worker error");
      return;
    }
    if (this.#active.cancelled || this.#active.finalEmitted) {
      return;
    }
    this.#active.finalEmitted = true;
    await this.#transport.sendControl({
      audio_ref: this.#active.audioRef,
      kind: "asr.final",
      text: this.#script.text,
      utterance_id: this.#active.utteranceId
    });
    await this.#emitMark("asr-end", { utterance_id: this.#active.utteranceId });
  }

  async #handleTtsRequest(frame: Extract<VoiceControlFrame, { kind: "tts.request" }>): Promise<void> {
    this.#ttsCancelled = false;
    const chunks = chunkText(frame.text, this.#options.ttsChunkChars);
    if (chunks.length === 0) {
      await this.#emitMark("turn-boundary", { utterance_id: frame.utterance_id });
      return;
    }
    await this.#emitMark("tts-start", { utterance_id: frame.utterance_id });
    const chunkFrames = chunks.map((text, index): VoiceControlFrame => {
      const chunkId = `${frame.utterance_id}:tts:${String(index + 1).padStart(3, "0")}`;
      return {
        audio_ref: `duplex://tts/${chunkId}`,
        chunk_id: chunkId,
        kind: "tts.chunk",
        text
      };
    });
    const immediate = chunkFrames.slice(0, this.#options.pauseTtsAfterChunks);
    this.#pendingTts = [
      ...chunkFrames.slice(this.#options.pauseTtsAfterChunks),
      { kind: "mark", mark_id: "tts-end", position_ms: 0, utterance_id: frame.utterance_id },
      { kind: "mark", mark_id: "turn-boundary", position_ms: 0, utterance_id: frame.utterance_id }
    ];
    for (const chunk of immediate) {
      await this.#transport.sendControl(chunk);
    }
    if (this.#pendingTts.length === 2) {
      await this.flushPendingTts();
    }
  }

  async #handleCancel(frame: Extract<VoiceControlFrame, { kind: "cancel" }>): Promise<void> {
    if (frame.target === "asr" && this.#active && !this.#active.finalEmitted) {
      this.#active.cancelled = true;
      await this.#emitMark("asr-cancelled", { utterance_id: this.#active.utteranceId });
      return;
    }
    if (frame.target === "tts") {
      this.#ttsCancelled = true;
      this.#pendingTts = [];
      await this.#emitMark("tts-cancelled", {});
    }
  }

  async #emitMark(markId: string, refs: { readonly chunk_id?: string; readonly utterance_id?: string }): Promise<void> {
    await this.#transport.sendControl({
      ...refs,
      kind: "mark",
      mark_id: markId,
      position_ms: 0
    });
  }

  async #emitError(code: string, message: string): Promise<void> {
    await this.#transport.sendControl({
      code,
      kind: "error",
      message,
      retryable: false
    });
  }
}

export class DuplexVoiceTransport implements VoiceTransport {
  readonly #maxFrameBytes: number;
  readonly #maxQueueFrames: number;
  readonly #ttsChunkChars: number;

  constructor(options: DuplexVoiceTransportOptions = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? defaultVoiceMaxFrameBytes;
    this.#maxQueueFrames = options.maxQueueFrames ?? defaultVoiceMaxQueueFrames;
    this.#ttsChunkChars = options.ttsChunkChars ?? defaultTtsChunkChars;
  }

  async run(options: DuplexVoiceTransportRunOptions): Promise<DuplexVoiceTransportRunResult> {
    const policy = voiceInputPolicyForProfile(options.profile);
    const effectiveFloor = clampVoiceFrameLabels(policy.labels, options.script.frameLabels);
    const finalLabels = options.labelFinalTranscript?.(options.script.text, effectiveFloor) ?? effectiveFloor;
    const emitted: SpeechEventInput[] = [];
    const frameCounts: Record<string, number> = {};
    const [coordinator, workerSide] = createVoiceDuplexPair({
      maxFrameBytes: this.#maxFrameBytes,
      maxQueueFrames: this.#maxQueueFrames
    });
    const worker = new MockSpeechDuplexWorker(workerSide, options.script, {
      ttsChunkChars: this.#ttsChunkChars
    });
    let finalFrame: Extract<VoiceControlFrame, { kind: "asr.final" }> | undefined;
    let ttsLabels = finalLabels;

    const countFrame = (name: string): void => {
      frameCounts[name] = (frameCounts[name] ?? 0) + 1;
    };
    const emit = async (event: SpeechEventInput): Promise<void> => {
      emitted.push(event);
      await options.emit(event);
    };

    coordinator.onControl(async (frame) => {
      countFrame(`control.${frame.kind}`);
      if (frame.kind === "mark") {
        const labels = frame.mark_id.startsWith("tts") || frame.mark_id === "turn-boundary"
          ? ttsLabels
          : frame.mark_id === "asr-start" || frame.mark_id === "asr-cancelled"
            ? effectiveFloor
            : finalLabels;
        await emit({
          actor: "system",
          labels,
          payload: {
            mark_id: frame.mark_id,
            position_ms: frame.position_ms
          },
          provenance: "agent",
          turn: options.turn,
          type: "speech.mark"
        });
        return;
      }
      if (frame.kind === "asr.partial") {
        await emit({
          actor: "user",
          labels: effectiveFloor,
          payload: {
            text: frame.text,
            utterance_id: frame.utterance_id
          },
          provenance: "user",
          turn: options.turn,
          type: "speech.asr.partial"
        });
        return;
      }
      if (frame.kind === "asr.final") {
        finalFrame = frame;
        await emit({
          actor: "user",
          labels: finalLabels,
          payload: {
            audio_ref: frame.audio_ref,
            text: frame.text,
            utterance_id: frame.utterance_id
          },
          provenance: "user",
          turn: options.turn,
          type: "speech.asr.final"
        });
        return;
      }
      if (frame.kind === "tts.chunk") {
        await emit({
          actor: "agent",
          labels: ttsLabels,
          payload: {
            ...(frame.audio_ref ? { audio_ref: frame.audio_ref } : {}),
            chunk_id: frame.chunk_id,
            text: frame.text
          },
          provenance: "agent",
          turn: options.turn,
          type: "speech.tts.chunk"
        });
      }
    });

    const sendControl = async (frame: VoiceControlFrame): Promise<void> => {
      countFrame(`control.${frame.kind}`);
      await coordinator.sendControl(frame);
    };
    const sendAudio = async (frame: VoiceAudioFrame): Promise<void> => {
      countFrame("audio");
      await coordinator.sendAudio(frame);
    };

    const frameLabels = options.script.frameLabels ?? policy.labels;
    await sendControl({
      kind: "session.start",
      labels: frameLabels,
      profile: options.profile,
      stream_id: options.script.streamId
    });
    await sendControl({
      audio_ref: options.script.audioRef,
      kind: "utterance.start",
      labels: frameLabels,
      stream_id: options.script.streamId,
      utterance_id: options.script.utteranceId
    });
    for (const [index, byteLength] of options.script.audioFrameBytes.entries()) {
      await sendAudio(syntheticAudioFrame(options.script.streamId, index, byteLength, false));
    }
    if (options.script.cancelAsrBeforeFinal) {
      await sendControl({ kind: "cancel", reason: "scripted_asr_cancel", target: "asr" });
      assertNoRawAudioPayloads(emitted);
      await coordinator.close("cancelled");
      await workerSide.close("cancelled");
      return {
        assistantFinalText: "",
        cancelled: true,
        eventCounts: countEvents(emitted),
        frameCounts,
        transcriptText: "",
        ttsChunkCount: 0
      };
    }

    await sendAudio(syntheticAudioFrame(options.script.streamId, options.script.audioFrameBytes.length, 1, true));
    if (!finalFrame) {
      throw new Error("duplex worker completed without asr.final");
    }

    const turn = await options.submitFinalTranscript({
      audioRef: finalFrame.audio_ref,
      labels: effectiveFloor,
      ...(policy.routingHints ? { routingHints: policy.routingHints } : {}),
      text: finalFrame.text,
      utteranceId: finalFrame.utterance_id
    });
    ttsLabels = turn.labels ?? finalLabels;
    await sendControl({
      kind: "tts.request",
      labels: ttsLabels,
      text: turn.assistantFinalText,
      utterance_id: finalFrame.utterance_id
    });
    await worker.flushPendingTts();
    assertNoRawAudioPayloads(emitted);
    await coordinator.close("done");
    await workerSide.close("done");

    return {
      assistantFinalText: turn.assistantFinalText,
      cancelled: false,
      eventCounts: countEvents(emitted),
      frameCounts,
      transcriptText: finalFrame.text,
      ttsChunkCount: emitted.filter((event) => event.type === "speech.tts.chunk").length
    };
  }
}
