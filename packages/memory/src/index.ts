import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface MemoryLabels {
  readonly sensitivity: "public" | "internal" | "personal" | "secret";
  readonly residency: "local-only" | "region-restricted" | "global-ok";
}

export interface MemoryScope {
  readonly kind: "personal" | "workspace";
  readonly workspace_id?: string;
}

export interface MemoryProvenance {
  readonly sid: string;
  readonly turn: number;
  readonly event_id: string;
  readonly quote?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly text: string;
  readonly kind: "fact" | "preference" | "event-fact";
  readonly labels: MemoryLabels;
  readonly scope: MemoryScope;
  readonly provenance: MemoryProvenance;
  readonly confidence: number;
  readonly valid_from: string;
  readonly valid_to?: string;
  readonly superseded_by?: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used?: string;
  readonly use_count: number;
}

export interface MemoryCandidate {
  readonly text: string;
  readonly source: {
    readonly sid: string;
    readonly turn: number;
    readonly event_id?: string;
  };
  readonly labels: MemoryLabels;
  readonly reason: string;
  readonly category: "preference" | "fact" | "note" | "secret";
}

export type MemoryGateDecision = "allow" | "deny" | "hold";

export interface MemoryGateResult {
  readonly candidate: MemoryCandidate;
  readonly decision: MemoryGateDecision;
  readonly memory_id: string;
  readonly reason: string;
}

export interface MemoryGateOptions {
  readonly internalDefault?: Extract<MemoryGateDecision, "allow" | "hold">;
  readonly personalDefault?: Extract<MemoryGateDecision, "allow" | "hold">;
}

export type RetrievalGateReason =
  | "admit"
  | "below_relevance_floor"
  | "deleted_or_superseded"
  | "label_clearance_denied"
  | "scope_mismatch";

export interface ScoredMemoryRecord {
  readonly record: MemoryRecord;
  readonly score: number;
}

export interface RetrievalGateContext {
  readonly requestLabels: MemoryLabels;
  readonly routeAllowed: boolean;
  readonly scope?: MemoryScope;
  readonly relevanceFloor?: number;
  readonly channelTrust?: "trusted" | "untrusted";
  readonly mode?: "chat" | "plan" | "loop" | "workflow";
}

export interface RetrievalGateResult {
  readonly decision: "allow" | "deny";
  readonly phase: "retrieval";
  readonly reason: RetrievalGateReason;
  readonly memory_id: string;
  readonly labels: MemoryLabels;
  readonly score: number;
}

export interface MemoryDigest {
  readonly content: string;
  readonly labels?: MemoryLabels;
  readonly records: readonly ScoredMemoryRecord[];
}

export interface MemoryEvidenceAllowed {
  readonly ok: true;
  readonly memory_id: string;
  readonly text: string;
  readonly labels: MemoryLabels;
  readonly provenance: MemoryProvenance;
  readonly quote?: string;
  readonly episode: readonly Record<string, unknown>[];
  readonly chronicle?: readonly {
    readonly id: string;
    readonly path: string;
    readonly provenance?: unknown;
  }[];
  readonly report_artifacts?: readonly {
    readonly path: string;
    readonly report_id: string;
  }[];
}

export interface MemoryEvidenceDenied {
  readonly ok: false;
  readonly memory_id: string;
  readonly reason: RetrievalGateReason | "not_found";
}

export type MemoryEvidenceResult = MemoryEvidenceAllowed | MemoryEvidenceDenied;

type SqlMemoryRow = {
  id: string;
  text: string;
  kind: MemoryRecord["kind"];
  sensitivity: MemoryLabels["sensitivity"];
  residency: MemoryLabels["residency"];
  scope_kind: MemoryScope["kind"];
  workspace_id: string | null;
  provenance_sid: string;
  provenance_turn: number;
  provenance_event_id: string;
  provenance_quote: string | null;
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
  last_used: string | null;
  use_count: number;
  dedupe_key: string;
};

type SqlValue = number | string | null;

type EventLike = {
  readonly actor?: unknown;
  readonly id?: unknown;
  readonly labels?: unknown;
  readonly payload?: unknown;
  readonly sid?: unknown;
  readonly ts?: unknown;
  readonly turn?: unknown;
  readonly type?: unknown;
};

