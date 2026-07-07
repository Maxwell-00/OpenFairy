import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { MemoryLabels } from "./index.js";

export type ChronicleKind = "attempt" | "failure" | "decision" | "outcome" | "fragile-file" | "note";

export interface ChronicleProvenance {
  readonly sid?: string;
  readonly turn?: number;
  readonly event_id?: string;
  readonly source?: string;
}

export interface ChronicleRecord {
  readonly id: string;
  readonly created_at: string;
  readonly kind: ChronicleKind;
  readonly summary: string;
  readonly details?: string;
  readonly labels: MemoryLabels;
  readonly workspace: {
    readonly id: string;
    readonly root: string;
  };
  readonly files: readonly string[];
  readonly topics: readonly string[];
  readonly provenance: ChronicleProvenance;
  readonly supersedes?: readonly string[];
  readonly related?: readonly string[];
}

export interface ChronicleAppendInput {
  readonly kind: ChronicleKind;
  readonly summary: string;
  readonly details?: string;
  readonly labels?: MemoryLabels;
  readonly files?: readonly string[];
  readonly topics?: readonly string[];
  readonly provenance?: ChronicleProvenance;
  readonly created_at?: string;
  readonly supersedes?: readonly string[];
  readonly related?: readonly string[];
  readonly allowPersonal?: boolean;
}

export interface ChronicleQueryResult {
  readonly record: ChronicleRecord;
  readonly score: number;
}

export interface ChronicleDigest {
  readonly content: string;
  readonly labels?: MemoryLabels;
  readonly records: readonly ChronicleQueryResult[];
}

export type ChronicleContentLabeler = (
  text: string,
  labels: MemoryLabels
) => { readonly labels: MemoryLabels } | MemoryLabels;

export interface ChronicleStoreOptions {
  readonly workspaceRoot?: string;
  readonly workspaceId?: string;
  readonly defaultLabels?: MemoryLabels;
  readonly labelContent?: ChronicleContentLabeler;
  readonly allowPersonal?: boolean;
  readonly clock?: () => string;
}

export class ChroniclePolicyError extends Error {
  readonly code: "personal_requires_explicit_workspace_scope" | "secret_denied";

  constructor(code: ChroniclePolicyError["code"], message: string) {
    super(message);
    this.name = "ChroniclePolicyError";
    this.code = code;
  }
}

const defaultLabels: MemoryLabels = { residency: "global-ok", sensitivity: "internal" };

const sensitivityRank: Record<MemoryLabels["sensitivity"], number> = {
  public: 0,
  internal: 1,
  personal: 2,
  secret: 3
};

const residencyRank: Record<MemoryLabels["residency"], number> = {
  "global-ok": 0,
  "region-restricted": 1,
  "local-only": 2
};

const residencyByRank = ["global-ok", "region-restricted", "local-only"] as const;

const stopwords = new Set([
  "a",
  "about",
  "and",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "please",
  "the",
  "to",
  "what",
  "with"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

const hash = (value: unknown, length = 20): string =>
  createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex").slice(0, length);

const nowIso = (): string => new Date().toISOString();

export const workspaceIdForRoot = (workspaceRoot: string): string =>
  `ws_${hash(resolve(workspaceRoot).replace(/\\/g, "/"), 16)}`;

const labelJoin = (left: MemoryLabels, right: MemoryLabels): MemoryLabels => ({
  residency: residencyByRank[Math.max(residencyRank[left.residency], residencyRank[right.residency])] ?? "local-only",
  sensitivity: sensitivityRank[right.sensitivity] > sensitivityRank[left.sensitivity] ? right.sensitivity : left.sensitivity
});

export const deriveChronicleLabels = (
  records: readonly { readonly labels: MemoryLabels }[],
  fallback: MemoryLabels = defaultLabels
): MemoryLabels => records.reduce((labels, record) => labelJoin(labels, record.labels), fallback);

const normalizeArray = (values: readonly string[] | undefined): string[] =>
  [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));

const tokenize = (query: string): string[] =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_./\\-]+/gu) ?? [])]
    .filter((term) => term.length > 1 && !stopwords.has(term))
    .slice(0, 18);

const shortText = (text: string, max = 160): string =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

const labelsFromLabelerResult = (result: ReturnType<ChronicleContentLabeler>): MemoryLabels =>
  "labels" in result ? result.labels : result;

const isChronicleRecord = (value: unknown): value is ChronicleRecord =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.created_at === "string" &&
  typeof value.kind === "string" &&
  typeof value.summary === "string" &&
  isRecord(value.labels) &&
  isRecord(value.workspace) &&
  Array.isArray(value.files) &&
  Array.isArray(value.topics);

export class ChronicleStore {
  readonly #allowPersonal: boolean;
  readonly #clock: () => string;
  readonly #dataDir: string;
  readonly #defaultLabels: MemoryLabels;
  readonly #labelContent: ChronicleContentLabeler | undefined;
  readonly #workspaceId: string;
  readonly #workspaceRoot: string;

