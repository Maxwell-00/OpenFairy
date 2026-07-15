import { ArtifactRegistry, hasAudioMagic, type ArtifactRecord } from "@fairy/artifacts";
import { deriveLabels } from "@fairy/model-gateway";
import type { EventEnvelope, Labels } from "@fairy/protocol";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve, win32 } from "node:path";

import { validateSpeechInputArtifact } from "./speech-input-artifact.js";
import {
  parseCanonicalWebWav,
  webVoiceMaximumWavBytes,
  WebVoiceWavError,
  type CanonicalWebWav
} from "./web-voice-wav.js";

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:*; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const sessionPattern = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const artifactPattern = /^art_[a-f0-9]{20}$/;

const staticAssets = new Map<string, { readonly mime: string; readonly path: string }>([
  ["/web/", { mime: "text/html; charset=utf-8", path: fileURLToPath(new URL("../../web/index.html", import.meta.url)) }],
  ["/web/index.html", { mime: "text/html; charset=utf-8", path: fileURLToPath(new URL("../../web/index.html", import.meta.url)) }],
  ["/web/styles.css", { mime: "text/css; charset=utf-8", path: fileURLToPath(new URL("../../web/styles.css", import.meta.url)) }],
  ["/web/app.js", { mime: "text/javascript; charset=utf-8", path: fileURLToPath(new URL("../../web/app.js", import.meta.url)) }],
  ["/web/recorder.js", { mime: "text/javascript; charset=utf-8", path: fileURLToPath(new URL("../../web/recorder.js", import.meta.url)) }],
  ["/web/wav.js", { mime: "text/javascript; charset=utf-8", path: fileURLToPath(new URL("../../web/wav.js", import.meta.url)) }],
  ["/web/audio-worklet.js", { mime: "text/javascript; charset=utf-8", path: fileURLToPath(new URL("../../web/audio-worklet.js", import.meta.url)) }]
]);

class WebHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "WebHttpError";
    this.status = status;
  }
}

export interface WebVoiceHttpOptions {
  readonly artifactsDir: string;
  readonly authToken: string;
  readonly homeRegions: readonly string[];
  readonly isSessionBusy: (sid: `ses_${string}`) => boolean;
  readonly readSessionEvents: (sid: `ses_${string}`) => Promise<readonly EventEnvelope[]>;
  readonly sessionExists: (sid: `ses_${string}`) => boolean;
  readonly voiceEnabled: boolean;
  readonly voiceLabels: Labels;
}

export const webVoiceHomeRegions = (config: Record<string, unknown>): string[] => {
  const governance = config.governance && typeof config.governance === "object" && !Array.isArray(config.governance)
    ? config.governance as Record<string, unknown>
    : {};
  return Array.isArray(governance.home_regions)
    ? governance.home_regions.filter((region): region is string => typeof region === "string" && region.length > 0)
    : [];
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(encoded);
};

const sendError = (response: ServerResponse, error: WebHttpError): void =>
  sendJson(response, error.status, { code: error.code, message: error.message });

const bearerToken = (request: IncomingMessage): string | undefined => {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
};

const labelsCover = (stored: Labels, required: Labels): boolean => {
  const joined = deriveLabels([{ labels: stored }, { labels: required }], stored);
  return joined.sensitivity === stored.sensitivity && joined.residency === stored.residency;
};

const isContained = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const sha256 = (bytes: Buffer): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const readBoundedBody = (request: IncomingMessage): Promise<Buffer> => new Promise((resolvePromise, reject) => {
  const chunks: Buffer[] = [];
  let total = 0;
  let settled = false;
  const cleanup = (): void => {
    request.off("data", onData);
    request.off("end", onEnd);
    request.off("error", onError);
    request.off("aborted", onAborted);
  };
  const finishError = (error: Error): void => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    request.pause();
    reject(error);
  };
  const onData = (chunk: Buffer): void => {
    total += chunk.byteLength;
    if (total > webVoiceMaximumWavBytes) {
      finishError(new WebHttpError(413, "web_upload_too_large", "Audio upload exceeds the fixed Web voice limit."));
      return;
    }
    chunks.push(chunk);
  };
  const onEnd = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    resolvePromise(Buffer.concat(chunks, total));
  };
  const onError = (): void => finishError(new WebHttpError(400, "web_upload_failed", "Audio upload could not be read."));
  const onAborted = (): void => finishError(new WebHttpError(400, "web_upload_aborted", "Audio upload was incomplete."));
  request.on("data", onData);
  request.on("end", onEnd);
  request.on("error", onError);
  request.on("aborted", onAborted);
});

