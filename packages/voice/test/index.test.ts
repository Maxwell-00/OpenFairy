import { describe, expect, it } from "vitest";

import {
  assertNoRawAudioPayloads,
  chunkText,
  LoopbackVoiceTransport,
  loopbackMarkVocabulary,
  normalizeLoopbackScript,
  voiceInputPolicyForProfile,
  type SpeechEventInput
} from "../src/index.js";

describe("LoopbackVoiceTransport", () => {
  it("emits stable speech events around exactly one final turn callback", async () => {
    const events: SpeechEventInput[] = [];
    let finalCalls = 0;
    const transport = new LoopbackVoiceTransport({ ttsChunkChars: 6 });

    const result = await transport.run({
      emit: async (event) => {
        if (event.type === "speech.asr.partial") {
          expect(finalCalls).toBe(0);
        }
        events.push(event);
      },
      profile: "balanced",
      script: normalizeLoopbackScript({
        audio_ref: "loopback://audio/utt_test",
        partials: ["hel", "hello"],
        text: "hello there",
        utterance_id: "utt_test"
      }),
      submitFinalTranscript: async (input) => {
        finalCalls += 1;
        expect(input).toMatchObject({
          labels: { residency: "region-restricted", sensitivity: "personal" },
          routingHints: { prefer_local: true },
          text: "hello there",
          utteranceId: "utt_test"
        });
        expect(events.map((event) => event.type)).toEqual([
          "speech.mark",
          "speech.asr.partial",
          "speech.asr.partial",
          "speech.asr.final",
          "speech.mark"
        ]);
        return {
          assistantFinalText: "visible reply",
          labels: { residency: "global-ok", sensitivity: "internal" }
        };
      },
      turn: 1
    });

    expect(finalCalls).toBe(1);
    expect(result).toMatchObject({
      assistantFinalText: "visible reply",
      transcriptText: "hello there",
      ttsChunkCount: 3
    });
    expect(events.map((event) => event.type)).toEqual([
      "speech.mark",
      "speech.asr.partial",
      "speech.asr.partial",
      "speech.asr.final",
      "speech.mark",
      "speech.mark",
      "speech.tts.chunk",
      "speech.tts.chunk",
      "speech.tts.chunk",
      "speech.mark",
      "speech.mark"
    ]);
    expect(new Set(events
      .filter((event) => event.type === "speech.mark")
      .map((event) => String(event.payload.mark_id)))).toEqual(new Set([
      "asr-start",
      "asr-end",
      "tts-start",
      "tts-end",
      "turn-boundary"
    ]));
    expect(events
      .filter((event) => event.type === "speech.asr.partial" || event.type === "speech.asr.final")
      .map((event) => event.payload.utterance_id)).toEqual(["utt_test", "utt_test", "utt_test"]);
    expect(events
      .filter((event) => event.type === "speech.tts.chunk")
      .map((event) => event.payload.chunk_id)).toEqual([
      "utt_test:tts:001",
      "utt_test:tts:002",
      "utt_test:tts:003"
    ]);
  });

  it("keeps TTS chunks output-only and within the documented mark vocabulary", async () => {
    const events: SpeechEventInput[] = [];
    const transport = new LoopbackVoiceTransport({ ttsChunkChars: 80 });
    const inputTexts: string[] = [];

    await transport.run({
      emit: async (event) => {
        events.push(event);
      },
      labelFinalTranscript: (_text, floor) => floor,
      profile: "cloud-friendly",
      script: normalizeLoopbackScript({ text: "voice question", utterance_id: "utt_output_only" }),
      submitFinalTranscript: async (input) => {
        inputTexts.push(input.text);
        return { assistantFinalText: "assistant says only this" };
      },
      turn: 2
    });

    expect(inputTexts).toEqual(["voice question"]);
    expect(events.filter((event) => event.type === "speech.tts.chunk").map((event) => event.payload.text)).toEqual([
      "assistant says only this"
    ]);
    expect(events.some((event) => event.type === "speech.tts.chunk" && String(event.payload.text).includes("voice question"))).toBe(false);
    const vocabulary = new Set<string>(loopbackMarkVocabulary);
    for (const mark of events.filter((event) => event.type === "speech.mark")) {
      expect(vocabulary.has(String(mark.payload.mark_id))).toBe(true);
    }
  });

  it("derives profile voice label floors and rejects raw audio payloads", () => {
    expect(voiceInputPolicyForProfile("balanced")).toEqual({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      routingHints: { prefer_local: true }
    });
    expect(voiceInputPolicyForProfile("sovereign")).toEqual({
      labels: { residency: "local-only", sensitivity: "personal" }
    });
    expect(voiceInputPolicyForProfile("cloud-friendly")).toEqual({
      labels: { residency: "global-ok", sensitivity: "personal" }
    });
    expect(chunkText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
    expect(() => assertNoRawAudioPayloads([{
      actor: "user",
      labels: { residency: "global-ok", sensitivity: "internal" },
      payload: { audio_ref: "data:audio/wav;base64,AAAA" },
      provenance: "user",
      turn: 1,
      type: "speech.asr.final"
    }])).toThrow(/raw audio/);
  });
});
