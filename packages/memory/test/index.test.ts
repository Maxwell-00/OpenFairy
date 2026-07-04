import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateRetrievalGate, MemoryGate, MemoryStore, proposeMemoryCandidate, type MemoryCandidate, type MemoryRecord } from "../src/index.js";

const candidate = (overrides: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  category: "preference",
  labels: { residency: "global-ok", sensitivity: "internal" },
  reason: "explicit_user_remember",
  source: { sid: "ses_test", turn: 1 },
  text: "favorite editor is Helix",
  ...overrides
});

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  confidence: 0.8,
  created_at: "2026-07-02T10:00:00.000Z",
  id: "mem_shell",
  kind: "preference",
  labels: { residency: "global-ok", sensitivity: "internal" },
  provenance: {
    event_id: "evt_01J00000000000000000000002",
    quote: "favorite shell is pwsh",
    sid: "ses_01J00000000000000000000000",
    turn: 1
  },
  scope: { kind: "personal" },
  text: "favorite shell is pwsh",
  updated_at: "2026-07-02T10:00:00.000Z",
  use_count: 0,
  valid_from: "2026-07-02T10:00:00.000Z",
  ...overrides
});

describe("@fairy/memory", () => {
  it("allows safe explicit memory by default", () => {
    const result = new MemoryGate().evaluate(candidate());

    expect(result).toMatchObject({
      decision: "allow",
      memory_id: expect.stringMatching(/^mem_[a-f0-9]{20}$/),
      reason: "explicit_remember"
    });
  });

  it("denies secret-labeled memory candidates", () => {
    const result = new MemoryGate().evaluate(candidate({
      category: "secret",
      labels: { residency: "local-only", sensitivity: "secret" },
      text: "API_KEY=sk_test_1234567890abcdef"
    }));

    expect(result).toMatchObject({
      decision: "deny",
      reason: "secret_denied"
    });
  });

  it("holds personal memory by default", () => {
    const result = new MemoryGate().evaluate(candidate({
      labels: { residency: "global-ok", sensitivity: "personal" },
      text: "my birthday is Jan 1"
    }));

    expect(result).toMatchObject({
      decision: "hold",
      reason: "personal_default_hold"
    });
  });

  it("extracts explicit remember instructions", () => {
    expect(proposeMemoryCandidate({
      labels: { residency: "global-ok", sensitivity: "internal" },
      sid: "ses_test",
      text: "please remember favorite shell is pwsh",
      turn: 2
    })).toMatchObject({
      category: "preference",
      reason: "explicit_user_remember",
      text: "favorite shell is pwsh"
    });

    expect(proposeMemoryCandidate({
      labels: { residency: "global-ok", sensitivity: "internal" },
      sid: "ses_test",
      text: "\u8bf7\u8bb0\u4f4f\u6211\u559c\u6b22\u7ea2\u8272",
      turn: 3
    })).toMatchObject({
      text: "\u6211\u559c\u6b22\u7ea2\u8272"
    });
  });

  it("rejects direct secret projection inserts even when the gate is bypassed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-secret-"));
    const store = new MemoryStore(dataDir);

    expect(() => store.insert(record({
      id: "mem_secret",
      labels: { residency: "local-only", sensitivity: "secret" },
      text: "API_KEY=sk_test_1234567890abcdef"
    }))).toThrow(/secret/);
    expect(store.list()).toEqual([]);
  });

  it("inserts, deduplicates, deletes, and searches projection rows", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-store-"));
    const store = new MemoryStore(dataDir);

    const first = store.insert(record());
    const second = store.insert(record({ id: "mem_shell_later", provenance: { ...record().provenance, event_id: "evt_later" } }));

    expect(first.id).toBe("mem_shell");
    expect(second.id).toBe("mem_shell");
    expect(store.list()).toHaveLength(1);
    expect(store.search("which shell do I prefer?")[0]?.record.id).toBe("mem_shell");
    expect(store.search("tell me about ocean tides")).toEqual([]);

    store.delete("mem_shell", { event_id: "evt_delete", reason: "user_deleted" });
    expect(store.list()).toEqual([]);
  });

  it("rebuilds from JSONL memory events and keeps deleted memories tombstoned", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-rebuild-"));
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    const written = {
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
    expect(store.get("mem_shell")).toBeUndefined();
    expect(store.search("shell")).toEqual([]);
  });

  it("rebuilds repeated memory.written events without unbounded duplicates", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-rebuild-dedupe-"));
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    const base = {
      actor: "system",
      labels: { residency: "global-ok", sensitivity: "internal" },
      payload: {
        kind: "preference",
        scope: { kind: "personal" },
        source: { event_id: "evt_01J00000000000000000000001", quote: "favorite shell is pwsh", sid, turn: 1 },
        summary: "favorite shell is pwsh",
        tier: "semantic"
      },
      provenance: "agent",
      sid,
      turn: 1,
      type: "memory.written",
      v: 1
    };
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({
        ...base,
        id: "evt_01J00000000000000000000002",
        payload: { ...base.payload, memory_id: "mem_shell_first" },
        ts: "2026-07-02T10:00:00.001Z"
      }),
      JSON.stringify({
        ...base,
        id: "evt_01J00000000000000000000003",
        payload: { ...base.payload, memory_id: "mem_shell_second" },
        ts: "2026-07-02T10:00:00.002Z"
      })
    ].join("\n"), "utf8");

    const store = new MemoryStore(dataDir);
    await expect(store.rebuildFromSessionLogs()).resolves.toEqual({ records: 1, tombstones: 0 });
    expect(store.list().map((item) => item.text)).toEqual(["favorite shell is pwsh"]);
  });

  it("gates retrieval by relevance, scope, deleted state, and route clearance", () => {
    const scored = { record: record(), score: 0.8 };

    expect(evaluateRetrievalGate(scored, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: { kind: "personal" }
    })).toMatchObject({ decision: "allow", reason: "admit" });
    expect(evaluateRetrievalGate({ record: record({ valid_to: "2026-07-03T00:00:00.000Z" }), score: 0.8 }, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true
    })).toMatchObject({ decision: "deny", reason: "deleted_or_superseded" });
    expect(evaluateRetrievalGate({ record: record(), score: 0.01 }, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true
    })).toMatchObject({ decision: "deny", reason: "below_relevance_floor" });
    expect(evaluateRetrievalGate(scored, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: { kind: "workspace", workspace_id: "other" }
    })).toMatchObject({ decision: "deny", reason: "scope_mismatch" });
    expect(evaluateRetrievalGate(scored, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: false
    })).toMatchObject({ decision: "deny", reason: "label_clearance_denied" });
  });

  it("returns evidence for allowed records and does not leak denied record text", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-evidence-"));
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({ id: "evt_before", payload: { content: [{ kind: "text", text: "before" }] }, sid, turn: 1, type: "turn.input" }),
      JSON.stringify({ id: "evt_01J00000000000000000000002", payload: { summary: "favorite shell is pwsh" }, sid, turn: 1, type: "memory.written" }),
      JSON.stringify({ id: "evt_after", payload: { content: [{ kind: "text", text: "after" }] }, sid, turn: 1, type: "turn.final" })
    ].join("\n"), "utf8");
    const store = new MemoryStore(dataDir);
    store.insert(record());

    await expect(store.evidence("mem_shell", {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: { kind: "personal" }
    })).resolves.toMatchObject({
      ok: true,
      provenance: { sid, turn: 1 },
      text: "favorite shell is pwsh"
    });

    await expect(store.evidence("mem_shell", {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: false
    })).resolves.toEqual({
      memory_id: "mem_shell",
      ok: false,
      reason: "label_clearance_denied"
    });
  });
});
