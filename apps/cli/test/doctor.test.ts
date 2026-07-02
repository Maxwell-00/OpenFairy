import { describe, expect, it } from "vitest";

import { isNodeVersionOk, runDoctor } from "../src/index.js";

describe("fairy doctor", () => {
  it("checks Node major version", () => {
    expect(isNodeVersionOk("22.0.0")).toBe(true);
    expect(isNodeVersionOk("21.9.0")).toBe(false);
  });

  it("prints a plain-text report", () => {
    return runDoctor(process.cwd()).then((report) => {
      expect(report.lines[0]).toBe("Fairy doctor");
      expect(report.lines.some((line) => line.startsWith("Node:"))).toBe(true);
      expect(report.lines.some((line) => line.startsWith("Config:"))).toBe(true);
      expect(report.lines.some((line) => line.startsWith("Container runtime:"))).toBe(true);
      expect(report.lines.some((line) => line.startsWith("Gateway:"))).toBe(true);
    });
  });
});
