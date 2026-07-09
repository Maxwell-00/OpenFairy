import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertNoRawAudioPayloads,
  clampVoiceFrameLabels,
  chunkText,
  createVoiceDuplexPair,
  decodeVoiceControlFrame,
  defaultVoiceMaxFrameBytes,
  DuplexVoiceTransport,
  encodeVoiceControlFrame,
  InMemoryVoiceDuplexTransport,
  LoopbackVoiceTransport,
  loopbackMarkVocabulary,
  MockSpeechDuplexWorker,
  normalizeDuplexScript,
  normalizeLoopbackScript,
  validateVoiceAudioFrame,
  validateVoiceControlFrame,
  voiceAudioFrameMetadata,
  voiceInputPolicyForProfile,
  type VoiceControlFrame,
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

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;

const labels = { residency: "global-ok", sensitivity: "public" } as const;

const partialFrame = (text: string): VoiceControlFrame => ({
  kind: "asr.partial",
  text,
  utterance_id: "utt_transport"
});

describe("voice duplex frame protocol", () => {
  it("validates golden control-frame fixtures and fails closed on invalid fixtures", () => {
    const valid = fixture("voice-control.valid.json");
    expect(Array.isArray(valid)).toBe(true);
    for (const frame of valid as unknown[]) {
      expect(validateVoiceControlFrame(frame)).toMatchObject({ ok: true });
    }

    const invalid = fixture("voice-control.invalid.json");
    expect(Array.isArray(invalid)).toBe(true);
    for (const frame of invalid as unknown[]) {
      expect(validateVoiceControlFrame(frame)).toMatchObject({ ok: false });
    }
  });

  it("round-trips stable JSON control frames", () => {
    const frame: VoiceControlFrame = {
      kind: "utterance.start",
      audio_ref: "duplex://audio/utt_stable",
      labels,
      stream_id: "stream_stable",
      utterance_id: "utt_stable"
    };

    expect(encodeVoiceControlFrame(frame)).toBe([
      "{",
      "  \"audio_ref\": \"duplex://audio/utt_stable\",",
      "  \"kind\": \"utterance.start\",",
      "  \"labels\": {",
      "    \"residency\": \"global-ok\",",
      "    \"sensitivity\": \"public\"",
      "  },",
      "  \"stream_id\": \"stream_stable\",",
      "  \"utterance_id\": \"utt_stable\"",
      "}\n"
    ].join("\n"));
    expect(decodeVoiceControlFrame(encodeVoiceControlFrame(frame))).toEqual(frame);
    expect(() => decodeVoiceControlFrame("{\"kind\":\"unknown\"}")).toThrow(/invalid voice control frame/);
  });

  it("keeps binary audio as guarded in-memory frames and exposes metadata only", () => {
    const frame = {
      data: Uint8Array.from([1, 2, 3, 4]),
      final: true,
      sequence: 7,
      stream_id: "stream_audio"
    };

    expect(validateVoiceAudioFrame(frame)).toMatchObject({ ok: true });
    expect(validateVoiceAudioFrame({ ...frame, data: new Uint8Array(defaultVoiceMaxFrameBytes + 1) })).toMatchObject({ ok: false });
    expect(voiceAudioFrameMetadata(frame)).toEqual({
      byte_length: 4,
      final: true,
      sequence: 7,
      stream_id: "stream_audio"
    });
    expect(JSON.stringify(voiceAudioFrameMetadata(frame))).not.toContain("AQID");
    expect(JSON.stringify(voiceAudioFrameMetadata(frame))).not.toContain("data");
  });

  it("clamps advisory frame labels so they can raise but never lower the voice floor", () => {
    expect(clampVoiceFrameLabels(
      { residency: "region-restricted", sensitivity: "personal" },
      { residency: "global-ok", sensitivity: "public" }
    )).toEqual({ residency: "region-restricted", sensitivity: "personal" });
    expect(clampVoiceFrameLabels(
      { residency: "region-restricted", sensitivity: "personal" },
      { residency: "local-only", sensitivity: "secret" }
    )).toEqual({ residency: "local-only", sensitivity: "secret" });
  });
});

