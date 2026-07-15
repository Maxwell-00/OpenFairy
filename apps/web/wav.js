// @ts-check

export const TARGET_SAMPLE_RATE = 16_000;
export const RECOMMENDED_SAMPLES = 480_000;
export const WARNING_SAMPLES = 800_000;
export const COUNTDOWN_SAMPLES = 880_000;
export const MAXIMUM_SAMPLES = 960_000;
export const WAV_HEADER_BYTES = 44;
export const MAXIMUM_WAV_BYTES = 1_920_044;

/** @param {DataView} view @param {number} offset @param {string} value */
const writeAscii = (view, offset, value) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

/** @param {number} sample */
export const floatToPcm16 = (sample) => {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
  return Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
};

/** @param {Float32Array} samples */
export const encodePcm16Wav = (samples) => {
  if (!(samples instanceof Float32Array) || samples.length < 1 || samples.length > MAXIMUM_SAMPLES) {
    throw new Error("PCM sample count is outside the Web voice contract");
  }
  const bytes = new Uint8Array(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(WAV_HEADER_BYTES + index * 2, floatToPcm16(samples[index] ?? 0), true);
  }
  return bytes;
};

/** @param {readonly Float32Array[]} blocks */
export const concatenateBlocks = (blocks) => {
  const length = blocks.reduce((total, block) => total + block.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const block of blocks) {
    joined.set(block, offset);
    offset += block.length;
  }
  return joined;
};

/**
 * Dependency-free deterministic mono resampler. The final target sample count,
 * not a wall timer, is capped by the repository-owned 60-second constant.
 * @param {Float32Array} source
 * @param {number} sourceRate
 * @param {number} [maximumSamples]
 */
export const resampleMonoTo16k = (source, sourceRate, maximumSamples = MAXIMUM_SAMPLES) => {
  if (!(source instanceof Float32Array) || source.length < 1 || !Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error("Source PCM is invalid");
  }
  const targetLength = Math.min(maximumSamples, Math.max(1, Math.floor(source.length * TARGET_SAMPLE_RATE / sourceRate)));
  if (sourceRate === TARGET_SAMPLE_RATE) {
    return source.slice(0, targetLength);
  }
  const output = new Float32Array(targetLength);
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(source.length - 1, Math.floor(position));
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (source[left] ?? 0) * (1 - fraction) + (source[right] ?? 0) * fraction;
  }
  return output;
};
