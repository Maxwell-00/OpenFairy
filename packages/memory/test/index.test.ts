import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ChroniclePolicyError,
  ChronicleStore,
  consolidateMemory,
  evaluateRetrievalGate,
  MemoryGate,
  MemoryStore,
  proposeMemoryCandidate,
  readLatestConsolidationReport,
  type ChronicleContentLabeler,
  type MemoryCandidate,
  type MemoryLabels,
  type MemoryRecord
} from "../src/index.js";

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

const testLabeler: ChronicleContentLabeler = (text: string, labels: MemoryLabels) => {
  if (/sk_test_|API_KEY=/i.test(text)) {
    return { labels: { residency: "local-only", sensitivity: "secret" } };
  }
  if (/doctor|birthday|my private/i.test(text)) {
    return { labels: { residency: "local-only", sensitivity: "personal" } };
  }
  return { labels };
};

const SQLITE_PROJECTION_CI_TIMEOUT_MS = 30_000;

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
  }, SQLITE_PROJECTION_CI_TIMEOUT_MS);

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
  }, SQLITE_PROJECTION_CI_TIMEOUT_MS);

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

  it("denies retrieval when residency fails route clearance while sensitivity is cleared", () => {
    const scored = {
      record: record({
        labels: { residency: "local-only", sensitivity: "internal" }
      }),
      score: 0.8
    };

    expect(evaluateRetrievalGate(scored, {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: false,
      scope: { kind: "personal" }
    })).toMatchObject({
      decision: "deny",
      labels: { residency: "local-only", sensitivity: "internal" },
      reason: "label_clearance_denied"
    });
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

  it("appends workspace Chronicle entries, scopes queries, and rejects secret or implicit personal writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-chronicle-store-"));
    const workspaceRoot = join(dataDir, "workspace-a");
    const store = new ChronicleStore(dataDir, {
      clock: () => "2026-07-02T10:00:00.000Z",
      labelContent: testLabeler,
      workspaceRoot
    });
    const memory = new MemoryStore(dataDir);

    const entry = await store.append({
      files: ["packages/kernel/src/index.ts"],
      kind: "decision",
      provenance: { event_id: "evt_source", sid: "ses_source", source: "unit", turn: 2 },
      summary: "Use source-first TS execution for gateway tests",
      topics: ["m2", "testing"]
    });

    expect(entry).toMatchObject({
      id: expect.stringMatching(/^chr_[a-f0-9]{20}$/),
      labels: { residency: "global-ok", sensitivity: "internal" },
      workspace: { id: expect.stringMatching(/^ws_[a-f0-9]{16}$/) }
    });
    expect((await readFile(store.path, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
    expect(await store.query("source-first packages/kernel/src/index.ts")).toEqual([
      expect.objectContaining({ record: expect.objectContaining({ id: entry.id }), score: expect.any(Number) })
    ]);

    const otherWorkspace = new ChronicleStore(dataDir, {
      labelContent: testLabeler,
      workspaceRoot: join(dataDir, "workspace-b")
    });
    expect(await otherWorkspace.query("source-first", { includeIrrelevant: true })).toEqual([]);
    expect(memory.list()).toEqual([]);

    await expect(store.append({
      kind: "note",
      summary: "API_KEY=sk_test_1234567890abcdef"
    })).rejects.toBeInstanceOf(ChroniclePolicyError);
    await expect(store.append({
      kind: "note",
      summary: "my private doctor note"
    })).rejects.toMatchObject({ code: "personal_requires_explicit_workspace_scope" });
    expect((await readFile(store.path, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("creates deterministic consolidation reports with redaction, suggestions, and pending learned skills only", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-consolidation-"));
    const workspaceRoot = join(dataDir, "workspace");
    const pendingDir = join(workspaceRoot, "extensions", "skills", "learned", "pending");
    const sid = "ses_01J00000000000000000004444";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000004441",
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
        actor: "user",
        id: "evt_01J00000000000000000004442",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "DECISION_ALPHA: keep source-first TS execution" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:01.000Z",
        turn: 2,
        type: "turn.input",
        v: 1
      }),
      JSON.stringify({
        actor: "tool",
        id: "evt_01J00000000000000000004443",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: {
          call_id: "call_fail",
          error: { class: "ToolError", message: "fixture failed" },
          labels: { residency: "global-ok", sensitivity: "internal" },
          provenance: "tool:vision.ocr",
          status: "error"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:02.000Z",
        turn: 2,
        type: "tool.result",
        v: 1
      }),
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000004444",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "API_KEY=sk_test_1234567890abcdef" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:03.000Z",
        turn: 3,
        type: "turn.input",
        v: 1
      })
    ].join("\n") + "\n", "utf8");

    const memoryRecords = [
      record({ id: "mem_shell_pwsh", text: "favorite shell is pwsh" }),
      record({ id: "mem_shell_bash", text: "favorite shell is bash", provenance: { ...record().provenance, event_id: "evt_other" } })
    ];
    const first = await consolidateMemory({
      dataDir,
      from: sid,
      labelContent: testLabeler,
      learnedSkillPendingDir: pendingDir,
      memoryRecords,
      workspaceRoot
    });
    const second = await consolidateMemory({
      dataDir,
      from: sid,
      labelContent: testLabeler,
      learnedSkillPendingDir: pendingDir,
      memoryRecords,
      workspaceRoot
    });

    expect(second.id).toBe(first.id);
    expect(second.artifact.path).toBe(first.artifact.path);
    expect(first.candidate_memories).toEqual([
      expect.objectContaining({ admission: "candidate_only", summary: "favorite shell is pwsh" })
    ]);
    expect(first.chronicle_candidates.some((item) => item.kind === "decision")).toBe(true);
    expect(first.contradiction_suggestions).toEqual([
      expect.objectContaining({
        memory_ids: ["mem_shell_bash", "mem_shell_pwsh"],
        suggestion: expect.stringContaining("explicitly supersede")
      })
    ]);
    expect(first.learned_skill_drafts).toEqual([
      expect.objectContaining({ path: expect.stringContaining("pending"), status: "pending" })
    ]);
    await expect(readFile(first.learned_skill_drafts[0]?.path ?? "", "utf8")).resolves.toContain("\"status\": \"pending\"");
    expect(await readLatestConsolidationReport(dataDir)).toMatchObject({ id: first.id });
    const reportRaw = await readFile(first.artifact.path, "utf8");
    expect(reportRaw).not.toContain("sk_test_1234567890abcdef");
    expect(reportRaw).toContain("[REDACTED:secret:");

    const sessionDirs = await readdir(join(dataDir, "sessions"), { withFileTypes: true });
    const allSessionLogs = (await Promise.all(sessionDirs
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFile(join(dataDir, "sessions", entry.name, "log.jsonl"), "utf8")))).join("\n");
    expect(allSessionLogs).not.toContain("memory.deleted");
    expect(allSessionLogs).not.toContain("memory.superseded");
  });

  it("pulls Chronicle and consolidation report refs through memory evidence without exposing denied text", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-memory-evidence-pullthrough-"));
    const sid = "ses_01J00000000000000000005555";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000005551",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "remember that favorite shell is pwsh" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1,
        type: "turn.input",
        v: 1
      })
    ].join("\n") + "\n", "utf8");
    const store = new MemoryStore(dataDir);
    store.insert(record({ provenance: { event_id: "evt_01J00000000000000000005551", quote: "favorite shell is pwsh", sid, turn: 1 } }));
    const chronicle = new ChronicleStore(dataDir, { workspaceRoot: join(dataDir, "workspace") });
    await chronicle.append({
      kind: "decision",
      provenance: { event_id: "evt_01J00000000000000000005551", sid, source: "unit", turn: 1 },
      summary: "Memory evidence should include this Chronicle decision"
    });
    await consolidateMemory({
      dataDir,
      from: sid,
      labelContent: testLabeler,
      memoryRecords: [store.get("mem_shell")].filter((item): item is MemoryRecord => Boolean(item)),
      workspaceRoot: join(dataDir, "workspace")
    });

    await expect(store.evidence("mem_shell", {
      requestLabels: { residency: "global-ok", sensitivity: "internal" },
      routeAllowed: true,
      scope: { kind: "personal" }
    })).resolves.toMatchObject({
      chronicle: [expect.objectContaining({ id: expect.stringMatching(/^chr_/) })],
      ok: true,
      report_artifacts: [expect.objectContaining({ report_id: expect.stringMatching(/^mrep_/) })]
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
