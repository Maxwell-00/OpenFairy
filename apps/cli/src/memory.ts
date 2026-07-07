import { defaultDataDir, loadConfig } from "@fairy/config";
import { escalateLabelsForContent, redactText } from "@fairy/kernel";
import {
  MemoryStore,
  consolidateMemory,
  evaluateRetrievalGate,
  readLatestConsolidationReport,
  type MemoryRecord,
  type ScoredMemoryRecord
} from "@fairy/memory";
import { createEventId, type EventEnvelope } from "@fairy/protocol";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface MemoryCliOptions {
  readonly command: "consolidate" | "delete" | "evidence" | "list" | "rebuild" | "report" | "search" | "show";
  readonly configPath?: string;
  readonly dataDir: string;
  readonly from?: string;
  readonly json: boolean;
  readonly learnedSkillPendingDir?: string;
  readonly to?: string;
  readonly value?: string;
  readonly workspaceRoot: string;
}

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const hasFlag = (args: readonly string[], name: string): boolean => args.includes(name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const configuredDataDir = (config: Record<string, unknown>, env: NodeJS.ProcessEnv): string => {
  const gateway = isRecord(config.gateway) ? config.gateway : {};
  return typeof gateway.data_dir === "string" ? gateway.data_dir : defaultDataDir(env);
};

const configuredWorkspaceRoot = (config: Record<string, unknown>): string => {
  const workspace = isRecord(config.workspace) ? config.workspace : {};
  return resolve(typeof workspace.root === "string" ? workspace.root : process.cwd());
};

const configuredPendingDir = (config: Record<string, unknown>): string | undefined => {
  const memory = isRecord(config.memory) ? config.memory : {};
  const consolidation = isRecord(memory.consolidation) ? memory.consolidation : {};
  return typeof consolidation.learned_skill_pending_dir === "string" ? consolidation.learned_skill_pending_dir : undefined;
};

export const parseMemoryOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): MemoryCliOptions => {
  const command = args[0];
  if (command !== "delete" && command !== "list" && command !== "rebuild" && command !== "search" && command !== "show" && command !== "evidence" && command !== "consolidate" && command !== "report") {
    throw new Error("Usage: fairy memory <list|search|show|evidence|delete|rebuild|consolidate|report> [value] [--from date-or-session] [--to date] [--json] [--data-dir path] [--config path]");
  }
  const configPath = readOption(args, "--config");
  const from = readOption(args, "--from");
  const to = readOption(args, "--to");
  const loaded = loadConfig(configPath ? { configPath, env } : { env });
  const dataDir = resolve(readOption(args, "--data-dir") ?? configuredDataDir(loaded.config, env));
  const positional = args
    .slice(1)
    .filter((arg, index, all) =>
      !arg.startsWith("--") &&
      all[index - 1] !== "--data-dir" &&
      all[index - 1] !== "--config" &&
      all[index - 1] !== "--from" &&
      all[index - 1] !== "--to"
    );
  const value = positional.join(" ").trim() || undefined;
  if ((command === "delete" || command === "search" || command === "show" || command === "evidence") && !value) {
    throw new Error(`fairy memory ${command} requires a value`);
  }
  if (command === "consolidate" && !from) {
    throw new Error("fairy memory consolidate requires --from <date-or-session>");
  }
  const pendingDir = configuredPendingDir(loaded.config);
  return {
    command,
    dataDir,
    ...(from ? { from } : {}),
    ...(configPath ? { configPath } : {}),
    json: hasFlag(args, "--json"),
    ...(pendingDir ? { learnedSkillPendingDir: pendingDir } : {}),
    ...(to ? { to } : {}),
    ...(value ? { value } : {}),
    workspaceRoot: configuredWorkspaceRoot(loaded.config)
  };
};

const memorySummary = (record: MemoryRecord): Record<string, unknown> => ({
  confidence: record.confidence,
  id: record.id,
  kind: record.kind,
  labels: record.labels,
  scope: record.scope,
  source: {
    event_id: record.provenance.event_id,
    sid: record.provenance.sid,
    turn: record.provenance.turn
  },
  text: record.text.length <= 100 ? record.text : `${record.text.slice(0, 97)}...`,
  use_count: record.use_count
});