  constructor(dataDir: string, options: ChronicleStoreOptions = {}) {
    this.#dataDir = resolve(dataDir);
    this.#workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.#workspaceId = options.workspaceId ?? workspaceIdForRoot(this.#workspaceRoot);
    this.#defaultLabels = options.defaultLabels ?? defaultLabels;
    this.#labelContent = options.labelContent;
    this.#allowPersonal = options.allowPersonal ?? false;
    this.#clock = options.clock ?? nowIso;
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get workspaceRoot(): string {
    return this.#workspaceRoot;
  }

  get path(): string {
    return join(this.#dataDir, "chronicle", this.#workspaceId, "chronicle.jsonl");
  }

  async append(input: ChronicleAppendInput): Promise<ChronicleRecord> {
    const summary = input.summary.trim();
    if (!summary) {
      throw new Error("chronicle summary must be non-empty");
    }

    const files = normalizeArray(input.files);
    const topics = normalizeArray(input.topics);
    const labels = this.#labelsFor(input);
    const createdAt = input.created_at ?? this.#clock();
    const record: ChronicleRecord = {
      created_at: createdAt,
      files,
      id: `chr_${hash({
        created_at: createdAt,
        details: input.details?.trim() ?? "",
        files,
        kind: input.kind,
        summary,
        topics,
        workspace: this.#workspaceId
      })}`,
      kind: input.kind,
      labels,
      provenance: input.provenance ?? { source: "user:chronicle" },
      summary,
      topics,
      workspace: {
        id: this.#workspaceId,
        root: this.#workspaceRoot
      },
      ...(input.details?.trim() ? { details: input.details.trim() } : {}),
      ...(input.related && input.related.length > 0 ? { related: normalizeArray(input.related) } : {}),
      ...(input.supersedes && input.supersedes.length > 0 ? { supersedes: normalizeArray(input.supersedes) } : {})
    };

    await mkdir(join(this.#dataDir, "chronicle", this.#workspaceId), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async list(): Promise<ChronicleRecord[]> {
    const records = await this.#readAll();
    return records.sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id));
  }

  async get(id: string): Promise<ChronicleRecord | undefined> {
    return (await this.list()).find((record) => record.id === id);
  }

  async query(query: string, options: { readonly includeIrrelevant?: boolean; readonly limit?: number } = {}): Promise<ChronicleQueryResult[]> {
    const terms = tokenize(query);
    const limit = options.limit ?? 6;
    const records = await this.list();
    return records
      .map((record) => ({ record, score: this.#score(record, terms) }))
      .filter((item) => options.includeIrrelevant === true || item.score > 0)
      .sort((left, right) => right.score - left.score || right.record.created_at.localeCompare(left.record.created_at))
      .slice(0, limit);
  }

  #labelsFor(input: ChronicleAppendInput): MemoryLabels {
    const base = input.labels ?? this.#defaultLabels;
    const content = [
      input.summary,
      input.details ?? "",
      ...(input.files ?? []),
      ...(input.topics ?? [])
    ].join("\n");
    const labels = this.#labelContent
      ? labelsFromLabelerResult(this.#labelContent(content, base))
      : base;
    if (labels.sensitivity === "secret") {
      throw new ChroniclePolicyError("secret_denied", "secret content must not be written to Chronicle");
    }
    if (labels.sensitivity === "personal" && !(input.allowPersonal ?? this.#allowPersonal)) {
      throw new ChroniclePolicyError(
        "personal_requires_explicit_workspace_scope",
        "personal content requires explicit workspace-scoped Chronicle admission"
      );
    }
    return labels;
  }

  async #readAll(): Promise<ChronicleRecord[]> {
    let raw = "";
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const lines = raw.split(/\r?\n/);
    const records: ChronicleRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as unknown;
      if (isChronicleRecord(parsed) && parsed.workspace.id === this.#workspaceId) {
        records.push(parsed);
      }
    }
    return records;
  }

  #score(record: ChronicleRecord, terms: readonly string[]): number {
    if (terms.length === 0) {
      return 0.5;
    }
    const files = record.files.map((file) => file.toLowerCase());
    const topics = record.topics.map((topic) => topic.toLowerCase());
    const haystack = [
      record.kind,
      record.summary,
      record.details ?? "",
      ...files,
      ...topics
    ].join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) {
      const normalized = term.toLowerCase();
      if (topics.includes(normalized)) {
        score += 0.55;
      } else if (files.some((file) => file.includes(normalized) || normalized.includes(file))) {
        score += 0.5;
      } else if (haystack.includes(normalized)) {
        score += 0.25;
      }
    }
    if (record.kind === "failure" || record.kind === "fragile-file") {
      score += 0.05;
    }
    return score;
  }
}

export const renderChronicleDigest = (
  results: readonly ChronicleQueryResult[],
  options: { readonly estimatedTokenBudget?: number } = {}
): ChronicleDigest => {
  const maxChars = Math.max(1, (options.estimatedTokenBudget ?? 500) * 4);
  const lines: string[] = [];
  const admitted: ChronicleQueryResult[] = [];
  let used = 0;
  for (const result of results) {
    const record = result.record;
    const refs = [
      record.files.length > 0 ? `files=${record.files.join(",")}` : "",
      record.topics.length > 0 ? `topics=${record.topics.join(",")}` : "",
      `source=${record.provenance.sid ?? record.provenance.source ?? "chronicle"}${record.provenance.turn !== undefined ? `#${record.provenance.turn}` : ""}`
    ].filter(Boolean).join(" ");
    const line = `- ${record.id} ${record.kind}: ${shortText(record.summary)} (${refs})`;
    if (used + line.length > maxChars && lines.length > 0) {
      break;
    }
    lines.push(line);
    admitted.push(result);
    used += line.length;
  }

  if (lines.length === 0) {
    return { content: "", records: [] };
  }

  return {
    content: ["Chronicle digest:", ...lines].join("\n"),
    labels: deriveChronicleLabels(admitted.map((item) => item.record)),
    records: admitted
  };
};
