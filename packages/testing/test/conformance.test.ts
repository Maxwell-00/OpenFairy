import { describe, expect, it } from "vitest";

import { classifyLiveToolCallShape, runMockConformance } from "../src/conformance.js";

describe("conformance kit v1", () => {
  it("passes the mock OpenAI-compatible provider suite", async () => {
    const verdict = await runMockConformance();

    expect(verdict.ok, JSON.stringify(verdict.cases.filter((testCase) => !testCase.ok), null, 2)).toBe(true);
    expect(verdict.cases.map((testCase) => testCase.name)).toEqual(expect.arrayContaining([
      "streaming text deltas",
      "tool deltas fragmented args",
      "tool deltas malformed JSON",
      "reasoning field and think tags",
      "usage missing estimated",
      "function-name charset rejection",
      "wire-name codec round-trip"
    ]));
  });

  it("does not report live tool capability as pass when only done is observed", () => {
    const verdict = classifyLiveToolCallShape([
      { text: "done", type: "text" },
      { finish_reason: "stop", type: "done", usage: { estimated: true, input_tokens: 1, output_tokens: 1 } }
    ]);

    expect(verdict).toMatchObject({
      ok: true,
      reason: "model_did_not_call_tool",
      status: "degraded"
    });
  });
});
