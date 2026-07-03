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
});
