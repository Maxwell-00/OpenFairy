import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { MockOpenAIChatServer } from "@fairy/testing";
import { runVoice } from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI_VOICE_E2E_TIMEOUT_MS = 60_000;

type GatewayProcess = ChildProcessByStdio<null, Readable, Readable>;

let provider: MockOpenAIChatServer | undefined;

const waitForGateway = (process: GatewayProcess): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`gateway did not start in time\n${output}`));
    }, 30000);

    process.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/gateway\.started (\{.*\})/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolvePromise((JSON.parse(match[1]) as { port: number }).port);
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

const startGateway = (configPath: string): GatewayProcess =>
  spawn(process.execPath, ["--import", "tsx", "apps/gateway/src/bin/gateway.ts", "--config", configPath], {
    cwd: repoRoot,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });

const stopGateway = async (process: GatewayProcess): Promise<void> => {
  if (process.exitCode !== null) {
    return;
  }
  process.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => process.once("exit", () => resolvePromise()));
};

afterEach(async () => {
  await provider?.stop();
  provider = undefined;
});

describe("fairy voice CLI", () => {
  it("runs loopback through the gateway and prints parseable JSON", async () => {
    provider = await MockOpenAIChatServer.start({
      text: ["voice cli answer"],
      usage: { completion_tokens: 3, prompt_tokens: 4, total_tokens: 7 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const scriptPath = join(temp, "script.json");
    const token = "voice-cli-token";
    await writeFile(configPath, [
      "models:",
      "  - id: mock-main",
      "    transport: openai-chat",
      `    base_url: ${JSON.stringify(provider.url)}`,
      "    model: mock-model",
      "    data_clearance:",
      "      max_sensitivity: personal",
      "      residency: [region-restricted]",
      "      regions: [cn]",
      "roles:",
      "  main:",
      "    model: mock-main",
      "gateway:",
      "  port: 0",
      `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
      "  auth:",
      `    token: ${JSON.stringify(token)}`,
      "affect:",
      "  enabled: false",
      "persona:",
      "  enabled: false"
    ].join("\n"), "utf8");
    await writeFile(scriptPath, JSON.stringify({
      partials: ["voice", "voice cli"],
      text: "voice cli request",
      utterance_id: "utt_cli"
    }), "utf8");
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const outputLines: string[] = [];
      const originalLog = console.log;
      console.log = (value?: unknown): void => {
        outputLines.push(String(value ?? ""));
      };
      try {
        await runVoice([
          "loopback",
          "--gateway",
          `ws://127.0.0.1:${port}`,
          "--token",
          token,
          "--script",
          scriptPath,
          "--json"
        ]);
      } finally {
        console.log = originalLog;
      }
      const output = outputLines.join("\n").trim();
      const parsed = JSON.parse(output) as {
        assistant_final_text: string;
        event_counts: Record<string, number>;
        log_path?: string;
        replay_command?: string;
        sid: string;
        transcript_text: string;
        tts_chunk_count: number;
      };

      expect(parsed.sid).toMatch(/^ses_/);
      expect(parsed.transcript_text).toBe("voice cli request");
      expect(parsed.assistant_final_text).toBe("voice cli answer");
      expect(parsed.tts_chunk_count).toBe(1);
      expect(parsed.event_counts).toMatchObject({
        "speech.asr.final": 1,
        "speech.asr.partial": 2,
        "speech.tts.chunk": 1,
        "turn.input": 1,
        "turn.final": 1
      });
      expect(parsed.log_path ?? parsed.replay_command).toBeDefined();
      const rawLog = await readFile(parsed.log_path ?? join(dataDir, "sessions", parsed.sid, "log.jsonl"), "utf8");
      expect(rawLog).toContain("\"type\":\"speech.asr.final\"");
      expect(rawLog).toContain("\"channel\":\"voice\"");
      expect(rawLog).not.toContain("data:audio/");
    } finally {
      await stopGateway(gateway);
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);

  it("runs duplex conformance through the gateway and prints parseable JSON", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden duplex plan"],
      text: ["voice duplex answer"],
      usage: { completion_tokens: 3, prompt_tokens: 4, total_tokens: 7 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-duplex-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const scriptPath = join(temp, "script.json");
    const token = "voice-duplex-cli-token";
    await writeFile(configPath, [
      "models:",
      "  - id: mock-main",
      "    transport: openai-chat",
      `    base_url: ${JSON.stringify(provider.url)}`,
      "    model: mock-model",
      "    data_clearance:",
      "      max_sensitivity: personal",
      "      residency: [region-restricted]",
      "      regions: [cn]",
      "roles:",
      "  main:",
      "    model: mock-main",
      "gateway:",
      "  port: 0",
      `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
      "  auth:",
      `    token: ${JSON.stringify(token)}`,
      "affect:",
      "  enabled: false",
      "persona:",
      "  enabled: false"
    ].join("\n"), "utf8");
    await writeFile(scriptPath, JSON.stringify({
      audio_frame_bytes: [8, 8],
      frame_labels: { residency: "global-ok", sensitivity: "public" },
      partials: ["voice", "voice duplex"],
      text: "voice duplex request",
      utterance_id: "utt_cli_duplex"
    }), "utf8");
    const gateway = startGateway(configPath);

    try {
      const port = await waitForGateway(gateway);
      const outputLines: string[] = [];
      const originalLog = console.log;
      console.log = (value?: unknown): void => {
        outputLines.push(String(value ?? ""));
      };
      try {
        await runVoice([
          "duplex",
          "--gateway",
          `ws://127.0.0.1:${port}`,
          "--token",
          token,
          "--script",
          scriptPath,
          "--json"
        ]);
      } finally {
        console.log = originalLog;
      }
      const parsed = JSON.parse(outputLines.join("\n").trim()) as {
        assistant_final_text: string;
        event_counts: Record<string, number>;
        frame_counts: Record<string, number>;
        log_path?: string;
        model_request_count: number;
        sid: string;
        transcript_text: string;
        tts_chunk_count: number;
      };

      expect(parsed.sid).toMatch(/^ses_/);
      expect(outputLines.join("\n")).not.toContain("hidden duplex plan");
      expect(parsed.transcript_text).toBe("voice duplex request");
      expect(parsed.assistant_final_text).toBe("voice duplex answer");
      expect(parsed.model_request_count).toBe(1);
      expect(parsed.frame_counts).toMatchObject({
        "control.asr.final": 1,
        "control.asr.partial": 2,
        "control.tts.request": 1,
        audio: 3
      });
      expect(parsed.event_counts).toMatchObject({
        "speech.asr.final": 1,
        "speech.asr.partial": 2,
        "speech.tts.chunk": 1,
        "turn.input": 1,
        "turn.final": 1
      });
      const rawLog = await readFile(parsed.log_path ?? join(dataDir, "sessions", parsed.sid, "log.jsonl"), "utf8");
      expect(rawLog).toContain("\"type\":\"speech.asr.final\"");
      expect(rawLog).toContain("\"channel\":\"voice\"");
      expect(rawLog).not.toContain("voice.frame.");
      expect(rawLog).not.toContain("data:audio/");
    } finally {
      await stopGateway(gateway);
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);
});
