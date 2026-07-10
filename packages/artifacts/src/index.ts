import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

export interface ArtifactLabels {
  readonly sensitivity: "public" | "internal" | "personal" | "secret";
  readonly residency: "local-only" | "region-restricted" | "global-ok";
}

export interface ArtifactRecord {
  readonly artifact_id: string;
  readonly hash: string;
  readonly kind: "input" | "perception" | "speech";
  readonly labels: ArtifactLabels;
  readonly mime: string;
  readonly origin: string;
  readonly path: string;
  readonly size_bytes: number;
  readonly created_event_id?: string;
  readonly metadata?: Record<string, unknown>;
  readonly source_filename?: string;
}

export interface RegisterArtifactOptions {
  readonly content: Buffer | string;
  readonly kind?: ArtifactRecord["kind"];
  readonly labels: ArtifactLabels;
  readonly metadata?: Record<string, unknown>;
  readonly mime?: string;
  readonly origin: string;
  readonly sourceFilename?: string;
}

const hashBuffer = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

const extensionForMime = (mime: string, sourceFilename?: string): string => {
  const sourceExtension = sourceFilename ? extname(sourceFilename).toLowerCase() : "";
  if (sourceExtension && /^[.][a-z0-9]+$/i.test(sourceExtension)) {
    return sourceExtension;
  }
  if (mime === "image/png") {
    return ".png";
  }
  if (mime === "image/jpeg") {
    return ".jpg";
  }
  if (mime === "application/pdf") {
    return ".pdf";
  }
  if (mime === "application/json") {
    return ".json";
  }
  if (mime === "audio/mpeg") {
    return ".mp3";
  }
  if (mime.startsWith("text/")) {
    return ".txt";
  }
  return ".bin";
};

export const detectMime = (sourceFilename?: string, fallback = "application/octet-stream"): string => {
  const extension = sourceFilename ? extname(sourceFilename).toLowerCase() : "";
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".md") {
    return "text/markdown";
  }
  if (extension === ".txt") {
    return "text/plain";
  }
  if (extension === ".mp3") {
    return "audio/mpeg";
  }
  return fallback;
};

const assertInside = (root: string, target: string): void => {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`artifact path escapes artifact root: ${target}`);
};

const safeArtifactPath = (root: string, kind: ArtifactRecord["kind"], artifactId: string, mime: string, sourceFilename?: string): string => {
  const directory = kind === "input" ? "inputs" : kind === "perception" ? "perception" : "speech";
  const target = resolve(root, directory, `${artifactId}${extensionForMime(mime, sourceFilename)}`);
  assertInside(resolve(root), target);
  return target;
};

const parseJsonLine = (line: string): ArtifactRecord | undefined => {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { artifact_id?: unknown }).artifact_id === "string"
      ? parsed as ArtifactRecord
      : undefined;
  } catch {
    return undefined;
  }
};

export const artifactEventPayload = (record: ArtifactRecord): Record<string, unknown> => ({
  artifact_id: record.artifact_id,
  hash: record.hash,
  kind: record.kind,
  labels: record.labels,
  mime: record.mime,
  origin: record.origin,
  path: record.path,
  size_bytes: record.size_bytes,
  ...(record.created_event_id ? { created_event_id: record.created_event_id } : {}),
  ...(record.source_filename ? { source_filename: record.source_filename } : {}),
  ...(record.metadata ? { metadata: record.metadata } : {})
});

export class ArtifactRegistry {
  readonly #artifactsDir: string;
  readonly #registryPath: string;

  constructor(artifactsDir: string) {
    this.#artifactsDir = resolve(artifactsDir);
    this.#registryPath = resolve(this.#artifactsDir, "artifacts.jsonl");
  }

  artifactsDir(): string {
    return this.#artifactsDir;
  }

  async list(): Promise<ArtifactRecord[]> {
    try {
      const raw = await readFile(this.#registryPath, "utf8");
      return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(parseJsonLine).filter((item): item is ArtifactRecord => Boolean(item));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async get(identifier: string): Promise<ArtifactRecord | undefined> {
    const artifacts = await this.list();
    const normalized = resolve(this.#artifactsDir, identifier);
    return artifacts.find((artifact) =>
      artifact.artifact_id === identifier ||
      artifact.hash === identifier ||
      artifact.path === identifier ||
      artifact.path === normalized ||
      relative(this.#artifactsDir, artifact.path).replace(/\\/g, "/") === identifier.replace(/\\/g, "/")
    );
  }

  async register(options: RegisterArtifactOptions): Promise<{ created: boolean; record: ArtifactRecord }> {
    const content = Buffer.isBuffer(options.content) ? options.content : Buffer.from(options.content, "utf8");
    const hash = hashBuffer(content);
    const artifactId = `art_${hash.slice(0, 20)}`;
    const kind = options.kind ?? "input";
    const mime = options.mime ?? detectMime(options.sourceFilename);
    const path = safeArtifactPath(this.#artifactsDir, kind, artifactId, mime, options.sourceFilename);
    const existing = await this.get(artifactId);
    if (existing) {
      return { created: false, record: existing };
    }

    const record: ArtifactRecord = {
      artifact_id: artifactId,
      hash: `sha256:${hash}`,
      kind,
      labels: options.labels,
      mime,
      origin: options.origin,
      path,
      size_bytes: content.byteLength,
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(options.sourceFilename ? { source_filename: options.sourceFilename } : {})
    };
    const directory = kind === "input" ? "inputs" : kind === "perception" ? "perception" : "speech";
    await mkdir(resolve(this.#artifactsDir, directory), { recursive: true });
    await writeFile(path, content);
    await mkdir(this.#artifactsDir, { recursive: true });
    await writeFile(this.#registryPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
    return { created: true, record };
  }

  async readText(record: ArtifactRecord): Promise<string> {
    const target = resolve(record.path);
    assertInside(this.#artifactsDir, target);
    return readFile(target, "utf8");
  }
}
