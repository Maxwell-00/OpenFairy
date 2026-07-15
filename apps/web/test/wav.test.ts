import { describe, expect, it, vi } from "vitest";

import {
  beginBrowserSessionOperation,
  beginBrowserSessionCreate,
  acceptCreatedBrowserSession,
  canChangeSelectedSession,
  completeBrowserReplay,
  consumeProjectedEvent,
  createBrowserSessionState,
  createPlaybackController,
  invalidateBrowserSessionOperation,
  isCurrentBrowserSessionBinding,
  noteBrowserReplayAudio,
  parseSessionHash,
  projectedEventFailureMessage,
  projectedFrameMatchesBrowserSession,
  replaceBrowserPlaybackForBinding,
  selectBrowserSession,
  sessionHash,
  submitBrowserAsrForUpload,
  voiceAckFailureMessage
} from "../app.js";
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
    expect(reduceRecorderState("uploading", "fail")).toBe("failed");
    expect(reduceRecorderState("failed", "reset")).toBe("ready");
    expect(reduceRecorderState("playing", "stop")).toBe("ready");
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

  it("binds an operation to one immutable session generation", () => {
    const state = createBrowserSessionState();
    const sessionA = selectBrowserSession(state, "ses_01J00000000000000000000000", false);
    const operation = beginBrowserSessionOperation(state);
    expect(operation).toEqual(sessionA);
    expect(canChangeSelectedSession("recording")).toBe(false);
    expect(canChangeSelectedSession("uploading")).toBe(false);
    selectBrowserSession(state, "ses_01J00000000000000000000001", false);
    expect(operation?.sid).toBe("ses_01J00000000000000000000000");
    expect(isCurrentBrowserSessionBinding(state, operation)).toBe(false);
    expect(projectedFrameMatchesBrowserSession(state, { sid: operation?.sid, type: "turn.final" })).toBe(false);
  });

  it("discards a deferred upload response after its session generation becomes stale", async () => {
    const state = createBrowserSessionState();
    const sessionA = selectBrowserSession(state, "ses_01J00000000000000000000000", false);
    const operation = beginBrowserSessionOperation(state);
    if (!operation) throw new Error("expected a bound operation");
    let releaseUpload = (artifactId: string): void => { void artifactId; };
    const uploadResponse = new Promise<string>((resolvePromise) => { releaseUpload = resolvePromise; });
    const sent: Array<{ audio_ref: string; op: "voice.asr"; sid: string }> = [];
    const completion = uploadResponse.then((artifactId) => submitBrowserAsrForUpload(state, operation, artifactId, (frame) => sent.push(frame)));
    expect(canChangeSelectedSession("uploading")).toBe(false);
    selectBrowserSession(state, "ses_01J00000000000000000000001", false);
    releaseUpload("art_0123456789abcdef0123");
    await expect(completion).resolves.toBe(false);
    expect(sent).toEqual([]);
    expect(sessionA.sid).not.toBe(state.sid);
  });

  it("accepts session.created only for the current create action", () => {
    const state = createBrowserSessionState();
    expect(acceptCreatedBrowserSession(state, "ses_01J00000000000000000000000")).toBeUndefined();
    const generation = beginBrowserSessionCreate(state);
    expect(acceptCreatedBrowserSession(state, "ses_01J00000000000000000000001")).toEqual({
      generation,
      sid: "ses_01J00000000000000000000001"
    });
    expect(acceptCreatedBrowserSession(state, "ses_01J00000000000000000000002")).toBeUndefined();
  });

  it("ignores late old-session frames and stale MP3 responses", async () => {
    const state = createBrowserSessionState();
    const sessionA = selectBrowserSession(state, "ses_01J00000000000000000000000", false);
    let releaseSpeech = (url: string): void => { void url; };
    const speechResponse = new Promise<string>((resolvePromise) => { releaseSpeech = resolvePromise; });
    const replacements: string[] = [];
    const completion = speechResponse.then((url) => replaceBrowserPlaybackForBinding(state, sessionA, url, (currentUrl) => replacements.push(currentUrl)));
    selectBrowserSession(state, "ses_01J00000000000000000000001", false);
    releaseSpeech("blob:late-audio-a");
    await expect(completion).resolves.toBe(false);
    expect(replacements).toEqual([]);
    expect(projectedFrameMatchesBrowserSession(state, { sid: sessionA.sid, type: "speech.tts.chunk" })).toBe(false);
    expect(isCurrentBrowserSessionBinding(state, sessionA)).toBe(false);
    const view = { assistant: "B answer", sid: "ses_01J00000000000000000000001", transcript: "B transcript" };
    expect(consumeProjectedEvent(view, { sid: sessionA.sid, type: "turn.final", payload: { text: "late A" } }, view.sid)).toBe(view);
  });

  it("coalesces replay to the latest speech artifact exactly once", () => {
    const state = createBrowserSessionState();
    const binding = selectBrowserSession(state, "ses_01J00000000000000000000000", true);
    noteBrowserReplayAudio(state, binding, "art_00000000000000000000");
    noteBrowserReplayAudio(state, binding, "art_11111111111111111111");
    expect(completeBrowserReplay(state, binding)).toBe("art_11111111111111111111");
    expect(completeBrowserReplay(state, binding)).toBeUndefined();
  });

  it("maps bounded failures and resets locally without private detail", () => {
    const poisoned = {
      assistant_final_text: "visible answer",
      endpoint_profile: "POISON_ENDPOINT",
      error_status: "request_failed",
      kind: "ack",
      op: "voice.asr",
      provider_id: "POISON_PROVIDER"
    };
    expect(voiceAckFailureMessage(poisoned)).toBe("The text answer is ready, but speech playback failed.");
    expect(voiceAckFailureMessage({ error_status: "asr_route_denied", kind: "ack", op: "voice.asr" })).toBe("Voice routing is unavailable for this recording.");
    expect(voiceAckFailureMessage({ error_status: "asr_input_invalid", kind: "ack", op: "voice.asr" })).toBe("The recording could not be processed.");
    expect(voiceAckFailureMessage({ cancelled: true, error_status: "asr_cancelled", kind: "ack", op: "voice.asr" })).toBe("Voice processing was cancelled.");
    expect(voiceAckFailureMessage({ asr_final_count: 1, error_status: "none", kind: "ack", model_request_count: 1, op: "voice.asr", turn_input_count: 1 })).toBeUndefined();
    expect(projectedEventFailureMessage({ type: "progress.update", payload: { stage: "voice.tts.failed" } })).toBe("The text answer is ready, but speech playback failed.");
    expect(JSON.stringify([voiceAckFailureMessage(poisoned)])).not.toMatch(/POISON_ENDPOINT|POISON_PROVIDER/);
    const state = createBrowserSessionState();
    const before = selectBrowserSession(state, "ses_01J00000000000000000000000", false);
    beginBrowserSessionOperation(state);
    const after = invalidateBrowserSessionOperation(state);
    expect(after?.sid).toBe(before.sid);
    expect(after?.generation).toBeGreaterThan(before.generation);
    expect(state.operation).toBeUndefined();
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
