import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer, type RequestListener, type Server as HttpServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "@fairy/config";
import { parseSpeechProviderConfig } from "@fairy/gateway";
import { parseModelGatewayConfig } from "@fairy/model-gateway";
import { parseSpeechPythonVersion, speechPythonCandidates } from "@fairy/voice";
import { afterAll, describe, expect, it } from "vitest";

import {
  doctorCheckIds,
  doctorExitCode,
  doctorProbeDeadlines,
  parseDevOptions,
  parseDoctorOptions,
  probeGatewayPort,
  renderDoctorJson,
  runDev,
  runDoctor,
  type DoctorProbeOverrides,
  type GatewayPortState
} from "../src/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const cleanupRoots: string[] = [];
const secretValues = {
  gateway: "synthetic-gateway-token-never-print",
  main: "synthetic-main-key-never-print",
  mimo: "sk-synthetic-paygo-never-print",
  minimax: "synthetic-minimax-token-never-print"
} as const;

const inheritedEnvironmentKeys = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR"
] as const;

const boundedTestEnvironment = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  Object.fromEntries(inheritedEnvironmentKeys.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]])) as NodeJS.ProcessEnv;

interface Harness {
  readonly configPath: string;
  readonly dataDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly root: string;
}

interface ConfigFixtureOptions {
  readonly gatewayToken?: string;
  readonly mainBaseUrl?: string;
  readonly mimoRef?: string;
  readonly port?: number;
}

const configText = (options: ConfigFixtureOptions = {}): string => [
  "models:",
  "  - id: main-test",
  "    transport: openai-chat",
  `    base_url: ${options.mainBaseUrl ?? "http://127.0.0.1:9/v1"}`,
  "    model: test-model",
  "    api_key_ref: secret://main_key",
  "    capabilities:",
  "      tools: native",
  "    data_clearance:",
  "      max_sensitivity: personal",
  "      residency: [region-restricted, global-ok]",
  "      regions: [cn]",
  "roles:",
  "  main:",
  "    model: main-test",
  "    fallback: []",
  "gateway:",
  `  port: ${options.port ?? 18787}`,
  "  auth:",
  `    token: ${options.gatewayToken ?? "secret://gateway_token"}`,
  "governance:",
  "  profile: balanced",
  "  home_regions: [cn]",
  "speech:",
  "  providers:",
  "    - id: mimo-asr",
  "      stage: asr",
  "      transport: mimo-v2.5-asr-chat-http",
  "      endpoint_profile: mimo-paygo-cn",
  "      model: mimo-v2.5-asr",
  `      api_key_ref: ${options.mimoRef ?? "secret://mimo_key"}`,
  "      language: auto",
  "      limits:",
  "        max_input_bytes: 7000000",
  "        max_response_bytes: 1048576",
  "        max_transcript_chars: 20000",
  "      data_clearance:",
  "        max_sensitivity: personal",
  "        residency: [region-restricted, global-ok]",
  "        regions: [cn]",
  "    - id: minimax-tts",
  "      stage: tts",
  "      transport: minimax-t2a-v2-http",
  "      endpoint_profile: cn-primary",
  "      model: speech-2.8-turbo",
  "      voice:",
  "        voice_id: synthetic-voice",
  "        speed: 1",
  "        volume: 1",
  "        pitch: 0",
  "      api_key_ref: secret://minimax_key",
  "      language_boost: auto",
  "      audio:",
  "        format: mp3",
  "        sample_rate: 32000",
  "        bitrate: 128000",
  "        channel: 1",
  "      limits:",
  "        max_text_chars: 3000",
  "        max_response_bytes: 67108864",
  "        max_audio_bytes: 33554432",
  "      data_clearance:",
  "        max_sensitivity: personal",
  "        residency: [region-restricted, global-ok]",
  "        regions: [cn]",
  "  roles:",
  "    asr:",
  "      primary: mimo-asr",
  "      fallback: []",
  "    tts:",
  "      primary: minimax-tts",
  "      fallback: []",
  "search:",
  "  engine:",
  "    kind: mock",
  ""
].join("\n");