const assertContentLength = (request: IncomingMessage): void => {
  const value = request.headers["content-length"];
  if (value === undefined) {
    return;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new WebHttpError(400, "web_content_length_invalid", "Content-Length is invalid.");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new WebHttpError(400, "web_content_length_invalid", "Content-Length is invalid.");
  }
  if (length > webVoiceMaximumWavBytes) {
    throw new WebHttpError(413, "web_upload_too_large", "Audio upload exceeds the fixed Web voice limit.");
  }
};

const validatePersistentMp3 = async (root: string, record: ArtifactRecord): Promise<Buffer> => {
  if (record.kind !== "speech" || record.mime !== "audio/mpeg" || !Number.isInteger(record.size_bytes) || record.size_bytes < 1 || !/^sha256:[a-f0-9]{64}$/.test(record.hash)) {
    throw new Error("invalid speech artifact record");
  }
  const pathRoot = win32.parse(record.path).root;
  const pathTail = record.path.slice(pathRoot.length);
  if ((!isAbsolute(record.path) && !win32.isAbsolute(record.path)) || record.path.startsWith("\\\\") || /^[A-Za-z]:[^\\/]/.test(record.path) || pathTail.includes(":") || record.path.split(/[\\/]+/).includes("..")) {
    throw new Error("invalid speech artifact path");
  }
  const resolvedRoot = resolve(root);
  const target = resolve(record.path);
  if (!isContained(resolvedRoot, target)) {
    throw new Error("speech artifact escaped root");
  }
  const rootReal = await realpath(resolvedRoot);
  const before = await lstat(target);
  if (before.isSymbolicLink() || !before.isFile() || before.size !== record.size_bytes) {
    throw new Error("speech artifact is not the recorded regular file");
  }
  const targetReal = await realpath(target);
  if (!isContained(rootReal, targetReal)) {
    throw new Error("speech artifact resolved outside root");
  }
  const handle = await open(targetReal, "r");
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (!opened.isFile() || !after.isFile() || opened.size !== before.size || after.size !== before.size || opened.mtimeMs !== before.mtimeMs || after.mtimeMs !== before.mtimeMs || (before.ino !== 0 && opened.ino !== 0 && before.ino !== opened.ino) || (before.ino !== 0 && after.ino !== 0 && before.ino !== after.ino)) {
      throw new Error("speech artifact changed during read");
    }
  } finally {
    await handle.close();
  }
  if (bytes.byteLength !== record.size_bytes || sha256(bytes) !== record.hash || !hasAudioMagic(bytes, "audio/mpeg")) {
    throw new Error("speech artifact content mismatch");
  }
  return bytes;
};

export class WebVoiceHttp {
  readonly #options: WebVoiceHttpOptions;
  readonly #uploads = new Set<string>();

