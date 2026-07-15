// @ts-check

import {
  COUNTDOWN_SAMPLES,
  MAXIMUM_SAMPLES,
  TARGET_SAMPLE_RATE,
  WARNING_SAMPLES,
  concatenateBlocks,
  encodePcm16Wav,
  resampleMonoTo16k
} from "./wav.js";

export class TargetSampleClock {
  /** @param {{ onAutoStop: () => void }} options */
  constructor(options) {
    this.onAutoStop = options.onAutoStop;
    this.samples = 0;
    this.autoStopped = false;
  }

  /** @param {number} count */
  append(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Target sample increment must be a non-negative integer");
    }
    if (this.autoStopped) {
      return 0;
    }
    const accepted = Math.min(count, MAXIMUM_SAMPLES - this.samples);
    this.samples += accepted;
    if (this.samples === MAXIMUM_SAMPLES && !this.autoStopped) {
      this.autoStopped = true;
      this.onAutoStop();
    }
    return accepted;
  }

  snapshot() {
    return {
      countdown: this.samples >= COUNTDOWN_SAMPLES,
      elapsedSeconds: this.samples / TARGET_SAMPLE_RATE,
      remainingSeconds: Math.max(0, (MAXIMUM_SAMPLES - this.samples) / TARGET_SAMPLE_RATE),
      samples: this.samples,
      warning: this.samples >= WARNING_SAMPLES
    };
  }
}

/** @param {string} state @param {string} action */
export const reduceRecorderState = (state, action) => {
  /** @type {Record<string, Record<string, string>>} */
  const transitions = {
    disconnected: { connect: "ready" },
    ready: { start: "recording", disconnect: "disconnected" },
    recording: { finalize: "uploading", discard: "ready" },
    uploading: { uploaded: "transcribing", fail: "error" },
    transcribing: { final: "thinking", fail: "error" },
    thinking: { final: "synthesizing", fail: "error" },
    synthesizing: { audio: "playing", text: "ready", fail: "ready" },
    playing: { stop: "playback-ready", ended: "playback-ready" },
    "playback-ready": { play: "playing", start: "recording" },
    error: { reset: "ready", disconnect: "disconnected" }
  };
  return transitions[state]?.[action] ?? state;
};

export class BrowserPttRecorder {
  /** @param {{ onDiscard?: () => Promise<void> | void, onFinalize: (wav: Uint8Array, details: { sampleCount: number }) => Promise<void> | void, onTick?: (snapshot: ReturnType<TargetSampleClock["snapshot"]>) => void }} options */
  constructor(options) {
    this.options = options;
    /** @type {AudioContext | undefined} */
    this.context = undefined;
    /** @type {MediaStream | undefined} */
    this.stream = undefined;
    /** @type {AudioWorkletNode | undefined} */
    this.node = undefined;
    /** @type {MediaStreamAudioSourceNode | undefined} */
    this.source = undefined;
    /** @type {Float32Array[]} */
    this.blocks = [];
    this.sourceSamples = 0;
    this.targetSamples = 0;
    this.finalizing = false;
    this.clock = new TargetSampleClock({ onAutoStop: () => { void this.finalizeAndSend(); } });
  }

  async start() {
    if (this.context || this.finalizing) {
      throw new Error("A recording is already active");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule("/web/audio-worklet.js");
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "fairy-pcm-capture");
      this.node.port.onmessage = (event) => this.acceptBlock(event.data);
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
    } catch (error) {
      await this.cleanupMedia();
      throw error;
    }
  }

  /** @param {unknown} value */
  acceptBlock(value) {
    if (!(value instanceof Float32Array) || !this.context || this.finalizing) {
      return;
    }
    this.blocks.push(value.slice());
    this.sourceSamples += value.length;
    const nextTarget = Math.min(MAXIMUM_SAMPLES, Math.floor(this.sourceSamples * TARGET_SAMPLE_RATE / this.context.sampleRate));
    const increment = Math.max(0, nextTarget - this.targetSamples);
    this.targetSamples += this.clock.append(increment);
    this.options.onTick?.(this.clock.snapshot());
  }

  async finalizeAndSend() {
    if (this.finalizing || !this.context) {
      return;
    }
    this.finalizing = true;
    const sourceRate = this.context.sampleRate;
    const blocks = this.blocks;
    await this.cleanupMedia();
    try {
      if (blocks.reduce((total, block) => total + block.length, 0) < 1) {
        await this.options.onDiscard?.();
        return;
      }
      const samples = resampleMonoTo16k(concatenateBlocks(blocks), sourceRate, MAXIMUM_SAMPLES);
      if (samples.length < 1) {
        await this.options.onDiscard?.();
        return;
      }
      await this.options.onFinalize(encodePcm16Wav(samples), { sampleCount: samples.length });
    } finally {
      this.blocks = [];
      this.finalizing = false;
    }
  }

  async discard() {
    this.blocks = [];
    this.finalizing = true;
    await this.cleanupMedia();
    this.finalizing = false;
  }

  async cleanupMedia() {
    this.node?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    await this.context?.close().catch(() => undefined);
    this.node = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}