const hashText = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 20);

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isLabels = (value: unknown): value is MemoryLabels =>
  isRecord(value) &&
  (value.sensitivity === "public" || value.sensitivity === "internal" || value.sensitivity === "personal" || value.sensitivity === "secret") &&
  (value.residency === "local-only" || value.residency === "region-restricted" || value.residency === "global-ok");

const labelJoin = (left: MemoryLabels, right: MemoryLabels): MemoryLabels => ({
  residency: residencyByRank[Math.max(residencyRank[left.residency], residencyRank[right.residency])] ?? "local-only",
  sensitivity: sensitivityRank[right.sensitivity] > sensitivityRank[left.sensitivity] ? right.sensitivity : left.sensitivity
});

export const deriveMemoryLabels = (
  records: readonly { readonly labels: MemoryLabels }[],
  fallback: MemoryLabels = { residency: "global-ok", sensitivity: "internal" }
): MemoryLabels => records.reduce((labels, record) => labelJoin(labels, record.labels), fallback);

const normalizeText = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

const dedupeKeyFor = (record: Pick<MemoryRecord, "kind" | "scope" | "text">): string =>
  createHash("sha256")
    .update(JSON.stringify({
      kind: record.kind,
      scope: record.scope,
      text: normalizeText(record.text)
    }))
    .digest("hex");

const stopwords = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "be",
  "do",
  "does",
  "for",
  "how",
  "i",
  "is",
  "me",
  "my",
  "of",
  "please",
  "tell",
  "that",
  "the",
  "to",
  "what",
  "which"
]);

const tokenize = (query: string): string[] =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])]
    .filter((term) => term.length > 1 && !stopwords.has(term))
    .slice(0, 12);

const shortText = (text: string, max = 140): string =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

const rowToRecord = (row: SqlMemoryRow): MemoryRecord => ({
  confidence: row.confidence,
  created_at: row.created_at,
  id: row.id,
  kind: row.kind,
  labels: { residency: row.residency, sensitivity: row.sensitivity },
  provenance: {
    ...(row.provenance_quote ? { quote: row.provenance_quote } : {}),
    event_id: row.provenance_event_id,
    sid: row.provenance_sid,
    turn: row.provenance_turn
  },
  scope: {
    kind: row.scope_kind,
    ...(row.workspace_id ? { workspace_id: row.workspace_id } : {})
  },
  text: row.text,
  updated_at: row.updated_at,
  use_count: row.use_count,
  valid_from: row.valid_from,
  ...(row.last_used ? { last_used: row.last_used } : {}),
  ...(row.superseded_by ? { superseded_by: row.superseded_by } : {}),
  ...(row.valid_to ? { valid_to: row.valid_to } : {})
});

const recordToSqlParams = (record: MemoryRecord): SqlValue[] => [
  record.id,
  record.text,
  record.kind,
  record.labels.sensitivity,
  record.labels.residency,
  record.scope.kind,
  record.scope.workspace_id ?? null,
  record.provenance.sid,
  record.provenance.turn,
  record.provenance.event_id,
  record.provenance.quote ?? null,
  record.confidence,
  record.valid_from,
  record.valid_to ?? null,
  record.superseded_by ?? null,
  record.created_at,
  record.updated_at,
  record.last_used ?? null,
  record.use_count,
  dedupeKeyFor(record)
];

const defaultNow = (): string => new Date().toISOString();

const parseJsonlEvents = <T>(raw: string): T[] => {
  const lines = raw.split(/\r?\n/);
  const lastNonEmpty = lines.reduce((last, line, index) => line.trim() ? index : last, -1);
  const events: T[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as T);
    } catch (error) {
      if (index === lastNonEmpty) {
        continue;
      }
      throw error;
    }
  }
  return events;
};

export class MemoryGate {
  readonly #internalDefault: Extract<MemoryGateDecision, "allow" | "hold">;
  readonly #personalDefault: Extract<MemoryGateDecision, "allow" | "hold">;

  constructor(options: MemoryGateOptions = {}) {
    this.#internalDefault = options.internalDefault ?? "allow";
    this.#personalDefault = options.personalDefault ?? "hold";
  }

