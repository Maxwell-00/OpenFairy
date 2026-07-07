import { describe, expect, it } from "vitest";

import { assemblePrompt } from "../src/index.js";
import { estimateTextTokens, type ChatMessage, type ModelGateway } from "@fairy/model-gateway";

const gateway: ModelGateway = {
  estimateTokens(input) {
    return { estimated: true, tokens: estimateTextTokens(input) };
  },
  async *generate() {
    yield { finish_reason: "stop", type: "done", usage: { estimated: true, input_tokens: 1, output_tokens: 1 } };
  },
  modelInfo() {
    return { context_window: 600, id: "mock-main", max_output: 120, model: "mock-model" };
  }
};

const long = (label: string, count: number): string => Array.from({ length: count }, (_, index) => `${label}-${index}`).join(" ");

const historyFixture = (): ChatMessage[] => [
  { content: "old user one must survive verbatim", role: "user", turn: 1 },
  {
    content: JSON.stringify({
      artifacts: [{ ref: "artifact://tool-output-1.txt" }],
      call_id: "call_1",
      provenance: "tool:fs.read",
      result: { artifact_ref: "artifact://tool-output-1.txt", head: "aaa", tail: "zzz", truncated: true },
      status: "ok"
    }),
    role: "tool",
    tool_call_id: "call_1",
    turn: 1
  },
  { content: long("assistant-one", 180), role: "assistant", turn: 1 },
  { content: "old user two must survive verbatim", role: "user", turn: 2 },
  { content: long("assistant-two", 180), role: "assistant", turn: 2 },
  { content: "recent user must keep assistant body", role: "user", turn: 3 },
  { content: "recent assistant body stays pinned", role: "assistant", turn: 3 }
];

