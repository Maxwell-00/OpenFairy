import { describe, expect, it } from "vitest";

import { protocolConformanceSuite } from "../src/index.js";

describe("@fairy/testing", () => {
  it("exposes the M0 protocol conformance manifest", () => {
    expect(protocolConformanceSuite.package).toBe("@fairy/testing");
    expect(protocolConformanceSuite.eventTypes).toHaveLength(44);
  });
});
