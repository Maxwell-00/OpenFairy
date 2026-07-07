import { defaultDataDir, loadConfig } from "@fairy/config";
import {
  ArtifactRegistry,
  compactPerceptionText,
  quarantinePerceptionText,
  type ArtifactRecord,
  type PerceptionOutput
} from "@fairy/perception";
import { resolve } from "node:path";

interface ArtifactCliOptions {
  readonly command: "list" | "show";
  readonly configPath?: string;
  readonly dataDir: string;
  readonly json: boolean;
  readonly text: boolean;
  readonly value?: string;
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

export const parseArtifactOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): ArtifactCliOptions => {
  const command = args[0];
  if (command !== "list" && command !== "show") {
    throw new Error("Usage: fairy artifacts <list|show> [artifact_id] [--json|--text] [--data-dir path] [--config path]");
  }
  const configPath = readOption(args, "--config");
  const loaded = loadConfig(configPath ? { configPath, env } : { env });
  const dataDir = resolve(readOption(args, "--data-dir") ?? configuredDataDir(loaded.config, env));
  const positional = args
    .slice(1)
    .filter((arg, index, all) =>
      !arg.startsWith("--") &&
      all[index - 1] !== "--data-dir" &&
      all[index - 1] !== "--config"
    );
  const value = positional.join(" ").trim() || undefined;
  if (command === "show" && !value) {
    throw new Error("fairy artifacts show requires an artifact_id or path");
  }
  return {
    command,
    dataDir,
    ...(configPath ? { configPath } : {}),
    json: hasFlag(args, "--json"),
    text: hasFlag(args, "--text"),
    ...(value ? { value } : {})
  };
};

const artifactSummary = (record: ArtifactRecord): Record<string, unknown> => ({
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

const isPerceptionOutput = (value: unknown): value is PerceptionOutput =>
  isRecord(value) &&
  typeof value.artifact_id === "string" &&
  typeof value.caption === "string" &&
  typeof value.input_artifact_id === "string" &&
  (value.type === "describe" || value.type === "document" || value.type === "ocr");

const parsePerceptionOutput = (raw: string): PerceptionOutput | undefined => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPerceptionOutput(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const textForArtifact = async (registry: ArtifactRegistry, record: ArtifactRecord): Promise<string> => {
  if (record.kind === "perception") {
    const raw = await registry.readText(record);
    const output = parsePerceptionOutput(raw);
    const compact = output ? compactPerceptionText(output) : raw.trim();
    return quarantinePerceptionText(`artifact:${record.artifact_id}`, compact);
  }
  if (record.mime.startsWith("text/") || record.mime === "application/json") {
    return registry.readText(record);
  }
  return [
    `artifact ${record.artifact_id}`,
    `mime: ${record.mime}`,
    `hash: ${record.hash}`,
    `labels: ${record.labels.sensitivity}/${record.labels.residency}`,
    `path: ${record.path}`
  ].join("\n");
};

export const runArtifacts = async (args: readonly string[]): Promise<void> => {
  const options = parseArtifactOptions(args);
  const registry = new ArtifactRegistry(resolve(options.dataDir, "artifacts"));

  if (options.command === "list") {
    const artifacts = await registry.list();
    if (options.json) {
      console.log(JSON.stringify({ artifacts: artifacts.map(artifactSummary) }));
      return;
    }
    for (const artifact of artifacts) {
      console.log(`${artifact.artifact_id} ${artifact.kind} ${artifact.labels.sensitivity}/${artifact.labels.residency} ${artifact.mime} ${artifact.hash} ${artifact.path}`);
    }
    return;
  }

  const artifact = await registry.get(options.value ?? "");
  if (!artifact) {
    throw new Error(`artifact ${options.value ?? ""} not found`);
  }
  if (options.text) {
    console.log(await textForArtifact(registry, artifact));
    return;
  }
  const body = { artifact: artifactSummary(artifact) };
  console.log(options.json ? JSON.stringify(body) : JSON.stringify(body, null, 2));
};
