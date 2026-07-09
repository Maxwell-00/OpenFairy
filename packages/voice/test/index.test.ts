import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  assertNoRawAudioPayloads,
  clampVoiceFrameLabels,
  chunkText,
  createVoiceDuplexPair,
  createWebSocketVoiceDuplexPair,
  decodeVoiceWebSocketAudioMessage,
  decodeVoiceWebSocketControlMessage,
  decodeVoiceControlFrame,
  defaultVoiceMaxQueueFrames,
  defaultVoiceMaxFrameBytes,
  DuplexVoiceTransport,
  encodeVoiceWebSocketAudioMessage,
  encodeVoiceWebSocketControlMessage,
  encodeVoiceControlFrame,
  InMemoryVoiceDuplexTransport,
  LoopbackVoiceTransport,
  loopbackMarkVocabulary,
  MockSpeechDuplexWorker,
  normalizeDuplexScript,
  normalizeLoopbackScript,
  startLocalVoiceWebSocketEndpoint,
  validateVoiceAudioFrame,
  validateVoiceControlFrame,
  voiceAudioFrameMetadata,
  voiceInputPolicyForProfile,
  voiceWebSocketLoopbackHost,
  WebSocketVoiceTransport,
  type VoiceControlFrame,
  type VoiceAudioFrame,
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

const SOCKET_TEST_TIMEOUT_MS = 5000;

const withDeadline = async <T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = SOCKET_TEST_TIMEOUT_MS
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const waitUntil = async (label: string, predicate: () => boolean): Promise<void> => {
  let interval: ReturnType<typeof setInterval> | undefined;
  try {
    await withDeadline(label, new Promise<void>((resolve) => {
      interval = setInterval(() => {
        if (predicate()) {
          resolve();
        }
      }, 5);
    }));
  } finally {
    if (interval) {
      clearInterval(interval);
    }
  }
};

const waitForSocketClose = (socket: WebSocket, label: string): Promise<{ code: number; reason: string }> =>
  withDeadline(label, new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  }));

const openSocket = (url: string, label: string): Promise<WebSocket> =>
  withDeadline(label, new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
      fn();
    };
    const onOpen = (): void => settle(() => resolve(socket));
    const onError = (error: Error): void => settle(() => reject(error));
    const onClose = (code: number, reason: Buffer): void => {
      if (code !== 1000 && code !== 1001) {
        settle(() => reject(new Error(`socket closed before open: ${code} ${reason.toString()}`)));
      }
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
  }));

