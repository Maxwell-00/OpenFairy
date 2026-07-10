import { redactText } from "@fairy/kernel";
import type { Labels } from "@fairy/protocol";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const speechWorkerProtocol = "fairy.speech-worker.v0" as const;

export const speechWorkerDeadlines = {
  cancellationMs: 2_000,
  discoveryMs: 5_000,
  handshakeMs: 5_000,
  processStartupMs: 3_000,
  requestMs: 10_000,
  shutdownMs: 3_000
} as const;

const maxCapturedStderrBytes = 8_192;
const maxStdoutLineBytes = 262_144;
const maxPendingRequests = 16;
const maxQueuedStdoutMessages = 64;
const rawAudioPattern = /^[A-Za-z0-9+/]{120,}={0,2}$/;
const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../workers/speech/mock_worker.py");

export type SpeechWorkerTestMode = "malformed-startup" | "startup-timeout" | "stderr-secret";
export type SpeechWorkerMockBehavior = "normal" | "wait" | "crash" | "malformed";
export type SpeechWorkerCancelTarget = "asr" | "tts" | "all";

export interface SpeechWorkerDeadlineOptions {
  readonly cancellationMs?: number;
  readonly discoveryMs?: number;
  readonly handshakeMs?: number;
  readonly processStartupMs?: number;
  readonly requestMs?: number;
  readonly shutdownMs?: number;
}

export interface SpeechWorkerProcessOptions {
  readonly deadlines?: SpeechWorkerDeadlineOptions;
  /** Repository-controlled adversarial modes used only by deterministic tests. */
  readonly testMode?: SpeechWorkerTestMode;
}

export interface PythonInterpreterEvidence {
  readonly argv0: string;
  readonly args: readonly string[];
  readonly source: "discovered" | "test-override";
  readonly version: string;
}

export type SpeechWorkerWireMessage =
  | { readonly kind: "hello"; readonly protocol: typeof speechWorkerProtocol }
  | { readonly capabilities: readonly string[]; readonly kind: "ready"; readonly protocol: typeof speechWorkerProtocol; readonly python_version: string; readonly worker_id: string }
  | { readonly audio_ref: string; readonly final: string; readonly kind: "asr.script"; readonly labels?: Labels; readonly mock_behavior?: SpeechWorkerMockBehavior; readonly partials: readonly string[]; readonly request_id: string; readonly utterance_id: string }
  | { readonly kind: "asr.partial"; readonly request_id: string; readonly text: string; readonly utterance_id: string }
  | { readonly audio_ref: string; readonly kind: "asr.final"; readonly request_id: string; readonly text: string; readonly utterance_id: string }
  | { readonly chunk_chars?: number; readonly kind: "tts.script"; readonly labels?: Labels; readonly request_id: string; readonly text: string; readonly utterance_id: string }
  | { readonly audio_ref?: string; readonly chunk_id: string; readonly kind: "tts.chunk"; readonly request_id: string; readonly text: string }
  | { readonly chunk_count: number; readonly kind: "tts.done"; readonly request_id: string; readonly utterance_id: string }
  | { readonly kind: "cancel"; readonly reason?: string; readonly request_id: string; readonly target: SpeechWorkerCancelTarget; readonly target_request_id: string }
  | { readonly kind: "cancelled"; readonly request_id: string; readonly target: SpeechWorkerCancelTarget; readonly target_request_id: string }
  | { readonly code: string; readonly kind: "error"; readonly message: string; readonly request_id?: string; readonly retryable?: boolean }
  | { readonly kind: "shutdown"; readonly reason?: string }
  | { readonly kind: "bye"; readonly reason?: string };

export interface SpeechWorkerWireValidationIssue {
  readonly message: string;
  readonly path: string;
}

export type SpeechWorkerWireValidationResult =
  | { readonly message: SpeechWorkerWireMessage; readonly ok: true }
  | { readonly issues: readonly SpeechWorkerWireValidationIssue[]; readonly ok: false };

export interface SpeechWorkerAsrScript {
  readonly audioRef: string;
  readonly final: string;
  readonly labels?: Labels;
  readonly mockBehavior?: SpeechWorkerMockBehavior;
  readonly partials: readonly string[];
  readonly requestId: string;
  readonly utteranceId: string;
}

export interface SpeechWorkerAsrResult {
  readonly audioRef?: string;
  readonly cancelled: boolean;
  readonly partials: readonly string[];
  readonly text?: string;
  readonly utteranceId: string;
}

export interface SpeechWorkerTtsScript {
  readonly chunkChars?: number;
  readonly labels?: Labels;
  readonly requestId: string;
  readonly text: string;
  readonly utteranceId: string;
}

export interface SpeechWorkerTtsChunk {
  readonly audioRef?: string;
  readonly chunkId: string;
  readonly text: string;
}

