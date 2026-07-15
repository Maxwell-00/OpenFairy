export const webVoiceSampleRate = 16_000 as const;
export const webVoiceChannels = 1 as const;
export const webVoiceBitsPerSample = 16 as const;
export const webVoiceRecommendedSamples = 480_000 as const;
export const webVoiceWarningSamples = 800_000 as const;
export const webVoiceCountdownSamples = 880_000 as const;
export const webVoiceMaximumSamples = 960_000 as const;
export const webVoiceWavHeaderBytes = 44 as const;
export const webVoiceMaximumWavBytes = 1_920_044 as const;

export class WebVoiceWavError extends Error {
  readonly code: string;
  readonly status: 400 | 413 | 415 | 422;

  constructor(code: string, message: string, status: 400 | 413 | 415 | 422) {
    super(message);
    this.code = code;
    this.name = "WebVoiceWavError";
    this.status = status;
  }
}

export interface CanonicalWebWav {
  readonly bitsPerSample: typeof webVoiceBitsPerSample;
  readonly channels: typeof webVoiceChannels;
  readonly durationMs: number;
  readonly sampleCount: number;
  readonly sampleRate: typeof webVoiceSampleRate;
}

const asciiAt = (bytes: Buffer, offset: number, length: number): string =>
  bytes.subarray(offset, offset + length).toString("ascii");

export const parseCanonicalWebWav = (bytes: Buffer): CanonicalWebWav => {
  if (bytes.byteLength > webVoiceMaximumWavBytes) {
    throw new WebVoiceWavError("web_wav_too_large", "WAV body exceeds the fixed Web voice limit.", 413);
  }
  if (bytes.byteLength < webVoiceWavHeaderBytes + 2) {
    throw new WebVoiceWavError("web_wav_truncated", "WAV body is incomplete.", 400);
  }
  if (
    asciiAt(bytes, 0, 4) !== "RIFF" ||
    asciiAt(bytes, 8, 4) !== "WAVE" ||
    asciiAt(bytes, 12, 4) !== "fmt " ||
    asciiAt(bytes, 36, 4) !== "data"
  ) {
    throw new WebVoiceWavError("web_wav_format", "WAV format is not supported.", 415);
  }
  if (bytes.readUInt32LE(4) !== bytes.byteLength - 8 || bytes.readUInt32LE(16) !== 16) {
    throw new WebVoiceWavError("web_wav_layout", "WAV layout is not canonical.", 415);
  }
  const format = bytes.readUInt16LE(20);
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const byteRate = bytes.readUInt32LE(28);
  const blockAlign = bytes.readUInt16LE(32);
  const bitsPerSample = bytes.readUInt16LE(34);
  if (
    format !== 1 ||
    channels !== webVoiceChannels ||
    sampleRate !== webVoiceSampleRate ||
    byteRate !== 32_000 ||
    blockAlign !== 2 ||
    bitsPerSample !== webVoiceBitsPerSample
  ) {
    throw new WebVoiceWavError("web_wav_encoding", "WAV encoding is not supported.", 415);
  }
  const dataBytes = bytes.readUInt32LE(40);
  if (dataBytes !== bytes.byteLength - webVoiceWavHeaderBytes) {
    throw new WebVoiceWavError("web_wav_size_mismatch", "WAV byte counts do not match.", 400);
  }
  if (dataBytes < 2 || dataBytes % 2 !== 0) {
    throw new WebVoiceWavError("web_wav_sample_count", "WAV must contain complete PCM16 samples.", 422);
  }
  const sampleCount = dataBytes / 2;
  if (sampleCount < 1 || sampleCount > webVoiceMaximumSamples) {
    throw new WebVoiceWavError("web_wav_duration", "WAV duration exceeds the fixed Web voice limit.", 422);
  }
  return {
    bitsPerSample: webVoiceBitsPerSample,
    channels: webVoiceChannels,
    durationMs: Math.floor(sampleCount * 1_000 / webVoiceSampleRate),
    sampleCount,
    sampleRate: webVoiceSampleRate
  };
};