const testAudioFrame = (streamId: string, sequence: number, bytes: readonly number[], final = false): VoiceAudioFrame => ({
  data: Uint8Array.from(bytes),
  ...(final ? { final } : {}),
  sequence,
  stream_id: streamId
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

describe("voice websocket frame protocol", () => {
  it("round-trips text control messages and rejects invalid control JSON", () => {
    const frame: VoiceControlFrame = {
      kind: "session.start",
      labels,
      profile: "balanced",
      session_id: "voice_ws_session",
      stream_id: "stream_ws"
    };
    const encoded = encodeVoiceWebSocketControlMessage(frame);

    expect(decodeVoiceWebSocketControlMessage(encoded)).toEqual(frame);
    expect(encoded).toContain("\"kind\": \"session.start\"");
    expect(() => decodeVoiceWebSocketControlMessage("{\"kind\":\"voice.ws.fake\"}")).toThrow(/invalid voice control frame/);
    expect(() => decodeVoiceWebSocketControlMessage("{not json")).toThrow(/invalid voice control frame JSON/);
  });

  it("round-trips binary audio messages with deterministic header framing and max-size guard", () => {
    const frame = testAudioFrame("stream_ws_audio", 9, [1, 2, 3, 4], true);
    const encoded = encodeVoiceWebSocketAudioMessage(frame);
    const headerLength = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(0, false);
    const header = JSON.parse(new TextDecoder().decode(encoded.slice(4, 4 + headerLength))) as Record<string, unknown>;

    expect(header).toEqual({
      final: true,
      seq: 9,
      stream_id: "stream_ws_audio"
    });
    expect(decodeVoiceWebSocketAudioMessage(encoded)).toEqual(frame);
    expect([...encodeVoiceWebSocketAudioMessage(decodeVoiceWebSocketAudioMessage(encoded))]).toEqual([...encoded]);
    expect(JSON.stringify(header)).not.toContain("AQID");
    expect(() => encodeVoiceWebSocketAudioMessage({
      data: new Uint8Array(defaultVoiceMaxFrameBytes + 1),
      sequence: 0,
      stream_id: "stream_oversize"
    })).toThrow(/invalid voice websocket audio frame/);
    expect(() => decodeVoiceWebSocketAudioMessage(new Uint8Array([0, 0, 0, 0]))).toThrow(/invalid header length/);
    expect(() => decodeVoiceWebSocketAudioMessage(encodeVoiceWebSocketAudioMessage({
      data: new Uint8Array(defaultVoiceMaxFrameBytes + 1),
      sequence: 0,
      stream_id: "stream_oversize"
    }, { maxFrameBytes: defaultVoiceMaxFrameBytes + 1 }), { maxFrameBytes: defaultVoiceMaxFrameBytes })).toThrow(/invalid voice websocket audio frame/);
  });
});

describe("WebSocketVoiceDuplexTransport", () => {
  it("binds loopback only, enforces token auth, and sends no frames to unauthorized clients", async () => {
    const endpoint = await startLocalVoiceWebSocketEndpoint({ token: "voice-ws-token" });
    const noTokenSocket = new WebSocket(endpoint.url);
    const wrongUrl = new URL(endpoint.url);
    wrongUrl.searchParams.set("token", "wrong");
    const wrongTokenSocket = new WebSocket(wrongUrl.toString());
    const noTokenClosePromise = waitForSocketClose(noTokenSocket, "no-token close");
    const wrongTokenClosePromise = waitForSocketClose(wrongTokenSocket, "wrong-token close");

    try {
      noTokenSocket.once("open", () => {
        noTokenSocket.send(encodeVoiceWebSocketControlMessage(partialFrame("unauthorized")));
      });
      wrongTokenSocket.once("open", () => {
        wrongTokenSocket.send(encodeVoiceWebSocketControlMessage(partialFrame("unauthorized")));
      });
      const [noTokenClose, wrongTokenClose] = await Promise.all([
        noTokenClosePromise,
        wrongTokenClosePromise
      ]);

      expect(endpoint.host).toBe(voiceWebSocketLoopbackHost);
      expect(endpoint.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/voice$/);
      expect(noTokenClose.code).toBe(4401);
      expect(wrongTokenClose.code).toBe(4401);
      expect(endpoint.rejectedConnections()).toBe(2);
      expect(endpoint.acceptedConnections()).toHaveLength(0);
    } finally {
      noTokenSocket.terminate();
      wrongTokenSocket.terminate();
      await endpoint.close();
    }
  });

  it("connects, exchanges control and binary audio frames, reports malformed messages safely, and closes cleanly", async () => {
    const pair = await createWebSocketVoiceDuplexPair({ maxQueueFrames: defaultVoiceMaxQueueFrames });
    const controls: VoiceControlFrame[] = [];
    const audio: VoiceAudioFrame[] = [];
    let closed = false;

    try {
      pair.server.onControl((frame) => {
        controls.push(frame);
      });
      pair.server.onAudio((frame) => {
        audio.push(frame);
      });

      await pair.client.sendControl(partialFrame("one"));
      await pair.client.sendAudio(testAudioFrame("stream_pair", 0, [1, 2, 3]));
      await waitUntil("server received websocket frames", () => controls.length === 1 && audio.length === 1);

      expect(controls).toEqual([partialFrame("one")]);
      expect(audio).toEqual([testAudioFrame("stream_pair", 0, [1, 2, 3])]);
      expect(pair.websocketFrameCounts()).toMatchObject({
        "audio.received": 1,
        "audio.sent": 1,
        "control.received": 1,
        "control.sent": 1
      });
      await pair.close("test done");
      closed = true;
      await expect(pair.client.sendControl(partialFrame("closed"))).rejects.toThrow(/closed/);
    } finally {
      if (!closed) {
        await pair.close("test done");
      }
    }
  });

  it("turns malformed raw websocket messages into redacted error control frames", async () => {
    const endpoint = await startLocalVoiceWebSocketEndpoint({ token: "voice-ws-malformed" });
    const url = new URL(endpoint.url);
    url.searchParams.set("token", "voice-ws-malformed");
    const socket = await openSocket(url.toString(), "malformed socket open");
    const errors: VoiceControlFrame[] = [];
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        const frame = decodeVoiceWebSocketControlMessage(data.toString());
        if (frame.kind === "error") {
          errors.push(frame);
        }
      }
    });

    try {
      socket.send("{\"kind\":\"asr.partial\",\"text\":\"sk_test_1234567890abcdef\"");
      socket.send(Uint8Array.from([0, 0, 0, 200, 1, 2, 3]), { binary: true });
      await waitUntil("redacted malformed websocket errors", () => errors.length === 2);

      expect(errors.map((frame) => frame.kind)).toEqual(["error", "error"]);
      expect(errors.map((frame) => frame.kind === "error" ? frame.code : "")).toEqual([
        "invalid_control_frame",
        "invalid_audio_frame"
      ]);
      expect(JSON.stringify(errors)).not.toContain("sk_test_1234567890abcdef");
      expect(endpoint.acceptedConnections()).toHaveLength(1);
    } finally {
      socket.close(1000, "done");
      await endpoint.close();
    }
  });

  it("keeps per-stream audio FIFO while allowing deterministic interleave across streams", async () => {
    const pair = await createWebSocketVoiceDuplexPair();
    const delivered: string[] = [];
    const byStream = new Map<string, number[]>();

    try {
      pair.server.onAudio(async (frame) => {
        if (frame.stream_id === "stream_a" && frame.sequence === 0) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        const stream = byStream.get(frame.stream_id) ?? [];
        stream.push(frame.sequence);
        byStream.set(frame.stream_id, stream);
        delivered.push(`${frame.stream_id}:${frame.sequence}`);
      });

      for (const frame of [
        testAudioFrame("stream_a", 0, [1]),
        testAudioFrame("stream_b", 0, [2]),
        testAudioFrame("stream_a", 1, [3]),
        testAudioFrame("stream_b", 1, [4]),
        testAudioFrame("stream_a", 2, [5]),
        testAudioFrame("stream_b", 2, [6])
      ]) {
        await pair.client.sendAudio(frame);
      }
      await waitUntil("two websocket audio streams delivered", () => delivered.length === 6);

      expect(byStream.get("stream_a")).toEqual([0, 1, 2]);
      expect(byStream.get("stream_b")).toEqual([0, 1, 2]);
      expect(delivered.indexOf("stream_b:0")).toBeLessThan(delivered.indexOf("stream_a:0"));
      expect(new Set(delivered.map((entry) => entry.split(":")[0]))).toEqual(new Set(["stream_a", "stream_b"]));
      expect(JSON.stringify(delivered)).not.toContain("AQID");
    } finally {
      await pair.close("two-stream done");
    }
  });
});

