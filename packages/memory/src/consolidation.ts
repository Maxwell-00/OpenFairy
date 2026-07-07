import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { deriveChronicleLabels, type ChronicleContentLabeler, type ChronicleKind } from "./chronicle.js";
import type { MemoryLabels, MemoryRecord } from "./index.js";

export interface ConsolidationArtifactRef {
  readonly event: ConsolidationArtifactEvent;
  readonly hash: string;
  readonly id: string;
  readonly labels: MemoryLabels;
  readonly path: string;
}

export interface ConsolidationArtifactEvent {
  readonly actor: "system";
  readonly id: `evt_${string}`;
  readonly labels: MemoryLabels;
  readonly payload: {
    readonly hash: string;
    readonly kind: "memory.consolidation.report";
    readonly labels: MemoryLabels;
    readonly mime: "application/json";
    readonly origin: "memory.consolidation";
    readonly path: string;
    readonly report_id: string;
    readonly source_range: {
      readonly from: string;
      readonly to?: string;
      readonly sessions: readonly string[];
    };
  };
  readonly provenance: "agent";
  readonly sid: `ses_${string}`;
  readonly ts: string;
  readonly turn: 0;
  readonly type: "artifact.created";
  readonly v: 1;
}

export interface ConsolidationReport {
  readonly id: string;
  readonly created_at: string;
  readonly input_hash: string;
  readonly labels: MemoryLabels;
  readonly range: {
    readonly from: string;
    readonly to?: string;
    readonly sessions: readonly string[];
  };
  readonly artifact: Omit<ConsolidationArtifactRef, "event">;
  readonly episode_summary: {
    readonly event_count: number;
    readonly sessions: readonly string[];
    readonly turns: readonly number[];
    readonly tool_error_count: number;
    readonly final_count: number;
  };
  readonly candidate_memories: readonly {
    readonly id: string;
    readonly summary: string;
    readonly labels: MemoryLabels;
    readonly admission: "candidate_only" | "held";
    readonly provenance: ConsolidationProvenanceQuote;
  }[];
  readonly contradiction_suggestions: readonly {
    readonly reason: string;
    readonly memory_ids: readonly string[];
    readonly suggestion: string;
  }[];
  readonly chronicle_candidates: readonly {
    readonly kind: ChronicleKind;
    readonly summary: string;
    readonly labels: MemoryLabels;
    readonly provenance: ConsolidationProvenanceQuote;
  }[];
  readonly learned_skill_drafts: readonly {
    readonly id: string;
    readonly path: string;
    readonly status: "pending";
  }[];
  readonly redactions: readonly {
    readonly event_id: string;
    readonly quote: string;
    readonly reason: "secret";
  }[];
  readonly deferred: readonly string[];
}

export interface ConsolidationProvenanceQuote {
  readonly sid: string;
  readonly turn: number;
  readonly event_id: string;
  readonly quote: string;
}

export interface ConsolidationOptions {
  readonly from: string;
  readonly to?: string;
  readonly dataDir: string;
  readonly workspaceRoot?: string;
  readonly learnedSkillPendingDir?: string;
  readonly labelContent?: ChronicleContentLabeler;
  readonly redactText?: (text: string) => string;
  readonly memoryRecords?: readonly MemoryRecord[];
}

interface EventLike {
  readonly actor?: unknown;
  readonly id?: unknown;
  readonly labels?: unknown;
  readonly payload?: unknown;
  readonly sid?: unknown;
  readonly ts?: unknown;
  readonly turn?: unknown;
  readonly type?: unknown;
}

interface SanitizedEvent {
  readonly event: EventLike;
  readonly event_id: string;
  readonly labels: MemoryLabels;
  readonly quote: string;
  readonly redacted: boolean;
  readonly sid: string;
  readonly ts: string;
  readonly turn: number;
  readonly type: string;
}

const internalLabels: MemoryLabels = { residency: "global-ok", sensitivity: "internal" };

const base32Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isLabels = (value: unknown): value is MemoryLabels =>
  isRecord(value) &&
  (value.sensitivity === "public" || value.sensitivity === "internal" || value.sensitivity === "personal" || value.sensitivity === "secret") &&
  (value.residency === "local-only" || value.residency === "region-restricted" || value.residency === "global-ok");

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

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

const hex = (value: string, length = 20): string => createHash("sha256").update(value).digest("hex").slice(0, length);