  evaluate(candidate: MemoryCandidate): MemoryGateResult {
    const memoryId = `mem_${hashText(`${candidate.source.sid}:${candidate.source.turn}:${candidate.text}`)}`;

    if (candidate.labels.sensitivity === "secret" || candidate.category === "secret") {
      return {
        candidate,
        decision: "deny",
        memory_id: memoryId,
        reason: "secret_denied"
      };
    }

    if (candidate.labels.sensitivity === "personal") {
      return {
        candidate,
        decision: this.#personalDefault,
        memory_id: memoryId,
        reason: this.#personalDefault === "allow" ? "personal_default_allow" : "personal_default_hold"
      };
    }

    return {
      candidate,
      decision: this.#internalDefault,
      memory_id: memoryId,
      reason: this.#internalDefault === "allow" ? "explicit_remember" : "internal_default_hold"
    };
  }
}

const rememberPatterns: readonly RegExp[] = [
  /\bremember(?:\s+that)?\s+(?<text>.+)$/i,
  /\bplease remember\s+(?<text>.+)$/i,
  /(?:\u8bf7)?\u8bb0\u4f4f(?<text>.+)$/
];

export const proposeMemoryCandidate = (input: {
  readonly labels: MemoryLabels;
  readonly sid: string;
  readonly text: string;
  readonly turn: number;
  readonly event_id?: string;
}): MemoryCandidate | undefined => {
  for (const pattern of rememberPatterns) {
    const match = pattern.exec(input.text.trim());
    const text = match?.groups?.text?.trim();
    if (!text) {
      continue;
    }
    return {
      category: input.labels.sensitivity === "secret" ? "secret" : "preference",
      labels: input.labels,
      reason: "explicit_user_remember",
      source: {
        ...(input.event_id ? { event_id: input.event_id } : {}),
        sid: input.sid,
        turn: input.turn
      },
      text
    };
  }
  return undefined;
};

export const evaluateRetrievalGate = (
  scored: ScoredMemoryRecord,
  context: RetrievalGateContext
): RetrievalGateResult => {
  const floor = context.relevanceFloor ?? 0.1;
  const record = scored.record;

  if (record.valid_to || record.superseded_by) {
    return {
      decision: "deny",
      labels: record.labels,
      memory_id: record.id,
      phase: "retrieval",
      reason: "deleted_or_superseded",
      score: scored.score
    };
  }

  if (scored.score < floor) {
    return {
      decision: "deny",
      labels: record.labels,
      memory_id: record.id,
      phase: "retrieval",
      reason: "below_relevance_floor",
      score: scored.score
    };
  }

  if (context.scope) {
    const sameKind = context.scope.kind === record.scope.kind;
    const sameWorkspace = record.scope.kind !== "workspace" || context.scope.workspace_id === record.scope.workspace_id;
    if (!sameKind || !sameWorkspace) {
      return {
        decision: "deny",
        labels: record.labels,
        memory_id: record.id,
        phase: "retrieval",
        reason: "scope_mismatch",
        score: scored.score
      };
    }
  }

  if (!context.routeAllowed) {
    return {
      decision: "deny",
      labels: record.labels,
      memory_id: record.id,
      phase: "retrieval",
      reason: "label_clearance_denied",
      score: scored.score
    };
  }

  return {
    decision: "allow",
    labels: record.labels,
    memory_id: record.id,
    phase: "retrieval",
    reason: "admit",
    score: scored.score
  };
};

export const renderMemoryDigest = (
  records: readonly ScoredMemoryRecord[],
  options: { readonly estimatedTokenBudget?: number } = {}
): MemoryDigest => {
  const maxChars = Math.max(1, (options.estimatedTokenBudget ?? 600) * 4);
  const lines: string[] = [];
  const admitted: ScoredMemoryRecord[] = [];
  let used = 0;

  for (const scored of records) {
    const confidence = scored.record.confidence >= 0.8 ? "high" : scored.record.confidence >= 0.5 ? "med" : "low";
    const line = `- ${scored.record.id} ${scored.record.kind} confidence=${confidence}: ${shortText(scored.record.text)} (source ${scored.record.provenance.sid}#${scored.record.provenance.turn}/${scored.record.provenance.event_id})`;
    if (used + line.length > maxChars && lines.length > 0) {
      break;
    }
    lines.push(line);
    admitted.push(scored);
    used += line.length;
  }

  if (lines.length === 0) {
    return { content: "", records: [] };
  }

  return {
    content: ["Memory digest:", ...lines].join("\n"),
    labels: deriveMemoryLabels(admitted.map((item) => item.record)),
    records: admitted
  };
};

