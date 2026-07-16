import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ArtifactRegistry, type ArtifactRecord } from "@fairy/artifacts";
import { ConfigValidationError, defaultDataDir, loadConfig, type LoadedConfig } from "@fairy/config";
import { gatewayVersion, parseSpeechProviderConfig, resolveMimoCredential, resolveMiniMaxCredential } from "@fairy/gateway";
import { parseModelGatewayConfig, resolveSecretRef } from "@fairy/model-gateway";
import { protocolVersion } from "@fairy/protocol";
import { parseSpeechPythonVersion, speechPythonCandidates, type SpeechPythonCandidateSource } from "@fairy/voice";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
  readonly remediation?: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly kind: "fairy.doctor.report";
  readonly lines: readonly string[];
  readonly ok: boolean;
  readonly v: 1;
}

export interface DoctorOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly dataDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly port?: number;
  readonly probes?: DoctorProbeOverrides;
}

export interface DoctorCliOptions {
  readonly configPath?: string;
  readonly dataDir?: string;
  readonly json: boolean;
  readonly port?: number;
}

export type GatewayPortState = "available" | "fairy-running" | "occupied";

export interface PythonReadinessEvidence {
  readonly source: SpeechPythonCandidateSource;
  readonly version: string;
}

export interface DoctorProbeOverrides {
  readonly commandVersion?: (command: "docker" | "pnpm" | "podman", args: readonly string[], timeoutMs: number) => string | undefined;
  readonly gatewayPort?: (port: number, timeoutMs: number) => Promise<GatewayPortState>;
  readonly python?: (options: { readonly testOverride?: string; readonly timeoutMs: number }) => PythonReadinessEvidence | undefined;
  readonly webAssetsRoot?: string;
}

export interface ReadinessFacts {
  readonly dataDir: string;
  readonly gatewayPort: number;
  readonly gatewayPortState: GatewayPortState;
}

export interface ReadinessEvaluation {
  readonly facts: ReadinessFacts;
  readonly report: DoctorReport;
}

export const doctorCheckIds = [
  "runtime.node",
  "runtime.pnpm",
  "runtime.python",
  "config.load",
  "config.main-role",
  "config.gateway-auth",
  "config.speech-asr",
  "config.speech-tts",
  "storage.data-dir",
  "storage.artifacts",
  "storage.sessions",
  "network.gateway-port",
  "runtime.gateway-health",
  "web.assets",
  "optional.container-runtime",
  "optional.research"
] as const;

export const doctorProbeDeadlines = {
  commandMs: 2_000,
  gatewayMs: 1_000,
  pythonMs: 5_000
} as const;

export const doctorUsage = "Usage: fairy doctor [--json] [--config path] [--data-dir path] [--port 1-65535]";

const webAssetNames = [
  "index.html",
  "styles.css",
  "app.js",
  "recorder.js",
  "wav.js",
  "audio-worklet.js"
] as const;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const forbiddenDoctorFlags = new Set(["--token", "--api-key", "--secret", "--live", "--probe-provider", "--base-url", "--host"]);

export class DoctorCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctorCliError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const check = (id: typeof doctorCheckIds[number], status: DoctorCheckStatus, summary: string, remediation?: string): DoctorCheck => ({
  id,
  status,
  summary,
  ...(remediation ? { remediation } : {})
});

const valueAfter = (argv: readonly string[], index: number): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DoctorCliError("A required option value is missing.");
  }
  return value;
};