describe("WebSocketVoiceTransport", () => {
  it("runs a websocket duplex script through one final transcript callback", async () => {
    const events: SpeechEventInput[] = [];
    const transport = new WebSocketVoiceTransport({ ttsChunkChars: 7 });
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
        partials: ["ws"],
        text: "websocket request",
        utterance_id: "utt_ws_transport"
      }),
      submitFinalTranscript: async (input) => {
        finalCalls += 1;
        expect(input).toMatchObject({
          labels: { residency: "region-restricted", sensitivity: "personal" },
          routingHints: { prefer_local: true },
          text: "websocket request"
        });
        return { assistantFinalText: "visible websocket reply" };
      },
      turn: 5
    });

    expect(finalCalls).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(result.frameCounts).toMatchObject({
      "control.asr.final": 1,
      "control.asr.partial": 1,
      "control.tts.request": 1,
      audio: 3
    });
    expect(result.websocketFrameCounts).toMatchObject({
      "audio.received": 3,
      "audio.sent": 3
    });
    expect(events.filter((event) => event.type === "speech.asr.final")).toHaveLength(1);
    expect(events.find((event) => event.type === "speech.asr.final")).toMatchObject({
      labels: { residency: "region-restricted", sensitivity: "personal" },
      payload: { text: "websocket request", utterance_id: "utt_ws_transport" }
    });
    expect(events.filter((event) => event.type === "speech.tts.chunk").map((event) => event.payload.text)).toEqual([
      "visible",
      " websoc",
      "ket rep",
      "ly"
    ]);
    assertNoRawAudioPayloads(events);
  });

  it("leaves a clean websocket speech-only event stream when ASR is cancelled before final", async () => {
    const events: SpeechEventInput[] = [];
    const transport = new WebSocketVoiceTransport();
    let finalCalls = 0;

    const result = await transport.run({
      emit: async (event) => {
        events.push(event);
      },
      profile: "balanced",
      script: normalizeDuplexScript({
        cancel_asr_before_final: true,
        partials: ["cancel ws"],
        text: "this should not become a turn",
        utterance_id: "utt_ws_cancel"
      }),
      submitFinalTranscript: async () => {
        finalCalls += 1;
        return { assistantFinalText: "should not happen" };
      },
      turn: 6
    });

    expect(result.cancelled).toBe(true);
    expect(finalCalls).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      "speech.mark",
      "speech.asr.partial",
      "speech.mark"
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ mark_id: "asr-cancelled" });
    assertNoRawAudioPayloads(events);
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

  it("keeps the in-memory transport usable without opening sockets or OS audio devices", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:(dgram|child_process)/);
    expect(source).not.toMatch(/microphone|speaker|audio device/i);
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
