import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";

import {
  evaluateReadiness,
  probeGatewayPort,
  type DoctorProbeOverrides,
  type DoctorReport,
  type GatewayPortState
} from "./doctor.js";

export interface DevCliOptions {
  readonly configPath?: string;
  readonly dataDir?: string;
  readonly noOpen: boolean;
  readonly port?: number;
}

export interface DevOptions extends DevCliOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly probes?: DevProbeOverrides;
  readonly signal?: AbortSignal;
}

export interface DevProbeOverrides {
  readonly browserOpen?: (url: string) => Promise<void>;
  readonly doctor?: DoctorProbeOverrides;
  readonly gatewayHealth?: (port: number, timeoutMs: number) => Promise<GatewayPortState>;
  readonly output?: (line: string) => void;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly spawnGateway?: (args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }) => ChildProcess;
}

export interface DevResult {
  readonly browserOpened: boolean;
  readonly doctor: DoctorReport;
  readonly gateway: "none" | "reused" | "started";
  readonly ok: boolean;
  readonly portReleased: boolean;
}

export const devUsage = "Usage: fairy dev [--config path] [--data-dir path] [--port 1-65535] [--no-open]";

export const devDeadlines = {
  forcedShutdownMs: 5_000,
  gracefulShutdownMs: 5_000,
  pollMs: 100,
  startupMs: 15_000
} as const;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const startGatewayScript = resolve(repoRoot, "scripts", "start-gateway.mjs");
const forbiddenFlags = new Set(["--token", "--api-key", "--secret", "--live", "--probe-provider", "--base-url", "--host", "--json"]);

export class DevCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevCliError";
  }
}

const valueAfter = (argv: readonly string[], index: number): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DevCliError("A required option value is missing.");
  }
  return value;
};

export const parseDevOptions = (argv: readonly string[]): DevCliOptions => {
  const result: { configPath?: string; dataDir?: string; noOpen: boolean; port?: number } = { noOpen: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (forbiddenFlags.has(arg)) {
      throw new DevCliError("That option is forbidden for dev start.");
    }
    if (arg === "--no-open") {
      if (seen.has(arg)) {
        throw new DevCliError("Duplicate options are not allowed.");
      }
      seen.add(arg);
      result.noOpen = true;
      continue;
    }
    if (arg === "--config" || arg === "--data-dir" || arg === "--port") {
      if (seen.has(arg)) {
        throw new DevCliError("Duplicate options are not allowed.");
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
          throw new DevCliError("The port must be an integer from 1 to 65535.");
        }
        result.port = port;
      }
      continue;
    }
    throw new DevCliError(arg.startsWith("-") ? "Unknown dev option." : "Positional arguments are not allowed.");
  }
  return result;
};

const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const defaultSpawnGateway = (args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }): ChildProcess =>
  spawn(process.execPath, [startGatewayScript, ...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true
  });

const commandSpawned = (child: ChildProcess): Promise<void> => new Promise((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("spawn", () => resolvePromise());
});

const defaultBrowserOpen = async (url: string): Promise<void> => {
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], { shell: false, stdio: "ignore", windowsHide: true })
    : process.platform === "darwin"
      ? spawn("open", [url], { detached: true, shell: false, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, shell: false, stdio: "ignore" });
  await commandSpawned(child);
  child.unref();
};

const childExit = (child: ChildProcess): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })));
};

const aborted = (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => signal.addEventListener("abort", () => resolvePromise(), { once: true }));
};

const abortedWithKeepAlive = (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const keepAlive = new MessageChannel();
    const close = (): void => {
      signal.removeEventListener("abort", onAbort);
      keepAlive.port1.close();
      keepAlive.port2.close();
    };
    const onAbort = (): void => {
      close();
      resolvePromise();
    };
    try {
      keepAlive.port1.on("message", () => undefined);
      keepAlive.port1.ref();
      signal.addEventListener("abort", onAbort, { once: true });
    } catch (error) {
      close();
      reject(error);
    }
  });
};

const waitForGateway = async (
  child: ChildProcess,
  port: number,
  health: (port: number, timeoutMs: number) => Promise<GatewayPortState>,
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < devDeadlines.startupMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return false;
    }
    if (await health(port, Math.min(1_000, devDeadlines.startupMs - (Date.now() - started))) === "fairy-running") {
      return true;
    }
    await sleep(devDeadlines.pollMs);
  }
  return false;
};

const waitWithDeadline = async <T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolvePromise) => {
        timeout = setTimeout(() => resolvePromise(undefined), milliseconds);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const forceProcessTree = (child: ChildProcess): void => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      timeout: devDeadlines.forcedShutdownMs,
      windowsHide: true
    });
  } else {
    child.kill("SIGKILL");
  }
};

