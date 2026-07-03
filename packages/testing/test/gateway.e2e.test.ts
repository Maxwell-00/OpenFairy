import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { validateEvent, type EventEnvelope } from "@fairy/protocol";
import {
  acceptIncomingEvent,
  assertM1TurnCompletes,
  assertMonotonicUlidsPerSession,
  assertSchemaValidStream,
  MockFairyClient,
  MockOpenAIChatServer
} from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

type GatewayProcess = ChildProcessByStdio<null, Readable, Readable>;

let provider: MockOpenAIChatServer | undefined;

const waitForGateway = (process: GatewayProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`gateway did not start in time\n${output}`));
    }, 30000);

    process.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/gateway\.started (\{.*\})/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve((JSON.parse(match[1]) as { port: number }).port);
      }
    });

    process.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`gateway exited before startup with code ${code}\n${output}`));
    });
  });

const stopGateway = async (process: GatewayProcess): Promise<void> => {
  if (process.exitCode !== null) {
    return;
  }

  process.kill("SIGTERM");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
};

const killGateway = async (process: GatewayProcess): Promise<void> => {
  if (process.exitCode !== null) {
    return;
  }

  process.kill("SIGKILL");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
};

const hasDocker = (): boolean => spawnSync("docker", ["--version"], { timeout: 2000, windowsHide: true }).status === 0;

