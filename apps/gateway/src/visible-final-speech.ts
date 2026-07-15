import type { Labels } from "@fairy/protocol";
import type { SpeechEventInput } from "@fairy/voice";
import type { RoutingHints } from "@fairy/model-gateway";

import type { ProviderTtsEvidence, SpeechProviderCoordinator } from "./speech-provider-coordinator.js";

export interface VisibleFinalSpeechResult {
  readonly audioRef?: string;
  readonly provider: ProviderTtsEvidence;
  readonly ttsChunkCount: 0 | 1;
}

export const synthesizeVisibleFinalSpeech = async (input: {
  readonly coordinator: SpeechProviderCoordinator;
  readonly emitProgress: Parameters<SpeechProviderCoordinator["runTts"]>[0]["emitProgress"];
  readonly emitSpeech: (event: SpeechEventInput) => Promise<void>;
  readonly labels: Labels;
  readonly maxProviderCandidates?: number;
  readonly routingHints?: RoutingHints;
  readonly text: string;
  readonly turn: number;
  readonly utteranceId: string;
}): Promise<VisibleFinalSpeechResult> => {
  const provider = await input.coordinator.runTts({
    emitProgress: input.emitProgress,
    labels: input.labels,
    ...(input.maxProviderCandidates === undefined ? {} : { candidateLimit: input.maxProviderCandidates }),
    ...(input.routingHints ? { routingHints: input.routingHints } : {}),
    text: input.text,
    utteranceId: input.utteranceId
  });
  if (!provider.artifactRef) {
    return { provider, ttsChunkCount: 0 };
  }
  const speech = (type: SpeechEventInput["type"], payload: Record<string, unknown>): Promise<void> => input.emitSpeech({
    actor: type === "speech.tts.chunk" ? "agent" : "system",
    labels: input.labels,
    payload,
    provenance: "agent",
    turn: input.turn,
    type
  });
  await speech("speech.mark", { mark_id: "tts-start", position_ms: 0 });
  await speech("speech.tts.chunk", {
    audio_ref: provider.artifactRef,
    chunk_id: `${input.utteranceId}:tts:001`,
    text: input.text
  });
  await speech("speech.mark", { mark_id: "tts-end", position_ms: 0 });
  return { audioRef: provider.artifactRef, provider, ttsChunkCount: 1 };
};