const stopOwnedGateway = async (
  child: ChildProcess,
  port: number,
  health: (port: number, timeoutMs: number) => Promise<GatewayPortState>,
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> => {
  const exit = childExit(child);
  if (child.exitCode === null && child.signalCode === null) {
    if (child.connected) {
      child.send?.({ kind: "fairy.launcher.shutdown", signal: "SIGTERM" });
    } else if (process.platform !== "win32") {
      child.kill("SIGTERM");
    }
  }
  if (!await waitWithDeadline(exit, devDeadlines.gracefulShutdownMs)) {
    forceProcessTree(child);
    await waitWithDeadline(exit, devDeadlines.forcedShutdownMs);
  }
  const releaseStarted = Date.now();
  while (Date.now() - releaseStarted < devDeadlines.forcedShutdownMs) {
    if (await health(port, 500) === "available") {
      return true;
    }
    await sleep(devDeadlines.pollMs);
  }
  return false;
};

const doctorSummary = (report: DoctorReport): "FAIL" | "PASS" | "PASS WITH WARNINGS" =>
  !report.ok ? "FAIL" : report.checks.some((item) => item.status === "warn") ? "PASS WITH WARNINGS" : "PASS";

export const runDev = async (options: DevOptions): Promise<DevResult> => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const output = options.probes?.output ?? console.log;
  const health = options.probes?.gatewayHealth ?? probeGatewayPort;
  const sleep = options.probes?.sleep ?? defaultSleep;
  const readiness = await evaluateReadiness({
    ...(options.configPath ? { configPath: options.configPath } : {}),
    cwd,
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    env,
    ...(options.port ? { port: options.port } : {}),
    ...(options.probes?.doctor ? { probes: options.probes.doctor } : {})
  });
  const { facts, report } = readiness;
  output("Fairy dev");
  output(`Doctor: ${doctorSummary(report)}`);
  for (const item of report.checks.filter((candidate) => candidate.status === "warn")) {
    output(`[WARN] ${item.id} - ${item.summary}`);
  }
  if (!report.ok) {
    for (const item of report.checks.filter((candidate) => candidate.status === "fail")) {
      output(`[FAIL] ${item.id} - ${item.summary}`);
      if (item.remediation) {
        output(`Remediation: ${item.remediation}`);
      }
    }
    return { browserOpened: false, doctor: report, gateway: "none", ok: false, portReleased: true };
  }

  const healthUrl = `http://127.0.0.1:${facts.gatewayPort}/health`;
  const webUrl = `http://127.0.0.1:${facts.gatewayPort}/web/`;
  const signal = options.signal ?? new AbortController().signal;
  let child: ChildProcess | undefined;
  let gateway: DevResult["gateway"];

  if (facts.gatewayPortState === "fairy-running") {
    gateway = "reused";
    output("Gateway: REUSED");
  } else if (facts.gatewayPortState === "available") {
    const args = [
      ...(options.configPath ? ["--config", options.configPath] : []),
      "--data-dir",
      facts.dataDir,
      "--port",
      String(facts.gatewayPort)
    ];
    child = (options.probes?.spawnGateway ?? defaultSpawnGateway)(args, { cwd: repoRoot, env });
    gateway = "started";
    if (!await waitForGateway(child, facts.gatewayPort, health, sleep)) {
      const portReleased = await stopOwnedGateway(child, facts.gatewayPort, health, sleep);
      output("Gateway: FAILED before bounded health readiness");
      return { browserOpened: false, doctor: report, gateway: "started", ok: false, portReleased };
    }
    output("Gateway: STARTED");
  } else {
    return { browserOpened: false, doctor: report, gateway: "none", ok: false, portReleased: true };
  }

  output(`Health: ${healthUrl}`);
  output(`Web: ${webUrl}`);
  output("Auth: enter the configured gateway token in the Web UI; token is not printed");
  output("Press Ctrl+C to stop this launcher");

  let browserOpened = false;
  if (!options.noOpen) {
    try {
      await (options.probes?.browserOpen ?? defaultBrowserOpen)(webUrl);
      browserOpened = true;
    } catch {
      output(`Browser: WARN could not open automatically; use ${webUrl}`);
    }
  }

  if (!child) {
    await abortedWithKeepAlive(signal);
    return { browserOpened, doctor: report, gateway, ok: true, portReleased: false };
  }

  const outcome = await Promise.race([
    aborted(signal).then(() => "stop" as const),
    childExit(child).then(() => "exit" as const)
  ]);
  if (outcome === "exit") {
    output("Gateway: owned process exited");
    return { browserOpened, doctor: report, gateway, ok: false, portReleased: await health(facts.gatewayPort, 500) === "available" };
  }
  const portReleased = await stopOwnedGateway(child, facts.gatewayPort, health, sleep);
  output(portReleased ? "Gateway: STOPPED" : "Gateway: STOP FAILED");
  return { browserOpened, doctor: report, gateway, ok: portReleased, portReleased };
};
