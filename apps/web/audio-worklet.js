// @ts-check

const WorkletProcessor = /** @type {any} */ (globalThis).AudioWorkletProcessor;

class FairyPcmCapture extends WorkletProcessor {
  /** @param {Float32Array[][]} inputs */
  process(inputs) {
    const channels = inputs[0] ?? [];
    const first = channels[0];
    if (!first || first.length === 0) {
      return true;
    }
    const mono = new Float32Array(first.length);
    for (const channel of channels) {
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
      }
    }
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}

/** @type {any} */ (globalThis).registerProcessor("fairy-pcm-capture", FairyPcmCapture);
