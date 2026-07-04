import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MemoryStore } from "@fairy/memory";

describe("memory.deletion-permanence", () => {
  it("keeps deleted memories tombstoned across rebuild and retrieval", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-eval-memory-delete-"));
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });

    const written = {
      actor: "system",
      id: "evt_01J00000000000000000000002",
      labels: { residency: "global-ok", sensitivity: "internal" },
      payload: {
        confidence: 0.8,
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
    };
    const deleted = {
      actor: "system",
      id: "evt_01J00000000000000000000003",
      labels: { residency: "global-ok", sensitivity: "internal" },
      payload: { memory_id: "mem_shell", reason: "user_deleted" },
      provenance: "agent",
      sid,
      ts: "2026-07-02T10:00:00.002Z",
      turn: 1,
      type: "memory.deleted",
      v: 1
    };
    await writeFile(join(sessionDir, "log.jsonl"), `${JSON.stringify(written)}\n${JSON.stringify(deleted)}\n`, "utf8");

    const store = new MemoryStore(dataDir);
    await expect(store.rebuildFromSessionLogs()).resolves.toEqual({ records: 0, tombstones: 1 });
    expect(store.list()).toEqual([]);
    expect(store.search("which shell do I prefer?", { includeIrrelevant: true })).toEqual([]);
  });
});