describe("InMemoryVoiceDuplexTransport", () => {
  it("delivers control and audio frames in FIFO order", async () => {
    const [client, worker] = createVoiceDuplexPair();
    const controls: string[] = [];
    const audio: number[] = [];
    worker.onControl((frame) => {
      if (frame.kind === "asr.partial") {
        controls.push(frame.text);
      }
    });
    worker.onAudio((frame) => {
      audio.push(frame.sequence);
    });

    await client.sendControl(partialFrame("one"));
    await client.sendControl(partialFrame("two"));
    await client.sendAudio({ data: Uint8Array.from([1]), sequence: 0, stream_id: "stream_fifo" });
    await client.sendAudio({ data: Uint8Array.from([2]), sequence: 1, stream_id: "stream_fifo" });

    expect(controls).toEqual(["one", "two"]);
    expect(audio).toEqual([0, 1]);
  });

  it("rejects sends after close and reports deterministic queue overflow", async () => {
    const [client, worker] = createVoiceDuplexPair({ maxQueueFrames: 1 });
    let release!: () => void;
    worker.onControl(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    const first = client.sendControl(partialFrame("hold"));
    await Promise.resolve();
    await expect(client.sendControl(partialFrame("overflow"))).rejects.toThrow(/queue overflow/);
    release();
    await first;

    await client.close("done");
    await expect(client.sendControl(partialFrame("closed"))).rejects.toThrow(/closed/);
  });

  it("has no socket, network, or OS audio dependencies", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:(net|dgram|http|https|child_process)/);
    expect(source).not.toContain("WebSocket");
    expect(new InMemoryVoiceDuplexTransport()).toBeInstanceOf(InMemoryVoiceDuplexTransport);
  });
});

describe("MockSpeechDuplexWorker", () => {
  it("emits deterministic ASR partial/final frames and TTS chunks", async () => {
    const [coordinator, workerSide] = createVoiceDuplexPair();
    const frames: VoiceControlFrame[] = [];
    new MockSpeechDuplexWorker(workerSide, normalizeLoopbackScript({
      partials: ["du", "duplex"],
      text: "duplex hello",
      utterance_id: "utt_worker"
    }), { ttsChunkChars: 6 });
    coordinator.onControl((frame) => {
      frames.push(frame);
    });

    await coordinator.sendControl({ kind: "session.start", labels, stream_id: "stream_worker" });
    await coordinator.sendControl({
      audio_ref: "duplex://audio/utt_worker",
      kind: "utterance.start",
      labels,
      stream_id: "stream_worker",
      utterance_id: "utt_worker"
    });
    await coordinator.sendAudio({ data: Uint8Array.from([1, 2]), sequence: 0, stream_id: "stream_worker" });
    await coordinator.sendAudio({ data: Uint8Array.from([3]), final: true, sequence: 1, stream_id: "stream_worker" });
    await coordinator.sendControl({
      kind: "tts.request",
      labels,
      text: "visible reply",
      utterance_id: "utt_worker"
    });

    expect(frames.map((frame) => frame.kind)).toEqual([
      "mark",
      "asr.partial",
      "asr.partial",
      "asr.final",
      "mark",
      "mark",
      "tts.chunk",
      "tts.chunk",
      "tts.chunk",
      "mark",
      "mark"
    ]);
    expect(frames.find((frame) => frame.kind === "asr.final")).toMatchObject({
      text: "duplex hello",
      utterance_id: "utt_worker"
    });
    expect(frames.filter((frame) => frame.kind === "tts.chunk").map((frame) => frame.text)).toEqual(["visibl", "e repl", "y"]);
  });

  it("suppresses ASR final and pending TTS chunks after protocol-level cancel", async () => {
    const [coordinator, workerSide] = createVoiceDuplexPair();
    const frames: VoiceControlFrame[] = [];
    const worker = new MockSpeechDuplexWorker(workerSide, normalizeLoopbackScript({
      partials: ["cancel"],
      text: "cancelled secret sk_test_1234567890abcdef",
      utterance_id: "utt_cancel"
    }), { pauseTtsAfterChunks: 1, ttsChunkChars: 4 });
    coordinator.onControl((frame) => {
      frames.push(frame);
    });

    await coordinator.sendControl({
      audio_ref: "duplex://audio/utt_cancel",
      kind: "utterance.start",
      labels,
      stream_id: "stream_cancel",
      utterance_id: "utt_cancel"
    });
    await coordinator.sendControl({ kind: "cancel", reason: "user stopped", target: "asr" });
    await coordinator.sendAudio({ data: Uint8Array.from([1]), final: true, sequence: 0, stream_id: "stream_cancel" });
    expect(frames.some((frame) => frame.kind === "asr.final")).toBe(false);
    expect(frames).toContainEqual({
      kind: "mark",
      mark_id: "asr-cancelled",
      position_ms: 0,
      utterance_id: "utt_cancel"
    });

    await coordinator.sendControl({
      kind: "tts.request",
      labels,
      text: "first second",
      utterance_id: "utt_cancel"
    });
    await coordinator.sendControl({ kind: "cancel", reason: "user stopped", target: "tts" });
    await worker.flushPendingTts();
    expect(frames.filter((frame) => frame.kind === "tts.chunk").map((frame) => frame.text)).toEqual(["firs"]);
    expect(JSON.stringify(frames.filter((frame) => frame.kind === "error"))).not.toContain("sk_test_1234567890abcdef");

    const [errorCoordinator, errorWorkerSide] = createVoiceDuplexPair();
    const errorFrames: VoiceControlFrame[] = [];
    new MockSpeechDuplexWorker(errorWorkerSide, normalizeLoopbackScript({
      text: "secret sk_test_1234567890abcdef",
      utterance_id: "utt_error"
    }));
    errorCoordinator.onControl((frame) => {
      errorFrames.push(frame);
    });
    await errorCoordinator.sendAudio({ data: Uint8Array.from([1]), final: true, sequence: 0, stream_id: "stream_error" });
    expect(errorFrames.find((frame) => frame.kind === "error")).toMatchObject({
      code: "no_active_utterance",
      message: "speech worker error"
    });
    expect(JSON.stringify(errorFrames)).not.toContain("sk_test_1234567890abcdef");
  });
});

