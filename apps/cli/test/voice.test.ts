import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactRegistry } from "@fairy/artifacts";
import { MockOpenAIChatServer } from "@fairy/testing";
import { loadGatewayConfig } from "../../gateway/src/config.js";
import { MinimalGateway } from "../../gateway/src/server.js";
import { parseVoiceOptions, runVoice } from "../src/index.js";

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

const startMiniMaxFake = async (credential: string): Promise<{
  readonly bodies: Record<string, unknown>[];
  readonly port: number;
  readonly requests: () => number;
  readonly stop: () => Promise<void>;
}> => {
  const audio = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xfb]);
  let requestCount = 0;
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestCount += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      bodies.push(body);
      const statusCode = request.headers.authorization === `Bearer ${credential}` ? 0 : 1004;
      const envelope = statusCode === 0
        ? {
            base_resp: { status_code: 0 },
            data: { audio: audio.toString("hex"), status: 2 },
            extra_info: { audio_channel: 1, audio_format: "mp3", audio_sample_rate: 32000, audio_size: audio.byteLength, bitrate: 128000 }
          }
        : { base_resp: { status_code: statusCode }, data: null };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(envelope));
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("CLI fake MiniMax did not bind");
  }
  return {
    bodies,
    port: address.port,
    requests: () => requestCount,
    stop: async () => {
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      }
    }
  };
};

const startMimoFake = async (credential: string): Promise<{
  readonly port: number;
  readonly requests: () => number;
  readonly stop: () => Promise<void>;
}> => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestCount += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const valid = request.headers["api-key"] === credential &&
        request.headers.authorization === undefined &&
        body.model === "mimo-v2.5-asr";
      response.writeHead(valid ? 200 : 401, { "content-type": "application/json" });
      response.end(JSON.stringify(valid ? {
        choices: [{ finish_reason: "stop", index: 0, message: { audio: null, content: "CLI MiMo transcript", role: "assistant", tool_calls: null } }],
        id: "mimo_cli_request",
        model: "mimo-v2.5-asr",
        object: "chat.completion",
        usage: { audio_seconds: 0.5 }
      } : { error: "unauthorized" }));
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("CLI fake MiMo did not bind");
  }
  return {
    port: address.port,
    requests: () => requestCount,
    stop: async () => {
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      }
    }
  };
};

afterEach(async () => {
  await provider?.stop();
  provider = undefined;
});

