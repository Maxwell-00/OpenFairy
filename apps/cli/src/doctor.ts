import { spawnSync } from "node:child_process";

import { ConfigValidationError, loadConfig, type SourceTrace } from "@fairy/config";

export interface DoctorReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

const commandVersion = (command: string, args: readonly string[]): string | undefined => {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], { encoding: "utf8" })
      : spawnSync(command, [...args], { encoding: "utf8" });

  if (result.status !== 0) {
    return undefined;
  }

  return (result.stdout || result.stderr).trim();
};

export const isNodeVersionOk = (version = process.versions.node): boolean => {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major >= 22;
};

const formatSourceTrace = (source: SourceTrace): string => {
  const path = source.path ? ` ${source.path}` : "";
  return `  - ${source.name}: ${source.found ? "found" : "not found"}${path}`;
};

const detectContainerRuntime = (): string | undefined =>
  commandVersion("docker", ["--version"]) ?? commandVersion("podman", ["--version"]);

const configuredGatewayPort = (config: Record<string, unknown>): number => {
  const gateway = config.gateway;
  if (gateway && typeof gateway === "object" && typeof (gateway as { port?: unknown }).port === "number") {
    return (gateway as { port: number }).port;
  }
  return 8787;
};

const checkGatewayReachability = async (port: number): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) {
      return `Gateway: running but unhealthy (HTTP ${response.status})`;
    }
    const body = (await response.json()) as { status?: unknown };
    return body.status === "ok" ? `Gateway: running on 127.0.0.1:${port}` : `Gateway: running but returned unexpected health`;
  } catch {
    return `Gateway: not running on 127.0.0.1:${port} (ok for M0)`;
  } finally {
    clearTimeout(timeout);
  }
};

export const runDoctor = async (cwd = process.cwd()): Promise<DoctorReport> => {
  const lines: string[] = ["Fairy doctor", ""];
  let ok = true;
  let gatewayPort = 8787;

  const nodeOk = isNodeVersionOk();
  lines.push(`Node: ${nodeOk ? "OK" : "FAIL"} v${process.versions.node} (requires >=22)`);
  ok &&= nodeOk;

  const pnpmVersion = commandVersion("pnpm", ["--version"]);
  lines.push(`pnpm: ${pnpmVersion ? `OK ${pnpmVersion}` : "FAIL not found"}`);
  ok &&= Boolean(pnpmVersion);

  try {
    const loaded = loadConfig({ cwd });
    gatewayPort = configuredGatewayPort(loaded.config);
    lines.push("Config: OK valid");
    lines.push("Config sources:");
    lines.push(...loaded.sources.map(formatSourceTrace));
  } catch (error) {
    ok = false;
    lines.push("Config: FAIL invalid");
    if (error instanceof ConfigValidationError) {
      for (const issue of error.issues) {
        lines.push(`  - ${issue.path}: expected ${issue.expected}, got ${issue.got}`);
      }
    } else {
      lines.push(`  - ${(error as Error).message}`);
    }
  }

  const runtime = detectContainerRuntime();
  lines.push(`Container runtime: ${runtime ? `yes (${runtime})` : "no (Docker/Podman not detected; execution tools stay disabled for now)"}`);
  lines.push(await checkGatewayReachability(gatewayPort));

  return { ok, lines };
};
