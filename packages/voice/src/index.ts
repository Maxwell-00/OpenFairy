import type { Actor, EventEnvelope, Labels, Provenance } from "@fairy/protocol";

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
