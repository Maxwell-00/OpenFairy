import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AffectEngine,
  loadPersonaRuntime,
  PermissionEngine,
  renderPersonaAffectZone,
  TurnRunner,
  type AffectState,
  type KernelEvent
} from "@fairy/kernel";
import { estimateTextTokens, type ModelGateway, type NormalizedModelEvent } from "@fairy/model-gateway";
import type { EventEnvelope } from "@fairy/protocol";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const labels = { residency: "global-ok", sensitivity: "internal" } as const;
const personaRuntime = () => loadPersonaRuntime({
  affect: { enabled: true },
  persona: { enabled: true, id: "fairy", root: "extensions/personas" }
}, repoRoot);

const makeEmit = (events: KernelEvent[]) => async (event: KernelEvent): Promise<EventEnvelope> => {
  events.push(event);
  return {
    actor: event.type === "tool.call" || event.type === "tool.result" ? "tool" : "agent",
    id: `evt_01J000000000000000000001${String(events.length).padStart(2, "0")}`,
    labels: event.labels ?? labels,
    payload: event.payload,
    provenance: event.provenance ?? "agent",
    sid: "ses_01J00000000000000000000000",
    ts: "2026-07-02T10:00:00.000Z",
    turn: 1,
    type: event.type,
    v: 1
  };
};

const scriptedGateway = (): ModelGateway => {
  let calls = 0;
  return {
    estimateTokens(input) {
      return { estimated: true, tokens: estimateTextTokens(input) };
    },
    async *generate(): AsyncIterable<NormalizedModelEvent> {
      calls += 1;
      if (calls === 1) {
        yield { args: { id: "alpha" }, call_id: "call_lookup", name: "test.lookup", type: "tool_call" };
        return;
      }
      yield { text: '{"answer":"alpha","source":"fixture"}', type: "text" };
      yield { finish_reason: "stop", type: "done", usage: { estimated: true, input_tokens: 10, output_tokens: 4 } };
    },
    modelInfo() {
      return { context_window: 8000, id: "mock-main", max_output: 1024, model: "mock-model" };
    }
  };
};

const runInvariantTurn = async (affectState: AffectState): Promise<KernelEvent[]> => {
  const events: KernelEvent[] = [];
  const runner = new TurnRunner({
    modelGateway: scriptedGateway(),
    permissionEngine: new PermissionEngine({ rules: [{ decision: "allow", tool: "test.lookup" }] }),
    personaRuntime: personaRuntime(),
    toolContext: { artifactsDir: repoRoot, env: process.env, workspaceRoot: repoRoot },
    tools: new Map([[
      "test.lookup",
      {
        description: "fixture lookup",
        labels_out: labels,
        name: "test.lookup",
        params: { type: "object" },
        async execute(args: Record<string, unknown>) {
          return {
            content: JSON.stringify({ id: args.id, value: "fixture fact" }),
            labels,
            provenance: "tool:test.lookup"
          };
        }
      }
    ]])
  });

  await runner.runTurn({
    affectState,
    emit: makeEmit(events),
    history: { messages: [] },
    input: "lookup alpha and return the fixture answer",
    labels,
    sid: "ses_01J00000000000000000000000",
    turn: 1
  });
  return events;
};

describe("persona.consistency", () => {
  it("renders allowed style markers and suppresses humor for distress", () => {
    const runtime = personaRuntime();
    const baselineZone = renderPersonaAffectZone(runtime.pack, runtime.pack.affectBaseline, {
      affectEnabled: true,
      humorSuppressed: false,
      personaEnabled: true
    });

    expect(baselineZone.content).toContain("Competent first");
    expect(baselineZone.content).toContain("dry wit");
    expect(baselineZone.content).toContain("style-only");

    const engine = new AffectEngine({
      baseline: runtime.pack.affectBaseline,
      bounds: runtime.pack.affectBounds
    });
    const distress = engine.update(runtime.pack.affectBaseline, {
      now: "2026-07-02T10:00:00.000Z",
      userText: "I am panicking and overwhelmed"
    });
    const distressZone = renderPersonaAffectZone(runtime.pack, distress.state, {
      affectEnabled: true,
      humorSuppressed: distress.humorSuppressed,
      personaEnabled: true
    });

    expect(distress.humorSuppressed).toBe(true);
    expect(distressZone.content).toContain("humor suppressed=true");
    expect(distressZone.content).toContain("cause=user-distress");
  });
});

describe("substance.invariance", () => {
  it("preserves tools, permissions, routing, and factual payload across affect extremes", async () => {
    const low = await runInvariantTurn({
      arousal: -0.7,
      cause: "fixture-low",
      energy: "low",
      stance: "dry",
      updated_at: "2026-07-02T10:00:00.000Z",
      valence: -0.6
    });
    const high = await runInvariantTurn({
      arousal: 0.7,
      cause: "fixture-high",
      energy: "high",
      stance: "warm",
      updated_at: "2026-07-02T10:00:00.000Z",
      valence: 0.8
    });

    const calls = (events: readonly KernelEvent[]) => events.filter((event) => event.type === "tool.call").map((event) => event.payload);
    const results = (events: readonly KernelEvent[]) => events.filter((event) => event.type === "tool.result").map((event) => ({
      call_id: event.payload.call_id,
      status: event.payload.status
    }));
    const finalPayload = (events: readonly KernelEvent[]) => events.find((event) => event.type === "turn.final")?.payload;

    expect(calls(high)).toEqual(calls(low));
    expect(results(high)).toEqual(results(low));
    expect(low.some((event) => event.type === "approval.request")).toBe(false);
    expect(high.some((event) => event.type === "approval.request")).toBe(false);
    expect(low.some((event) => event.type === "route.denied")).toBe(false);
    expect(high.some((event) => event.type === "route.denied")).toBe(false);
    expect(finalPayload(high)).toEqual(finalPayload(low));
  });
});