export const parseDoctorOptions = (argv: readonly string[]): DoctorCliOptions => {
  const result: { configPath?: string; dataDir?: string; json: boolean; port?: number } = { json: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (forbiddenDoctorFlags.has(arg)) {
      throw new DoctorCliError("That option is forbidden for readiness checks.");
    }
    if (arg === "--json") {
      if (seen.has(arg)) {
        throw new DoctorCliError("Duplicate options are not allowed.");
      }
      seen.add(arg);
      result.json = true;
      continue;
    }
    if (arg === "--config" || arg === "--data-dir" || arg === "--port") {
      if (seen.has(arg)) {
        throw new DoctorCliError("Duplicate options are not allowed.");
      }
      seen.add(arg);
      const value = valueAfter(argv, index);
      index += 1;
      if (arg === "--config") {
        result.configPath = value;
      } else if (arg === "--data-dir") {
        result.dataDir = value;
      } else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new DoctorCliError("The port must be an integer from 1 to 65535.");
        }
        result.port = port;
      }
      continue;
    }
    throw new DoctorCliError(arg.startsWith("-") ? "Unknown doctor option." : "Positional arguments are not allowed.");
  }
  return result;
};

export const isNodeVersionOk = (version = process.versions.node): boolean => {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major >= 22;
};

const probeEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const allowed = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"];
  return Object.fromEntries(allowed.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]])) as NodeJS.ProcessEnv;
};

const defaultCommandVersion = (command: "docker" | "pnpm" | "podman", args: readonly string[], timeoutMs: number): string | undefined => {
  const windowsPnpm = process.platform === "win32" && command === "pnpm";
  const argv0 = windowsPnpm ? "cmd.exe" : command;
  const argv = windowsPnpm ? ["/d", "/s", "/c", "pnpm --version"] : [...args];
  const result = spawnSync(argv0, argv, {
    encoding: "utf8",
    env: probeEnvironment(process.env),
    shell: false,
    timeout: timeoutMs,
    windowsHide: true
  });
  if (result.status !== 0) {
    return undefined;
  }
  const output = String(result.stdout || result.stderr).trim();
  return output.length > 0 && output.length <= 256 ? output : undefined;
};

const defaultPythonProbe = (
  env: NodeJS.ProcessEnv,
  options: { readonly testOverride?: string; readonly timeoutMs: number }
): PythonReadinessEvidence | undefined => {
  const candidates = speechPythonCandidates(process.platform, options.testOverride);
  const perCandidateMs = Math.max(250, Math.floor(options.timeoutMs / candidates.length));
  const program = "import json,sys;print(json.dumps({'python_version':'.'.join(map(str,sys.version_info[:3]))}))";
  for (const candidate of candidates) {
    const result = spawnSync(candidate.argv0, [...candidate.args, "-u", "-B", "-c", program], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: probeEnvironment(env),
      shell: false,
      timeout: perCandidateMs,
      windowsHide: true
    });
    if (result.status !== 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(String(result.stdout).trim()) as { python_version?: unknown };
      if (typeof parsed.python_version !== "string") {
        continue;
      }
      const version = parseSpeechPythonVersion(parsed.python_version).value;
      return { source: candidate.source, version };
    } catch {
      continue;
    }
  }
  return undefined;
};

const readBoundedHealth = async (response: Response, limit = 8_192): Promise<unknown> => {
  if (!response.body) {
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    total += next.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    return undefined;
  }
};

const hasFairyHealthShape = (value: unknown): boolean =>
  isRecord(value) &&
  value.status === "ok" &&
  value.gateway_version === gatewayVersion &&
  value.protocol_version === protocolVersion &&
  typeof value.uptime_s === "number";

const canBindLoopback = (port: number, timeoutMs: number): Promise<boolean> => new Promise((resolvePromise) => {
  const server = createServer();
  let settled = false;
  const finish = (available: boolean): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    server.close(() => resolvePromise(available));
  };
  const timeout = setTimeout(() => finish(false), timeoutMs);
  server.once("error", () => finish(false));
  server.listen({ host: "127.0.0.1", port, exclusive: true }, () => finish(true));
});

export const probeGatewayPort = async (port: number, timeoutMs: number = doctorProbeDeadlines.gatewayMs): Promise<GatewayPortState> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
    if (response.ok && hasFairyHealthShape(await readBoundedHealth(response))) {
      return "fairy-running";
    }
  } catch {
    // The bounded bind probe below distinguishes an unused port from an occupied one.
  } finally {
    clearTimeout(timeout);
  }
  return await canBindLoopback(port, timeoutMs) ? "available" : "occupied";
};