describe("DuplexVoiceTransport", () => {
  it("runs a duplex script through one final transcript callback", async () => {
    const events: SpeechEventInput[] = [];
    const transport = new DuplexVoiceTransport({ ttsChunkChars: 7 });
    let finalCalls = 0;

    const result = await transport.run({
      emit: async (event) => {
        events.push(event);
      },
      labelFinalTranscript: (_text, floor) => floor,
      profile: "balanced",
      script: normalizeDuplexScript({
        audio_frame_bytes: [3, 2],
        frame_labels: { residency: "global-ok", sensitivity: "public" },
        partials: ["duplex"],
        text: "duplex request",
        utterance_id: "utt_duplex"
      }),
      submitFinalTranscript: async (input) => {
        finalCalls += 1;
        expect(input).toMatchObject({
          labels: { residency: "region-restricted", sensitivity: "personal" },
          routingHints: { prefer_local: true },
          text: "duplex request"
        });
        return { assistantFinalText: "visible duplex reply" };
      },
      turn: 3
    });

    expect(finalCalls).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(result.frameCounts).toMatchObject({
      "control.asr.final": 1,
      "control.asr.partial": 1,
      "control.tts.request": 1,
      audio: 3
    });
    expect(events.filter((event) => event.type === "speech.asr.partial")).toHaveLength(1);
    expect(events.filter((event) => event.type === "speech.asr.final")).toHaveLength(1);
    expect(events.filter((event) => event.type === "speech.tts.chunk").map((event) => event.payload.text)).toEqual([
      "visible",
      " duplex",
      " reply"
    ]);
    assertNoRawAudioPayloads(events);
  });

  it("leaves a clean speech-only event stream when ASR is cancelled before final", async () => {
    const events: SpeechEventInput[] = [];
    const transport = new DuplexVoiceTransport();
    let finalCalls = 0;

    const result = await transport.run({
      emit: async (event) => {
        events.push(event);
      },
      profile: "balanced",
      script: normalizeDuplexScript({
        cancel_asr_before_final: true,
        partials: ["cancel me"],
        text: "this should not enter a turn",
        utterance_id: "utt_cancelled_duplex"
      }),
      submitFinalTranscript: async () => {
        finalCalls += 1;
        return { assistantFinalText: "should not happen" };
      },
      turn: 4
    });

    expect(result.cancelled).toBe(true);
    expect(finalCalls).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      "speech.mark",
      "speech.asr.partial",
      "speech.mark"
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ mark_id: "asr-cancelled" });
  });
});
