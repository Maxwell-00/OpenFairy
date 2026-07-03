import { describe, expect, it } from "vitest";

import { runMockConformance } from "../src/conformance.js";

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
});