describe("fairy voice CLI", () => {
  it("does not accept a user-controlled worker executable or script path", () => {
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--worker-path", "evil.py"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--python", "python -c evil"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--worker-command", "python evil.py"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--endpoint-url", "https://evil.invalid"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--provider-executable", "evil"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--output-dir", "evil"])).toThrow(/repository-controlled/);
    expect(() => parseVoiceOptions(["worker", "--script", "fixture.json", "--artifact-path", "evil.mp3"])).toThrow(/repository-controlled/);
  });

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

  it("runs websocket conformance through the gateway and prints parseable JSON", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden websocket plan"],
      text: ["voice websocket answer"],
      usage: { completion_tokens: 3, prompt_tokens: 4, total_tokens: 7 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-websocket-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const scriptPath = join(temp, "script.json");
    const token = "voice-websocket-cli-token";
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
      partials: ["voice", "voice websocket"],
      text: "voice websocket request",
      utterance_id: "utt_cli_websocket"
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
          "ws",
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
        websocket_frame_counts: Record<string, number>;
      };

      expect(parsed.sid).toMatch(/^ses_/);
      expect(outputLines.join("\n")).not.toContain("hidden websocket plan");
      expect(parsed.transcript_text).toBe("voice websocket request");
      expect(parsed.assistant_final_text).toBe("voice websocket answer");
      expect(parsed.model_request_count).toBe(1);
      expect(parsed.frame_counts).toMatchObject({
        "control.asr.final": 1,
        "control.asr.partial": 2,
        "control.tts.request": 1,
        audio: 3
      });
      expect(parsed.websocket_frame_counts).toMatchObject({
        "audio.received": 3,
        "audio.sent": 3
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
      expect(rawLog).not.toContain("voice.ws.");
      expect(rawLog).not.toContain("voice.frame.");
      expect(rawLog).not.toContain("speech.worker.");
      expect(rawLog).not.toContain("data:audio/");
      expect(rawLog).not.toMatch(/[A-Za-z0-9+/]{120,}={0,2}/);
    } finally {
      await stopGateway(gateway);
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);

  it("runs the supervised Python worker through the gateway and prints interpreter evidence", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden worker CLI plan"],
      text: ["voice worker CLI answer"],
      usage: { completion_tokens: 4, prompt_tokens: 5, total_tokens: 9 }
    });
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-worker-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const scriptPath = join(temp, "script.json");
    const token = "voice-worker-cli-token";
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
      "governance:",
      "  profile: balanced",
      "  home_regions: [cn]",
      "affect:",
      "  enabled: false",
      "persona:",
      "  enabled: false"
    ].join("\n"), "utf8");
    await writeFile(scriptPath, JSON.stringify({
      frame_labels: { residency: "global-ok", sensitivity: "public" },
      partials: ["voice", "voice worker CLI"],
      text: "voice worker CLI request",
      utterance_id: "utt_cli_worker"
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
          "worker",
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
        error_status: string;
        event_counts: Record<string, number>;
        interpreter: { argv0: string; source: string; version: string };
        log_path: string;
        model_request_count: number;
        python_version: string;
        request_ids: { asr: string; cancel: null; tts: string };
        sid: string;
        transcript_text: string;
        tts_chunk_count: number;
        worker_id: string;
        worker_process_id: number;
      };

      expect(parsed).toMatchObject({
        assistant_final_text: "voice worker CLI answer",
        error_status: "none",
        interpreter: {
          argv0: expect.any(String),
          source: expect.stringMatching(/^(?:discovered|test-override)$/),
          version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
        },
        model_request_count: 1,
        python_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        request_ids: {
          asr: "worker-asr:utt_cli_worker",
          cancel: null,
          tts: "worker-tts:utt_cli_worker"
        },
        transcript_text: "voice worker CLI request",
        tts_chunk_count: 1,
        worker_id: "speech-mock-v0",
        worker_process_id: expect.any(Number)
      });
      expect(parsed.event_counts).toMatchObject({
        "speech.asr.final": 1,
        "speech.asr.partial": 2,
        "speech.tts.chunk": 1,
        "turn.final": 1,
        "turn.input": 1
      });
      expect(output).not.toContain("hidden worker CLI plan");
      const rawLog = await readFile(parsed.log_path, "utf8");
      expect(rawLog).not.toContain("asr.script");
      expect(rawLog).not.toContain("tts.script");
      expect(rawLog).not.toContain("speech.worker.");
      expect(rawLog).not.toContain("data:audio/");
      expect(rawLog).not.toMatch(/[A-Za-z0-9+/]{120,}={0,2}/);
    } finally {
      await stopGateway(gateway);
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);

  it("runs configured MiniMax TTS through the supervised provider worker and prints bounded JSON evidence", async () => {
    provider = await MockOpenAIChatServer.start({
      reasoning: ["hidden CLI provider reasoning"],
      text: ["visible CLI provider answer"]
    });
    const credential = "M305_CLI_FAKE_CREDENTIAL_DO_NOT_USE";
    const miniMax = await startMiniMaxFake(credential);
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-provider-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const scriptPath = join(temp, "script.json");
    const token = "voice-provider-cli-token";
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
      "governance:",
      "  profile: balanced",
      "  home_regions: [cn]",
      "persona:",
      "  enabled: false",
      "affect:",
      "  enabled: false",
      "speech:",
      "  providers:",
      "    - id: minimax-cli",
      "      stage: tts",
      "      transport: minimax-t2a-v2-http",
      "      endpoint_profile: cn-primary",
      "      voice:",
      "        voice_id: male-qn-qingse",
      "        speed: 1",
      "        volume: 1",
      "        pitch: 0",
      "      api_key_ref: secret://minimax_cli",
      "      language_boost: auto",
      "      audio:",
      "        format: mp3",
      "        sample_rate: 32000",
      "        bitrate: 128000",
      "        channel: 1",
      "      data_clearance:",
      "        max_sensitivity: personal",
      "        residency: [region-restricted, global-ok]",
      "        regions: [cn]",
      "  roles:",
      "    tts:",
      "      primary: minimax-cli",
      "      fallback: []"
    ].join("\n"), "utf8");
    await writeFile(scriptPath, JSON.stringify({
      partials: ["voice provider"],
      text: "voice provider CLI input",
      utterance_id: "utt_cli_provider"
    }), "utf8");
    const config = loadGatewayConfig({ configPath }, repoRoot, { ...process.env, minimax_cli: credential });
    const gateway = new MinimalGateway(config, { speechProviderLoopbackPorts: { "minimax-cli": miniMax.port } });
    const address = await gateway.start();

    try {
      const outputLines: string[] = [];
      const originalLog = console.log;
      console.log = (value?: unknown): void => {
        outputLines.push(String(value ?? ""));
      };
      try {
        await runVoice([
          "worker",
          "--gateway",
          `ws://127.0.0.1:${address.port}`,
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
        error_status: string;
        log_path: string;
        provider_request_count: number;
        provider_route: string[];
        tts_chunk_count: number;
        tts_provider: {
          artifact_ref: string;
          audio_format: string;
          byte_count: number;
          endpoint_profile: string;
          provider_id: string;
          request_id: string;
          sha256: string;
          success_checks: { base_resp_status_zero: boolean; data_status_complete: boolean };
          transport: string;
          worker: { interpreter: { argv0: string; source: string; version: string }; pythonVersion: string; workerId: string };
        };
      };
      expect(parsed).toMatchObject({
        error_status: "none",
        provider_request_count: 1,
        provider_route: ["minimax-cli:selected"],
        tts_chunk_count: 1,
        tts_provider: {
          artifact_ref: expect.stringMatching(/^art_/),
          audio_format: "mp3",
          endpoint_profile: "cn-primary",
          provider_id: "minimax-cli",
          request_id: "provider-tts:utt_cli_provider:minimax-cli",
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          success_checks: {
            base_resp_status_zero: true,
            data_status_complete: true
          },
          transport: "minimax-t2a-v2-http",
          worker: {
            interpreter: { argv0: expect.any(String), source: expect.stringMatching(/^(?:discovered|test-override)$/) },
            pythonVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
            workerId: "speech-minimax-t2a-v2"
          }
        }
      });
      expect(miniMax.requests()).toBe(1);
      expect(miniMax.bodies[0]).toMatchObject({ text: "visible CLI provider answer" });
      expect(output).not.toContain(credential);
      expect(output).not.toContain("hidden CLI provider reasoning");
      expect(output).not.toContain("tts-output.mp3");
      const rawLog = await readFile(parsed.log_path, "utf8");
      expect(rawLog).not.toContain(credential);
      expect(rawLog).not.toContain("base_resp");
      expect(rawLog).not.toContain("tts-output.mp3");
    } finally {
      await gateway.stop();
      await miniMax.stop();
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);

  it("imports WAV input and preserves bounded MiMo ASR evidence in CLI JSON", async () => {
    provider = await MockOpenAIChatServer.start({ text: ["visible ASR model answer"] });
    const credential = "sk-R09_CLI_FAKE_PAYGO_DO_NOT_USE";
    const mimo = await startMimoFake(credential);
    const temp = await mkdtemp(join(tmpdir(), "fairy-voice-mimo-cli-"));
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const inputPath = join(temp, "input.wav");
    const weakCollisionPath = join(temp, "weak-collision.wav");
    const kindCollisionPath = join(temp, "kind-collision.wav");
    const regionCollisionPath = join(temp, "region-collision.wav");
    const token = "voice-mimo-cli-token";
    const wavHeader = [0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
    const inputBytes = Buffer.from([...wavHeader, 1, 2, 3, 4]);
    const weakCollisionBytes = Buffer.from([...wavHeader, 5, 6, 7, 8]);
    const kindCollisionBytes = Buffer.from([...wavHeader, 9, 10, 11, 12]);
    const regionCollisionBytes = Buffer.from([...wavHeader, 13, 14, 15, 16]);
    await writeFile(inputPath, inputBytes);
    await writeFile(weakCollisionPath, weakCollisionBytes);
    await writeFile(kindCollisionPath, kindCollisionBytes);
    await writeFile(regionCollisionPath, regionCollisionBytes);
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
      "governance:",
      "  profile: balanced",
      "  home_regions: [cn]",
      "persona:",
      "  enabled: false",
      "affect:",
      "  enabled: false",
      "speech:",
      "  providers:",
      "    - id: mimo-cli",
      "      stage: asr",
      "      transport: mimo-v2.5-asr-chat-http",
      "      endpoint_profile: mimo-paygo-cn",
      "      model: mimo-v2.5-asr",
      "      api_key_ref: secret://mimo_cli",
      "      language: auto",
      "      limits:",
      "        max_input_bytes: 7000000",
      "        max_response_bytes: 1048576",
      "        max_transcript_chars: 20000",
      "      data_clearance:",
      "        max_sensitivity: personal",
      "        residency: [region-restricted, global-ok]",
      "        regions: [cn]",
      "  roles:",
      "    asr:",
      "      primary: mimo-cli",
      "      fallback: []"
    ].join("\n"), "utf8");
    const config = loadGatewayConfig({ configPath }, repoRoot, { ...process.env, mimo_cli: credential });
    const gateway = new MinimalGateway(config, { speechProviderLoopbackPorts: { "mimo-cli": mimo.port } });
    const address = await gateway.start();
    const invoke = async (args: string[]): Promise<string> => {
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (value?: unknown): void => { output.push(String(value ?? "")); };
      try {
        await runVoice(args);
      } finally {
        console.log = originalLog;
      }
      return output.join("\n").trim();
    };

    try {
      const registry = new ArtifactRegistry(join(dataDir, "artifacts"));
      await registry.register({
        content: weakCollisionBytes,
        kind: "input",
        labels: { residency: "global-ok", sensitivity: "public" },
        mime: "audio/wav",
        origin: "test:weak-collision",
        sourceFilename: "weak-collision.wav"
      });
      await expect(invoke([
        "import-audio", "--file", weakCollisionPath, "--sensitivity", "secret",
        "--residency", "local-only", "--config", configPath, "--json"
      ])).rejects.toThrow(/does not cover the requested labels/);
      await registry.register({
        content: kindCollisionBytes,
        kind: "speech",
        labels: { residency: "region-restricted", sensitivity: "personal" },
        metadata: { region: "cn" },
        mime: "audio/wav",
        origin: "test:kind-collision",
        sourceFilename: "kind-collision.wav"
      });
      await expect(invoke([
        "import-audio", "--file", kindCollisionPath, "--sensitivity", "personal",
        "--residency", "region-restricted", "--region", "cn", "--config", configPath, "--json"
      ])).rejects.toThrow(/did not preserve validated input metadata/);
      await registry.register({
        content: regionCollisionBytes,
        kind: "input",
        labels: { residency: "region-restricted", sensitivity: "personal" },
        metadata: { source: "preexisting-without-region" },
        mime: "audio/wav",
        origin: "test:region-collision",
        sourceFilename: "region-collision.wav"
      });
      await expect(invoke([
        "import-audio", "--file", regionCollisionPath, "--sensitivity", "personal",
        "--residency", "region-restricted", "--region", "cn", "--config", configPath, "--json"
      ])).rejects.toThrow(/did not preserve the requested region/);
      expect(mimo.requests()).toBe(0);

      const importedOutput = await invoke([
        "import-audio", "--file", inputPath, "--sensitivity", "personal",
        "--residency", "region-restricted", "--region", "cn", "--config", configPath, "--json"
      ]);
      const imported = JSON.parse(importedOutput) as { artifact_id: string; hash: string; kind: string; labels: Record<string, string>; mime: string; size_bytes: number };
      expect(imported).toMatchObject({ kind: "input", labels: { residency: "region-restricted", sensitivity: "personal" }, mime: "audio/wav", size_bytes: 16 });
      expect(imported.artifact_id).toMatch(/^art_[a-f0-9]{20}$/);
      expect(imported.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(importedOutput).not.toContain(inputPath);

      const asrOutput = await invoke([
        "asr", "--audio-ref", imported.artifact_id, "--gateway", `ws://127.0.0.1:${address.port}`,
        "--token", token, "--json"
      ]);
      const asr = JSON.parse(asrOutput) as Record<string, unknown>;
      expect(asr).toMatchObject({
        asr_final_count: 1,
        asr_provider: {
          auth: "api-key",
          endpoint_profile: "mimo-paygo-cn",
          finish_reason: "stop",
          model: "mimo-v2.5-asr",
          provider_id: "mimo-cli",
          provider_request_id: "mimo_cli_request",
          transport: "mimo-v2.5-asr-chat-http",
          usage_seconds: 0.5
        },
        audio_ref: imported.artifact_id,
        error_category: "none",
        model_request_count: 1,
        provider_request_count: 1,
        transcript_text: "CLI MiMo transcript",
        turn_input_count: 1,
        worker_spawn_count: 1
      });
      expect(mimo.requests()).toBe(1);
      expect(asrOutput).not.toContain(credential);
      expect(asrOutput).not.toContain("data:audio/");
      expect(asrOutput).not.toContain("asr-input.bin");
      const rawLog = await readFile(join(dataDir, "sessions", String(asr.sid), "log.jsonl"), "utf8");
      expect(rawLog).not.toContain(credential);
      expect(rawLog).not.toContain("data:audio/");
      expect(rawLog).not.toContain("asr.request");
    } finally {
      await gateway.stop();
      await mimo.stop();
    }
  }, CLI_VOICE_E2E_TIMEOUT_MS);
});