const createHarness = async (options: ConfigFixtureOptions = {}): Promise<Harness> => {
  const root = await mkdtemp(join(tmpdir(), "fairy-developer-preview-"));
  cleanupRoots.push(root);
  const configPath = join(root, "fairy.yaml");
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  await writeFile(configPath, configText(options));
  return {
    configPath,
    dataDir,
    env: {
      ...boundedTestEnvironment(),
      GATEWAY_TOKEN: secretValues.gateway,
      MAIN_KEY: secretValues.main,
      MIMO_KEY: secretValues.mimo,
      MINIMAX_KEY: secretValues.minimax,
      NODE_ENV: "test"
    },
    root
  };
};

const deterministicProbes = (gatewayPort: GatewayPortState = "available"): DoctorProbeOverrides => ({
  commandVersion: (command) => command === "pnpm" ? "11.7.0" : command === "docker" ? "Docker synthetic" : undefined,
  gatewayPort: async () => gatewayPort,
  python: () => ({ source: "discovered", version: "3.11.9" })
});

const runtimeOnlyProbes = (): DoctorProbeOverrides => {
  const probes = deterministicProbes();
  return { commandVersion: probes.commandVersion!, python: probes.python! };
};

const doctorFor = async (harness: Harness, probes = deterministicProbes()) => runDoctor({
  configPath: harness.configPath,
  cwd: repoRoot,
  dataDir: harness.dataDir,
  env: harness.env,
  port: 18787,
  probes
});

const freePort = async (): Promise<number> => new Promise((resolvePromise, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolvePromise(port));
  });
});

const listenHttp = async (handler: RequestListener, port = 0): Promise<{ readonly port: number; readonly server: HttpServer }> => {
  const server = createHttpServer(handler);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP address");
  }
  return { port: address.port, server };
};

const closeHttp = (server: HttpServer): Promise<void> => new Promise((resolvePromise, reject) =>
  server.close((error) => error ? reject(error) : resolvePromise()));

