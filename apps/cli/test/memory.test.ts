import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const runFairy = (args: readonly string[]): string => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin/fairy.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    timeout: 30000,
    windowsHide: true
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
};

describe("fairy memory CLI", () => {
  it("lists, searches, shows evidence, deletes, and rebuilds from JSONL", async () => {
    const dataDir = join(tmpdir(), `fairy-memory-cli-${Date.now()}`);
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
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

    expect(JSON.parse(runFairy(["memory", "delete", "mem_shell", "--data-dir", dataDir, "--json"]))).toMatchObject({
      deleted: "mem_shell",
      event_id: expect.stringMatching(/^evt_/)
    });
    expect(JSON.parse(runFairy(["memory", "rebuild", "--data-dir", dataDir, "--json"]))).toEqual({ records: 0, tombstones: 1 });
    expect(JSON.parse(runFairy(["memory", "search", "shell", "--data-dir", dataDir, "--json"]))).toEqual({ memories: [] });
  });
});