export interface SpeechWorkerTtsResult {
  readonly chunks: readonly SpeechWorkerTtsChunk[];
  readonly utteranceId: string;
}

export interface SpeechWorkerReadyInfo {
  readonly capabilities: readonly string[];
  readonly interpreter: PythonInterpreterEvidence;
  readonly processId: number;
  readonly pythonVersion: string;
  readonly workerId: string;
}

type RequiredDeadlines = Required<SpeechWorkerDeadlineOptions>;

type PendingRequest =
  | {
      readonly kind: "asr";
      readonly onPartial?: (text: string) => Promise<void> | void;
      readonly partials: string[];
      readonly reject: (error: Error) => void;
      readonly resolve: (result: SpeechWorkerAsrResult) => void;
      readonly utteranceId: string;
    }
  | {
      readonly chunks: SpeechWorkerTtsChunk[];
      readonly kind: "tts";
      readonly onChunk?: (chunk: SpeechWorkerTtsChunk) => Promise<void> | void;
      readonly reject: (error: Error) => void;
      readonly resolve: (result: SpeechWorkerTtsResult) => void;
      readonly utteranceId: string;
    }
  | {
      readonly kind: "cancel";
      readonly reject: (error: Error) => void;
      readonly resolve: () => void;
      readonly targetRequestId: string;
    };

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: T) => void;
}

interface InterpreterCandidate {
  readonly args: readonly string[];
  readonly argv0: string;
  readonly source: "discovered" | "test-override";
}

interface ProbeResult {
  readonly python_version: string;
}

export class SpeechWorkerProcessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SpeechWorkerProcessError";
  }
}

