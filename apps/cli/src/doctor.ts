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

export const runDoctor = (cwd = process.cwd()): DoctorReport => {
  const lines: string[] = ["Fairy doctor", ""];
  let ok = true;

  const nodeOk = isNodeVersionOk();
  lines.push(`Node: ${nodeOk ? "OK" : "FAIL"} v${process.versions.node} (requires >=22)`);
  ok &&= nodeOk;

  const pnpmVersion = commandVersion("pnpm", ["--version"]);
  lines.push(`pnpm: ${pnpmVersion ? `OK ${pnpmVersion}` : "FAIL not found"}`);
  ok &&= Boolean(pnpmVersion);

  try {
    const loaded = loadConfig({ cwd });
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

  return { ok, lines };
};
