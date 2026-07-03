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
        payload: { decision: "deny", memory_id: "mem_secret", reason: "secret_denied" },
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
        payload: { decision: "allow", memory_id: "mem_safe", reason: "explicit_remember" },
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
      }
    ];
    await writeFile(join(sessionDir, "log.jsonl"), events.map((event) => JSON.stringify(event)).join("\n"), "utf8");

    const result = await readReplayLog({ dataDir, sid });
    const rendered = renderReplay(result, { json: false, manifests: false });
    const json = renderReplay(result, { json: true, manifests: false });

    expect(rendered).toContain("memory.gate.decision deny mem_secret secret_denied");
    expect(rendered).toContain("route.denied main secret/local-only");
    expect(rendered).toContain("memory.written mem_safe semantic");
    expect(json).toContain("\"type\":\"route.denied\"");
    expect(json).toContain("\"decision\":\"deny\"");
    expect(json).toContain("\"required_clearance\"");
    expect(json).toContain("\"memory_id\":\"mem_safe\"");
  });
});
