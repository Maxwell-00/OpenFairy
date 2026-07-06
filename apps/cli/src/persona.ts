import { defaultDataDir, loadConfig } from "@fairy/config";
import { loadPersonaRuntime, type AffectState, type PersonaRuntime } from "@fairy/kernel";
import { validateEvent, type EventEnvelope } from "@fairy/protocol";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

interface PersonaCliOptions {
  readonly configPath?: string;
  readonly dataDir: string;
  readonly json: boolean;
}

type AffectCliOptions = PersonaCliOptions;

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

const loadRuntime = (configPath: string | undefined, env: NodeJS.ProcessEnv): {
  readonly dataDir: string;
  readonly runtime: PersonaRuntime;
} => {
  const loaded = loadConfig(configPath ? { configPath, env } : { env });
  return {
    dataDir: configuredDataDir(loaded.config, env),
    runtime: loadPersonaRuntime(loaded.config, process.cwd())
  };
};

export const parsePersonaOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): PersonaCliOptions => {
  if (args[0] !== "inspect") {
    throw new Error("Usage: fairy persona inspect [--json] [--data-dir path] [--config path]");
  }
  const configPath = readOption(args, "--config");
  const loaded = loadRuntime(configPath, env);
  return {
    dataDir: resolve(readOption(args, "--data-dir") ?? loaded.dataDir),
    ...(configPath ? { configPath } : {}),
    json: hasFlag(args, "--json")
  };
};

export const parseAffectOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): AffectCliOptions => {
  const configPath = readOption(args, "--config");
  const loaded = loadRuntime(configPath, env);
  return {
    dataDir: resolve(readOption(args, "--data-dir") ?? loaded.dataDir),
    ...(configPath ? { configPath } : {}),
    json: hasFlag(args, "--json")
  };
};

const stateFromPayload = (payload: Record<string, unknown>, fallback: AffectState): AffectState => ({
  arousal: typeof payload.arousal === "number" ? payload.arousal : fallback.arousal,
  cause: typeof payload.cause === "string" ? payload.cause : fallback.cause,
  energy: payload.energy === "low" || payload.energy === "medium" || payload.energy === "high"
    ? payload.energy
    : fallback.energy,
  stance: payload.stance === "warm" || payload.stance === "neutral" || payload.stance === "dry"
    ? payload.stance
    : fallback.stance,
  updated_at: typeof payload.updated_at === "string" ? payload.updated_at : fallback.updated_at,
  valence: typeof payload.valence === "number" ? payload.valence : fallback.valence
});

const readJsonlEvents = async (path: string): Promise<EventEnvelope[]> => {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line): EventEnvelope[] => {
      try {
        const result = validateEvent(JSON.parse(line) as unknown);
        return result.ok ? [result.event] : [];
      } catch {
        return [];
      }
    });
};

const readLatestAffectEvent = async (dataDir: string): Promise<EventEnvelope | undefined> => {
  const sessionsDir = join(dataDir, "sessions");
  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const affectEvents: EventEnvelope[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      affectEvents.push(...(await readJsonlEvents(join(sessionsDir, entry.name, "log.jsonl"))).filter((event) => event.type === "affect.updated"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return affectEvents.sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id)).at(-1);
};

const inspectPayload = (runtime: PersonaRuntime): Record<string, unknown> => ({
  affect_enabled: runtime.affectEnabled,
  disclosure: runtime.pack.disclosure,
  enabled: runtime.enabled,
  id: runtime.pack.id,
  labels: runtime.pack.labels,
  languages: runtime.pack.languages,
  name: runtime.pack.name,
  root: runtime.pack.root,
  style_summary: runtime.pack.styleSummary
});

export const runPersona = async (args: readonly string[]): Promise<void> => {
  const options = parsePersonaOptions(args);
  const runtime = loadRuntime(options.configPath, process.env).runtime;
  const payload = inspectPayload(runtime);
  if (options.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(`${payload.id} ${payload.name} enabled=${String(payload.enabled)} affect=${String(payload.affect_enabled)}`);
  console.log(String(payload.disclosure));
  console.log(String(payload.style_summary));
};

export const runAffect = async (args: readonly string[]): Promise<void> => {
  const options = parseAffectOptions(args);
  const runtime = loadRuntime(options.configPath, process.env).runtime;
  const latest = runtime.affectEnabled ? await readLatestAffectEvent(options.dataDir) : undefined;
  const current = latest && isRecord(latest.payload)
    ? stateFromPayload(latest.payload, runtime.pack.affectBaseline)
    : runtime.pack.affectBaseline;
  const payload = {
    bounds: runtime.pack.affectBounds,
    current,
    enabled: runtime.affectEnabled,
    last_cause: current.cause,
    persona_enabled: runtime.enabled,
    persona_id: runtime.pack.id,
    source: latest
      ? { event_id: latest.id, sid: latest.sid, ts: latest.ts, turn: latest.turn }
      : { kind: "baseline" }
  };
  if (options.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(`${payload.persona_id} affect enabled=${String(payload.enabled)} ${current.stance}/${current.energy} valence=${current.valence} arousal=${current.arousal} cause=${current.cause}`);
};