const printRecords = (records: readonly MemoryRecord[], json: boolean): void => {
  if (json) {
    console.log(JSON.stringify({ memories: records.map(memorySummary) }));
    return;
  }
  for (const record of records) {
    console.log(`${record.id} ${record.kind} ${record.labels.sensitivity}/${record.labels.residency} conf=${record.confidence.toFixed(2)} ${record.provenance.sid}#${record.provenance.turn} ${record.text}`);
  }
};

const admittedSearch = (store: MemoryStore, query: string): ScoredMemoryRecord[] =>
  store.search(query, { includeIrrelevant: true, limit: 20 }).filter((candidate) =>
    evaluateRetrievalGate(candidate, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: candidate.record.scope
    }).decision === "allow"
  );

const appendDeletedEvent = async (dataDir: string, record: MemoryRecord, reason: string): Promise<EventEnvelope> => {
  const event: EventEnvelope = {
    actor: "system",
    id: createEventId(),
    labels: record.labels,
    payload: {
      memory_id: record.id,
      reason
    },
    provenance: "agent",
    sid: record.provenance.sid as `ses_${string}`,
    ts: new Date().toISOString(),
    turn: record.provenance.turn,
    type: "memory.deleted",
    v: 1
  };
  const sessionDir = join(dataDir, "sessions", event.sid);
  const logPath = join(sessionDir, "log.jsonl");
  await mkdir(sessionDir, { recursive: true });
  let prefix = "";
  try {
    const existing = await readFile(logPath, "utf8");
    prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await appendFile(logPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
  return event;
};

export const runMemory = async (args: readonly string[]): Promise<void> => {
  const options = parseMemoryOptions(args);
  const store = new MemoryStore(options.dataDir);

  if (options.command === "rebuild") {
    const result = await store.rebuildFromSessionLogs();
    console.log(options.json ? JSON.stringify(result) : `rebuilt records=${result.records} tombstones=${result.tombstones}`);
    return;
  }

  if (options.command === "consolidate") {
    await store.rebuildFromSessionLogs();
    const report = await consolidateMemory({
      dataDir: options.dataDir,
      from: options.from ?? "",
      labelContent: escalateLabelsForContent,
      ...(options.learnedSkillPendingDir ? { learnedSkillPendingDir: options.learnedSkillPendingDir } : {}),
      memoryRecords: store.list(),
      redactText,
      ...(options.to ? { to: options.to } : {}),
      workspaceRoot: options.workspaceRoot
    });
    console.log(options.json ? JSON.stringify({ report }) : `memory report ${report.id} ${report.artifact.path}`);
    return;
  }

  if (options.command === "report") {
    const report = await readLatestConsolidationReport(options.dataDir);
    if (!report) {
      throw new Error("no memory consolidation report found");
    }
    console.log(options.json ? JSON.stringify({ report }) : `memory report ${report.id} ${report.artifact.path}`);
    return;
  }

  if (options.command === "list") {
    printRecords(store.list(), options.json);
    return;
  }

  if (options.command === "search") {
    const matches = admittedSearch(store, options.value ?? "");
    if (options.json) {
      console.log(JSON.stringify({ memories: matches.map((item) => ({ ...memorySummary(item.record), score: item.score })) }));
      return;
    }
    for (const match of matches) {
      console.log(`${match.record.id} score=${match.score.toFixed(3)} ${match.record.kind} ${match.record.text}`);
    }
    return;
  }

  if (options.command === "show" || options.command === "evidence") {
    const record = store.get(options.value ?? "");
    if (!record) {
      throw new Error(`memory ${options.value ?? ""} not found`);
    }
    const evidence = await store.evidence(record.id, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: record.scope
    });
    if (options.json) {
      console.log(JSON.stringify(evidence));
      return;
    }
    if (!evidence.ok) {
      console.log(`memory ${record.id} denied: ${evidence.reason}`);
      return;
    }
    console.log(`${evidence.memory_id}\n${evidence.text}\nsource ${evidence.provenance.sid}#${evidence.provenance.turn}/${evidence.provenance.event_id}`);
    return;
  }

  const record = store.get(options.value ?? "");
  if (!record) {
    throw new Error(`memory ${options.value ?? ""} not found`);
  }
  const event = await appendDeletedEvent(options.dataDir, record, "user_deleted");
  store.delete(record.id, { deleted_at: event.ts, event_id: event.id, reason: "user_deleted" });
  console.log(options.json ? JSON.stringify({ deleted: record.id, event_id: event.id }) : `deleted ${record.id}`);
};
