import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI_PERSONA_E2E_TIMEOUT_MS = 60_000;

const runFairy = (args: readonly string[]): string => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin/fairy.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    timeout: 30000,
    windowsHide: true
  });
  if (result.error) {
    throw new Error([
      `fairy ${args.join(" ")} failed: ${result.error.message}`,
      `stdout:\n${result.stdout ?? ""}`,
      `stderr:\n${result.stderr ?? ""}`
    ].join("\n"));
  }
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
};

describe("fairy persona and affect CLI", () => {
  it("inspects persona metadata and current affect state from JSONL", async () => {
    const temp = join(tmpdir(), `fairy-persona-cli-${Date.now()}`);
    const dataDir = join(temp, "data");
    const configPath = join(temp, "fairy.yaml");
    const sid = "ses_01J00000000000000000000000";
    await mkdir(join(dataDir, "sessions", sid), { recursive: true });
    await writeFile(configPath, [
      "gateway:",
      `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
      "persona:",
      "  enabled: true",
      "  id: fairy",
      "affect:",
      "  enabled: true"
    ].join("\n"), "utf8");
    await writeFile(join(dataDir, "sessions", sid, "log.jsonl"), JSON.stringify({
      actor: "agent",
      id: "evt_01J00000000000000000000030",
      labels: { residency: "global-ok", sensitivity: "internal" },
      payload: {
        arousal: 0.1,
        cause: "user-thanks",
        energy: "medium",
        stance: "warm",
        updated_at: "2026-07-02T10:00:00.000Z",
        valence: 0.33
      },
      provenance: "agent",
      sid,
      ts: "2026-07-02T10:00:00.000Z",
      turn: 1,
      type: "affect.updated",
      v: 1
    }), "utf8");

    const persona = JSON.parse(runFairy(["persona", "inspect", "--config", configPath, "--json"])) as Record<string, unknown>;
    expect(persona).toMatchObject({
      affect_enabled: true,
      disclosure: expect.stringContaining("AI assistant"),
      enabled: true,
      id: "fairy",
      name: "Fairy"
    });
    expect(JSON.stringify(persona)).not.toContain("Fairy is a capable bilingual AI companion");

    const affect = JSON.parse(runFairy(["affect", "--config", configPath, "--json"])) as Record<string, unknown>;
    expect(affect).toMatchObject({
      current: { cause: "user-thanks", stance: "warm", valence: 0.33 },
      enabled: true,
      last_cause: "user-thanks",
      persona_id: "fairy",
      source: { sid, turn: 1 }
    });
  }, CLI_PERSONA_E2E_TIMEOUT_MS);
});
