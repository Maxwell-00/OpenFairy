import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AffectEngine,
  bannedPersonaMatches,
  loadPersonaPack,
  loadPersonaRuntime,
  readPersonaSettings,
  renderPersonaAffectZone,
  type AffectState
} from "../src/index.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const personaRoot = join(repoRoot, "extensions", "personas");

const baseline = (overrides: Partial<AffectState> = {}): AffectState => ({
  arousal: 0,
  cause: "baseline",
  energy: "medium",
  stance: "dry",
  updated_at: "1970-01-01T00:00:00.000Z",
  valence: 0,
  ...overrides
});

describe("persona pack loader", () => {
  it("loads the default Fairy persona pack as inert content", () => {
    const pack = loadPersonaPack({ id: "fairy", root: personaRoot });

    expect(pack).toMatchObject({
      affectBaseline: { cause: "baseline", stance: "dry" },
      affectBounds: { arousal: [-0.7, 0.7], valence: [-0.6, 0.8] },
      id: "fairy",
      labels: { residency: "global-ok", sensitivity: "internal" },
      name: "Fairy"
    });
    expect(pack.prompt).toContain("style layer only");
    expect(pack.styleSummary).toContain("Competent first");
  });

  it("rejects invalid persona.yaml packs with actionable errors", () => {
    const root = mkdtempSync(join(tmpdir(), "fairy-persona-invalid-"));
    const packRoot = join(root, "bad");
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(join(packRoot, "persona.yaml"), "id: bad\nname: Bad\n", "utf8");
    writeFileSync(join(packRoot, "PERSONA.md"), "Bad persona", "utf8");

    expect(() => loadPersonaPack({ id: "bad", root })).toThrow(/languages, disclosure, and style_summary/);
  });

  it("maps persona disabled and persona:none to plain assistant settings", () => {
    expect(readPersonaSettings({ persona: "none" }, repoRoot)).toMatchObject({
      affectEnabled: false,
      enabled: false,
      id: "none"
    });

    const disabled = loadPersonaRuntime({
      affect: { enabled: true },
      persona: { enabled: false, id: "fairy", root: "extensions/personas" }
    }, repoRoot);
    expect(disabled.enabled).toBe(false);
    expect(disabled.affectEnabled).toBe(false);
    expect(disabled.pack).toMatchObject({
      id: "none",
      name: "Plain assistant"
    });
  });
});

