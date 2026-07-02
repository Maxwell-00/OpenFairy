import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { validateEvent } from "@fairy/protocol";
import {
  acceptIncomingEvent,
  assertM0TurnShape,
  assertMonotonicUlidsPerSession,
  assertSchemaValidStream,
  MockFairyClient
} from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

type GatewayProcess = ChildProcessByStdio<null, Readable, Readable>;

const waitForGateway = (process: GatewayProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`gateway did not start in time\n${output}`));
    }, 20000);

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

describe("minimal gateway e2e", () => {
  it("serves health/meta, echoes a turn, and writes valid JSONL", async () => {
    const temp = await mkdtemp(join(tmpdir(), "fairy-gateway-e2e-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const token = "test-token";

    writeFileSync(
      configPath,
      [
        "gateway:",
        "  port: 0",
        `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
        "  auth:",
        `    token: ${JSON.stringify(token)}`
      ].join("\n"),
      "utf8"
    );

    const gateway = spawn(process.execPath, ["scripts/start-gateway.mjs", "--config", configPath], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      const port = await waitForGateway(gateway);
      const base = `http://127.0.0.1:${port}`;

      await expect(fetch(`${base}/health`).then((response) => response.json())).resolves.toMatchObject({
        protocol_version: 1,
        status: "ok"
      });
      await expect(fetch(`${base}/meta`).then((response) => response.json())).resolves.toMatchObject({
        capabilities: { echo_responder: true, kernel: false },
        protocol_version: 1
      });
      await expect(
        new Promise<number>((resolve, reject) => {
          const unauthorized = new WebSocket(`ws://127.0.0.1:${port}`);
          unauthorized.once("close", (code) => resolve(code));
          unauthorized.once("error", reject);
        })
      ).resolves.toBe(4401);

      const client = await MockFairyClient.connect({ token, url: `ws://127.0.0.1:${port}` });
      const created = await client.createSession();
      const turnEvents = await client.sendTurnInput(created.sid, {
        channel: "mock",
        content: [{ kind: "text", text: "ping" }]
      });
      client.close();

      expect(created.type).toBe("session.created");
      expect(turnEvents.map((event) => event.type)).toEqual([
        "turn.input",
        "turn.delta",
        "turn.delta",
        "turn.final"
      ]);
      expect(turnEvents.at(-1)?.payload).toMatchObject({
        content: [{ kind: "text", text: "Echo: ping" }],
        finish_reason: "stop"
      });

      assertSchemaValidStream(client.events());
      assertMonotonicUlidsPerSession(client.events());
      assertM0TurnShape(turnEvents);

      const logPath = join(dataDir, "sessions", created.sid, "log.jsonl");
      const logged = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);
      expect(logged).toHaveLength(5);
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

      expect(readFileSync(logPath, "utf8")).toContain("session.created");
    } finally {
      await stopGateway(gateway);
    }
  });
});