const protocolSuffix = (value: string): string => {
  const bytes = sha256(value);
  let bits = 0;
  let bitLength = 0;
  let out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitLength += 8;
    while (bitLength >= 5 && out.length < 26) {
      const index = (bits >> (bitLength - 5)) & 31;
      out += base32Alphabet[index] ?? "0";
      bitLength -= 5;
    }
    if (out.length >= 26) {
      break;
    }
  }
  return out.padEnd(26, "0");
};

const protocolId = <TPrefix extends "evt_" | "ses_">(prefix: TPrefix, value: string): `${TPrefix}${string}` =>
  `${prefix}${protocolSuffix(value)}` as `${TPrefix}${string}`;

const labelsFromLabelerResult = (result: ReturnType<ChronicleContentLabeler>): MemoryLabels =>
  "labels" in result ? result.labels : result;

const parseJsonlEvents = (raw: string): EventLike[] =>
  raw.split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EventLike);

const readSessionIds = async (dataDir: string): Promise<string[]> => {
  const sessionsDir = join(dataDir, "sessions");
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const readSessionEvents = async (dataDir: string, sid: string): Promise<EventLike[]> => {
  try {
    return parseJsonlEvents(await readFile(join(dataDir, "sessions", sid, "log.jsonl"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const payloadText = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return "";
  }
  const content = payload.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (typeof payload.result === "string") {
    return payload.result;
  }
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return "";
};

const eventTimestamp = (event: EventLike): string =>
  typeof event.ts === "string" ? event.ts : "1970-01-01T00:00:00.000Z";

const eventId = (event: EventLike, fallback: number): string =>
  typeof event.id === "string" ? event.id : `event_${fallback}`;

const eventSid = (event: EventLike): string =>
  typeof event.sid === "string" ? event.sid : "ses_unknown";

const eventTurn = (event: EventLike): number =>
  typeof event.turn === "number" && Number.isInteger(event.turn) ? event.turn : 0;

const eventType = (event: EventLike): string =>
  typeof event.type === "string" ? event.type : "unknown";

const short = (text: string, max = 180): string =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

const sanitizeEvent = (
  event: EventLike,
  index: number,
  options: Pick<ConsolidationOptions, "labelContent" | "redactText">
): SanitizedEvent => {
  const baseLabels = isLabels(event.labels) ? event.labels : internalLabels;
  const rawText = payloadText(event.payload);
  const labels = options.labelContent
    ? labelsFromLabelerResult(options.labelContent(rawText, baseLabels))
    : baseLabels;
  const redacted = labels.sensitivity === "secret";
  return {
    event,
    event_id: eventId(event, index),
    labels: redacted ? internalLabels : labels,
    quote: redacted
      ? `[REDACTED:secret:${hex(rawText || eventId(event, index), 12)}]`
      : short(options.redactText ? options.redactText(rawText) : rawText),
    redacted,
    sid: eventSid(event),
    ts: eventTimestamp(event),
    turn: eventTurn(event),
    type: eventType(event)
  };
};

const selectedEvents = async (options: ConsolidationOptions): Promise<EventLike[]> => {
  if (options.from.startsWith("ses_")) {
    return readSessionEvents(options.dataDir, options.from);
  }

  const fromTime = Date.parse(options.from);
  if (!Number.isFinite(fromTime)) {
    throw new Error("--from must be a session id or ISO date/time");
  }
  const toTime = options.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(toTime)) {
    throw new Error("--to must be an ISO date/time when provided");
  }

  const events: EventLike[] = [];
  for (const sid of await readSessionIds(options.dataDir)) {
    for (const event of await readSessionEvents(options.dataDir, sid)) {
      const time = Date.parse(eventTimestamp(event));
      if (time >= fromTime && time <= toTime) {
        events.push(event);
      }
    }
  }
  return events.sort((left, right) => eventTimestamp(left).localeCompare(eventTimestamp(right)) || eventId(left, 0).localeCompare(eventId(right, 0)));
};

const quoteFor = (event: SanitizedEvent): ConsolidationProvenanceQuote => ({
  event_id: event.event_id,
  quote: event.quote,
  sid: event.sid,
  turn: event.turn
});

const extractCandidateMemories = (events: readonly SanitizedEvent[]): ConsolidationReport["candidate_memories"] =>
  events.flatMap((event) => {
    if (event.redacted) {
      return [];
    }
    const match = /\b(?:please\s+)?remember(?:\s+that)?\s+(?<text>.+)$/i.exec(event.quote) ??
      /(?:\u8bf7)?\u8bb0\u4f4f(?<text>.+)$/u.exec(event.quote);
    const summary = match?.groups?.text?.trim();
    if (!summary) {
      return [];
    }
    return [{
      admission: event.labels.sensitivity === "personal" ? "held" as const : "candidate_only" as const,
      id: `memcand_${hex(`${event.event_id}:${summary}`, 16)}`,
      labels: event.labels,
      provenance: quoteFor(event),
      summary
    }];
  });

const chronicleKindFor = (text: string, type: string): ChronicleKind | undefined => {
  if (/fragile file|flaky|brittle/i.test(text)) {
    return "fragile-file";
  }
  if (/decision|decided|DECISION_/i.test(text)) {
    return "decision";
  }
  if (/failed|failure|error|boom|ToolError/i.test(text) || type === "tool.result") {
    return "failure";
  }
  if (/outcome|resolved|done/i.test(text)) {
    return "outcome";
  }
  return undefined;
};

const extractChronicleCandidates = (events: readonly SanitizedEvent[]): ConsolidationReport["chronicle_candidates"] =>
  events.flatMap((event) => {
    if (event.redacted || !event.quote) {
      return [];
    }
    const kind = chronicleKindFor(event.quote, event.type);
    if (!kind) {
      return [];
    }
    return [{
      kind,
      labels: event.labels,
      provenance: quoteFor(event),
      summary: event.quote
    }];
  }).slice(0, 12);

const isToolErrorEvent = (event: SanitizedEvent): boolean => {
  if (event.type !== "tool.result") {
    return false;
  }
  if (/error/i.test(event.quote)) {
    return true;
  }
  const payload = isRecord(event.event.payload) ? event.event.payload : {};
  return payload.status === "error" || isRecord(payload.error);
};

const contradictionSuggestions = (records: readonly MemoryRecord[] | undefined): ConsolidationReport["contradiction_suggestions"] => {
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of records ?? []) {
    const match = /\bfavorite\s+(?<key>[\p{L}\p{N}_-]+)\s+is\s+(?<value>.+)$/iu.exec(record.text);
    if (!match?.groups?.key) {
      continue;
    }
    groups.set(match.groups.key.toLowerCase(), [...(groups.get(match.groups.key.toLowerCase()) ?? []), record]);
  }

  const suggestions: {
    readonly memory_ids: readonly string[];
    readonly reason: string;
    readonly suggestion: string;
  }[] = [];
  for (const [key, items] of groups) {
    const values = new Set(items.map((item) => item.text.toLowerCase()));
    if (values.size > 1) {
      suggestions.push({
        memory_ids: items.map((item) => item.id).sort(),
        reason: `multiple active favorite ${key} memories`,
        suggestion: "review and explicitly supersede the stale memory if appropriate"
      });
    }
  }
  return suggestions;
};

const writeLearnedSkillDraft = async (
  options: ConsolidationOptions,
  reportId: string,
  events: readonly SanitizedEvent[]
): Promise<ConsolidationReport["learned_skill_drafts"]> => {
  const hasPattern = events.some((event) => !event.redacted && (/tool\.result|tool\.call/.test(event.type) || /decision|failed|failure|fragile/i.test(event.quote)));
  if (!hasPattern) {
    return [];
  }
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const pendingDir = options.learnedSkillPendingDir ?? "extensions/skills/learned/pending";
  const root = isAbsolute(pendingDir) ? pendingDir : resolve(workspaceRoot, pendingDir);
  const id = `skilldraft_${hex(reportId, 16)}`;
  const path = join(root, `${id}.json`);
  const body = {
    id,
    report_id: reportId,
    status: "pending",
    title: "Review repeated project operation pattern",
    created_from: events.slice(0, 6).map((event) => ({ event_id: event.event_id, sid: event.sid, turn: event.turn }))
  };
  await mkdir(root, { recursive: true });
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return [{ id, path, status: "pending" }];
};

const reportLabels = (events: readonly SanitizedEvent[]): MemoryLabels =>
  deriveChronicleLabels(events.filter((event) => !event.redacted).map((event) => ({ labels: event.labels })), internalLabels);

const reportArtifactPath = (dataDir: string, reportId: string): string =>
  join(dataDir, "artifacts", "memory", "reports", `${reportId}.json`);

const latestReportPath = (dataDir: string): string =>
  join(dataDir, "artifacts", "memory", "reports", "latest.json");

const appendArtifactEventOnce = async (dataDir: string, event: ConsolidationArtifactEvent): Promise<void> => {
  const logPath = join(dataDir, "sessions", event.sid, "log.jsonl");
  await mkdir(dirname(logPath), { recursive: true });
  try {
    const existing = await readFile(logPath, "utf8");
    if (existing.split(/\r?\n/).some((line) => line.includes(event.id))) {
      return;
    }
    await appendFile(logPath, `${existing.endsWith("\n") ? "" : "\n"}${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await writeFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
  }
};

export const consolidateMemory = async (options: ConsolidationOptions): Promise<ConsolidationReport> => {
  const rawEvents = await selectedEvents(options);
  const events = rawEvents.map((event, index) => sanitizeEvent(event, index, options));
  const inputHash = hex(stableStringify(events.map((event) => ({
    event_id: event.event_id,
    labels: event.labels,
    quote: event.quote,
    redacted: event.redacted,
    sid: event.sid,
    ts: event.ts,
    turn: event.turn,
    type: event.type
  }))), 32);
  const reportId = `mrep_${inputHash.slice(0, 20)}`;
  const createdAt = events.map((event) => event.ts).sort().at(-1) ?? "1970-01-01T00:00:00.000Z";
  const labels = reportLabels(events);
  const sessions = [...new Set(events.map((event) => event.sid))].sort();
  const turns = [...new Set(events.map((event) => event.turn))].sort((left, right) => left - right);
  const redactions = events
    .filter((event) => event.redacted)
    .map((event) => ({ event_id: event.event_id, quote: event.quote, reason: "secret" as const }));
  const learnedSkillDrafts = await writeLearnedSkillDraft(options, reportId, events);
  const path = reportArtifactPath(options.dataDir, reportId);

  const withoutArtifact = {
    candidate_memories: extractCandidateMemories(events),
    chronicle_candidates: extractChronicleCandidates(events),
    contradiction_suggestions: contradictionSuggestions(options.memoryRecords),
    created_at: createdAt,
    deferred: [
      "semantic memory promotion",
      "decay",
      "index maintenance",
      "scheduler or autonomous nightly jobs",
      "automatic memory supersession/deletion",
      "learned skill activation"
    ],
    episode_summary: {
      event_count: events.length,
      final_count: events.filter((event) => event.type === "turn.final").length,
      sessions,
      tool_error_count: events.filter(isToolErrorEvent).length,
      turns
    },
    id: reportId,
    input_hash: inputHash,
    labels,
    learned_skill_drafts: learnedSkillDrafts,
    range: {
      from: options.from,
      ...(options.to ? { to: options.to } : {}),
      sessions
    },
    redactions
  };
  const bodyHash = hex(stableStringify(withoutArtifact), 64);
  const artifact = {
    hash: `sha256:${bodyHash}`,
    id: reportId,
    labels,
    path
  };
  const report: ConsolidationReport = {
    ...withoutArtifact,
    artifact
  };
  const content = `${JSON.stringify(report, null, 2)}\n`;
  const artifactHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const event: ConsolidationArtifactEvent = {
    actor: "system",
    id: protocolId("evt_", `artifact:${reportId}`),
    labels,
    payload: {
      hash: artifactHash,
      kind: "memory.consolidation.report",
      labels,
      mime: "application/json",
      origin: "memory.consolidation",
      path,
      report_id: reportId,
      source_range: report.range
    },
    provenance: "agent",
    sid: protocolId("ses_", `artifact:${reportId}`),
    ts: createdAt,
    turn: 0,
    type: "artifact.created",
    v: 1
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await writeFile(latestReportPath(options.dataDir), `${JSON.stringify({ path, report_id: reportId }, null, 2)}\n`, "utf8");
  await appendArtifactEventOnce(options.dataDir, event);
  return report;
};

export const readLatestConsolidationReport = async (dataDir: string): Promise<ConsolidationReport | undefined> => {
  try {
    const latest = JSON.parse(await readFile(latestReportPath(dataDir), "utf8")) as { path?: unknown };
    if (typeof latest.path !== "string") {
      return undefined;
    }
    return JSON.parse(await readFile(latest.path, "utf8")) as ConsolidationReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};