  constructor(options: WebVoiceHttpOptions) {
    this.#options = options;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const asset = staticAssets.get(path);
    if (asset) {
      if (request.method !== "GET") {
        sendJson(response, 405, { code: "method_not_allowed", message: "Method not allowed." });
        return true;
      }
      const bytes = await readFile(asset.path);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": bytes.byteLength,
        "content-security-policy": csp,
        "content-type": asset.mime,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      });
      response.end(bytes);
      return true;
    }
    if (!path.startsWith("/web")) {
      return false;
    }
    const uploadMatch = path.match(/^\/web\/api\/sessions\/([^/]+)\/input-audio$/);
    const speechMatch = path.match(/^\/web\/api\/sessions\/([^/]+)\/speech\/([^/]+)$/);
    try {
      if (uploadMatch) {
        await this.#upload(request, response, uploadMatch[1] ?? "");
        return true;
      }
      if (speechMatch) {
        await this.#speech(request, response, speechMatch[1] ?? "", speechMatch[2] ?? "");
        return true;
      }
      throw new WebHttpError(404, "not_found", "Resource not found.");
    } catch (error) {
      const safe = error instanceof WebHttpError
        ? error
        : error instanceof WebVoiceWavError
          ? new WebHttpError(error.status, error.code, error.message)
          : new WebHttpError(500, "web_request_failed", "Web voice request failed.");
      sendError(response, safe);
      return true;
    }
  }

  async #upload(request: IncomingMessage, response: ServerResponse, sidValue: string): Promise<void> {
    if (request.method !== "POST") {
      throw new WebHttpError(405, "method_not_allowed", "Method not allowed.");
    }
    if (bearerToken(request) !== this.#options.authToken) {
      throw new WebHttpError(401, "unauthorized", "Authentication is required.");
    }
    if (!sessionPattern.test(sidValue)) {
      throw new WebHttpError(400, "session_invalid", "Session identifier is invalid.");
    }
    const sid = sidValue as `ses_${string}`;
    if (!this.#options.sessionExists(sid)) {
      throw new WebHttpError(404, "session_not_found", "Session was not found.");
    }
    if (!this.#options.voiceEnabled) {
      throw new WebHttpError(503, "voice_disabled", "Voice is unavailable.");
    }
    if (this.#options.isSessionBusy(sid) || this.#uploads.has(sid)) {
      throw new WebHttpError(409, "session_busy", "Session already has an active operation.");
    }
    if (request.headers["content-type"] !== "audio/wav") {
      throw new WebHttpError(415, "content_type_unsupported", "Only canonical audio/wav is accepted.");
    }
    if (request.headers["content-encoding"] !== undefined) {
      throw new WebHttpError(415, "content_encoding_unsupported", "Content encoding is not supported.");
    }
    assertContentLength(request);
    const region = this.#options.voiceLabels.residency === "region-restricted" ? this.#options.homeRegions[0] : undefined;
    if (this.#options.voiceLabels.residency === "region-restricted" && !region) {
      throw new WebHttpError(503, "voice_governance_unavailable", "Voice governance configuration is unavailable.");
    }
    this.#uploads.add(sid);
    try {
      const body = await readBoundedBody(request);
      const wav = parseCanonicalWebWav(body);
      const registry = new ArtifactRegistry(this.#options.artifactsDir);
      const registered = await registry.register({
        content: body,
        kind: "input",
        labels: this.#options.voiceLabels,
        metadata: {
          bits_per_sample: wav.bitsPerSample,
          channels: wav.channels,
          duration_ms: wav.durationMs,
          ...(region ? { region } : {}),
          sample_count: wav.sampleCount,
          sample_rate: wav.sampleRate,
          source: "web-push-to-talk"
        },
        mime: "audio/wav",
        origin: "web:push-to-talk",
        sourceFilename: "input.wav"
      });
      await this.#verifyUpload(registry, registered.record, body, wav, region);
      sendJson(response, 201, {
        artifact_id: registered.record.artifact_id,
        duration_ms: wav.durationMs,
        labels: registered.record.labels,
        mime: registered.record.mime,
        sample_count: wav.sampleCount,
        size_bytes: registered.record.size_bytes
      });
    } finally {
      this.#uploads.delete(sid);
    }
  }

  async #verifyUpload(registry: ArtifactRegistry, record: ArtifactRecord, body: Buffer, wav: CanonicalWebWav, region: string | undefined): Promise<void> {
    const metadata = record.metadata ?? {};
    if (
      record.kind !== "input" ||
      record.mime !== "audio/wav" ||
      record.size_bytes !== body.byteLength ||
      !labelsCover(record.labels, this.#options.voiceLabels) ||
      metadata.source !== "web-push-to-talk" ||
      metadata.sample_rate !== wav.sampleRate ||
      metadata.channels !== wav.channels ||
      metadata.bits_per_sample !== wav.bitsPerSample ||
      metadata.sample_count !== wav.sampleCount ||
      metadata.duration_ms !== wav.durationMs ||
      (region !== undefined && metadata.region !== region)
    ) {
      throw new WebHttpError(409, "artifact_collision", "Audio artifact identity conflicts with its governed metadata.");
    }
    const validated = await validateSpeechInputArtifact(registry, record.artifact_id, webVoiceMaximumWavBytes);
    if (validated.sha256 !== sha256(body) || !validated.bytes.equals(body)) {
      throw new WebHttpError(409, "artifact_collision", "Audio artifact identity conflicts with its governed content.");
    }
  }

  async #speech(request: IncomingMessage, response: ServerResponse, sidValue: string, artifactId: string): Promise<void> {
    if (request.method !== "GET") {
      throw new WebHttpError(405, "method_not_allowed", "Method not allowed.");
    }
    if (bearerToken(request) !== this.#options.authToken) {
      throw new WebHttpError(401, "unauthorized", "Authentication is required.");
    }
    if (!sessionPattern.test(sidValue)) {
      throw new WebHttpError(404, "not_found", "Resource not found.");
    }
    const sid = sidValue as `ses_${string}`;
    if (!this.#options.sessionExists(sid) || !artifactPattern.test(artifactId)) {
      throw new WebHttpError(404, "not_found", "Resource not found.");
    }
    const events = await this.#options.readSessionEvents(sid);
    const owned = events.some((event) => event.type === "speech.tts.chunk" && event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) && (event.payload as Record<string, unknown>).audio_ref === artifactId);
    if (!owned) {
      throw new WebHttpError(404, "not_found", "Resource not found.");
    }
    try {
      const registry = new ArtifactRegistry(this.#options.artifactsDir);
      const record = await registry.get(artifactId);
      if (!record || record.artifact_id !== artifactId) {
        throw new Error("missing artifact");
      }
      const bytes = await validatePersistentMp3(this.#options.artifactsDir, record);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-disposition": "inline",
        "content-length": bytes.byteLength,
        "content-type": "audio/mpeg",
        "x-content-type-options": "nosniff"
      });
      response.end(bytes);
    } catch {
      throw new WebHttpError(404, "not_found", "Resource not found.");
    }
  }
}
