import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readReplayLog, renderReplay } from "../src/index.js";

describe("fairy replay", () => {
  it("reports a corrupt trailing line and still renders earlier events", async () => {
    const dataDir = join(tmpdir(), `fairy-replay-${Date.now()}`);
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "log.jsonl"), [
      JSON.stringify({
        actor: "user",
        id: "evt_01J00000000000000000000001",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { content: [{ kind: "text", text: "hello replay" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1,
        type: "turn.input",
        v: 1
      }),
      "{\"v\":1"
    ].join("\n"), "utf8");

    const result = await readReplayLog({ dataDir, sid });
    const rendered = renderReplay(result, { json: false, manifests: false });

    expect(result.events).toHaveLength(1);
    expect(result.warnings[0]).toContain("corrupt JSON tail");
    expect(rendered).toContain("warning:");
    expect(rendered).toContain("hello replay");
  });

  it("renders trust decisions offline and preserves payloads in JSON output", async () => {
    const dataDir = join(tmpdir(), `fairy-replay-trust-${Date.now()}`);
    const sid = "ses_01J00000000000000000000000";
    const sessionDir = join(dataDir, "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    const events = [
      {
        actor: "user",
        id: "evt_01J00000000000000000000001",
        labels: { residency: "local-only", sensitivity: "secret" },
        payload: { content: [{ kind: "text", text: "remember that API_KEY=sk_test_1234567890abcdef" }] },
        provenance: "user",
        sid,
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1,
        type: "turn.input",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000002",
        labels: { residency: "local-only", sensitivity: "secret" },
        payload: { decision: "deny", memory_id: "mem_secret", phase: "admission", reason: "secret_denied" },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.001Z",
        turn: 1,
        type: "memory.gate.decision",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000003",
        labels: { residency: "local-only", sensitivity: "secret" },
        payload: {
          reason: "No configured model satisfies request labels.",
          required_clearance: { residency: "local-only", sensitivity: "secret" },
          role: "main"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.002Z",
        turn: 1,
        type: "route.denied",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000004",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { decision: "allow", memory_id: "mem_safe", phase: "admission", reason: "explicit_remember" },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.003Z",
        turn: 2,
        type: "memory.gate.decision",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000005",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { memory_id: "mem_safe", summary: "favorite shell is pwsh", tier: "semantic" },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.004Z",
        turn: 2,
        type: "memory.written",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000006",
        labels: { residency: "local-only", sensitivity: "personal" },
        payload: { decision: "deny", memory_id: "mem_private", phase: "retrieval", reason: "label_clearance_denied", score: 0.91 },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.005Z",
        turn: 3,
        type: "memory.gate.decision",
        v: 1
      },
      {
        actor: "system",
        id: "evt_01J00000000000000000000007",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: { memory_id: "mem_safe", reason: "user_deleted" },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.006Z",
        turn: 3,
        type: "memory.deleted",
        v: 1
      },
      {
        actor: "tool",
        id: "evt_01J00000000000000000000008",
        labels: { residency: "global-ok", sensitivity: "public" },
        payload: {
          hash: "sha256:abc",
          retrieved_at: "2026-07-02T10:00:00.007Z",
          snapshot_ref: "snap_abc",
          url: "https://docs.openfairy.test/research/memory-store"
        },
        provenance: "web:docs.openfairy.test",
        sid,
        ts: "2026-07-02T10:00:00.007Z",
        turn: 3,
        type: "snapshot.created",
        v: 1
      },
      {
        actor: "tool",
        id: "evt_01J00000000000000000000009",
        labels: { residency: "global-ok", sensitivity: "public" },
        payload: {
          claim: "Fairy memory is rebuildable.",
          grade: "official",
          retrieved_at: "2026-07-02T10:00:00.007Z",
          source: {
            snapshot_ref: "snap_abc",
            span: { start: 0, end: 80 },
            title: "OpenFairy MemoryStore Notes",
            url: "https://docs.openfairy.test/research/memory-store"
          }
        },
        provenance: "web:docs.openfairy.test",
        sid,
        ts: "2026-07-02T10:00:00.008Z",
        turn: 3,
        type: "citation.recorded",
        v: 1
      },
      {
        actor: "tool",
        id: "evt_01J00000000000000000000010",
        labels: { residency: "global-ok", sensitivity: "public" },
        payload: {
          decision: "needs_more_sources",
          review_id: "review_abc",
          sources: [{ grade: "official", independence_key: "docs.openfairy.test", url: "https://docs.openfairy.test/research/memory-store" }],
          warnings: ["single_source_family"]
        },
        provenance: "tool:research.sources",
        sid,
        ts: "2026-07-02T10:00:00.009Z",
        turn: 3,
        type: "sourceset.reviewed",
        v: 1
      },
      {
        actor: "tool",
        id: "evt_01J00000000000000000000011",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: {
          args: { url: "https://example.test/?token=[REDACTED:api_key:sha256:abc123]" },
          args_redacted: true,
          call_id: "call_egress",
          tool: "web.fetch"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.010Z",
        turn: 4,
        type: "tool.call",
        v: 1
      },
      {
        actor: "tool",
        id: "evt_01J00000000000000000000012",
        labels: { residency: "global-ok", sensitivity: "internal" },
        payload: {
          call_id: "call_egress",
          denied_by_policy: true,
          egress: {
            fingerprints: ["sha256:abc123"],
            label_class: "secret",
            reason_code: "api_key"
          },
          error: { class: "PolicyError", message: "egress denied: outbound tool arguments were blocked" },
          labels: { residency: "global-ok", sensitivity: "internal" },
          provenance: "tool:web.fetch",
          reason_code: "egress_denied",
          status: "error"
        },
        provenance: "agent",
        sid,
        ts: "2026-07-02T10:00:00.011Z",
        turn: 4,
        type: "tool.result",
        v: 1
      }
    ];
    await writeFile(join(sessionDir, "log.jsonl"), events.map((event) => JSON.stringify(event)).join("\n"), "utf8");

    const result = await readReplayLog({ dataDir, sid });
    const rendered = renderReplay(result, { json: false, manifests: false });
    const json = renderReplay(result, { json: true, manifests: false });

    expect(rendered).toContain("memory.gate.decision phase=admission deny mem_secret secret_denied");
    expect(rendered).toContain("memory.gate.decision phase=retrieval deny mem_private label_clearance_denied");
    expect(rendered).toContain("route.denied main secret/local-only");
    expect(rendered).toContain("memory.written mem_safe semantic");
    expect(rendered).toContain("memory.deleted mem_safe user_deleted");
    expect(rendered).toContain("snapshot.created snap_abc");
    expect(rendered).toContain("citation.recorded snap_abc official Fairy memory is rebuildable.");
    expect(rendered).toContain("sourceset.reviewed needs_more_sources sources=1 warnings=single_source_family");
    expect(rendered).toContain("tool.result call_egress error tool:web.fetch egress.denied api_key");
    expect(rendered).not.toContain("sk_test_1234567890abcdef");
    expect(json).toContain("\"type\":\"route.denied\"");
    expect(json).toContain("\"type\":\"snapshot.created\"");
    expect(json).toContain("\"type\":\"citation.recorded\"");
    expect(json).toContain("\"type\":\"sourceset.reviewed\"");
    expect(json).toContain("\"reason_code\":\"egress_denied\"");
    expect(json).toContain("\"decision\":\"deny\"");
    expect(json).toContain("\"required_clearance\"");
    expect(json).toContain("\"memory_id\":\"mem_safe\"");

    const jsonEvents = json.split("\n").map((line) => JSON.parse(line) as { payload?: unknown; type: string });
    expect(JSON.stringify(jsonEvents.find((event) => event.type === "turn.input")?.payload)).toContain("sk_test_1234567890abcdef");
    const diagnosticEvents = jsonEvents.filter((event) => ["error", "progress.update", "tool.call", "tool.result"].includes(event.type));
    expect(JSON.stringify(diagnosticEvents)).not.toContain("sk_test_1234567890abcdef");
  });
});