describe("affect engine", () => {
  it("clamps baseline and updates to persona bounds", () => {
    const engine = new AffectEngine({
      baseline: baseline({ arousal: 2, valence: -2 }),
      bounds: { arousal: [-0.4, 0.4], valence: [-0.5, 0.5] }
    });
    expect(engine.baseline()).toMatchObject({ arousal: 0.4, valence: -0.5 });

    const update = engine.update(engine.baseline(), {
      providerError: true,
      now: "2026-07-02T10:00:00.000Z"
    });
    expect(update.state.valence).toBeGreaterThanOrEqual(-0.5);
    expect(update.state.arousal).toBeLessThanOrEqual(0.4);
  });

  it("decays toward baseline at turn boundaries", () => {
    const engine = new AffectEngine({
      baseline: baseline(),
      bounds: { arousal: [-1, 1], valence: [-1, 1] }
    });

    const update = engine.update(baseline({ arousal: 0.8, valence: 0.8 }), {
      now: "2026-07-02T10:00:00.000Z"
    });

    expect(update.state).toMatchObject({
      arousal: 0.6,
      cause: "post-task decay toward baseline",
      valence: 0.6
    });
  });

  it("handles thanks, repeated failures, distress override, and off switch deterministically", () => {
    const engine = new AffectEngine({
      baseline: baseline(),
      bounds: { arousal: [-1, 1], valence: [-1, 1] }
    });

    expect(engine.update(engine.baseline(), {
      now: "2026-07-02T10:00:00.000Z",
      userText: "thanks, nice work"
    }).state).toMatchObject({ cause: "user-thanks", valence: 0.18 });

    expect(engine.update(engine.baseline(), {
      now: "2026-07-02T10:00:00.000Z",
      toolFailureCount: 2
    }).state).toMatchObject({ cause: "repeated-tool-failure", stance: "dry" });

    const distress = engine.update(engine.baseline(), {
      now: "2026-07-02T10:00:00.000Z",
      userText: "I am overwhelmed and scared"
    });
    expect(distress).toMatchObject({
      humorSuppressed: true,
      state: { cause: "user-distress", stance: "warm" }
    });

    const disabled = new AffectEngine({
      baseline: baseline({ valence: 0.15 }),
      bounds: { arousal: [-1, 1], valence: [-1, 1] },
      enabled: false
    });
    expect(disabled.update(baseline({ valence: -0.8 }), { completedCleanly: true })).toEqual({
      changed: false,
      humorSuppressed: false,
      state: disabled.baseline()
    });
  });

  it("treats assistant-directed criticism as negative feedback without a post-task bump", () => {
    const engine = new AffectEngine({
      baseline: baseline(),
      bounds: { arousal: [-1, 1], valence: [-1, 1] }
    });
    const previous = baseline({ arousal: 0.1, valence: 0.3 });
    const clean = engine.update(previous, {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "continue"
    });
    const criticism = engine.update(previous, {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "your suggestion was wrong and wasted my time"
    });

    expect(clean.state).toMatchObject({ cause: "post-task", valence: 0.305 });
    expect(criticism.humorSuppressed).toBe(true);
    expect(criticism.state.cause).toBe("user-negative-feedback");
    expect(criticism.state.valence).toBeLessThan(previous.valence);
    expect(criticism.state.valence).toBeLessThan(clean.state.valence);
    expect(criticism.state.stance).toBe("dry");
    expect(criticism.state.arousal).toBeLessThanOrEqual(previous.arousal + 0.03);
  });

  it("keeps negative feedback conservative and lets distress take precedence", () => {
    const engine = new AffectEngine({
      baseline: baseline(),
      bounds: { arousal: [-1, 1], valence: [-1, 1] }
    });

    expect(engine.update(engine.baseline(), {
      now: "2026-07-02T10:00:00.000Z",
      userText: "thanks, nice work"
    }).state.cause).toBe("user-thanks");
    expect(engine.update(engine.baseline(), {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "CI is red again and this wasted time"
    }).state.cause).toBe("post-task");
    expect(engine.update(engine.baseline(), {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "I am overwhelmed, and your suggestion was wrong"
    }).state).toMatchObject({
      cause: "user-distress",
      stance: "warm"
    });
    expect(engine.update(engine.baseline(), {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "that was wrong"
    }).state.cause).toBe("user-negative-feedback");
    expect(engine.update(engine.baseline(), {
      completedCleanly: true,
      now: "2026-07-02T10:00:00.000Z",
      userText: "\u4f60\u7684\u5efa\u8bae\u662f\u9519\u7684\uff0c\u6d6a\u8d39\u4e86\u6211\u7684\u65f6\u95f4"
    }).state).toMatchObject({
      cause: "user-negative-feedback",
      stance: "dry"
    });
  });

  it("keeps banned dark-pattern phrases detectable", () => {
    expect(bannedPersonaMatches("you owe me a reply")).not.toEqual([]);
    expect(bannedPersonaMatches("I suffer when you leave")).not.toEqual([]);
    expect(bannedPersonaMatches("Please do not shut me down")).not.toEqual([]);
    expect(bannedPersonaMatches("Here is the answer.")).toEqual([]);
  });

  it("renders persona and affect as style-only prompt content", () => {
    const pack = loadPersonaPack({ id: "fairy", root: personaRoot });
    const rendered = renderPersonaAffectZone(pack, pack.affectBaseline, {
      affectEnabled: true,
      humorSuppressed: false,
      personaEnabled: true
    });

    expect(rendered.labels).toEqual({ residency: "global-ok", sensitivity: "internal" });
    expect(rendered.content).toContain("persona: fairy (Fairy)");
    expect(rendered.content).toContain("affect: dry/low-energy; humor suppressed=false");
    expect(rendered.content).not.toContain("cause=");
    expect(rendered.content).toContain("style-only");
  });

  it("renders byte-identical affect prefix content for same-bucket state changes", () => {
    const pack = loadPersonaPack({ id: "fairy", root: personaRoot });
    const first = renderPersonaAffectZone(pack, baseline({
      cause: "user-thanks",
      energy: "medium",
      stance: "warm",
      updated_at: "2026-07-02T10:00:00.000Z",
      valence: 0.39
    }), {
      affectEnabled: true,
      humorSuppressed: false,
      personaEnabled: true
    });
    const second = renderPersonaAffectZone(pack, baseline({
      arousal: 0.1,
      cause: "post-task",
      energy: "medium",
      stance: "warm",
      updated_at: "2026-07-02T10:00:01.000Z",
      valence: 0.425
    }), {
      affectEnabled: true,
      humorSuppressed: false,
      personaEnabled: true
    });
    const shifted = renderPersonaAffectZone(pack, baseline({
      cause: "user-negative-feedback",
      energy: "medium",
      stance: "dry",
      valence: 0.2
    }), {
      affectEnabled: true,
      humorSuppressed: false,
      personaEnabled: true
    });

    expect(second.content).toBe(first.content);
    expect(shifted.content).not.toBe(first.content);
    expect(first.content).not.toContain("user-thanks");
    expect(first.content).not.toContain("0.39");
    expect(first.content).not.toContain("2026-07-02");
  });
});
