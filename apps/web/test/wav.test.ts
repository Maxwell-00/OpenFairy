import { describe, expect, it, vi } from "vitest";

import { consumeProjectedEvent, createPlaybackController, parseSessionHash, sessionHash } from "../app.js";
import { reduceRecorderState, TargetSampleClock } from "../recorder.js";
import {
  COUNTDOWN_SAMPLES,
  MAXIMUM_SAMPLES,
  WARNING_SAMPLES,
  encodePcm16Wav,
  floatToPcm16,
  resampleMonoTo16k
} from "../wav.js";

describe("Web voice pure modules", () => {
  it("encodes a canonical deterministic PCM16 WAV", () => {
    const wav = encodePcm16Wav(new Float32Array([-2, -1, 0, 0.5, 1, 2]));
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect([...wav]).toEqual([...encodePcm16Wav(new Float32Array([-2, -1, 0, 0.5, 1, 2]))]);
    expect([floatToPcm16(-2), floatToPcm16(-1), floatToPcm16(1), floatToPcm16(2)]).toEqual([-32_768, -32_768, 32_767, 32_767]);
  });

  it("resamples non-16 kHz source deterministically and caps output", () => {
    const source = Float32Array.from({ length: 48_000 }, (_, index) => index / 48_000);
    const output = resampleMonoTo16k(source, 48_000);
    expect(output).toHaveLength(16_000);
    expect(output[1]).toBeCloseTo(source[3] ?? 0);
    expect(resampleMonoTo16k(new Float32Array(MAXIMUM_SAMPLES + 10), 16_000)).toHaveLength(MAXIMUM_SAMPLES);
  });

  it("uses target samples for warnings, countdown, and exactly-once auto-stop", () => {
    const stop = vi.fn();
    const clock = new TargetSampleClock({ onAutoStop: stop });
    clock.append(WARNING_SAMPLES);
    expect(clock.snapshot()).toMatchObject({ warning: true, countdown: false });
    clock.append(COUNTDOWN_SAMPLES - WARNING_SAMPLES);
    expect(clock.snapshot().countdown).toBe(true);
    expect(clock.append(MAXIMUM_SAMPLES)).toBe(MAXIMUM_SAMPLES - COUNTDOWN_SAMPLES);
    expect(clock.snapshot().samples).toBe(MAXIMUM_SAMPLES);
    expect(clock.append(1_000)).toBe(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the bounded UI transition reducer deterministic", () => {
    expect(reduceRecorderState("ready", "start")).toBe("recording");
    expect(reduceRecorderState("recording", "finalize")).toBe("uploading");
    expect(reduceRecorderState("uploading", "uploaded")).toBe("transcribing");
    expect(reduceRecorderState("playing", "stop")).toBe("playback-ready");
    expect(reduceRecorderState("ready", "unknown")).toBe("ready");
  });

  it("parses only canonical session hash routes", () => {
    const sid = "ses_01J00000000000000000000000";
    expect(parseSessionHash(sessionHash(sid))).toBe(sid);
    expect(parseSessionHash(`#/${sid}?token=bad`)).toBeUndefined();
    expect(parseSessionHash("#/sessions/../../bad")).toBeUndefined();
  });

  it("consumes only provider-neutral replay fields", () => {
    let view = { assistant: "", transcript: "" };
    view = consumeProjectedEvent(view, { sid: "ses_01J00000000000000000000000", type: "speech.asr.final", payload: { text: "hello" } });
    view = consumeProjectedEvent(view, { type: "turn.final", payload: { text: "answer", model_trace: "hidden" } });
    view = consumeProjectedEvent(view, { type: "speech.tts.chunk", payload: { audio_ref: "art_0123456789abcdef0123", path: "hidden" } });
    expect(view).toEqual({
      assistant: "answer",
      audioRef: "art_0123456789abcdef0123",
      sid: "ses_01J00000000000000000000000",
      transcript: "hello"
    });
  });

  it("stops playback locally and revokes the object URL", () => {
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const revoked: string[] = [];
    const player = { currentTime: 7, pause, removeAttribute, src: "" } as unknown as HTMLAudioElement;
    const controller = createPlaybackController(player, (url) => revoked.push(url));
    controller.replace("blob:first");
    controller.replace("blob:second");
    controller.stop();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(revoked).toEqual(["blob:first", "blob:second"]);
  });
});