const pathStat = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> =>
  lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));

const nearestExistingParent = async (path: string): Promise<string | undefined> => {
  let current = resolve(path);
  while (true) {
    const stat = await pathStat(current);
    if (stat) {
      return stat.isDirectory() && !stat.isSymbolicLink() ? current : undefined;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const writableDataDirectory = async (dataDir: string): Promise<boolean> => {
  const existing = await pathStat(dataDir);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    return false;
  }
  const probeRoot = existing ? dataDir : await nearestExistingParent(dataDir);
  if (!probeRoot) {
    return false;
  }
  const probePath = join(probeRoot, `.fairy-doctor-${randomUUID()}.tmp`);
  let created = false;
  let ready = false;
  try {
    await access(probeRoot, constants.W_OK);
    await writeFile(probePath, "readiness", { encoding: "utf8", flag: "wx" });
    created = true;
    ready = true;
  } catch {
    ready = false;
  } finally {
    if (created) {
      try {
        await unlink(probePath);
      } catch {
        ready = false;
      }
    }
  }
  return ready;
};

const isContained = (root: string, target: string): boolean => {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const validArtifactRecord = (value: unknown, artifactsRoot: string): value is ArtifactRecord =>
  isRecord(value) &&
  typeof value.artifact_id === "string" &&
  typeof value.hash === "string" &&
  typeof value.path === "string" &&
  typeof value.size_bytes === "number" &&
  isContained(artifactsRoot, value.path);

const artifactsReady = async (dataDir: string): Promise<boolean> => {
  const root = resolve(dataDir, "artifacts");
  const rootStat = await pathStat(root);
  if (!rootStat) {
    return true;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return false;
  }
  await access(root, constants.R_OK);
  const registryPath = join(root, "artifacts.jsonl");
  const registryStat = await pathStat(registryPath);
  if (!registryStat) {
    return (await new ArtifactRegistry(root).list()).length === 0;
  }
  if (!registryStat.isFile() || registryStat.isSymbolicLink()) {
    return false;
  }
  const raw = await readFile(registryPath, "utf8");
  if (Buffer.byteLength(raw) > 16 * 1024 * 1024) {
    return false;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const records: ArtifactRecord[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return false;
    }
    if (!validArtifactRecord(parsed, root)) {
      return false;
    }
    const targetStat = await pathStat(parsed.path);
    if (!targetStat || !targetStat.isFile() || targetStat.isSymbolicLink()) {
      return false;
    }
    records.push(parsed);
  }
  return (await new ArtifactRegistry(root).list()).length === records.length;
};

const sessionsReady = async (dataDir: string): Promise<boolean> => {
  const root = resolve(dataDir, "sessions");
  const stat = await pathStat(root);
  if (!stat) {
    return true;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return false;
  }
  await access(root, constants.R_OK);
  return true;
};

const webAssetsReady = async (root: string): Promise<boolean> => {
  for (const name of webAssetNames) {
    const stat = await pathStat(join(root, name));
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      return false;
    }
    await access(join(root, name), constants.R_OK);
  }
  return true;
};

const configuredGatewayPort = (loaded: LoadedConfig | undefined): number => {
  const gateway = loaded?.config.gateway;
  return isRecord(gateway) && typeof gateway.port === "number" ? gateway.port : 8787;
};

const configuredDataDirectory = (loaded: LoadedConfig | undefined, env: NodeJS.ProcessEnv): string => {
  const gateway = loaded?.config.gateway;
  return isRecord(gateway) && typeof gateway.data_dir === "string" ? gateway.data_dir : defaultDataDir(env);
};

const configHasSpeechProviders = (loaded: LoadedConfig | undefined): boolean => {
  const speech = loaded?.config.speech;
  return isRecord(speech) && Array.isArray(speech.providers) && speech.providers.length > 0;
};

const renderDoctorLines = (checks: readonly DoctorCheck[]): readonly string[] => {
  const lines = ["Fairy doctor", ""];
  for (const item of checks) {
    lines.push(`[${item.status.toUpperCase()}] ${item.id} - ${item.summary}`);
    if (item.remediation) {
      lines.push(`  Remediation: ${item.remediation}`);
    }
  }
  const failed = checks.some((item) => item.status === "fail");
  const warned = checks.some((item) => item.status === "warn");
  lines.push("", `Doctor: ${failed ? "FAIL" : warned ? "PASS WITH WARNINGS" : "PASS"}`);
  return lines;
};

export const renderDoctorJson = (report: DoctorReport): string => JSON.stringify(report);

export const doctorExitCode = (report: DoctorReport): 0 | 1 => report.ok ? 0 : 1;

export const evaluateReadiness = async (options: DoctorOptions = {}): Promise<ReadinessEvaluation> => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const commandVersion = options.probes?.commandVersion ?? defaultCommandVersion;
  let loaded: LoadedConfig | undefined;
  let configError: unknown;
  try {
    loaded = loadConfig(options.configPath ? { configPath: options.configPath, cwd, env } : { cwd, env });
  } catch (error) {
    configError = error;
  }

  const gatewayPort = options.port ?? configuredGatewayPort(loaded);
  const dataDir = resolve(options.dataDir ?? configuredDataDirectory(loaded, env));
  const gatewayPortState = await (options.probes?.gatewayPort ?? probeGatewayPort)(gatewayPort, doctorProbeDeadlines.gatewayMs);
  const checks: DoctorCheck[] = [];

  checks.push(isNodeVersionOk()
    ? check("runtime.node", "pass", `Node v${process.versions.node} satisfies >=22.`)
    : check("runtime.node", "fail", `Node v${process.versions.node} is unsupported.`, "Install Node 22 or newer."));

  const pnpmOutput = commandVersion("pnpm", ["--version"], doctorProbeDeadlines.commandMs);
  const pnpmVersion = pnpmOutput && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pnpmOutput) ? pnpmOutput : undefined;
  checks.push(pnpmVersion
    ? check("runtime.pnpm", "pass", `pnpm ${pnpmVersion} is executable.`)
    : check("runtime.pnpm", "fail", "pnpm is unavailable.", "Install the repository package-manager version with Corepack."));

  const testOverride = env.NODE_ENV === "test" || env.CI === "true" ? env.FAIRY_TEST_PYTHON : undefined;
  const python = (options.probes?.python ?? ((probeOptions) => defaultPythonProbe(env, probeOptions)))({
    ...(testOverride ? { testOverride } : {}),
    timeoutMs: doctorProbeDeadlines.pythonMs
  });
  if (python) {
    checks.push(check("runtime.python", "pass", `Python ${python.version} is ready (${python.source}).`));
  } else if (configHasSpeechProviders(loaded)) {
    checks.push(check("runtime.python", "fail", "No supported Python interpreter is available for configured speech providers.", "Install Python 3.11 or newer on the production discovery path."));
  } else {
    checks.push(check("runtime.python", "warn", "Python 3.11+ was not found; no speech provider is configured.", "Install Python 3.11 or newer before enabling speech providers."));
  }

  if (loaded) {
    const sources = loaded.sources.filter((source) => source.found).map((source) => source.name).join(", ") || "defaults";
    checks.push(check("config.load", "pass", `Effective configuration is valid (sources: ${sources}).`));
  } else {
    const issuePaths = configError instanceof ConfigValidationError
      ? configError.issues.slice(0, 4).map((issue) => issue.path).join(", ")
      : "configuration";
    checks.push(check("config.load", "fail", `Effective configuration is invalid (${issuePaths}).`, "Fix the bounded schema issues and rerun doctor."));
  }

  if (!loaded) {
    checks.push(check("config.main-role", "fail", "Main-role readiness cannot be validated because configuration loading failed."));
  } else {
    try {
      const parsed = parseModelGatewayConfig(loaded.config);
      const main = parsed.models.find((model) => model.id === parsed.roles.main?.model);
      if (!main) {
        throw new Error("main role missing");
      }
      if (main.api_key_ref) {
        resolveSecretRef(main.api_key_ref, env);
      }
      checks.push(check("config.main-role", "pass", "Main role resolves to a known tools-capable model; no provider probe was made."));
    } catch {
      checks.push(check("config.main-role", "fail", "Main role, model binding, or configured credential reference is not ready.", "Configure a known tools-capable main model and resolve its secret reference."));
    }
  }

  if (!loaded) {
    checks.push(check("config.gateway-auth", "fail", "Gateway authentication cannot be validated because configuration loading failed."));
  } else {
    const gateway = isRecord(loaded.config.gateway) ? loaded.config.gateway : {};
    const auth = isRecord(gateway.auth) ? gateway.auth : {};
    const token = auth.token;
    if (typeof token !== "string" || token === "" || token === "dev-token") {
      checks.push(check("config.gateway-auth", "fail", "Gateway authentication still uses a missing, empty, or default token.", "Set gateway.auth.token to a resolvable secret reference."));
    } else if (token.startsWith("secret://")) {
      try {
        resolveSecretRef(token, env);
        checks.push(check("config.gateway-auth", "pass", "Gateway token secret reference is present and resolvable."));
      } catch {
        checks.push(check("config.gateway-auth", "fail", "Gateway token secret reference is unresolved.", "Set the referenced gateway-token environment variable."));
      }
    } else {
      checks.push(check("config.gateway-auth", "warn", "A non-default literal gateway token is configured.", "Prefer a secret:// reference so the token is not stored in configuration."));
    }
  }

  let speechConfig: ReturnType<typeof parseSpeechProviderConfig> | undefined;
  if (loaded) {
    try {
      speechConfig = parseSpeechProviderConfig(loaded.config);
    } catch {
      speechConfig = undefined;
    }
  }
  const asrProvider = speechConfig?.asrCandidates[0];
  if (!asrProvider) {
    checks.push(check("config.speech-asr", "fail", "The MiMo ASR role is missing or invalid.", "Configure the closed mimo-paygo-cn ASR provider and role."));
  } else {
    try {
      resolveMimoCredential(asrProvider, env);
      checks.push(check("config.speech-asr", "pass", "MiMo ASR is ready with pay-as-you-go-sk credential class; no provider probe was made."));
    } catch {
      checks.push(check("config.speech-asr", "fail", "MiMo ASR credential is missing or has the wrong class.", "Resolve an ordinary pay-as-you-go sk-* credential reference."));
    }
  }

  const ttsProvider = speechConfig?.ttsCandidates[0];
  if (!ttsProvider) {
    checks.push(check("config.speech-tts", "fail", "The MiniMax TTS role is missing or invalid.", "Configure a closed MiniMax T2A v2 endpoint profile and role."));
  } else {
    try {
      resolveMiniMaxCredential(ttsProvider, env);
      checks.push(check("config.speech-tts", "pass", "MiniMax TTS credential reference is present; no provider probe was made."));
    } catch {
      checks.push(check("config.speech-tts", "fail", "MiniMax TTS credential reference is unresolved.", "Set the referenced MiniMax credential environment variable."));
    }
  }

  checks.push(await writableDataDirectory(dataDir)
    ? check("storage.data-dir", "pass", "The effective data directory is writable and the probe left no residue.")
    : check("storage.data-dir", "fail", "The effective data directory cannot be safely initialized or written.", "Choose a writable directory without a file or symlink collision."));

  try {
    checks.push(await artifactsReady(dataDir)
      ? check("storage.artifacts", "pass", "Artifact storage is absent-ready or its registry is readable and contained.")
      : check("storage.artifacts", "fail", "Artifact storage is malformed, escaped, unreadable, or unsafe.", "Repair the artifact registry before starting the gateway."));
  } catch {
    checks.push(check("storage.artifacts", "fail", "Artifact storage is unreadable.", "Repair permissions or registry state before starting the gateway."));
  }

  try {
    checks.push(await sessionsReady(dataDir)
      ? check("storage.sessions", "pass", "Session storage is absent-ready or its root is readable.")
      : check("storage.sessions", "fail", "Session storage has a collision or unsafe root.", "Repair the sessions root before starting the gateway."));
  } catch {
    checks.push(check("storage.sessions", "fail", "Session storage is unreadable.", "Repair permissions before starting the gateway."));
  }

  checks.push(gatewayPortState === "available"
    ? check("network.gateway-port", "pass", `Loopback port ${gatewayPort} is available.`)
    : gatewayPortState === "fairy-running"
      ? check("network.gateway-port", "pass", `Loopback port ${gatewayPort} is owned by a healthy Fairy gateway.`)
      : check("network.gateway-port", "fail", `Loopback port ${gatewayPort} is occupied by a non-Fairy or unhealthy service.`, "Stop the conflicting process or select another loopback port."));

  checks.push(gatewayPortState === "fairy-running"
    ? check("runtime.gateway-health", "pass", "An existing Fairy gateway returned the expected bounded health shape.")
    : gatewayPortState === "available"
      ? check("runtime.gateway-health", "warn", "The Fairy gateway is not running yet; the port is ready for dev start.")
      : check("runtime.gateway-health", "fail", "No healthy Fairy gateway is available on the occupied port.", "Resolve the port conflict before dev start."));

  try {
    const assetsRoot = options.probes?.webAssetsRoot ?? join(repoRoot, "apps", "web");
    checks.push(await webAssetsReady(assetsRoot)
      ? check("web.assets", "pass", `All ${webAssetNames.length} repository-owned Web assets are regular readable files.`)
      : check("web.assets", "fail", "One or more required Web assets are missing, unreadable, symlinked, or not regular files.", "Restore the six source Web assets from the repository."));
  } catch {
    checks.push(check("web.assets", "fail", "Required Web assets could not be read.", "Restore readable source Web assets from the repository."));
  }

  const containerRuntime = commandVersion("docker", ["--version"], doctorProbeDeadlines.commandMs) ?? commandVersion("podman", ["--version"], doctorProbeDeadlines.commandMs);
  checks.push(containerRuntime
    ? check("optional.container-runtime", "pass", "A bounded Docker/Podman version probe succeeded.")
    : check("optional.container-runtime", "warn", "Docker/Podman is unavailable; optional execution tools remain disabled."));

  const research = loaded && isRecord(loaded.config.research) ? loaded.config.research : {};
  const search = loaded && isRecord(loaded.config.search) ? loaded.config.search : {};
  const engine = isRecord(search.engine) ? search.engine : {};
  const liveResearchConfigured = Array.isArray(research.engines) && research.engines.length > 0 || (typeof engine.kind === "string" && engine.kind !== "mock");
  checks.push(liveResearchConfigured
    ? check("optional.research", "pass", "A configured research engine is schema-ready; no search or fetch was made.")
    : check("optional.research", "warn", "Only deterministic/mock or no research capability is configured."));

  const ordered = doctorCheckIds.map((id) => checks.find((item) => item.id === id));
  if (ordered.some((item) => !item)) {
    throw new Error("doctor registry did not produce every required check");
  }
  const finalChecks = ordered as readonly DoctorCheck[];
  const report: DoctorReport = {
    checks: finalChecks,
    kind: "fairy.doctor.report",
    lines: renderDoctorLines(finalChecks),
    ok: !finalChecks.some((item) => item.status === "fail"),
    v: 1
  };
  return { facts: { dataDir, gatewayPort, gatewayPortState }, report };
};

export const runDoctor = async (options: DoctorOptions | string = {}): Promise<DoctorReport> =>
  (await evaluateReadiness(typeof options === "string" ? { cwd: options } : options)).report;
