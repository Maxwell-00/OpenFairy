import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEventId,
  eventRegistry,
  eventTypes,
  fixturesDir,
  parseEvent,
  schemasDir,
  serializeEvent,
  validateEvent
} from "../src/index.js";

const readFixture = (name: string): string => readFileSync(join(fixturesDir, name), "utf8");
const parseFixture = (name: string): unknown => JSON.parse(readFixture(name));

describe("protocol registry", () => {
  it("registers every v1 type from the protocol spec", () => {
    expect(eventTypes).toEqual([
      "turn.input",
      "turn.delta",
      "turn.final",
      "turn.interrupted",
      "reasoning.delta",
      "tool.call",
      "tool.result",
      "approval.request",
      "approval.resolved",
      "progress.update",
      "plan.proposed",
      "plan.step.updated",
      "plan.deviation",
      "loop.iteration.started",
      "loop.iteration.completed",
      "loop.stopped",
      "workflow.checkpoint",
      "workflow.run.updated",
      "workflow.approval.parked",
      "memory.written",
      "memory.superseded",
      "memory.deleted",
      "memory.gate.decision",
      "citation.recorded",
      "snapshot.created",
      "sourceset.reviewed",
      "speech.asr.partial",
      "speech.asr.final",
      "speech.tts.chunk",
      "speech.mark",
      "affect.updated",
      "artifact.created",
      "label.declassified",
      "route.denied",
      "budget.updated",
      "audit.appended",
      "delivery.sent",
      "delivery.digested",
      "delivery.collapsed",
      "delivery.expired",
      "session.created",
      "session.compacted",
      "session.resumed",
      "error"
    ]);
  });

  it("keeps schema files in sync with the registry manifest", () => {
    const schemaFiles = readdirSync(schemasDir)
      .filter((file) => file.endsWith(".v1.json") && file !== "registry.v1.json")
      .sort();

    expect(schemaFiles).toEqual(eventRegistry.map((entry) => entry.schemaFile).sort());
  });
});

describe("fixture conformance", () => {
  it.each(eventRegistry.map((entry) => entry.type))("%s valid fixture parses and serializes byte-stable", (type) => {
    const fixtureName = `${type}.valid.json`;
    const raw = readFixture(fixtureName);
    const parsed = parseEvent(raw);

    expect(validateEvent(parsed)).toMatchObject({ ok: true, known: true });
    expect(serializeEvent(parsed)).toBe(raw);
  });

  it.each(eventRegistry.map((entry) => entry.type))("%s invalid fixture is rejected", (type) => {
    const result = validateEvent(parseFixture(`${type}.invalid.json`));

    expect(result.ok).toBe(false);
  });

  it("rejects outlawed local-preferred residency labels", () => {
    const result = validateEvent(parseFixture("turn.input.invalid.json"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes("residency"))).toBe(true);
    }
  });

  it.each(["delivery.sent", "delivery.digested", "delivery.collapsed", "delivery.expired"])(
    "%s requires storm_key for critical class",
    (type) => {
      const result = validateEvent(parseFixture(`${type}.invalid.json`));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.message.includes("storm_key"))).toBe(true);
      }
    }
  );
});

describe("reader tolerance", () => {
  it("ignores unknown top-level and payload fields", () => {
    const event = parseFixture("turn.delta.valid.json") as Record<string, unknown>;
    event.extra_top_level = "future";
    event.payload = { ...(event.payload as Record<string, unknown>), extra_payload_field: "future" };

    expect(validateEvent(event)).toMatchObject({ ok: true, known: true });
  });

  it("tolerates x.<vendor>.<name> extension event types", () => {
    expect(validateEvent(parseFixture("x.vendor.event.valid.json"))).toMatchObject({
      ok: true,
      known: false
    });
  });

  it("tolerates well-formed newer-minor unknown event types at envelope level", () => {
    const event = parseFixture("turn.delta.valid.json") as Record<string, unknown>;
    event.type = "future.event";

    expect(validateEvent(event)).toMatchObject({ ok: true, known: false });
  });
});

describe("envelope validation and ids", () => {
  it("requires envelope fields", () => {
    const event = parseFixture("turn.delta.valid.json") as Record<string, unknown>;
    delete event.id;

    const result = validateEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("required"))).toBe(true);
    }
  });

  it("creates monotonic event ids for the same timestamp", () => {
    const timestamp = Date.UTC(2026, 6, 2, 10, 0, 0);
    const ids = Array.from({ length: 20 }, () => createEventId(timestamp));

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
