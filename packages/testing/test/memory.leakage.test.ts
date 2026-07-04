import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateRetrievalGate, MemoryStore, type MemoryRecord } from "@fairy/memory";

const personalLocalRecord = (): MemoryRecord => ({
  confidence: 0.8,
  created_at: "2026-07-02T10:00:00.000Z",
  id: "mem_personal_shell",
  kind: "preference",
  labels: { residency: "local-only", sensitivity: "personal" },
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
  valid_from: "2026-07-02T10:00:00.000Z"
});

describe("memory.leakage", () => {
  it("records retrieval denials without leaking under-cleared personal text", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-eval-memory-leakage-"));
    const store = new MemoryStore(dataDir);
    store.insert(personalLocalRecord());

    const candidates = store.search("which shell do I prefer?", { includeIrrelevant: true });
    const auditEvents = candidates.map((candidate) => {
      const gate = evaluateRetrievalGate(candidate, {
        channelTrust: "trusted",
        mode: "chat",
        requestLabels: { residency: "global-ok", sensitivity: "internal" },
        routeAllowed: false,
        scope: { kind: "personal" }
      });
      return {
        payload: {
          decision: gate.decision,
          memory_id: gate.memory_id,
          phase: gate.phase,
          reason: gate.reason,
          score: Number(gate.score.toFixed(4))
        },
        type: "memory.gate.decision"
      };
    });

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents.filter((event) => event.payload.decision === "allow")).toHaveLength(0);
    expect(auditEvents[0]).toMatchObject({
      payload: {
        decision: "deny",
        memory_id: "mem_personal_shell",
        phase: "retrieval",
        reason: "label_clearance_denied"
      }
    });
    expect(JSON.stringify(auditEvents)).not.toContain("pwsh");
    expect(JSON.stringify(auditEvents)).not.toContain("favorite shell");
  });
});
