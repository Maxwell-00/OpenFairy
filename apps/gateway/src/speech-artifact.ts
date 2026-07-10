import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, win32 } from "node:path";

import type { SpeechWorkerTtsChunk } from "./speech-worker-process.js";

export const speechWorkerOutputName = "tts-output.mp3" as const;

export class SpeechArtifactValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SpeechArtifactValidationError";
  }
}

const isContained = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export const resolveSpeechWorkerOutput = (root: string, token: string): string => {
  if (
    token !== speechWorkerOutputName ||
    token.includes("..") ||
    token.includes(":") ||
    token.startsWith("\\") ||
    token.startsWith("//") ||
    isAbsolute(token) ||
    win32.isAbsolute(token) ||
    /^[A-Za-z]:/.test(token)
  ) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_PATH_INVALID", "speech worker returned an invalid output token");
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, token);
  if (!isContained(resolvedRoot, target)) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_PATH_ESCAPE", "speech worker output escaped the gateway-owned root");
  }
  return target;
};

const isMp3 = (content: Buffer): boolean =>
  content.subarray(0, 3).toString("ascii") === "ID3" ||
  (content.length >= 2 && content[0] === 0xff && ((content[1] ?? 0) & 0xe0) === 0xe0);

export const validateSpeechWorkerArtifact = async (
  root: string,
  chunk: SpeechWorkerTtsChunk,
  maxAudioBytes: number
): Promise<{ readonly bytes: Buffer; readonly sha256: string; readonly sizeBytes: number }> => {
  if (
    chunk.audioFormat !== "mp3" ||
    chunk.mime !== "audio/mpeg" ||
    !chunk.audioRef ||
    !chunk.sha256 ||
    !chunk.sizeBytes ||
    chunk.sizeBytes > maxAudioBytes
  ) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_METADATA_INVALID", "speech worker returned incomplete or oversized artifact metadata");
  }
  const rootReal = await realpath(root).catch(() => {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_ROOT_INVALID", "gateway-owned speech output root is unavailable");
  });
  const target = resolveSpeechWorkerOutput(rootReal, chunk.audioRef);
  const before = await lstat(target).catch(() => {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_MISSING", "speech worker output is missing");
  });
  if (before.isSymbolicLink()) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_SYMLINK", "speech worker output must not be a symlink");
  }
  if (!before.isFile()) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_NOT_REGULAR", "speech worker output must be a regular file");
  }
  const targetReal = await realpath(target).catch(() => {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_REALPATH_FAILED", "speech worker output could not be resolved");
  });
  if (!isContained(rootReal, targetReal)) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_SYMLINK_ESCAPE", "speech worker output resolved outside the gateway-owned root");
  }
  if (before.size < 1 || before.size !== chunk.sizeBytes || before.size > maxAudioBytes) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_SIZE_MISMATCH", "speech worker output size did not match its metadata");
  }
  const bytes = await readFile(targetReal);
  const after = await stat(targetReal);
  if (
    !after.isFile() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    (before.ino !== 0 && after.ino !== 0 && after.ino !== before.ino) ||
    bytes.byteLength !== chunk.sizeBytes
  ) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_PARTIAL", "speech worker output changed during validation");
  }
  if (!isMp3(bytes)) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_FORMAT_MISMATCH", "speech worker output is not an MP3 file");
  }
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (sha256 !== chunk.sha256) {
    throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_HASH_MISMATCH", "speech worker output hash did not match its metadata");
  }
  return { bytes, sha256, sizeBytes: bytes.byteLength };
};
