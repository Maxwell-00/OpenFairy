import { describe, expect, it } from "vitest";

import { isNodeVersionOk, runDoctor } from "../src/index.js";

describe("fairy doctor", () => {
  it("checks Node major version", () => {
    expect(isNodeVersionOk("22.0.0")).toBe(true);
    expect(isNodeVersionOk("21.9.0")).toBe(false);
  });

  // Probes are bounded at 2 s each in doctor.ts, but CI runners can still be slow
  // on first process spawns — give the integration-ish test generous headroom.
  it("prints a plain-text report", { timeout: 20_000 }, () => {
    return runDoctor(process.cwd()).then((report) => {
      expect(report.lines[0]).toBe("Fairy doctor");
      expect(report.kind).toBe("fairy.doctor.report");
      expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
        "runtime.node",
        "config.load",
        "optional.container-runtime",
        "runtime.gateway-health"
      ]));
    });
  });
});
