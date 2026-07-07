import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI_MEMORY_E2E_TIMEOUT_MS = 60_000;

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

describe("fairy memory CLI", () => {
  it("lists, searches, shows evidence, deletes, and rebuilds from JSONL", async () => {
    const dataDir = join(tmpdir(), `fairy-memory-cli-${Date.now()}`);
    const workspaceRoot = join(dataDir, "workspace");
    const configPath = join(dataDir, "fairy.yaml");
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(configPath, [
      "gateway:",
      `  data_dir: ${JSON.stringify(dataDir.replace(/\\/g, "/"))}`,
      "workspace:",
      `  root: ${JSON.stringify(workspaceRoot.replace(/\\/g, "/"))}`,
      "memory:",
      "  consolidation:",
      "    enabled: true",
      "    learned_skill_pending_dir: learned/pending"
    ].join("\n"), "utf8");
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000000001",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "remember that favorite shell is pwsh" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1,
        type: "turn.input",
        v: 1
      }),
      JSON.stringify({
        actor: "system",
        id: "evt_01J00000000000000000000002",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: {
          kind: "preference",
          memory_id: "mem_shell",
          scope: { kind: "personal" },
          source: { event_id: "evt_01J00000000000000000000001", quote: "favorite shell is pwsh", sid, turn: 1 },
          summary: "favorite shell is pwsh",
          tier: "semantic"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.001Z",
        turn: 1,
        type: "memory.written",
        v: 1
      }),
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000000003",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "DECISION_CLI: keep source-first TS execution" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.002Z",
        turn: 2,
        type: "turn.input",
        v: 1
      }),
      JSON.stringify({
        actor: "tool",
        id: "evt_01J00000000000000000000004",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: {
          call_id: "call_cli_failure",
          error: { class: "ToolError", message: "fixture failed" },
          labels: { residency: "global-ok", sensitivity: "internal" },
          provenance: "tool:vision.ocr",
          status: "error"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.003Z",
        turn: 2,
        type: "tool.result",
        v: 1
      }),
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000000005",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "API_KEY=sk_test_1234567890abcdef" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.004Z",
        turn: 3,
        type: "turn.input",
        v: 1
      })
    ].join("\n"), "utf8");

    expect(JSON.parse(runFairy(["memory", "rebuild", "--data-dir", dataDir, "--json"]))).toEqual({ records: 1, tombstones: 0 });
    expect(JSON.parse(runFairy(["memory", "list", "--data-dir", dataDir, "--json"]))).toMatchObject({
      memories: [expect.objectContaining({ id: "mem_shell", kind: "preference" })]
    });
    expect(JSON.parse(runFairy(["memory", "search", "shell", "--data-dir", dataDir, "--json"]))).toMatchObject({
      memories: [expect.objectContaining({ id: "mem_shell", score: expect.any(Number) })]
    });
    expect(JSON.parse(runFairy(["memory", "show", "mem_shell", "--data-dir", dataDir, "--json"]))).toMatchObject({
      memory_id: "mem_shell",
      ok: true,
      provenance: { sid, turn: 1 },
      text: "favorite shell is pwsh"
    });
    expect(JSON.parse(runFairy(["memory", "evidence", "mem_shell", "--data-dir", dataDir, "--json"]))).toMatchObject({
      memory_id: "mem_shell",
      ok: true,
      provenance: { sid, turn: 1 },
      text: "favorite shell is pwsh"
    });

    const consolidated = JSON.parse(runFairy(["memory", "consolidate", "--from", sid, "--config", configPath, "--json"])) as {
      report: {
        artifact: { path: string };
        chronicle_candidates: { kind: string; summary: string }[];
        id: string;
        learned_skill_drafts: { path: string; status: string }[];
        redactions: { event_id: string; reason: string }[];
      };
    };
    expect(consolidated.report.id).toMatch(/^mrep_/);
    expect(consolidated.report.chronicle_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "decision", summary: expect.stringContaining("DECISION_CLI") }),
      expect.objectContaining({ kind: "failure", summary: expect.stringContaining("fixture failed") })
    ]));
    expect(consolidated.report.redactions).toEqual([
      expect.objectContaining({
        event_id: "evt_01J00000000000000000000005",
        quote: expect.stringContaining("[REDACTED:secret:"),
        reason: "secret"
      })
    ]);
    expect(consolidated.report.learned_skill_drafts).toEqual([
      expect.objectContaining({ path: expect.stringContaining("pending"), status: "pending" })
    ]);
    await expect(readFile(consolidated.report.learned_skill_drafts[0]?.path ?? "", "utf8")).resolves.toContain("\"status\": \"pending\"");
    const reportRaw = await readFile(consolidated.report.artifact.path, "utf8");
    expect(reportRaw).toContain("[REDACTED:secret:");
    expect(reportRaw).not.toContain("sk_test_1234567890abcdef");
    expect(JSON.parse(runFairy(["memory", "report", "--config", configPath, "--json"]))).toMatchObject({
      report: { id: consolidated.report.id }
    });

    expect(JSON.parse(runFairy(["memory", "delete", "mem_shell", "--data-dir", dataDir, "--json"]))).toMatchObject({
      deleted: "mem_shell",
      event_id: expect.stringMatching(/^evt_/)
    });
    expect(JSON.parse(runFairy(["memory", "rebuild", "--data-dir", dataDir, "--json"]))).toEqual({ records: 0, tombstones: 1 });
    expect(JSON.parse(runFairy(["memory", "search", "shell", "--data-dir", dataDir, "--json"]))).toEqual({ memories: [] });
  }, CLI_MEMORY_E2E_TIMEOUT_MS);
});
