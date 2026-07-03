import { describe, expect, it } from "vitest";

import { MemoryGate, proposeMemoryCandidate, type MemoryCandidate } from "../src/index.js";

const candidate = (overrides: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  category: "preference",
  labels: { residency: "global-ok", sensitivity: "internal" },
  reason: "explicit_user_remember",
  source: { sid: "ses_test", turn: 1 },
  text: "favorite editor is Helix",
  ...overrides
});

describe("@fairy/memory", () => {
  it("allows safe explicit memory by default", () => {
    const result = new MemoryGate().evaluate(candidate());

    expect(result).toMatchObject({
      decision: "allow",
      memory_id: expect.stringMatching(/^mem_[a-f0-9]{20}$/),
      reason: "explicit_remember"
    });
  });

  it("denies secret-labeled memory candidates", () => {
    const result = new MemoryGate().evaluate(candidate({
      category: "secret",
      labels: { residency: "local-only", sensitivity: "secret" },
      text: "API_KEY=sk_test_1234567890abcdef"
    }));

    expect(result).toMatchObject({
      decision: "deny",
      reason: "secret_denied"
    });
  });

  it("holds personal memory by default", () => {
    const result = new MemoryGate().evaluate(candidate({
      labels: { residency: "global-ok", sensitivity: "personal" },
      text: "my birthday is Jan 1"
    }));

    expect(result).toMatchObject({
      decision: "hold",
      reason: "personal_default_hold"
    });
  });

  it("extracts explicit remember instructions", () => {
    expect(proposeMemoryCandidate({
      labels: { residency: "global-ok", sensitivity: "internal" },
      sid: "ses_test",
      text: "please remember favorite shell is pwsh",
      turn: 2
    })).toMatchObject({
      category: "preference",
      reason: "explicit_user_remember",
      text: "favorite shell is pwsh"
    });

    expect(proposeMemoryCandidate({
      labels: { residency: "global-ok", sensitivity: "internal" },
      sid: "ses_test",
      text: "\u8bf7\u8bb0\u4f4f\u6211\u559c\u6b22\u7ea2\u8272",
      turn: 3
    })).toMatchObject({
      text: "\u6211\u559c\u6b22\u7ea2\u8272"
    });
  });
});
