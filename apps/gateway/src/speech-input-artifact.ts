import { hasAudioMagic, isSupportedAudioMime, type ArtifactRecord, type ArtifactRegistry, type SupportedAudioMime } from "@fairy/artifacts";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, win32 } from "node:path";

export const speechWorkerInputName = "asr-input.bin" as const;
const speechWorkerInputPartialName = "asr-input.bin.partial" as const;

export class SpeechInputArtifactValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SpeechInputArtifactValidationError";
  }
}

const isContained = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const digest = (content: Buffer): string => `sha256:${createHash("sha256").update(content).digest("hex")}`;

export const resolveSpeechWorkerInput = (root: string, token: string): string => {
  if (
    token !== speechWorkerInputName ||
    token.includes("..") ||
    token.includes(":") ||
    token.includes("/") ||
    token.includes("\\") ||
    isAbsolute(token) ||
    win32.isAbsolute(token) ||
    /^[A-Za-z]:/.test(token)
  ) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_INPUT_TOKEN_INVALID", "speech worker input token is invalid");
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, token);
  if (!isContained(resolvedRoot, target)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_INPUT_PATH_ESCAPE", "speech worker input escaped the gateway-owned root");
  }
  return target;
};

export interface ValidatedSpeechInputArtifact {
  readonly audioRef: string;
  readonly bytes: Buffer;
  readonly mime: SupportedAudioMime;
  readonly record: ArtifactRecord;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export const validateSpeechInputArtifact = async (
  registry: ArtifactRegistry,
  audioRef: string,
  maxInputBytes: number
): Promise<ValidatedSpeechInputArtifact> => {
  if (!/^art_[a-f0-9]{20}$/.test(audioRef)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_REF_INVALID", "ASR requires a content-addressed artifact id");
  }
  const record = await registry.get(audioRef);
  if (!record || record.artifact_id !== audioRef) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_MISSING", "ASR input artifact was not found");
  }
  if (record.kind !== "input") {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_KIND_INVALID", "ASR accepts only explicitly imported input artifacts");
  }
  if (!isSupportedAudioMime(record.mime)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_MIME_INVALID", "ASR accepts only audio/wav or audio/mpeg input artifacts");
  }
  if (!Number.isInteger(record.size_bytes) || record.size_bytes < 1 || record.size_bytes > maxInputBytes) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_SIZE_INVALID", "ASR input artifact is empty or exceeds the raw-audio limit");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(record.hash)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_HASH_INVALID", "ASR input artifact has invalid hash metadata");
  }
  const pathRoot = win32.parse(record.path).root;
  const pathTail = record.path.slice(pathRoot.length);
  if (
    (!isAbsolute(record.path) && !win32.isAbsolute(record.path)) ||
    record.path.startsWith("\\\\") ||
    /^[A-Za-z]:[^\\/]/.test(record.path) ||
    pathTail.includes(":") ||
    record.path.split(/[\\/]+/).includes("..")
  ) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_PATH_INVALID", "ASR input artifact path form is forbidden");
  }
  const root = resolve(registry.artifactsDir());
  const rootReal = await realpath(root).catch(() => {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_ROOT_INVALID", "artifact root is unavailable");
  });
  const target = resolve(record.path);
  if (!isContained(rootReal, target)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_PATH_ESCAPE", "ASR input artifact escaped the artifact root");
  }
  const before = await lstat(target).catch(() => {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_MISSING", "ASR input artifact file is missing");
  });
  if (before.isSymbolicLink()) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_SYMLINK", "ASR input artifact must not be a symlink");
  }
  if (!before.isFile()) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_NOT_REGULAR", "ASR input artifact must be a regular file");
  }
  const targetReal = await realpath(target).catch(() => {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_REALPATH_FAILED", "ASR input artifact could not be resolved");
  });
  if (!isContained(rootReal, targetReal)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_PATH_ESCAPE", "ASR input artifact resolved outside the artifact root");
  }
  if (before.size !== record.size_bytes || before.size < 1 || before.size > maxInputBytes) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_SIZE_MISMATCH", "ASR input artifact size did not match its registry record");
  }
  const handle = await open(targetReal, "r");
  let opened: Awaited<ReturnType<typeof lstat>>;
  let bytes: Buffer;
  let after: Awaited<ReturnType<typeof lstat>>;
  try {
    opened = await handle.stat();
    bytes = await handle.readFile();
    after = await handle.stat();
  } finally {
    await handle.close();
  }
  if (
    !opened.isFile() ||
    !after.isFile() ||
    opened.size !== before.size ||
    after.size !== before.size ||
    after.size !== opened.size ||
    after.mtimeMs !== before.mtimeMs ||
    opened.mtimeMs !== before.mtimeMs ||
    (before.ino !== 0 && opened.ino !== 0 && opened.ino !== before.ino) ||
    (before.ino !== 0 && after.ino !== 0 && after.ino !== before.ino) ||
    bytes.byteLength !== record.size_bytes
  ) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_PARTIAL", "ASR input artifact changed during validation");
  }
  if (!hasAudioMagic(bytes, record.mime)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_FORMAT_MISMATCH", "ASR input artifact MIME and magic bytes do not match");
  }
  const sha256 = digest(bytes);
  if (sha256 !== record.hash) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_ARTIFACT_HASH_MISMATCH", "ASR input artifact hash did not match its registry record");
  }
  return { audioRef, bytes, mime: record.mime, record, sha256, sizeBytes: bytes.byteLength };
};

export const stageSpeechInputArtifact = async (
  root: string,
  artifact: ValidatedSpeechInputArtifact
): Promise<{ readonly stagedBytes: number; readonly token: typeof speechWorkerInputName }> => {
  const rootReal = await realpath(root).catch(() => {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_STAGE_ROOT_INVALID", "gateway-owned ASR staging root is unavailable");
  });
  const target = resolveSpeechWorkerInput(rootReal, speechWorkerInputName);
  const partial = resolve(rootReal, speechWorkerInputPartialName);
  await unlink(partial).catch(() => undefined);
  await unlink(target).catch(() => undefined);
  const handle = await open(partial, "wx");
  try {
    await handle.writeFile(artifact.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(partial, target);
  const staged = await lstat(target);
  if (staged.isSymbolicLink() || !staged.isFile() || staged.size !== artifact.sizeBytes) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_STAGE_INVALID", "staged ASR input is not the verified regular file");
  }
  const bytes = await readFile(target);
  if (bytes.byteLength !== artifact.sizeBytes || digest(bytes) !== artifact.sha256 || !hasAudioMagic(bytes, artifact.mime)) {
    throw new SpeechInputArtifactValidationError("SPEECH_ASR_STAGE_MISMATCH", "staged ASR input did not match the verified artifact");
  }
  return { stagedBytes: bytes.byteLength, token: speechWorkerInputName };
};