export class MemoryStore {
  readonly #dataDir: string;
  readonly #db: DatabaseSync;
  readonly #ftsAvailable: boolean;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "core.db"));
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'event-fact')),
        sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public', 'internal', 'personal', 'secret')),
        residency TEXT NOT NULL CHECK(residency IN ('local-only', 'region-restricted', 'global-ok')),
        scope_kind TEXT NOT NULL CHECK(scope_kind IN ('personal', 'workspace')),
        workspace_id TEXT,
        provenance_sid TEXT NOT NULL,
        provenance_turn INTEGER NOT NULL,
        provenance_event_id TEXT NOT NULL,
        provenance_quote TEXT,
        confidence REAL NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        superseded_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        dedupe_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_records_kind ON memory_records(kind);
      CREATE INDEX IF NOT EXISTS idx_memory_records_labels ON memory_records(sensitivity, residency);
      CREATE INDEX IF NOT EXISTS idx_memory_records_scope ON memory_records(scope_kind, workspace_id);
      CREATE INDEX IF NOT EXISTS idx_memory_records_active ON memory_records(valid_to, superseded_by);
      CREATE TABLE IF NOT EXISTS memory_tombstones (
        memory_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL,
        event_id TEXT NOT NULL,
        reason TEXT NOT NULL
      );
    `);
    this.#ftsAvailable = this.#tryInitFts();
  }

  insert(record: MemoryRecord): MemoryRecord {
    if (record.labels.sensitivity === "secret") {
      throw new Error("secret memory records must not be persisted");
    }
    if (!record.provenance.sid || !record.provenance.event_id || !Number.isInteger(record.provenance.turn)) {
      throw new Error("memory records require provenance sid, turn, and event_id");
    }
    if (this.#isTombstoned(record.id)) {
      return this.get(record.id) ?? record;
    }

    const dedupeKey = dedupeKeyFor(record);
    const existing = this.#db.prepare("SELECT * FROM memory_records WHERE dedupe_key = ? LIMIT 1").get(dedupeKey) as SqlMemoryRow | undefined;
    if (existing) {
      const updated = {
        ...rowToRecord(existing),
        confidence: Math.min(1, Math.max(existing.confidence, record.confidence) + 0.02),
        updated_at: record.updated_at,
        use_count: existing.use_count + 1
      } satisfies MemoryRecord;
      this.#writeRecord(updated);
      return updated;
    }

    this.#writeRecord(record);
    return record;
  }

  insertFromWrittenEvent(event: EventLike): MemoryRecord | undefined {
    if (event.type !== "memory.written" || !isRecord(event.payload) || !isLabels(event.labels)) {
      return undefined;
    }
    if (event.labels.sensitivity === "secret") {
      throw new Error("secret memory.written event cannot be projected");
    }

    const memoryId = typeof event.payload.memory_id === "string" ? event.payload.memory_id : undefined;
    const text = typeof event.payload.summary === "string" ? event.payload.summary : undefined;
    const eventId = typeof event.id === "string" ? event.id : undefined;
    const sid = typeof event.sid === "string" ? event.sid : undefined;
    const turn = typeof event.turn === "number" ? event.turn : undefined;
    if (!memoryId || !text || !eventId || !sid || turn === undefined) {
      throw new Error("memory.written projection requires memory_id, summary, sid, turn, and event id");
    }

    const source = isRecord(event.payload.source) ? event.payload.source : {};
    const scope = isRecord(event.payload.scope) && event.payload.scope.kind === "workspace"
      ? {
          kind: "workspace" as const,
          ...(typeof event.payload.scope.workspace_id === "string" ? { workspace_id: event.payload.scope.workspace_id } : {})
        }
      : { kind: "personal" as const };
    const kind = event.payload.kind === "fact" || event.payload.kind === "event-fact" || event.payload.kind === "preference"
      ? event.payload.kind
      : "preference";
    const now = typeof event.ts === "string" ? event.ts : defaultNow();

    return this.insert({
      confidence: typeof event.payload.confidence === "number" ? event.payload.confidence : 0.8,
      created_at: now,
      id: memoryId,
      kind,
      labels: event.labels,
      provenance: {
        event_id: typeof source.event_id === "string" ? source.event_id : eventId,
        ...(typeof source.quote === "string" ? { quote: source.quote } : { quote: text }),
        sid: typeof source.sid === "string" ? source.sid : sid,
        turn: typeof source.turn === "number" ? source.turn : turn
      },
      scope,
      text,
      updated_at: now,
      use_count: 0,
      valid_from: typeof event.payload.valid_from === "string" ? event.payload.valid_from : now
    });
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM memory_records WHERE id = ? LIMIT 1").get(id) as SqlMemoryRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  list(): MemoryRecord[] {
    return (this.#db.prepare(
      "SELECT * FROM memory_records WHERE valid_to IS NULL AND superseded_by IS NULL ORDER BY updated_at DESC, id ASC"
    ).all() as unknown as SqlMemoryRow[]).map(rowToRecord);
  }

  search(query: string, options: { readonly limit?: number; readonly includeIrrelevant?: boolean } = {}): ScoredMemoryRecord[] {
    const limit = options.limit ?? 10;
    const terms = tokenize(query);
    const rows = this.#candidateRows(query, terms);
    return rows
      .map((row) => ({ record: rowToRecord(row), score: this.#scoreRow(row, terms) }))
      .filter((item) => options.includeIrrelevant === true || item.score > 0)
      .sort((left, right) => right.score - left.score || right.record.updated_at.localeCompare(left.record.updated_at))
      .slice(0, limit);
  }

  markUsed(id: string, at = defaultNow()): void {
    this.#db.prepare("UPDATE memory_records SET last_used = ?, use_count = use_count + 1, updated_at = ? WHERE id = ?").run(at, at, id);
  }

  delete(id: string, options: { readonly event_id: string; readonly reason: string; readonly deleted_at?: string }): void {
    const deletedAt = options.deleted_at ?? defaultNow();
    this.#db.prepare(
      "INSERT OR REPLACE INTO memory_tombstones (memory_id, deleted_at, event_id, reason) VALUES (?, ?, ?, ?)"
    ).run(id, deletedAt, options.event_id, options.reason);
    this.#db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
    this.#deleteFts(id);
  }

  supersede(id: string, supersededBy: string, at = defaultNow()): void {
    this.#db.prepare("UPDATE memory_records SET valid_to = ?, superseded_by = ?, updated_at = ? WHERE id = ?")
      .run(at, supersededBy, at, id);
  }

  processEvent(event: EventLike): void {
    if (event.type === "memory.written") {
      this.insertFromWrittenEvent(event);
      return;
    }
    if (event.type === "memory.deleted" && isRecord(event.payload) && typeof event.payload.memory_id === "string") {
      this.delete(event.payload.memory_id, {
        event_id: typeof event.id === "string" ? event.id : `evt_${hashText(event.payload.memory_id)}`,
        reason: typeof event.payload.reason === "string" ? event.payload.reason : "deleted",
        ...(typeof event.ts === "string" ? { deleted_at: event.ts } : {})
      });
      return;
    }
    if (
      event.type === "memory.superseded" &&
      isRecord(event.payload) &&
      typeof event.payload.memory_id === "string" &&
      typeof event.payload.superseded_by === "string"
    ) {
      this.supersede(event.payload.memory_id, event.payload.superseded_by, typeof event.ts === "string" ? event.ts : undefined);
    }
  }

  async rebuildFromSessionLogs(): Promise<{ records: number; tombstones: number }> {
    this.#clearProjection();
    const events = await this.#readAllSessionEvents();
    for (const event of events) {
      this.processEvent(event);
    }
    const records = (this.#db.prepare("SELECT COUNT(*) AS count FROM memory_records").get() as { count: number }).count;
    const tombstones = (this.#db.prepare("SELECT COUNT(*) AS count FROM memory_tombstones").get() as { count: number }).count;
    return { records, tombstones };
  }

  async evidence(id: string, context: RetrievalGateContext): Promise<MemoryEvidenceResult> {
    const record = this.get(id);
    if (!record) {
      return { memory_id: id, ok: false, reason: "not_found" };
    }
    const gate = evaluateRetrievalGate({ record, score: 1 }, context);
    if (gate.decision !== "allow") {
      return { memory_id: id, ok: false, reason: gate.reason };
    }

    return {
      ...(await this.#chronicleRefsFor(record)),
      episode: await this.#episodeSlice(record.provenance),
      labels: record.labels,
      memory_id: id,
      ok: true,
      provenance: record.provenance,
      ...(record.provenance.quote ? { quote: record.provenance.quote } : {}),
      text: record.text
    };
  }

  #writeRecord(record: MemoryRecord): void {
    this.#db.prepare(`
      INSERT OR REPLACE INTO memory_records (
        id, text, kind, sensitivity, residency, scope_kind, workspace_id,
        provenance_sid, provenance_turn, provenance_event_id, provenance_quote,
        confidence, valid_from, valid_to, superseded_by,
        created_at, updated_at, last_used, use_count, dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...recordToSqlParams(record));
    this.#upsertFts(record);
  }

  #candidateRows(query: string, terms: readonly string[]): SqlMemoryRow[] {
    if (this.#ftsAvailable && terms.length > 0) {
      try {
        const match = terms.map((term) => `${term.replace(/"/g, "")}*`).join(" OR ");
        const ftsRows = this.#db.prepare(`
          SELECT r.* FROM memory_records_fts f
          JOIN memory_records r ON r.id = f.id
          WHERE memory_records_fts MATCH ?
            AND r.valid_to IS NULL
            AND r.superseded_by IS NULL
          LIMIT 50
        `).all(match) as unknown as SqlMemoryRow[];
        if (ftsRows.length > 0) {
          return ftsRows;
        }
      } catch {
        // Fall through to deterministic lexical scan; malformed FTS queries should
        // never make retrieval fail closed for safe records.
      }
    }

    const rows = this.#db.prepare(
      "SELECT * FROM memory_records WHERE valid_to IS NULL AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT 200"
    ).all() as unknown as SqlMemoryRow[];
    if (!query.trim()) {
      return rows;
    }
    return rows;
  }

  #scoreRow(row: SqlMemoryRow, terms: readonly string[]): number {
    if (terms.length === 0) {
      return 0.5;
    }
    const haystack = `${row.text} ${row.kind}`.toLowerCase();
    const matches = terms.filter((term) => haystack.includes(term)).length;
    if (matches === 0) {
      return 0;
    }
    const lexical = matches / terms.length;
    const recency = Math.max(0, 1 - Math.min(365, (Date.now() - Date.parse(row.updated_at || row.created_at)) / 86_400_000) / 365) * 0.1;
    const frequency = Math.min(row.use_count, 10) * 0.02;
    const tier = row.kind === "preference" ? 0.12 : row.kind === "fact" ? 0.08 : 0.04;
    return lexical + recency + frequency + tier;
  }

  #isTombstoned(id: string): boolean {
    const row = this.#db.prepare("SELECT 1 AS ok FROM memory_tombstones WHERE memory_id = ? LIMIT 1").get(id) as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  #tryInitFts(): boolean {
    try {
      this.#db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(id UNINDEXED, text, kind)");
      return true;
    } catch {
      return false;
    }
  }

  #upsertFts(record: MemoryRecord): void {
    if (!this.#ftsAvailable) {
      return;
    }
    this.#db.prepare("DELETE FROM memory_records_fts WHERE id = ?").run(record.id);
    this.#db.prepare("INSERT INTO memory_records_fts (id, text, kind) VALUES (?, ?, ?)").run(record.id, record.text, record.kind);
  }

  #deleteFts(id: string): void {
    if (this.#ftsAvailable) {
      this.#db.prepare("DELETE FROM memory_records_fts WHERE id = ?").run(id);
    }
  }

  #clearProjection(): void {
    this.#db.exec(`
      DELETE FROM memory_records;
      DELETE FROM memory_tombstones;
    `);
    if (this.#ftsAvailable) {
      this.#db.exec("DELETE FROM memory_records_fts");
    }
  }

  async #readAllSessionEvents(): Promise<EventLike[]> {
    const sessionsDir = join(this.#dataDir, "sessions");
    let entries: Dirent<string>[];
    try {
      entries = await readdir(sessionsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events: EventLike[] = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(sessionsDir, entry.name, "log.jsonl");
      let raw = "";
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      events.push(...parseJsonlEvents<EventLike>(raw));
    }
    return events.sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
  }

  async #episodeSlice(provenance: MemoryProvenance): Promise<Record<string, unknown>[]> {
    const path = join(this.#dataDir, "sessions", provenance.sid, "log.jsonl");
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return [];
    }
    const events = parseJsonlEvents<Record<string, unknown>>(raw);
    const index = events.findIndex((event) => event.id === provenance.event_id);
    const center = index >= 0 ? index : events.findIndex((event) => event.turn === provenance.turn);
    if (center < 0) {
      return events.slice(0, 3);
    }
    return events.slice(Math.max(0, center - 2), center + 3);
  }

  async #chronicleRefsFor(record: MemoryRecord): Promise<{
    chronicle?: readonly { id: string; path: string; provenance?: unknown }[];
    report_artifacts?: readonly { path: string; report_id: string }[];
  }> {
    const chronicle = await this.#matchingChronicleRefs(record);
    const reportArtifacts = await this.#matchingReportArtifacts(record);
    return {
      ...(chronicle.length > 0 ? { chronicle } : {}),
      ...(reportArtifacts.length > 0 ? { report_artifacts: reportArtifacts } : {})
    };
  }

  async #matchingChronicleRefs(record: MemoryRecord): Promise<{ id: string; path: string; provenance?: unknown }[]> {
    const root = join(this.#dataDir, "chronicle");
    let workspaces: Dirent<string>[];
    try {
      workspaces = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const refs: { id: string; path: string; provenance?: unknown }[] = [];
    for (const workspace of workspaces.filter((entry) => entry.isDirectory())) {
      const path = join(root, workspace.name, "chronicle.jsonl");
      let raw = "";
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      for (const entry of parseJsonlEvents<Record<string, unknown>>(raw)) {
        const provenance = isRecord(entry.provenance) ? entry.provenance : {};
        if (
          provenance.event_id === record.provenance.event_id ||
          (provenance.sid === record.provenance.sid && provenance.turn === record.provenance.turn)
        ) {
          refs.push({
            id: typeof entry.id === "string" ? entry.id : "unknown",
            path,
            ...(isRecord(entry.provenance) ? { provenance: entry.provenance } : {})
          });
        }
      }
    }
    return refs.sort((left, right) => left.id.localeCompare(right.id));
  }

  async #matchingReportArtifacts(record: MemoryRecord): Promise<{ path: string; report_id: string }[]> {
    const reportsDir = join(this.#dataDir, "artifacts", "memory", "reports");
    let entries: Dirent<string>[];
    try {
      entries = await readdir(reportsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const refs: { path: string; report_id: string }[] = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json") && item.name !== "latest.json")) {
      const path = join(reportsDir, entry.name);
      const raw = await readFile(path, "utf8");
      if (!raw.includes(record.id) && !raw.includes(record.provenance.event_id)) {
        continue;
      }
      const parsed = JSON.parse(raw) as { id?: unknown };
      refs.push({ path, report_id: typeof parsed.id === "string" ? parsed.id : entry.name.replace(/\.json$/, "") });
    }
    return refs.sort((left, right) => left.report_id.localeCompare(right.report_id));
  }
}

export {
  ChroniclePolicyError,
  ChronicleStore,
  deriveChronicleLabels,
  renderChronicleDigest,
  workspaceIdForRoot
} from "./chronicle.js";
export type {
  ChronicleAppendInput,
  ChronicleContentLabeler,
  ChronicleDigest,
  ChronicleKind,
  ChronicleProvenance,
  ChronicleQueryResult,
  ChronicleRecord,
  ChronicleStoreOptions
} from "./chronicle.js";
export { consolidateMemory, readLatestConsolidationReport } from "./consolidation.js";
export type {
  ConsolidationArtifactEvent,
  ConsolidationArtifactRef,
  ConsolidationOptions,
  ConsolidationProvenanceQuote,
  ConsolidationReport
} from "./consolidation.js";
