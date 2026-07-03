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
});