afterAll(async () => {
  await Promise.all(cleanupRoots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("developer-preview.launch-v0", () => {
  it("Case A — doctor schema and stable ordering", async () => {
    const harness = await createHarness();
    expect(boundedTestEnvironment({
      CI: "true",
      CONDA_PREFIX: "must-not-inherit",
      FAIRY_CONFIG: "must-not-inherit",
      FAIRY_OWNER_LIVE_ASR: "1",
      FAIRY_OWNER_LIVE_TTS: "1",
      FAIRY_TEST_PYTHON: "must-not-inherit",
      PATH: "synthetic-path"
    })).toEqual({ PATH: "synthetic-path" });
    expect(harness.env).not.toHaveProperty("CI");
    expect(Object.keys(harness.env).filter((name) => name.startsWith("FAIRY_"))).toEqual([]);
    const first = await doctorFor(harness);
    const second = await doctorFor(harness);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ kind: "fairy.doctor.report", ok: true, v: 1 });
    expect(first.checks.map((item) => item.id)).toEqual(doctorCheckIds);
    expect(first.checks.every((item) => ["pass", "warn", "fail"].includes(item.status))).toBe(true);
    expect(first.checks.some((item) => item.status === "warn")).toBe(true);
    expect(first.lines[0]).toBe("Fairy doctor");
    expect(first.lines.at(-1)).toBe("Doctor: PASS WITH WARNINGS");
    expect(JSON.parse(renderDoctorJson(first))).toEqual(first);
    expect(renderDoctorJson(first)).not.toContain(String.fromCharCode(27));
  });

  it("Case B — CLI parse and exit law", async () => {
    expect(parseDoctorOptions(["--json", "--config", "x.yaml", "--data-dir", "data", "--port", "8787"])).toEqual({
      configPath: "x.yaml", dataDir: "data", json: true, port: 8787
    });
    expect(parseDevOptions(["--config", "x.yaml", "--data-dir", "data", "--port", "8787", "--no-open"])).toEqual({
      configPath: "x.yaml", dataDir: "data", noOpen: true, port: 8787
    });
    for (const args of [
      ["--port"], ["--port", "0"], ["--port", "65536"], ["--port", "nope"],
      ["--json", "--json"], ["--config", "a", "--config", "b"], ["--unknown"], ["positional"],
      ["--token"], ["--api-key"], ["--secret"], ["--live"], ["--probe-provider"], ["--base-url"], ["--host"], ["--python"]
    ]) {
      expect(() => parseDoctorOptions(args)).toThrow();
    }
    expect(() => parseDevOptions(["--no-open", "--no-open"])).toThrow();
    expect(() => parseDevOptions(["--json"])).toThrow();
    const harness = await createHarness();
    const warningReport = await doctorFor(harness);
    const failureReport = await doctorFor({ ...harness, env: { ...harness.env, GATEWAY_TOKEN: undefined } });
    expect(doctorExitCode(warningReport)).toBe(0);
    expect(doctorExitCode(failureReport)).toBe(1);
    const json = renderDoctorJson(warningReport);
    expect(json.trim().split(/\r?\n/)).toHaveLength(1);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("Case C — config and credential readiness", async () => {
    const harness = await createHarness();
    const valid = await doctorFor(harness);
    for (const id of ["config.load", "config.main-role", "config.gateway-auth", "config.speech-asr", "config.speech-tts"]) {
      expect(valid.checks.find((item) => item.id === id)?.status).toBe("pass");
    }

    const missing = await doctorFor({ ...harness, env: { ...boundedTestEnvironment(), NODE_ENV: "test" } });
    expect(missing.checks.filter((item) => item.id.startsWith("config.")).map((item) => [item.id, item.status])).toEqual(expect.arrayContaining([
      ["config.main-role", "fail"], ["config.gateway-auth", "fail"], ["config.speech-asr", "fail"], ["config.speech-tts", "fail"]
    ]));
    const mismatch = await doctorFor({ ...harness, env: { ...harness.env, MIMO_KEY: "token-plan-synthetic" } });
    expect(mismatch.checks.find((item) => item.id === "config.speech-asr")?.status).toBe("fail");

    const defaultToken = await createHarness({ gatewayToken: "dev-token" });
    expect((await doctorFor(defaultToken)).checks.find((item) => item.id === "config.gateway-auth")?.status).toBe("fail");
    const literalToken = await createHarness({ gatewayToken: "literal-synthetic-token" });
    expect((await doctorFor(literalToken)).checks.find((item) => item.id === "config.gateway-auth")?.status).toBe("warn");

    const allOutput = [valid, missing, mismatch, await doctorFor(defaultToken), await doctorFor(literalToken)].map((report) => JSON.stringify(report)).join("\n");
    for (const secret of Object.values(secretValues)) {
      expect(allOutput).not.toContain(secret);
    }
    expect(allOutput).not.toMatch(/Authorization|api-key\s*[:=]|base64|data:audio/i);
  });

  it("Case D — shared Python floor", async () => {
    expect(speechPythonCandidates("linux").map((item) => [item.argv0, item.args])).toEqual([["python3", []], ["python", []]]);
    expect(speechPythonCandidates("win32").map((item) => [item.argv0, item.args])).toEqual([["python3", []], ["python", []], ["py", ["-3"]]]);
    expect(speechPythonCandidates("win32", "test-python")).toEqual([{ args: [], argv0: "test-python", source: "test-override" }]);
    expect(parseSpeechPythonVersion("3.11.0").value).toBe("3.11.0");
    expect(() => parseSpeechPythonVersion("3.10.99")).toThrow(/Python >= 3\.11/);
    expect(() => parseSpeechPythonVersion("not-a-version")).toThrow(/invalid version evidence/);

    const harness = await createHarness();
    let productionOverride: string | undefined;
    await doctorFor({ ...harness, env: { ...harness.env, FAIRY_TEST_PYTHON: "must-not-be-used", NODE_ENV: "production" } }, {
      ...deterministicProbes(),
      python: (options) => {
        productionOverride = options.testOverride;
        return { source: "discovered", version: "3.11.0" };
      }
    });
    expect(productionOverride).toBeUndefined();
    let testOverride: string | undefined;
    await doctorFor({ ...harness, env: { ...harness.env, FAIRY_TEST_PYTHON: "test-only-python", NODE_ENV: "test" } }, {
      ...deterministicProbes(),
      python: (options) => {
        testOverride = options.testOverride;
        return { source: "test-override", version: "3.11.0" };
      }
    });
    expect(testOverride).toBe("test-only-python");
    if (process.env.FAIRY_TEST_PYTHON) {
      const floor = await runDoctor({
        configPath: harness.configPath,
        cwd: repoRoot,
        dataDir: harness.dataDir,
        env: { ...harness.env, FAIRY_TEST_PYTHON: process.env.FAIRY_TEST_PYTHON, NODE_ENV: "test" },
        port: 18787,
        probes: {
          commandVersion: deterministicProbes().commandVersion!,
          gatewayPort: deterministicProbes().gatewayPort!
        }
      });
      expect(floor.checks.find((item) => item.id === "runtime.python")).toMatchObject({ status: "pass" });
      expect(floor.checks.find((item) => item.id === "runtime.python")?.summary).toContain("test-override");
    }
    const supervisor = await readFile(join(repoRoot, "apps/gateway/src/speech-worker-process.ts"), "utf8");
    expect(supervisor).toContain("speechPythonCandidates(process.platform, this.#testPythonOverride)");
    expect((supervisor.match(/FAIRY_TEST_PYTHON/g) ?? [])).toHaveLength(1);
  });

  it("Case E — storage and Web assets", async () => {
    const harness = await createHarness();
    const ready = await doctorFor(harness);
    expect(ready.checks.find((item) => item.id === "storage.data-dir")?.status).toBe("pass");
    expect(ready.checks.find((item) => item.id === "storage.artifacts")?.status).toBe("pass");
    expect(ready.checks.find((item) => item.id === "storage.sessions")?.status).toBe("pass");
    expect((await readdir(harness.dataDir)).filter((name) => name.startsWith(".fairy-doctor-"))).toEqual([]);

    const collision = join(harness.root, "data-file");
    await writeFile(collision, "collision");
    const collisionReport = await runDoctor({ ...parseDoctorOptions(["--config", harness.configPath, "--data-dir", collision, "--port", "18787"]), cwd: repoRoot, env: harness.env, probes: deterministicProbes() });
    expect(collisionReport.checks.find((item) => item.id === "storage.data-dir")?.status).toBe("fail");

    await mkdir(join(harness.dataDir, "artifacts"));
    const hidden = "synthetic registry content must not leak";
    await writeFile(join(harness.dataDir, "artifacts", "artifacts.jsonl"), `{not-json ${hidden}\n`);
    const malformed = await doctorFor(harness);
    expect(malformed.checks.find((item) => item.id === "storage.artifacts")?.status).toBe("fail");
    expect(JSON.stringify(malformed)).not.toContain(hidden);
    await mkdir(join(harness.dataDir, "sessions"));
    await rm(join(harness.dataDir, "sessions"), { recursive: true });
    await writeFile(join(harness.dataDir, "sessions"), "collision");
    expect((await doctorFor(harness)).checks.find((item) => item.id === "storage.sessions")?.status).toBe("fail");

    const assetsRoot = join(harness.root, "web-assets");
    await mkdir(assetsRoot);
    for (const name of ["index.html", "styles.css", "app.js", "recorder.js", "wav.js", "audio-worklet.js"]) {
      await writeFile(join(assetsRoot, name), "asset");
    }
    const assetReady = await doctorFor(harness, { ...deterministicProbes(), webAssetsRoot: assetsRoot });
    expect(assetReady.checks.find((item) => item.id === "web.assets")?.status).toBe("pass");
    await rm(join(assetsRoot, "app.js"));
    await mkdir(join(assetsRoot, "app.js"));
    expect((await doctorFor(harness, { ...deterministicProbes(), webAssetsRoot: assetsRoot })).checks.find((item) => item.id === "web.assets")?.status).toBe("fail");
    await rm(join(assetsRoot, "app.js"), { recursive: true });
    try {
      await symlink(join(assetsRoot, "styles.css"), join(assetsRoot, "app.js"));
      expect((await doctorFor(harness, { ...deterministicProbes(), webAssetsRoot: assetsRoot })).checks.find((item) => item.id === "web.assets")?.status).toBe("fail");
    } catch {
      // Windows environments without symlink privilege still cover directory replacement above.
    }
  });

  it("Case F — port and health classification", async () => {
    const availablePort = await freePort();
    expect(await probeGatewayPort(availablePort)).toBe("available");
    const healthy = await listenHttp((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ gateway_version: "0.1.0-m1", protocol_version: 1, status: "ok", uptime_s: 1 }));
    });
    try {
      expect(await probeGatewayPort(healthy.port)).toBe("fairy-running");
    } finally {
      await closeHttp(healthy.server);
    }
    const occupied = await listenHttp((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
    });
    try {
      expect(await probeGatewayPort(occupied.port)).toBe("occupied");
    } finally {
      await closeHttp(occupied.server);
    }
    expect(doctorProbeDeadlines.gatewayMs).toBeLessThanOrEqual(1_000);
    const source = await readFile(join(repoRoot, "apps/cli/src/doctor.ts"), "utf8");
    expect(source).toContain("http://127.0.0.1:${port}/health");
    expect((source.match(/fetch\(/g) ?? [])).toHaveLength(1);
  });

  it("Case G — provider-network zero", async () => {
    const counters = { model: 0, mimo: 0, minimax: 0, research: 0 };
    const sentinels = await Promise.all((Object.keys(counters) as (keyof typeof counters)[]).map(async (kind) => listenHttp((_request, response) => {
      counters[kind] += 1;
      response.writeHead(500);
      response.end("provider-shaped sentinel");
    })));
    try {
      const harness = await createHarness({ mainBaseUrl: `http://127.0.0.1:${sentinels[0]?.port}/v1` });
      await doctorFor(harness);
      let spawned = 0;
      let opened = 0;
      const failed = await runDev({
        configPath: harness.configPath,
        cwd: repoRoot,
        dataDir: harness.dataDir,
        env: { ...harness.env, MIMO_KEY: undefined },
        noOpen: false,
        port: 18787,
        probes: {
          browserOpen: async () => { opened += 1; },
          doctor: deterministicProbes(),
          output: () => undefined,
          spawnGateway: () => { spawned += 1; throw new Error("must not spawn"); }
        }
      });
      expect(failed.ok).toBe(false);
      const controller = new AbortController();
      controller.abort();
      const successful = await runDev({
        configPath: harness.configPath,
        cwd: repoRoot,
        dataDir: harness.dataDir,
        env: harness.env,
        noOpen: true,
        port: 18787,
        probes: { doctor: deterministicProbes("fairy-running"), output: () => undefined },
        signal: controller.signal
      });
      expect(successful.ok).toBe(true);
      expect({ ...counters, artifacts: (await readdir(harness.dataDir)).includes("artifacts"), sessions: (await readdir(harness.dataDir)).includes("sessions"), spawned, opened }).toEqual({
        artifacts: false, model: 0, mimo: 0, minimax: 0, opened: 0, research: 0, sessions: false, spawned: 0
      });
    } finally {
      await Promise.all(sentinels.map(({ server }) => closeHttp(server)));
    }
  });

  it("Case H — preflight failure is zero-spawn", async () => {
    const harness = await createHarness();
    const output: string[] = [];
    let spawned = 0;
    let opened = 0;
    const result = await runDev({
      configPath: harness.configPath,
      cwd: repoRoot,
      dataDir: harness.dataDir,
      env: { ...harness.env, GATEWAY_TOKEN: undefined },
      noOpen: false,
      port: 18787,
      probes: {
        browserOpen: async () => { opened += 1; },
        doctor: deterministicProbes(),
        output: (line) => output.push(line),
        spawnGateway: () => { spawned += 1; throw new Error("must not spawn"); }
      }
    });
    expect(result).toMatchObject({ browserOpened: false, gateway: "none", ok: false });
    expect({ opened, spawned }).toEqual({ opened: 0, spawned: 0 });
    expect(output.join("\n")).toContain("Remediation:");
    expect((await readdir(harness.dataDir)).filter((name) => name.startsWith(".fairy"))).toEqual([]);
  });

  it("Case I — owned gateway start", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const harness = await createHarness({ port });
    const output: string[] = [];
    const browserUrls: string[] = [];
    const controller = new AbortController();
    let webBody = "";
    const result = await runDev({
      configPath: harness.configPath,
      cwd: repoRoot,
      dataDir: harness.dataDir,
      env: harness.env,
      noOpen: false,
      port,
      probes: {
        browserOpen: async (url) => {
          browserUrls.push(url);
          const response = await fetch(url);
          webBody = await response.text();
          controller.abort();
        },
        doctor: runtimeOnlyProbes(),
        output: (line) => output.push(line)
      },
      signal: controller.signal
    });
    expect(result).toMatchObject({ browserOpened: true, gateway: "started", ok: true, portReleased: true });
    expect(browserUrls).toEqual([`http://127.0.0.1:${port}/web/`]);
    expect(webBody).toMatch(/OpenFairy|Fairy/i);
    expect(output).toContain("Gateway: STARTED");
    const rendered = output.join("\n");
    for (const secret of Object.values(secretValues)) {
      expect(rendered).not.toContain(secret);
    }
    expect(rendered).not.toMatch(/[?&]token=/i);
    expect(await probeGatewayPort(port)).toBe("available");
  });

  it("Case J — reused and occupied gateway modes", async () => {
    const healthy = await listenHttp((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ gateway_version: "0.1.0-m1", protocol_version: 1, status: "ok", uptime_s: 1 }));
        return;
      }
      response.writeHead(200);
      response.end("Fairy Web");
    });
    const harness = await createHarness({ port: healthy.port });
    let spawned = 0;
    const controller = new AbortController();
    try {
      const reused = await runDev({
        configPath: harness.configPath,
        cwd: repoRoot,
        dataDir: harness.dataDir,
        env: harness.env,
        noOpen: false,
        port: healthy.port,
        probes: {
          browserOpen: async () => controller.abort(),
          doctor: runtimeOnlyProbes(),
          output: () => undefined,
          spawnGateway: () => { spawned += 1; throw new Error("must reuse"); }
        },
        signal: controller.signal
      });
      expect(reused).toMatchObject({ gateway: "reused", ok: true, portReleased: false });
      expect(spawned).toBe(0);
      expect((await fetch(`http://127.0.0.1:${healthy.port}/health`)).status).toBe(200);
    } finally {
      await closeHttp(healthy.server);
    }

    const occupied = await listenHttp((_request, response) => { response.writeHead(200); response.end("not Fairy"); });
    try {
      let opened = 0;
      const denied = await runDev({
        configPath: harness.configPath,
        cwd: repoRoot,
        dataDir: harness.dataDir,
        env: harness.env,
        noOpen: false,
        port: occupied.port,
        probes: {
          browserOpen: async () => { opened += 1; },
          doctor: runtimeOnlyProbes(),
          output: () => undefined,
          spawnGateway: () => { spawned += 1; throw new Error("must not spawn"); }
        }
      });
      expect(denied.ok).toBe(false);
      expect({ opened, spawned }).toEqual({ opened: 0, spawned: 0 });
    } finally {
      await closeHttp(occupied.server);
    }
  });

  it("Case K — shutdown and browser failure", { timeout: 30_000 }, async () => {
    const port = await freePort();
    const harness = await createHarness({ port });
    const output: string[] = [];
    const controller = new AbortController();
    let healthyDuringBrowserFailure = false;
    const result = await runDev({
      configPath: harness.configPath,
      cwd: repoRoot,
      dataDir: harness.dataDir,
      env: harness.env,
      noOpen: false,
      port,
      probes: {
        browserOpen: async () => {
          healthyDuringBrowserFailure = await probeGatewayPort(port) === "fairy-running";
          throw new Error("synthetic browser failure");
        },
        doctor: runtimeOnlyProbes(),
        output: (line) => {
          output.push(line);
          if (line.startsWith("Browser: WARN")) {
            controller.abort();
          }
        }
      },
      signal: controller.signal
    });
    expect(healthyDuringBrowserFailure).toBe(true);
    expect(result).toMatchObject({ browserOpened: false, gateway: "started", ok: true, portReleased: true });
    expect(output.some((line) => line.startsWith("Browser: WARN"))).toBe(true);
    expect(await probeGatewayPort(port)).toBe("available");
    const launcher = await readFile(join(repoRoot, "scripts/start-gateway.mjs"), "utf8");
    const devSource = await readFile(join(repoRoot, "apps/cli/src/dev.ts"), "utf8");
    const binSource = await readFile(join(repoRoot, "apps/cli/src/bin/fairy.ts"), "utf8");
    expect(launcher).toContain("fairy.launcher.shutdown");
    expect(devSource).toMatch(/taskkill\.exe[\s\S]*\/t[\s\S]*\/f/);
    expect(binSource).toContain('process.once("SIGINT", stop)');
    expect(binSource).toContain('process.once("SIGTERM", stop)');
  });

  it("Case L — repository/demo policy", async () => {
    const serverPath = join(repoRoot, "apps/gateway/src/server.ts");
    const server = await readFile(serverPath);
    expect(createHash("sha256").update(server).digest("hex")).toBe("038e7cb70578355e02366e0446513691e86f7529e3897935f6f16b21839931b3");
    expect(server.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).length).toBe(1_628);

    const examplePath = join(repoRoot, "examples/fairy.v0.9.yaml");
    const example = loadConfig({ configPath: examplePath, cwd: repoRoot }).config;
    expect(parseModelGatewayConfig(example).roles.main?.model).toBe("main-openai-compatible");
    expect(parseSpeechProviderConfig(example)).toMatchObject({
      asrCandidates: [{ endpointProfile: "mimo-paygo-cn" }],
      ttsCandidates: [{ endpointProfile: "cn-primary" }]
    });
    const exampleSource = await readFile(examplePath, "utf8");
    expect(exampleSource).not.toMatch(/\b(sk-|tp-)[A-Za-z0-9]/);
    expect(exampleSource).not.toMatch(/endpoint:\s*https?:/);

    const readme = await readFile(join(repoRoot, "README.md"), "utf8");
    for (const section of ["Project positioning", "Current status: OpenFairy v0.9 Developer Preview", "What is implemented", "What is explicitly deferred", "Architecture overview", "Prerequisites", "Quick start", "Configuration and secret references", "Doctor", "One-command dev start", "Web voice walkthrough", "Three demo scenarios", "Security / threat-model summary", "Replay and evidence", "Troubleshooting", "Technology stack", "Interview / portfolio summary", "Document map"]) {
      expect(readme).toContain(`## ${section}`);
    }
    expect(readme).toContain("voice session ledger is **3/20**");
    expect(readme).toContain("R0.9-03+04 bounded workflows and Morning Briefing are deferred");
    expect(readme).toContain("Stop** only stops playback in the browser; it is not barge-in");
    expect(readme).toContain("not a production-ready desktop product");
    expect(readme).toContain("does not claim ASR accuracy benchmarking");
    expect(readme).not.toMatch(/\b20\/20\b|ASR accuracy benchmark:\s*PASS/i);

    for (const path of [
      "docs/demo/v0.9-demo-script.md",
      "docs/demo/scenarios/01-normal-voice.md",
      "docs/demo/scenarios/02-secret-route-denial.md",
      "docs/demo/scenarios/03-memory-research-replay.md",
      "docs/demo/interview-project-summary.md",
      "docs/demo/assets/README.md"
    ]) {
      expect((await readFile(join(repoRoot, path), "utf8")).length).toBeGreaterThan(100);
    }
    const demo = await readFile(join(repoRoot, "docs/demo/v0.9-demo-script.md"), "utf8");
    expect(demo).toContain("OpenFairy v0.9 Developer Preview");
    expect(demo).toContain("**3/20**");
    expect(demo).toContain("synthetic secret fixture");
    expect(demo).toContain("not an ASR accuracy benchmark");
    const assets = await readFile(join(repoRoot, "docs/demo/assets/README.md"), "utf8");
    for (const name of ["01-doctor-pass.png", "02-web-voice-roundtrip.png", "03-replay-governance.png"]) {
      expect(assets).toContain(`docs/demo/assets/${name}`);
      expect(readme).toContain(`docs/demo/assets/${name}`);
    }
    const newRuntimeSources = `${await readFile(join(repoRoot, "apps/cli/src/doctor.ts"), "utf8")}\n${await readFile(join(repoRoot, "apps/cli/src/dev.ts"), "utf8")}`;
    expect(newRuntimeSources).not.toMatch(/ExecutionContext|RunExecutor|Morning Briefing|Access-Control-Allow-Origin|createWebSocketServer/);
    const cliPackage = JSON.parse(await readFile(join(repoRoot, "apps/cli/package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.entries(cliPackage.dependencies).filter(([name]) => name === "@fairy/gateway" || name === "@fairy/model-gateway").every(([name, version]) => name.startsWith("@fairy/") && version === "workspace:*")).toBe(true);

    const git = spawnSync("git", ["diff", "--name-only", "--", "packages/protocol", "workers/speech", "apps/gateway/src/server.ts"], { cwd: repoRoot, encoding: "utf8", shell: false });
    expect(git.status).toBe(0);
    expect(git.stdout.trim()).toBe("");
  });
});
