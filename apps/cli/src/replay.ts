import { defaultDataDir } from "@fairy/config";
import { validateEvent, type EventEnvelope } from "@fairy/protocol";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface ReplayOptions {
  readonly dataDir: string;
  readonly json: boolean;
  readonly manifests: boolean;
  readonly sid: string;
  readonly turn?: number;
}

interface ReplayReadResult {
  readonly events: readonly EventEnvelope[];
  readonly warnings: readonly string[];
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

export const parseReplayOptions = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): ReplayOptions => {
  const sid = args.find((arg) => !arg.startsWith("--") && arg !== readOption(args, "--turn") && arg !== readOption(args, "--data-dir"));
  if (!sid) {
    throw new Error("Usage: fairy replay <sid> [--manifests] [--turn n] [--json] [--data-dir path]");
  }
  const turnRaw = readOption(args, "--turn");
  const dataDir = readOption(args, "--data-dir") ?? env.FAIRY_DATA_DIR ?? defaultDataDir(env);
  return {
    dataDir: resolve(dataDir),
    json: hasFlag(args, "--json"),
    manifests: hasFlag(args, "--manifests"),
    sid,
    ...(turnRaw ? { turn: Number(turnRaw) } : {})
  };
};

export const readReplayLog = async (options: Pick<ReplayOptions, "dataDir" | "sid">): Promise<ReplayReadResult> => {
  const path = join(options.dataDir, "sessions", options.sid, "log.jsonl");
  const raw = await readFile(path, "utf8");
  const events: EventEnvelope[] = [];
  const warnings: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const result = validateEvent(parsed);
      if (result.ok) {
        events.push(result.event);
      } else {
        warnings.push(`line ${index + 1}: invalid event (${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")})`);
      }
    } catch (error) {
      warnings.push(`line ${index + 1}: corrupt JSON tail (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { events, warnings };
};

const payloadText = (payload: unknown): string => {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return "";
  }
  return payload.content
    .map((part) => isRecord(part) && part.kind === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
};

const short = (value: string, max = 100): string =>
  value.length <= max ? value : `${value.slice(0, max)}...`;

const renderChronological = (events: readonly EventEnvelope[]): string[] => {
  const lines: string[] = [];
  const deltas = new Map<number, string>();
  for (const event of events) {
    if (event.type === "turn.delta" && isRecord(event.payload) && typeof event.payload.text === "string") {
      deltas.set(event.turn, `${deltas.get(event.turn) ?? ""}${event.payload.text}`);
      continue;
    }
    if (event.type === "reasoning.delta" || event.type === "context.manifest") {
      continue;
    }
    if (event.type === "turn.input") {
      lines.push(`turn ${event.turn} > ${short(payloadText(event.payload))}`);
    } else if (event.type === "tool.call" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} tool.call ${String(event.payload.tool ?? "?")} ${String(event.payload.call_id ?? "")}`);
    } else if (event.type === "tool.result" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} tool.result ${String(event.payload.call_id ?? "?")} ${String(event.payload.status ?? "?")} ${String(event.payload.provenance ?? "")}`);
    } else if (event.type === "approval.request" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} approval.request ${short(String(event.payload.summary ?? ""))}`);
    } else if (event.type === "approval.resolved" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} approval.resolved ${String(event.payload.decision ?? "?")}`);
    } else if (event.type === "turn.final") {
      const streamed = deltas.get(event.turn);
      lines.push(`turn ${event.turn} < ${short(streamed || payloadText(event.payload))}`);
    } else if (event.type === "turn.interrupted" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} interrupted ${String(event.payload.reason ?? "?")}`);
    } else if (event.type === "error" && isRecord(event.payload)) {
      lines.push(`turn ${event.turn} error ${String(event.payload.class ?? "Error")}: ${String(event.payload.message ?? "")}`);
    } else if (event.type === "session.created") {
      lines.push(`session ${event.sid} created`);
    } else if (event.type === "session.resumed") {
      lines.push(`session ${event.sid} resumed`);
    }
  }
  return lines;
};

const zoneTokens = (payload: Record<string, unknown>, zone: string): string => {
  const zones = Array.isArray(payload.zones) ? payload.zones : [];
  const match = zones.find((item) => isRecord(item) && item.name === zone);
  return isRecord(match) && typeof match.tokens === "number" ? String(match.tokens) : "0";
};

const renderManifests = (events: readonly EventEnvelope[]): string[] => {
  const manifests = events.filter((event) => event.type === "context.manifest" && isRecord(event.payload));
  const lines = ["turn model projected/budget/window stages system tools history input prefix"];
  for (const event of manifests) {
    const payload = event.payload as Record<string, unknown>;
    const stages = Array.isArray(payload.reduction_stages_applied) && payload.reduction_stages_applied.length > 0
      ? payload.reduction_stages_applied.join(",")
      : "-";
    lines.push([
      event.turn,
      String(payload.model ?? "?"),
      `${String(payload.projected_tokens ?? "?")}/${String(payload.budget ?? "?")}/${String(payload.window ?? "?")}`,
      stages,
      zoneTokens(payload, "system"),
      zoneTokens(payload, "tools"),
      zoneTokens(payload, "history"),
      zoneTokens(payload, "input"),
      String(payload.prefix_hash ?? "?")
    ].join(" "));
  }
  return lines;
};

const renderTurn = (events: readonly EventEnvelope[], turn: number): string[] =>
  events
    .filter((event) => event.turn === turn)
    .map((event) => `${event.id} ${event.type} ${JSON.stringify(event.payload)}`);

export const renderReplay = (result: ReplayReadResult, options: Pick<ReplayOptions, "json" | "manifests" | "turn">): string => {
  if (options.json) {
    const events = options.turn !== undefined
      ? result.events.filter((event) => event.turn === options.turn)
      : options.manifests
        ? result.events.filter((event) => event.type === "context.manifest")
        : result.events;
    return [
      ...result.warnings.map((warning) => JSON.stringify({ type: "warning", warning })),
      ...events.map((event) => JSON.stringify(event))
    ].join("\n");
  }

  const lines = [
    ...result.warnings.map((warning) => `warning: ${warning}`),
    ...(options.turn !== undefined
      ? renderTurn(result.events, options.turn)
      : options.manifests
        ? renderManifests(result.events)
        : renderChronological(result.events))
  ];
  return lines.join("\n");
};

export const runReplay = async (args: readonly string[]): Promise<void> => {
  const options = parseReplayOptions(args);
  const result = await readReplayLog(options);
  console.log(renderReplay(result, options));
};