describe("context engine", () => {
  it("applies L1-L3 deterministically while preserving pinned user messages and append-only input history", () => {
    const history = historyFixture();
    const before = JSON.stringify(history);
    const first = assemblePrompt({
      config: { minRecentTurns: 1, outputReserve: 120, reduceAt: 0.45 },
      currentInput: "current input",
      history,
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      systemPrompt: "system",
      toolSafetyPrompt: "tool safety",
      tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
    });
    const second = assemblePrompt({
      config: { minRecentTurns: 1, outputReserve: 120, reduceAt: 0.45 },
      currentInput: "current input",
      history,
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      systemPrompt: "system",
      toolSafetyPrompt: "tool safety",
      tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
    });

    expect(first.manifest.reduction_stages_applied).toEqual(["L1", "L2", "L3"]);
    expect(second.manifest.prefix_hash).toBe(first.manifest.prefix_hash);
    expect(JSON.stringify(history)).toBe(before);
    const promptText = first.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("old user one must survive verbatim");
    expect(promptText).toContain("old user two must survive verbatim");
    expect(promptText).toContain("recent assistant body stays pinned");
    expect(promptText).toContain("[turn 1 elided:");
    expect(promptText).toContain("[turn 2 elided:");
    expect(promptText).not.toContain("context.manifest");
  });

  it("recomputes budget from the selected model window", () => {
    const small = assemblePrompt({
      config: { minRecentTurns: 4, reduceAt: 0.5 },
      currentInput: "hi",
      history: [],
      model: { context_window: 1000, id: "small", model: "small" },
      modelGateway: gateway,
      systemPrompt: "system",
      tools: []
    });
    const large = assemblePrompt({
      config: { minRecentTurns: 4, reduceAt: 0.5 },
      currentInput: "hi",
      history: [],
      model: { context_window: 2000, id: "large", model: "large" },
      modelGateway: gateway,
      systemPrompt: "system",
      tools: []
    });

    expect(small.manifest.budget).toBe(500);
    expect(large.manifest.budget).toBe(1000);
    expect(small.manifest.output_reserve).toBe(4096);
  });

  it("derives effective labels across all assembled prompt content", () => {
    const assembled = assemblePrompt({
      config: { minRecentTurns: 4, reduceAt: 0.8 },
      currentInput: "harmless follow-up",
      currentLabels: { residency: "global-ok", sensitivity: "internal" },
      history: [
        {
          content: "API_KEY=sk_test_1234567890abcdef",
          labels: { residency: "local-only", sensitivity: "secret" },
          role: "user",
          turn: 1
        }
      ],
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      systemPrompt: "system",
      tools: []
    });

    expect(assembled.effectiveLabels).toEqual({ residency: "local-only", sensitivity: "secret" });
    expect(assembled.manifest).toMatchObject({
      effective_labels: { residency: "local-only", sensitivity: "secret" }
    });
  });

  it("includes gate-admitted memory digest as a labeled memory zone", () => {
    const assembled = assemblePrompt({
      config: { minRecentTurns: 4, reduceAt: 0.8 },
      currentInput: "what shell do I prefer?",
      currentLabels: { residency: "global-ok", sensitivity: "internal" },
      history: [],
      memoryDigest: {
        content: "Memory digest:\n- mem_shell preference confidence=high: favorite shell is pwsh (source ses_x#1/evt_x)",
        labels: { residency: "local-only", sensitivity: "personal" }
      },
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      systemPrompt: "system",
      tools: []
    });

    expect(assembled.messages.map((message) => message.content).join("\n")).toContain("mem_shell");
    expect(assembled.messages.map((message) => message.content).join("\n")).not.toContain("context.manifest");
    expect(assembled.effectiveLabels).toEqual({ residency: "local-only", sensitivity: "personal" });
    expect(assembled.manifest.zones.find((zone) => zone.name === "memory")?.tokens).toBeGreaterThan(0);
  });

  it("includes persona and affect zone tokens without lowering effective labels", () => {
    const assembled = assemblePrompt({
      config: { minRecentTurns: 4, reduceAt: 0.8 },
      currentInput: "harmless follow-up",
      currentLabels: { residency: "local-only", sensitivity: "secret" },
      history: [],
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      personaZone: {
        content: [
          "persona: fairy (Fairy)",
          "style: dry and concise",
          "affect: dry/low-energy; humor suppressed=false"
        ].join("\n"),
        labels: { residency: "global-ok", sensitivity: "internal" }
      },
      systemPrompt: "system",
      tools: []
    });

    const promptText = assembled.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("persona: fairy (Fairy)");
    expect(promptText).not.toContain("context.manifest");
    expect(assembled.effectiveLabels).toEqual({ residency: "local-only", sensitivity: "secret" });
    expect(assembled.manifest.zones.find((zone) => zone.name === "persona")?.tokens).toBeGreaterThan(0);
  });

  it("keeps prefix stable for the same affect bucket and changes it for bucket shifts", () => {
    const common = {
      config: { minRecentTurns: 4, reduceAt: 0.8 },
      currentInput: "same task",
      history: [{ content: "same prior message", role: "user" as const }],
      model: gateway.modelInfo("main"),
      modelGateway: gateway,
      systemPrompt: "system",
      tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
    };
    const baselinePersona = [
      "persona: fairy (Fairy)",
      "style: dry and concise",
      "affect: warm/medium-energy; humor suppressed=false"
    ].join("\n");
    const sameBucketPersona = baselinePersona;
    const shiftedPersona = baselinePersona.replace("warm/medium-energy", "dry/medium-energy");
    const humorShiftedPersona = baselinePersona.replace("humor suppressed=false", "humor suppressed=true");
    const first = assemblePrompt({ ...common, personaZone: { content: baselinePersona } });
    const second = assemblePrompt({ ...common, personaZone: { content: sameBucketPersona } });
    const third = assemblePrompt({ ...common, personaZone: { content: shiftedPersona } });
    const fourth = assemblePrompt({ ...common, personaZone: { content: humorShiftedPersona } });

    expect(second.manifest.prefix_hash).toBe(first.manifest.prefix_hash);
    expect(third.manifest.prefix_hash).not.toBe(first.manifest.prefix_hash);
    expect(fourth.manifest.prefix_hash).not.toBe(first.manifest.prefix_hash);
    expect(third.messages[0]).toEqual(first.messages[0]);
    expect(third.messages.slice(2)).toEqual(first.messages.slice(2));
    expect(third.manifest.zones.find((zone) => zone.name === "tools")?.tokens).toBe(
      first.manifest.zones.find((zone) => zone.name === "tools")?.tokens
    );
    expect(third.messages[1]?.content).toContain("affect: dry/medium-energy");
    expect(fourth.messages[1]?.content).toContain("humor suppressed=true");
  });
});