const deferred = <T>(): Deferred<T> => {
  let rejectPromise: ((error: Error) => void) | undefined;
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  // Event-driven lifecycle promises can settle before their consumer reaches
  // the corresponding await. Keep the original rejecting promise semantics
  // while preventing Node from treating that short window as unhandled.
  void promise.catch(() => undefined);
  return {
    promise,
    reject: (error) => rejectPromise?.(error),
    resolve: (value) => resolvePromise?.(value)
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isLabels = (value: unknown): value is Labels =>
  isRecord(value) &&
  (value.sensitivity === "public" || value.sensitivity === "internal" || value.sensitivity === "personal" || value.sensitivity === "secret") &&
  (value.residency === "local-only" || value.residency === "region-restricted" || value.residency === "global-ok");

const issue = (path: string, message: string): SpeechWorkerWireValidationIssue => ({ message, path });

const allowedFields = (value: Record<string, unknown>, fields: readonly string[]): SpeechWorkerWireValidationIssue[] =>
  Object.keys(value).filter((key) => !fields.includes(key)).map((key) => issue(`/${key}`, "unknown field"));

const requiredString = (value: Record<string, unknown>, key: string): SpeechWorkerWireValidationIssue[] =>
  typeof value[key] === "string" && value[key].length > 0 ? [] : [issue(`/${key}`, "must be a non-empty string")];

const optionalString = (value: Record<string, unknown>, key: string): SpeechWorkerWireValidationIssue[] =>
  value[key] === undefined || (typeof value[key] === "string" && value[key].length > 0) ? [] : [issue(`/${key}`, "must be a non-empty string when present")];

const optionalBoolean = (value: Record<string, unknown>, key: string): SpeechWorkerWireValidationIssue[] =>
  value[key] === undefined || typeof value[key] === "boolean" ? [] : [issue(`/${key}`, "must be boolean when present")];

const labelsIssues = (value: Record<string, unknown>): SpeechWorkerWireValidationIssue[] =>
  value.labels === undefined || isLabels(value.labels) ? [] : [issue("/labels", "must contain valid sensitivity and residency")];

const containsRawAudio = (value: unknown): boolean => {
  if (typeof value === "string") {
    return /^data:audio\//i.test(value) || rawAudioPattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsRawAudio);
  }
  return isRecord(value) && Object.values(value).some(containsRawAudio);
};

const redactSpeechWorkerDiagnostic = (value: string): string =>
  redactText(value).replace(/\bsk[_-](?:test[_-]?)?[A-Za-z0-9_-]{4,}/gi, "[REDACTED:worker-secret]");

const messageIssues = (value: Record<string, unknown>): SpeechWorkerWireValidationIssue[] => {
  if (typeof value.kind !== "string") {
    return [issue("/kind", "must be a string")];
  }
  switch (value.kind) {
    case "hello":
      return [
        ...allowedFields(value, ["kind", "protocol"]),
        ...(value.protocol === speechWorkerProtocol ? [] : [issue("/protocol", `must equal ${speechWorkerProtocol}`)])
      ];
    case "ready":
      return [
        ...allowedFields(value, ["capabilities", "kind", "protocol", "python_version", "worker_id"]),
        ...(value.protocol === speechWorkerProtocol ? [] : [issue("/protocol", `must equal ${speechWorkerProtocol}`)]),
        ...requiredString(value, "worker_id"),
        ...requiredString(value, "python_version"),
        ...(Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === "string" && item.length > 0)
          ? []
          : [issue("/capabilities", "must be an array of non-empty strings")])
      ];
    case "asr.script":
      return [
        ...allowedFields(value, ["audio_ref", "final", "kind", "labels", "mock_behavior", "partials", "request_id", "utterance_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "utterance_id"),
        ...requiredString(value, "audio_ref"),
        ...requiredString(value, "final"),
        ...(Array.isArray(value.partials) && value.partials.every((item) => typeof item === "string") ? [] : [issue("/partials", "must be an array of strings")]),
        ...labelsIssues(value),
        ...(value.mock_behavior === undefined || value.mock_behavior === "normal" || value.mock_behavior === "wait" || value.mock_behavior === "crash" || value.mock_behavior === "malformed"
          ? []
          : [issue("/mock_behavior", "must be a supported mock behavior")])
      ];
    case "asr.partial":
      return [
        ...allowedFields(value, ["kind", "request_id", "text", "utterance_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "utterance_id"),
        ...(typeof value.text === "string" ? [] : [issue("/text", "must be a string")])
      ];
    case "asr.final":
      return [
        ...allowedFields(value, ["audio_ref", "kind", "request_id", "text", "utterance_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "utterance_id"),
        ...requiredString(value, "audio_ref"),
        ...requiredString(value, "text")
      ];
    case "tts.script":
      return [
        ...allowedFields(value, ["chunk_chars", "kind", "labels", "request_id", "text", "utterance_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "utterance_id"),
        ...requiredString(value, "text"),
        ...labelsIssues(value),
        ...(value.chunk_chars === undefined || (Number.isInteger(value.chunk_chars) && typeof value.chunk_chars === "number" && value.chunk_chars >= 1 && value.chunk_chars <= 4096)
          ? []
          : [issue("/chunk_chars", "must be an integer from 1 to 4096 when present")])
      ];
    case "tts.chunk":
      return [
        ...allowedFields(value, ["audio_ref", "chunk_id", "kind", "request_id", "text"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "chunk_id"),
        ...(typeof value.text === "string" ? [] : [issue("/text", "must be a string")]),
        ...optionalString(value, "audio_ref")
      ];
    case "tts.done":
      return [
        ...allowedFields(value, ["chunk_count", "kind", "request_id", "utterance_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "utterance_id"),
        ...(Number.isInteger(value.chunk_count) && typeof value.chunk_count === "number" && value.chunk_count >= 0 ? [] : [issue("/chunk_count", "must be a non-negative integer")])
      ];
    case "cancel":
    case "cancelled":
      return [
        ...allowedFields(value, value.kind === "cancel" ? ["kind", "reason", "request_id", "target", "target_request_id"] : ["kind", "request_id", "target", "target_request_id"]),
        ...requiredString(value, "request_id"),
        ...requiredString(value, "target_request_id"),
        ...(value.target === "asr" || value.target === "tts" || value.target === "all" ? [] : [issue("/target", "must be asr, tts, or all")]),
        ...(value.kind === "cancel" ? optionalString(value, "reason") : [])
      ];
    case "error":
      return [
        ...allowedFields(value, ["code", "kind", "message", "request_id", "retryable"]),
        ...requiredString(value, "code"),
        ...requiredString(value, "message"),
        ...optionalString(value, "request_id"),
        ...optionalBoolean(value, "retryable")
      ];
    case "shutdown":
    case "bye":
      return [
        ...allowedFields(value, ["kind", "reason"]),
        ...optionalString(value, "reason")
      ];
    default:
      return [issue("/kind", "unknown speech worker message kind")];
  }
};

export const validateSpeechWorkerWireMessage = (value: unknown): SpeechWorkerWireValidationResult => {
  if (!isRecord(value)) {
    return { issues: [issue("/", "must be an object")], ok: false };
  }
  const issues = messageIssues(value);
  if (containsRawAudio(value)) {
    issues.push(issue("/", "raw audio/base64 is forbidden on the speech worker control wire"));
  }
  if (issues.length > 0) {
    return { issues, ok: false };
  }
  return { message: value as unknown as SpeechWorkerWireMessage, ok: true };
};

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
};

export const encodeSpeechWorkerWireMessage = (message: SpeechWorkerWireMessage): string => {
  const result = validateSpeechWorkerWireMessage(message);
  if (!result.ok) {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_WIRE_INVALID", result.issues.map((item) => `${item.path}: ${item.message}`).join("; "));
  }
  return JSON.stringify(sortJson(result.message));
};

export const decodeSpeechWorkerWireMessage = (line: string): SpeechWorkerWireMessage => {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_MALFORMED_OUTPUT", "speech worker emitted malformed JSON");
  }
  const result = validateSpeechWorkerWireMessage(parsed);
  if (!result.ok) {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_INVALID_OUTPUT", `speech worker emitted an invalid message: ${result.issues.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  }
  return result.message;
};

const deadlineError = (code: string, name: string, timeoutMs: number): SpeechWorkerProcessError =>
  new SpeechWorkerProcessError(code, `${name} timed out after ${timeoutMs} ms`);

const withDeadline = async <T>(code: string, name: string, promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(deadlineError(code, name, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const boundedAppend = (current: string, chunk: Buffer, maxBytes: number): string => {
  const combined = current + chunk.toString("utf8");
  return Buffer.byteLength(combined) <= maxBytes ? combined : Buffer.from(combined).subarray(0, maxBytes).toString("utf8");
};

const childEnvironment = (): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8"
  };
  for (const key of ["HOME", "LANG", "LOCALAPPDATA", "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"]) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

const interpreterCandidates = (testOverride: string | undefined): readonly InterpreterCandidate[] => {
  if (testOverride !== undefined && testOverride.length > 0) {
    return [{ args: [], argv0: testOverride, source: "test-override" }];
  }
  return [
    { args: [], argv0: "python3", source: "discovered" },
    { args: [], argv0: "python", source: "discovered" },
    ...(process.platform === "win32" ? [{ args: ["-3"] as const, argv0: "py", source: "discovered" as const }] : [])
  ];
};

const probeInterpreter = async (candidate: InterpreterCandidate, timeoutMs: number): Promise<PythonInterpreterEvidence> => {
  const program = "import json,sys;print(json.dumps({'python_version':'.'.join(map(str,sys.version_info[:3]))}))";
  const child = spawn(candidate.argv0, [...candidate.args, "-u", "-B", "-c", program], {
    cwd: tmpdir(),
    env: childEnvironment(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = boundedAppend(stdout, chunk, 4_096);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = boundedAppend(stderr, chunk, 4_096);
  });
  const completion = new Promise<number>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolvePromise(code ?? -1));
  });
  let code: number;
  try {
    code = await withDeadline("SPEECH_WORKER_DISCOVERY_TIMEOUT", `Python interpreter probe (${candidate.argv0})`, completion, timeoutMs);
  } catch (error) {
    if (child.exitCode === null) {
      child.kill();
    }
    await withDeadline("SPEECH_WORKER_DISCOVERY_CLEANUP_TIMEOUT", `Python interpreter probe cleanup (${candidate.argv0})`, completion, 1_000).catch(() => undefined);
    throw error;
  }
  if (code !== 0) {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_INTERPRETER_REJECTED", `Python interpreter ${candidate.argv0} exited with code ${code}: ${redactSpeechWorkerDiagnostic(stderr.trim() || "no diagnostic")}`);
  }
  let parsed: ProbeResult;
  try {
    parsed = JSON.parse(stdout.trim()) as ProbeResult;
  } catch {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_INTERPRETER_INVALID", `Python interpreter ${candidate.argv0} returned invalid version evidence`);
  }
  if (!parsed || typeof parsed.python_version !== "string" || !/^\d+\.\d+\.\d+$/.test(parsed.python_version)) {
    throw new SpeechWorkerProcessError("SPEECH_WORKER_INTERPRETER_INVALID", `Python interpreter ${candidate.argv0} returned invalid version evidence`);
  }
  return {
    args: candidate.args,
    argv0: candidate.argv0,
    source: candidate.source,
    version: parsed.python_version
  };
};

export class SpeechWorkerProcess {
  readonly #deadlines: RequiredDeadlines;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #testMode: SpeechWorkerTestMode | undefined;
  readonly #testPythonOverride: string | undefined;
  #bye: Deferred<void> | undefined;
  #child: ChildProcessWithoutNullStreams | undefined;
  #exit: Deferred<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  #failure: Error | undefined;
  #interpreter: PythonInterpreterEvidence | undefined;
  #lastProcessId: number | undefined;
  #queuedStdoutMessages = 0;
  #ready: Deferred<SpeechWorkerReadyInfo> | undefined;
  #readyInfo: SpeechWorkerReadyInfo | undefined;
  #shuttingDown = false;
  #stderrRaw = "";
  #terminating = false;
  #stdoutBuffer = "";
  #stdoutChain: Promise<void> = Promise.resolve();

  constructor(options: SpeechWorkerProcessOptions = {}) {
    this.#deadlines = {
      cancellationMs: options.deadlines?.cancellationMs ?? speechWorkerDeadlines.cancellationMs,
      discoveryMs: options.deadlines?.discoveryMs ?? speechWorkerDeadlines.discoveryMs,
      handshakeMs: options.deadlines?.handshakeMs ?? speechWorkerDeadlines.handshakeMs,
      processStartupMs: options.deadlines?.processStartupMs ?? speechWorkerDeadlines.processStartupMs,
      requestMs: options.deadlines?.requestMs ?? speechWorkerDeadlines.requestMs,
      shutdownMs: options.deadlines?.shutdownMs ?? speechWorkerDeadlines.shutdownMs
    };
    this.#testMode = options.testMode;
    this.#testPythonOverride = process.env.NODE_ENV === "test" || process.env.CI === "true"
      ? process.env.FAIRY_TEST_PYTHON
      : undefined;
  }

  async start(): Promise<SpeechWorkerReadyInfo> {
    if (this.#child) {
      throw new SpeechWorkerProcessError("SPEECH_WORKER_ALREADY_STARTED", "speech worker process is already started");
    }
    this.#interpreter = await this.#discoverInterpreter();
    this.#ready = deferred<SpeechWorkerReadyInfo>();
    this.#exit = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
    const args = [
      ...this.#interpreter.args,
      "-u",
      "-B",
      workerPath,
      ...(this.#testMode ? ["--test-mode", this.#testMode] : [])
    ];
    const child = spawn(this.#interpreter.argv0, args, {
      cwd: tmpdir(),
      env: childEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.#child = child;
    this.#lastProcessId = child.pid;
    child.stdout.on("data", (chunk: Buffer) => this.#consumeStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrRaw = boundedAppend(this.#stderrRaw, chunk, maxCapturedStderrBytes);
    });
    child.once("exit", (code, signal) => this.#handleExit(code, signal));

    try {
      await withDeadline("SPEECH_WORKER_PROCESS_START_TIMEOUT", "speech worker process startup", new Promise<void>((resolvePromise, reject) => {
        child.once("spawn", resolvePromise);
        child.once("error", reject);
      }), this.#deadlines.processStartupMs);
    } catch (error) {
      await this.#terminate("process startup failure");
      throw new SpeechWorkerProcessError("SPEECH_WORKER_PROCESS_START_FAILED", `speech worker process failed to start with ${this.#interpreter.argv0}: ${redactText(error instanceof Error ? error.message : String(error))}`);
    }

    try {
      await this.#send({ kind: "hello", protocol: speechWorkerProtocol }, this.#deadlines.handshakeMs);
      return await withDeadline("SPEECH_WORKER_HANDSHAKE_TIMEOUT", "speech worker ready handshake", this.#ready.promise, this.#deadlines.handshakeMs);
    } catch (error) {
      await this.#terminate("ready handshake failure");
      throw this.#publicError(error, "SPEECH_WORKER_HANDSHAKE_FAILED", "speech worker ready handshake failed");
    }
  }

  info(): SpeechWorkerReadyInfo | undefined {
    return this.#readyInfo;
  }

  processId(): number | undefined {
    return this.#lastProcessId;
  }

  isAlive(): boolean {
    return Boolean(this.#child && this.#child.exitCode === null && this.#child.signalCode === null);
  }

  stderrDiagnostic(): string {
    return redactSpeechWorkerDiagnostic(this.#stderrRaw).slice(0, maxCapturedStderrBytes);
  }

  async requestAsr(script: SpeechWorkerAsrScript, onPartial?: (text: string) => Promise<void> | void): Promise<SpeechWorkerAsrResult> {
    this.#assertRequestCapacity(script.requestId);
    const result = deferred<SpeechWorkerAsrResult>();
    const pending: PendingRequest = {
      kind: "asr",
      ...(onPartial ? { onPartial } : {}),
      partials: [],
      reject: result.reject,
      resolve: result.resolve,
      utteranceId: script.utteranceId
    };
    this.#pending.set(script.requestId, pending);
    try {
      await this.#send({
        audio_ref: script.audioRef,
        final: script.final,
        kind: "asr.script",
        ...(script.labels ? { labels: script.labels } : {}),
        ...(script.mockBehavior ? { mock_behavior: script.mockBehavior } : {}),
        partials: script.partials,
        request_id: script.requestId,
        utterance_id: script.utteranceId
      }, this.#deadlines.requestMs);
      return await withDeadline("SPEECH_WORKER_REQUEST_TIMEOUT", `speech worker ASR request ${script.requestId}`, result.promise, this.#deadlines.requestMs);
    } catch (error) {
      if (error instanceof SpeechWorkerProcessError && error.code === "SPEECH_WORKER_REQUEST_TIMEOUT") {
        await this.#terminate("ASR request timeout");
      }
      throw this.#publicError(error, "SPEECH_WORKER_ASR_FAILED", "speech worker ASR request failed");
    } finally {
      this.#pending.delete(script.requestId);
    }
  }

  async requestTts(script: SpeechWorkerTtsScript, onChunk?: (chunk: SpeechWorkerTtsChunk) => Promise<void> | void): Promise<SpeechWorkerTtsResult> {
    this.#assertRequestCapacity(script.requestId);
    const result = deferred<SpeechWorkerTtsResult>();
    const pending: PendingRequest = {
      chunks: [],
      kind: "tts",
      ...(onChunk ? { onChunk } : {}),
      reject: result.reject,
      resolve: result.resolve,
      utteranceId: script.utteranceId
    };
    this.#pending.set(script.requestId, pending);
    try {
      await this.#send({
        ...(script.chunkChars === undefined ? {} : { chunk_chars: script.chunkChars }),
        kind: "tts.script",
        ...(script.labels ? { labels: script.labels } : {}),
        request_id: script.requestId,
        text: script.text,
        utterance_id: script.utteranceId
      }, this.#deadlines.requestMs);
      return await withDeadline("SPEECH_WORKER_REQUEST_TIMEOUT", `speech worker TTS request ${script.requestId}`, result.promise, this.#deadlines.requestMs);
    } catch (error) {
      if (error instanceof SpeechWorkerProcessError && error.code === "SPEECH_WORKER_REQUEST_TIMEOUT") {
        await this.#terminate("TTS request timeout");
      }
      throw this.#publicError(error, "SPEECH_WORKER_TTS_FAILED", "speech worker TTS request failed");
    } finally {
      this.#pending.delete(script.requestId);
    }
  }

  async cancel(requestId: string, targetRequestId: string, target: SpeechWorkerCancelTarget, reason = "cancelled by gateway"): Promise<void> {
    this.#assertRequestCapacity(requestId);
    const result = deferred<void>();
    this.#pending.set(requestId, {
      kind: "cancel",
      reject: result.reject,
      resolve: () => result.resolve(undefined),
      targetRequestId
    });
    try {
      await this.#send({
        kind: "cancel",
        reason,
        request_id: requestId,
        target,
        target_request_id: targetRequestId
      }, this.#deadlines.cancellationMs);
      await withDeadline("SPEECH_WORKER_CANCEL_TIMEOUT", `speech worker cancellation ${requestId}`, result.promise, this.#deadlines.cancellationMs);
    } catch (error) {
      await this.#terminate("cancellation failure");
      throw this.#publicError(error, "SPEECH_WORKER_CANCEL_FAILED", "speech worker cancellation failed");
    } finally {
      this.#pending.delete(requestId);
    }
  }

  async shutdown(reason = "gateway request complete"): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    if (this.#failure || this.#terminating) {
      if (this.#exit) {
        await withDeadline("SPEECH_WORKER_SHUTDOWN_TIMEOUT", "speech worker failure cleanup", this.#exit.promise, this.#deadlines.shutdownMs).catch(() => undefined);
      }
      return;
    }
    this.#shuttingDown = true;
    this.#bye = deferred<void>();
    try {
      await this.#send({ kind: "shutdown", reason }, this.#deadlines.shutdownMs);
      await withDeadline("SPEECH_WORKER_SHUTDOWN_TIMEOUT", "speech worker bye", this.#bye.promise, this.#deadlines.shutdownMs);
      if (this.#exit) {
        await withDeadline("SPEECH_WORKER_SHUTDOWN_TIMEOUT", "speech worker exit", this.#exit.promise, this.#deadlines.shutdownMs);
      }
    } catch (error) {
      await this.#terminate("shutdown deadline");
      throw this.#publicError(error, "SPEECH_WORKER_SHUTDOWN_FAILED", "speech worker shutdown failed");
    } finally {
      this.#shuttingDown = false;
    }
  }

  async terminateForTest(reason = "test killed worker process"): Promise<void> {
    await this.#terminate(reason);
  }

  async #discoverInterpreter(): Promise<PythonInterpreterEvidence> {
    const candidates = interpreterCandidates(this.#testPythonOverride);
    const errors: string[] = [];
    const perCandidateMs = Math.max(250, Math.floor(this.#deadlines.discoveryMs / candidates.length));
    for (const candidate of candidates) {
      try {
        return await probeInterpreter(candidate, perCandidateMs);
      } catch (error) {
        errors.push(`${candidate.argv0}: ${redactSpeechWorkerDiagnostic(error instanceof Error ? error.message : String(error))}`);
      }
    }
    throw new SpeechWorkerProcessError(
      "SPEECH_WORKER_PYTHON_NOT_FOUND",
      `No supported Python interpreter was ready within ${this.#deadlines.discoveryMs} ms. Tried fixed candidates ${candidates.map((candidate) => candidate.argv0).join(", ")}. ${errors.join(" | ")}`
    );
  }

  #consumeStdout(chunk: Buffer): void {
    this.#stdoutBuffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.#stdoutBuffer) > maxStdoutLineBytes && !this.#stdoutBuffer.includes("\n")) {
      this.#queueProtocolFailure(new SpeechWorkerProcessError("SPEECH_WORKER_OUTPUT_TOO_LARGE", "speech worker stdout line exceeded the bounded limit"));
      return;
    }
    const lines = this.#stdoutBuffer.split("\n");
    this.#stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      if (Buffer.byteLength(line) > maxStdoutLineBytes) {
        this.#queueProtocolFailure(new SpeechWorkerProcessError("SPEECH_WORKER_OUTPUT_TOO_LARGE", "speech worker stdout line exceeded the bounded limit"));
        break;
      }
      if (this.#queuedStdoutMessages >= maxQueuedStdoutMessages) {
        this.#queueProtocolFailure(new SpeechWorkerProcessError("SPEECH_WORKER_OUTPUT_QUEUE_FULL", "speech worker stdout queue exceeded the bounded limit"));
        break;
      }
      this.#queuedStdoutMessages += 1;
      this.#stdoutChain = this.#stdoutChain
        .then(() => this.#handleMessage(decodeSpeechWorkerWireMessage(line)))
        .catch((error: unknown) => this.#handleProtocolFailure(error))
        .finally(() => {
          this.#queuedStdoutMessages -= 1;
        });
    }
  }

  #queueProtocolFailure(error: Error): void {
    this.#stdoutChain = this.#stdoutChain.then(() => this.#handleProtocolFailure(error));
  }

  async #handleMessage(message: SpeechWorkerWireMessage): Promise<void> {
    if (message.kind === "ready") {
      if (!this.#interpreter || !this.#child?.pid || this.#readyInfo) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNEXPECTED_READY", "speech worker emitted an unexpected ready message");
      }
      if (message.python_version !== this.#interpreter.version) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_VERSION_MISMATCH", "speech worker ready version did not match interpreter discovery evidence");
      }
      const info: SpeechWorkerReadyInfo = {
        capabilities: message.capabilities,
        interpreter: this.#interpreter,
        processId: this.#child.pid,
        pythonVersion: message.python_version,
        workerId: message.worker_id
      };
      this.#readyInfo = info;
      this.#ready?.resolve(info);
      return;
    }
    if (message.kind === "bye") {
      this.#bye?.resolve(undefined);
      return;
    }
    if (message.kind === "asr.partial") {
      const pending = this.#pending.get(message.request_id);
      if (!pending || pending.kind !== "asr" || pending.utteranceId !== message.utterance_id) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an uncorrelated ASR partial");
      }
      pending.partials.push(message.text);
      await pending.onPartial?.(message.text);
      return;
    }
    if (message.kind === "asr.final") {
      const pending = this.#pending.get(message.request_id);
      if (!pending || pending.kind !== "asr" || pending.utteranceId !== message.utterance_id) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an uncorrelated ASR final");
      }
      this.#pending.delete(message.request_id);
      pending.resolve({
        audioRef: message.audio_ref,
        cancelled: false,
        partials: [...pending.partials],
        text: message.text,
        utteranceId: message.utterance_id
      });
      return;
    }
    if (message.kind === "tts.chunk") {
      const pending = this.#pending.get(message.request_id);
      if (!pending || pending.kind !== "tts") {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an uncorrelated TTS chunk");
      }
      const chunk: SpeechWorkerTtsChunk = {
        ...(message.audio_ref ? { audioRef: message.audio_ref } : {}),
        chunkId: message.chunk_id,
        text: message.text
      };
      pending.chunks.push(chunk);
      await pending.onChunk?.(chunk);
      return;
    }
    if (message.kind === "tts.done") {
      const pending = this.#pending.get(message.request_id);
      if (!pending || pending.kind !== "tts" || pending.utteranceId !== message.utterance_id || pending.chunks.length !== message.chunk_count) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an invalid TTS completion");
      }
      this.#pending.delete(message.request_id);
      pending.resolve({ chunks: [...pending.chunks], utteranceId: message.utterance_id });
      return;
    }
    if (message.kind === "cancelled") {
      const cancellation = this.#pending.get(message.request_id);
      if (!cancellation || cancellation.kind !== "cancel" || cancellation.targetRequestId !== message.target_request_id) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an uncorrelated cancellation");
      }
      const target = this.#pending.get(message.target_request_id);
      this.#pending.delete(message.request_id);
      this.#pending.delete(message.target_request_id);
      if (target?.kind === "asr") {
        target.resolve({
          cancelled: true,
          partials: [...target.partials],
          utteranceId: target.utteranceId
        });
      } else if (target?.kind === "tts") {
        target.resolve({ chunks: [...target.chunks], utteranceId: target.utteranceId });
      }
      cancellation.resolve();
      return;
    }
    if (message.kind === "error") {
      const error = new SpeechWorkerProcessError(`SPEECH_WORKER_${message.code.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, redactSpeechWorkerDiagnostic(message.message));
      if (message.request_id) {
        const pending = this.#pending.get(message.request_id);
        if (!pending) {
          throw new SpeechWorkerProcessError("SPEECH_WORKER_UNCORRELATED_OUTPUT", "speech worker emitted an uncorrelated error");
        }
        this.#pending.delete(message.request_id);
        pending.reject(error);
        return;
      }
      throw error;
    }
    throw new SpeechWorkerProcessError("SPEECH_WORKER_UNEXPECTED_OUTPUT", `speech worker emitted unexpected ${message.kind}`);
  }

  async #handleProtocolFailure(error: unknown): Promise<void> {
    if (this.#failure) {
      return;
    }
    this.#failure = this.#publicError(error, "SPEECH_WORKER_PROTOCOL_FAILED", "speech worker protocol failed");
    this.#ready?.reject(this.#failure);
    this.#bye?.reject(this.#failure);
    for (const pending of this.#pending.values()) {
      pending.reject(this.#failure);
    }
    await this.#terminate("protocol failure");
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.#exit?.resolve({ code, signal });
    if (this.#stdoutBuffer.trim().length > 0 && !this.#failure) {
      this.#queueProtocolFailure(new SpeechWorkerProcessError("SPEECH_WORKER_TRUNCATED_OUTPUT", "speech worker exited with a truncated stdout message"));
    }
    if (this.#shuttingDown && code === 0) {
      return;
    }
    const error = new SpeechWorkerProcessError(
      "SPEECH_WORKER_EXITED",
      `speech worker exited before completion (code=${String(code)}, signal=${String(signal)}${this.stderrDiagnostic() ? `, stderr=${this.stderrDiagnostic()}` : ""})`
    );
    this.#ready?.reject(error);
    this.#bye?.reject(error);
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
  }

  #assertRequestCapacity(requestId: string): void {
    if (!this.#child || !this.isAlive() || !this.#readyInfo) {
      throw new SpeechWorkerProcessError("SPEECH_WORKER_NOT_READY", "speech worker process is not ready");
    }
    if (!requestId || this.#pending.has(requestId)) {
      throw new SpeechWorkerProcessError("SPEECH_WORKER_REQUEST_ID_INVALID", "speech worker request id must be non-empty and unique");
    }
    if (this.#pending.size >= maxPendingRequests) {
      throw new SpeechWorkerProcessError("SPEECH_WORKER_QUEUE_FULL", "speech worker pending request bound was reached");
    }
  }

  async #send(message: SpeechWorkerWireMessage, timeoutMs: number): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.stdin.writable) {
      throw new SpeechWorkerProcessError("SPEECH_WORKER_NOT_RUNNING", "speech worker process is not running");
    }
    const encoded = `${encodeSpeechWorkerWireMessage(message)}\n`;
    const write = new Promise<void>((resolvePromise, reject) => {
      child.stdin.write(encoded, "utf8", (error) => error ? reject(error) : resolvePromise());
    });
    await withDeadline("SPEECH_WORKER_WRITE_TIMEOUT", `speech worker stdin write (${message.kind})`, write, timeoutMs);
  }

  async #terminate(reason: string): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    this.#terminating = true;
    try {
      child.stdin.destroy();
      child.kill();
      if (!this.#exit) {
        return;
      }
      try {
        await withDeadline("SPEECH_WORKER_TERMINATE_TIMEOUT", `speech worker termination (${reason})`, this.#exit.promise, this.#deadlines.cancellationMs);
      } catch {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        await withDeadline("SPEECH_WORKER_KILL_TIMEOUT", "speech worker forced termination", this.#exit.promise, this.#deadlines.cancellationMs).catch(() => undefined);
      }
    } finally {
      this.#terminating = false;
    }
  }

  #publicError(error: unknown, fallbackCode: string, fallbackMessage: string): SpeechWorkerProcessError {
    if (error instanceof SpeechWorkerProcessError) {
      const diagnostic = this.stderrDiagnostic();
      return new SpeechWorkerProcessError(error.code, `${redactSpeechWorkerDiagnostic(error.message)}${diagnostic ? `; worker stderr: ${diagnostic}` : ""}`);
    }
    const message = redactSpeechWorkerDiagnostic(error instanceof Error ? error.message : String(error));
    const diagnostic = this.stderrDiagnostic();
    return new SpeechWorkerProcessError(fallbackCode, `${fallbackMessage}: ${message}${diagnostic ? `; worker stderr: ${diagnostic}` : ""}`);
  }
}