const writeConfig = (path: string, dataDir: string, token: string, baseUrl: string, options: {
  readonly context?: readonly string[];
  readonly model?: readonly string[];
  readonly permissions?: readonly string[];
  readonly workspaceRoot?: string;
} = {}): void => {
  writeFileSync(
    path,
    [
      "models:",
      "  - id: mock-main",
      "    transport: openai-chat",
      `    base_url: ${JSON.stringify(baseUrl)}`,
      "    model: mock-model",
      ...(options.model ?? []),
      "    data_clearance:",
      "      max_sensitivity: internal",
      "      residency: [global-ok]",
      "roles:",
      "  main:",
      "    model: mock-main",
      "gateway:",
      "  port: 0",
      "  watchdog_s: 2",
      `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
      "  auth:",
      `    token: ${JSON.stringify(token)}`,
      "kernel:",
      "  system_prompt: M1 e2e test prompt",
      "  max_tool_iterations: 16",
      ...(options.context
        ? [
            "context:",
            ...options.context
          ]
        : []),
      ...(options.workspaceRoot
        ? ["workspace:", `  root: ${JSON.stringify(options.workspaceRoot.replace(/\\/g, "/"))}`]
        : []),
      ...(options.permissions
        ? [
            "permissions:",
            "  ask_timeout_s: 3",
            "  rules:",
            ...options.permissions
          ]
        : [])
    ].join("\n"),
    "utf8"
  );
};

const startGateway = (configPath: string): GatewayProcess =>
  // Spawn the gateway entry DIRECTLY (not via scripts/start-gateway.mjs): the crash test
  // must SIGKILL the gateway process itself — killing the launcher orphans the inner
  // child on POSIX, which then finishes the in-flight turn and defeats the test.
  spawn(process.execPath, ["--import", "tsx", "apps/gateway/src/bin/gateway.ts", "--config", configPath], {
    cwd: repoRoot,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });

const readLoggedEvents = async (dataDir: string, sid: string): Promise<EventEnvelope[]> =>
  (await readFile(join(dataDir, "sessions", sid, "log.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as EventEnvelope);

afterEach(async () => {
  await provider?.stop();
  provider = undefined;
});

describe("gateway M1 e2e", () => {
  it("serves health/meta/sessions, streams a model-backed turn, and writes valid JSONL", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["plan"],
      text: ["Hello", " Chidi"],
      usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-e2e-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "test-token";
    writeConfig(configPath, dataDir, token, provider.url);

    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const base = `http://127.0.0.1:${port}`;

      await expect(fetch(`${base}/health`).then((response) => response.json())).resolves.toMatchObject({
        protocol_version: 1,
        status: "ok"
      });
      await expect(fetch(`${base}/meta`).then((response) => response.json())).resolves.toMatchObject({
        capabilities: { kernel: true, model_calls: true, session_resume: true, turn_cancel: true },
        protocol_version: 1
      });
      await expect(fetch(`${base}/sessions?token=${token}`).then((response) => response.json())).resolves.toMatchObject({
        sessions: []
      });
      await expect(
        new Promise<number>((resolve, reject) => {
          const unauthorized = new WebSocket(`ws://127.0.0.1:${port}`);
          unauthorized.once("close", (code) => resolve(code));
          unauthorized.once("error", reject);
        })
      ).resolves.toBe(4401);

      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("M1 e2e");
      const turnEvents = await client.sendTurnInput(created.sid, {
        channel: "mock",
        content: [{ kind: "text", text: "ping" }]
      });
      client.close();

      expect(turnEvents.map((event) => event.type)).toEqual([
        "turn.input",
        "context.manifest",
        "reasoning.delta",
        "turn.delta",
        "turn.delta",
        "turn.final"
      ]);
      expect(turnEvents.at(-1)?.payload).toMatchObject({
        content: [{ kind: "text", text: "Hello Chidi" }],
        finish_reason: "stop",
        usage: { estimated: false, input_tokens: 3, output_tokens: 2 }
      });

      assertSchemaValidStream(client.events());
      assertMonotonicUlidsPerSession(client.events());
      assertM1TurnCompletes(turnEvents);

      const logged = await readLoggedEvents(dataDir, created.sid);
      expect(logged).toHaveLength(7);
      for (const event of logged) {
        expect(validateEvent(event)).toMatchObject({ ok: true });
      }

      expect(acceptIncomingEvent({
        actor: "agent",
        id: "evt_01J00000000000000000000000",
        labels: { sensitivity: "public", residency: "global-ok" },
        payload: { vendor_payload: true },
        provenance: "agent",
        sid: created.sid,
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1,
        type: "x.vendor.event",
        v: 1
      })).toMatchObject({ ok: true, known: false });

      expect(readFileSync(join(dataDir, "sessions", created.sid, "log.jsonl"), "utf8")).toContain("turn.final");
    } finally {
      await stopGateway(gateway);
    }
  });

  it("appends a synthetic interruption after restart and continues with the next turn number", async () => {
    provider = await MockOpenAIChatServer.start({
      delayMs: 80,
      text: ["first", " second", " third"]
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-resume-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "resume-token";
    writeConfig(configPath, dataDir, token, provider.url);

    let gateway = startGateway(configPath);
    const port = await waitForGateway(gateway);
    const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
    const created = await client.createSession("restart");
    client.sendTurnInputNoWait(created.sid, { content: [{ kind: "text", text: "slow" }] });
    await client.waitFor((event) => event.sid === created.sid && event.type === "turn.delta", 10000);
    await killGateway(gateway);

    provider.setDefaultScript({ text: ["after restart"], usage: { completion_tokens: 2, prompt_tokens: 2, total_tokens: 4 } });
    gateway = startGateway(configPath);

    try {
      const restartedPort = await waitForGateway(gateway);
      const resumed = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${restartedPort}` });
      await resumed.attachSession(created.sid);
      await resumed.waitFor(
        (event) =>
          event.sid === created.sid &&
          event.type === "turn.interrupted" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "gateway_restart",
        10000
      );

      const turnEvents = await resumed.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "continue" }]
      });
      resumed.close();

      expect(turnEvents.find((event) => event.type === "turn.input")?.turn).toBe(2);
      expect(turnEvents.find((event) => event.type === "turn.final")?.turn).toBe(2);

      const logged = await readLoggedEvents(dataDir, created.sid);
      expect(logged.map((event) => event.type)).toContain("turn.interrupted");
      for (const event of logged) {
        expect(validateEvent(event)).toMatchObject({ ok: true });
      }
      assertMonotonicUlidsPerSession(logged);
    } finally {
      await stopGateway(gateway);
    }
  });

  it("cancels an in-flight turn and emits turn.interrupted", async () => {
    provider = await MockOpenAIChatServer.start({
      delayMs: 60,
      text: ["one", " two", " three"]
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-cancel-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "cancel-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("cancel");
      const before = client.sendTurnInputNoWait(created.sid, {
        content: [{ kind: "text", text: "cancel this" }]
      });
      await client.waitFor((event) => event.sid === created.sid && event.type === "turn.delta", 10000);
      await client.cancelTurn(created.sid);
      await client.waitFor(
        (event) =>
          event.sid === created.sid &&
          event.type === "turn.interrupted" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "user_cancelled",
        10000
      );
      const turnEvents = client.events().slice(before);
      client.close();

      expect(turnEvents.map((event) => event.type)).toContain("turn.interrupted");
      expect(turnEvents.some((event) => event.type === "turn.final")).toBe(false);
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  });

  it("runs an auto-allowed fs.read tool call, spills oversized results, and completes", async () => {
    provider = await MockOpenAIChatServer.start();
    provider.enqueueScript({
      toolCalls: [{ id: "call_read", name: "fs.read", args: { path: "big.txt" } }]
    });
    provider.enqueueScript({
      text: ["I read the file and saw MAGIC_CONTENT."],
      usage: { completion_tokens: 8, prompt_tokens: 10, total_tokens: 18 }
    });

    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-tools-"));
    const dataDir = join(temp, "data");
    const workspaceRoot = join(temp, "workspace");
    const configPath = join(temp, "fairy.yaml");
    const token = "tools-token";
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "big.txt"), `${"x".repeat(40 * 1024)}\nMAGIC_CONTENT\n`, "utf8");
    writeConfig(configPath, dataDir, token, provider.url, { workspaceRoot });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("tools");
      const turnEvents = await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "read big.txt" }]
      });
      client.close();

      expect(turnEvents.map((event) => event.type)).toEqual([
        "turn.input",
        "context.manifest",
        "tool.call",
        "artifact.created",
        "tool.result",
        "context.manifest",
        "turn.delta",
        "turn.final"
      ]);
      expect(turnEvents.find((event) => event.type === "tool.result")?.payload).toMatchObject({
        artifacts: [expect.objectContaining({ mime: "text/plain" })],
        call_id: "call_read",
        result: expect.objectContaining({ truncated: true }),
        status: "ok"
      });
      expect(turnEvents.at(-1)?.payload).toMatchObject({
        content: [{ kind: "text", text: "I read the file and saw MAGIC_CONTENT." }]
      });
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  });

  it("continues gracefully when policy denies a tool call", async () => {
    provider = await MockOpenAIChatServer.start();
    provider.enqueueScript({
      toolCalls: [{ id: "call_denied", name: "fs.read", args: { path: "secret.txt" } }]
    });
    provider.enqueueScript({
      text: ["I cannot read that file because policy denied the tool call."]
    });

    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-deny-"));
    const dataDir = join(temp, "data");
    const workspaceRoot = join(temp, "workspace");
    const configPath = join(temp, "fairy.yaml");
    const token = "deny-token";
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "secret.txt"), "secret", "utf8");
    writeConfig(configPath, dataDir, token, provider.url, {
      permissions: [
        "    - tool: \"fs.read\"",
        "      decision: deny",
        "    - tool: \"*\"",
        "      decision: ask"
      ],
      workspaceRoot
    });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("deny");
      const turnEvents = await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "read secret" }]
      });
      client.close();

      expect(turnEvents.find((event) => event.type === "tool.result")?.payload).toMatchObject({
        denied_by_policy: true,
        error: { class: "PolicyError" },
        status: "error"
      });
      expect(turnEvents.at(-1)?.type).toBe("turn.final");
      assertSchemaValidStream(client.events());
    } finally {
      await stopGateway(gateway);
    }
  });

  it("returns audit rows through /audit?limit=N after an auto-allowed tool turn", async () => {
    provider = await MockOpenAIChatServer.start();
    provider.enqueueScript({
      toolCalls: [{ id: "call_audit_read", name: "fs.read", args: { path: "audit.txt" } }]
    });
    provider.enqueueScript({ text: ["audit complete"] });

    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-audit-"));
    const dataDir = join(temp, "data");
    const workspaceRoot = join(temp, "workspace");
    const configPath = join(temp, "fairy.yaml");
    const token = "audit-token";
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "audit.txt"), "audit target", "utf8");
    writeConfig(configPath, dataDir, token, provider.url, { workspaceRoot });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("audit");
      await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "read audit.txt" }]
      });
      client.close();

      const audit = await fetch(`http://127.0.0.1:${port}/audit?limit=5&token=${token}`).then((response) => response.json()) as {
        entries: { op: string; tool: string | null; decision: string | null }[];
      };
      expect(audit.entries.length).toBeGreaterThan(0);
      expect(audit.entries.length).toBeLessThanOrEqual(5);
      expect(audit.entries.some((entry) => entry.op === "permission.decide" && entry.tool === "fs.read")).toBe(true);
      expect(audit.entries.some((entry) => entry.op === "tool.execute" && entry.tool === "fs.read")).toBe(true);
    } finally {
      await stopGateway(gateway);
    }
  });

  it("drives context reduction manifests through L1-L3 and renders fairy replay manifests offline", async () => {
    provider = await MockOpenAIChatServer.start();
    provider.enqueueScript({
      toolCalls: [{ id: "call_long_read", name: "fs.read", args: { path: "big.txt" } }]
    });
    provider.enqueueScript({ text: ["turn one ", "A ".repeat(1400)] });
    provider.enqueueScript({ text: ["turn two ", "B ".repeat(1400)] });
    provider.enqueueScript({ text: ["turn three complete"] });

    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-context-"));
    const dataDir = join(temp, "data");
    const workspaceRoot = join(temp, "workspace");
    const configPath = join(temp, "fairy.yaml");
    const token = "context-token";
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "big.txt"), `${"x".repeat(40 * 1024)}\nCONTEXT_MAGIC\n`, "utf8");
    writeConfig(configPath, dataDir, token, provider.url, {
      context: [
        "  reduce_at: 0.5",
        "  output_reserve: 120",
        "  min_recent_turns: 1"
      ],
      model: [
        "    context_window: 700",
        "    max_output: 120"
      ],
      workspaceRoot
    });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("context");
      await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "read the big file and remember alpha" }]
      });
      await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "second pinned user beta" }]
      });
      await client.sendTurnInput(created.sid, {
        content: [{ kind: "text", text: "third user gamma" }]
      });
      client.close();

      const logged = await readLoggedEvents(dataDir, created.sid);
      const manifests = logged.filter((event) => event.type === "context.manifest");
      const stages = manifests.flatMap((event) =>
        typeof event.payload === "object" && event.payload !== null && Array.isArray((event.payload as { reduction_stages_applied?: unknown }).reduction_stages_applied)
          ? (event.payload as { reduction_stages_applied: string[] }).reduction_stages_applied
          : []
      );
      expect(stages).toContain("L1");
      expect(stages).toContain("L2");
      expect(stages).toContain("L3");

      const lastRequest = provider.requestBodies.at(-1) as { messages?: { content?: string }[] } | undefined;
      const prompt = (lastRequest?.messages ?? []).map((message) => message.content ?? "").join("\n");
      expect(prompt).toContain("read the big file and remember alpha");
      expect(prompt).toContain("[turn 1 elided:");
      expect(prompt).not.toContain("context.manifest");

      const replay = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/bin/fairy.ts",
        "replay",
        created.sid,
        "--manifests",
        "--data-dir",
        dataDir
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        timeout: 30000,
        windowsHide: true
      });
      expect(replay.status).toBe(0);
      expect(replay.stdout).toContain("turn model projected/budget/window stages");
      expect(replay.stdout).toContain("L1");
      expect(replay.stdout).toContain("L2");
      expect(replay.stdout).toContain("L3");
    } finally {
      await stopGateway(gateway);
    }
  });

  it("emits session.resumed as the replay sentinel on attach", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["hello"] });
    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-sentinel-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "sentinel-token";
    writeConfig(configPath, dataDir, token, provider.url);
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const first = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await first.createSession("sentinel");
      await first.sendTurnInput(created.sid, { content: [{ kind: "text", text: "hi" }] });
      first.close();

      const second = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const before = second.events().length;
      await second.attachSession(created.sid);
      const replayed = second.events().slice(before);
      second.close();

      expect(replayed.at(-1)?.type).toBe("session.resumed");
      expect(replayed.map((event) => event.type)).toContain("turn.final");
    } finally {
      await stopGateway(gateway);
    }
  });

  it.skipIf(!hasDocker())("asks once for shell.run, stores a session grant, and audits execution", async () => {
    provider = await MockOpenAIChatServer.start();
    provider.enqueueScript({
      toolCalls: [{ id: "call_shell_1", name: "shell.run", args: { command: "printf first" } }]
    });
    provider.enqueueScript({
      toolCalls: [{ id: "call_shell_2", name: "shell.run", args: { command: "printf second" } }]
    });
    provider.enqueueScript({ text: ["shell complete"] });

    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-shell-"));
    const dataDir = join(temp, "data");
    const workspaceRoot = join(temp, "workspace");
    const configPath = join(temp, "fairy.yaml");
    const token = "shell-token";
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "README.md"), "workspace", "utf8");
    writeConfig(configPath, dataDir, token, provider.url, { workspaceRoot });
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession("shell");
      client.sendTurnInputNoWait(created.sid, { content: [{ kind: "text", text: "run shell twice" }] });
      const approval = await client.waitFor((event) => event.type === "approval.request", 30000);
      client.resolveApproval(created.sid, approval.id, "session");
      await client.waitFor((event) => event.type === "turn.final", 120000);
      const events = client.events();
      client.close();

      expect(events.filter((event) => event.type === "approval.request")).toHaveLength(1);
      expect(events.filter((event) => event.type === "tool.call")).toHaveLength(2);
      expect(events.filter((event) => event.type === "tool.result")).toHaveLength(2);

      const audit = await fetch(`http://127.0.0.1:${port}/audit?token=${token}&limit=20`).then((response) => response.json()) as {
        entries: { op: string; tool: string | null; decision: string | null }[];
      };
      expect(audit.entries.some((entry) => entry.op === "approval.resolved" && entry.decision === "session")).toBe(true);
      expect(audit.entries.filter((entry) => entry.op === "tool.execute" && entry.tool === "shell.run")).toHaveLength(2);
    } finally {
      await stopGateway(gateway);
    }
  });
});
