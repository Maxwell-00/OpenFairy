import { defaultDataDir, loadConfig } from "@fairy/config";
import { escalateLabelsForContent } from "@fairy/kernel";
import { ChronicleStore, type ChronicleKind, type ChronicleRecord } from "@fairy/memory";
import { resolve } from "node:path";

interface ChronicleCliOptions {
  readonly command: "list" | "log" | "query" | "show";
  readonly configPath?: string;
  readonly dataDir: string;
  readonly files: readonly string[];
  readonly json: boolean;
  readonly kind?: ChronicleKind;
  readonly summary?: string;
  readonly topics: readonly string[];
  readonly value?: string;
  readonly workspaceRoot: string;
}

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

const readChronicleKind = (value: string | undefined): ChronicleKind => {
  if (
    value === "attempt" ||
    value === "failure" ||
    value === "decision" ||
    value === "outcome" ||
    value === "fragile-file" ||
    value === "note"
  ) {
    return value;
  }
  throw new Error("--kind must be attempt, failure, decision, outcome, fragile-file, or note");
};

const recordSummary = (entry: ChronicleRecord): Record<string, unknown> => ({
  created_at: entry.created_at,
  files: entry.files,
  id: entry.id,
  kind: entry.kind,
  labels: entry.labels,
  provenance: entry.provenance,
  summary: entry.summary,
  topics: entry.topics,
  workspace: entry.workspace
});

export const parseChronicleOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): ChronicleCliOptions => {
  const command = args[0];
  if (command !== "log" && command !== "query" && command !== "list" && command !== "show") {
    throw new Error("Usage: fairy chronicle <log|query|list|show> [value] [--kind kind] [--summary text] [--file path] [--topic topic] [--json] [--data-dir path] [--config path]");
  }

  const files: string[] = [];
  const topics: string[] = [];
  const positional: string[] = [];
  let configPath: string | undefined;
  let dataDirArg: string | undefined;
  let kindArg: string | undefined;
  let summary: string | undefined;
  let json = false;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--config" || arg === "--data-dir" || arg === "--kind" || arg === "--summary" || arg === "--file" || arg === "--topic") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--config") {
        configPath = value;
      } else if (arg === "--data-dir") {
        dataDirArg = value;
      } else if (arg === "--kind") {
        kindArg = value;
      } else if (arg === "--summary") {
        summary = value;
      } else if (arg === "--file") {
        files.push(value);
      } else {
        topics.push(value);
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const loaded = loadConfig(configPath ? { configPath, env } : { env });
  const dataDir = resolve(dataDirArg ?? configuredDataDir(loaded.config, env));
  const value = positional.join(" ").trim() || undefined;
  if (command === "log" && !summary) {
    throw new Error("fairy chronicle log requires --summary");
  }
  if ((command === "query" || command === "show") && !value) {
    throw new Error(`fairy chronicle ${command} requires a value`);
  }

  return {
    command,
    dataDir,
    files,
    ...(configPath ? { configPath } : {}),
    json,
    ...(kindArg ? { kind: readChronicleKind(kindArg) } : {}),
    ...(summary ? { summary } : {}),
    topics,
    ...(value ? { value } : {}),
    workspaceRoot: configuredWorkspaceRoot(loaded.config)
  };
};

export const runChronicle = async (args: readonly string[]): Promise<void> => {
  const options = parseChronicleOptions(args);
  const store = new ChronicleStore(options.dataDir, {
    labelContent: escalateLabelsForContent,
    workspaceRoot: options.workspaceRoot
  });

  if (options.command === "log") {
    const entry = await store.append({
      files: options.files,
      kind: options.kind ?? "note",
      provenance: { source: "cli:chronicle.log" },
      summary: options.summary ?? "",
      topics: options.topics
    });
    console.log(options.json ? JSON.stringify({ entry: recordSummary(entry) }) : `${entry.id} ${entry.kind} ${entry.summary}`);
    return;
  }

  if (options.command === "query") {
    const matches = await store.query(options.value ?? "", { limit: 20 });
    const entries = matches.map((match) => ({ ...recordSummary(match.record), score: match.score }));
    console.log(options.json ? JSON.stringify({ entries }) : matches.map((match) => `${match.record.id} score=${match.score.toFixed(3)} ${match.record.summary}`).join("\n"));
    return;
  }

  if (options.command === "list") {
    const entries = (await store.list()).map(recordSummary);
    console.log(options.json ? JSON.stringify({ entries }) : entries.map((entry) => `${entry.id} ${entry.kind} ${entry.summary}`).join("\n"));
    return;
  }

  const entry = await store.get(options.value ?? "");
  if (!entry) {
    throw new Error(`chronicle ${options.value ?? ""} not found`);
  }
  console.log(options.json ? JSON.stringify({ entry: recordSummary(entry) }) : JSON.stringify(recordSummary(entry), null, 2));
};
