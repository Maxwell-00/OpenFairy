import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
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

const writeConfig = (path: string, dataDir: string, token: string, baseUrl: string): void => {
  writeFileSync(
    path,
    [
      "models:",
      "  - id: mock-main",
      "    transport: openai-chat",
      `    base_url: ${JSON.stringify(baseUrl)}`,
      "    model: mock-model",
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
      "  system_prompt: M1 e2e test prompt"
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
      expect(logged).toHaveLength(6);
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
});
