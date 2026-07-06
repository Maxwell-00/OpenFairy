import { afterEach, describe, expect, it } from "vitest";

import { EgressGuard, escalateLabelsForContent, redactText } from "@fairy/kernel";
import { createModelGateway, deriveLabels, type NormalizedModelEvent } from "@fairy/model-gateway";
import { MockOpenAIChatServer } from "../src/index.js";

let providers: MockOpenAIChatServer[] = [];

afterEach(async () => {
  await Promise.all(providers.map((provider) => provider.stop()));
  providers = [];
});

const startProvider = async (script: Parameters<typeof MockOpenAIChatServer.start>[0]): Promise<MockOpenAIChatServer> => {
  const provider = await MockOpenAIChatServer.start(script);
  providers.push(provider);
  return provider;
};

const collect = async (events: AsyncIterable<NormalizedModelEvent>): Promise<NormalizedModelEvent[]> => {
  const out: NormalizedModelEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

describe("label.conformance", () => {
  it("enforces derivation laws without hint-based gating or automatic downgrade", () => {
    expect(deriveLabels([
      { labels: { residency: "global-ok", sensitivity: "internal" } },
      { labels: { residency: "local-only", sensitivity: "personal" } },
      { labels: { residency: "region-restricted", sensitivity: "public" } }
    ])).toEqual({ residency: "local-only", sensitivity: "personal" });

    expect(deriveLabels([
      { labels: { residency: "local-only", sensitivity: "secret" } },
      { labels: { residency: "global-ok", sensitivity: "public" } }
    ])).toEqual({ residency: "local-only", sensitivity: "secret" });
  });

  it("covers semantic escalation and near-miss non-escalation", () => {
    expect(escalateLabelsForContent("API_KEY=sk_test_1234567890abcdef", { residency: "global-ok", sensitivity: "internal" }).labels)
      .toEqual({ residency: "local-only", sensitivity: "secret" });
    expect(escalateLabelsForContent("my diagnosis changed after a doctor visit", { residency: "global-ok", sensitivity: "internal" }).labels)
      .toEqual({ residency: "local-only", sensitivity: "personal" });
    expect(escalateLabelsForContent("tax return and bank account review", { residency: "global-ok", sensitivity: "internal" }).labels)
      .toEqual({ residency: "local-only", sensitivity: "personal" });
    expect(escalateLabelsForContent("lawsuit notes from my attorney", { residency: "global-ok", sensitivity: "internal" }).labels)
      .toEqual({ residency: "local-only", sensitivity: "personal" });
    expect(escalateLabelsForContent("port 8787, invoice 123456, date 2026-07-06", { residency: "global-ok", sensitivity: "internal" }).labels)
      .toEqual({ residency: "global-ok", sensitivity: "internal" });
  });

  it("keeps secret and personal labels away from non-cleared model providers", async () => {
    const primary = await startProvider({ text: ["should not be called"] });
    const gateway = createModelGateway({
      governance: { home_regions: ["cn"], profile: "balanced" },
      gateway: { watchdog_s: 2 },
      models: [{
        base_url: primary.url,
        data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
        id: "cloud",
        model: "mock-model",
        transport: "openai-chat"
      }],
      roles: { main: { model: "cloud" } }
    });

    const events = await collect(gateway.generate("main", {
      labels: { residency: "local-only", sensitivity: "secret" },
      messages: [{ content: "API_KEY=sk_test_1234567890abcdef", labels: { residency: "local-only", sensitivity: "secret" }, role: "user" }]
    }));

    expect(primary.requests).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "route_denied" });
  });

  it("blocks seeded secret content from outbound tool arguments and redacts diagnostics", () => {
    const guard = new EgressGuard();
    const decision = guard.evaluate(
      "web.fetch",
      { url: "https://example.test/?token=sk_test_1234567890abcdef" },
      { currentLabels: { residency: "global-ok", sensitivity: "internal" }, sensitiveContext: [] }
    );

    expect(decision).toMatchObject({ ok: false, labelClass: "secret", reasonCode: "api_key" });
    expect(JSON.stringify(decision)).not.toContain("sk_test_1234567890abcdef");
    expect(redactText("token=sk_test_1234567890abcdef")).toContain("[REDACTED:api_key:");
  });
});

describe("governance.friction-canary", () => {
  it("emits a deterministic parseable report for route-denied recovery", async () => {
    const primary = await startProvider({ text: ["should not be called"] });
    const fallback = await startProvider({
      text: ["local recovery complete"],
      usage: { completion_tokens: 3, prompt_tokens: 4, total_tokens: 7 }
    });
    const gateway = createModelGateway({
      governance: { home_regions: ["cn"], profile: "balanced" },
      gateway: { watchdog_s: 2 },
      models: [
        {
          base_url: primary.url,
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "cloud",
          model: "mock-model",
          transport: "openai-chat"
        },
        {
          base_url: fallback.url,
          data_clearance: { max_sensitivity: "secret", residency: ["local-only", "global-ok"] },
          id: "local",
          model: "mock-model",
          transport: "openai-chat"
        }
      ],
      roles: { main: { fallback: ["local"], model: "cloud" } }
    });

    const events = await collect(gateway.generate("main", {
      labels: { residency: "local-only", sensitivity: "secret" },
      messages: [{ content: "sensitive local-only request", labels: { residency: "local-only", sensitivity: "secret" }, role: "user" }]
    }));
    const report = {
      dead_end_denials: events.filter((event) => event.type === "route_denied").length,
      governance_interruptions: events.filter((event) => event.type === "progress" && event.payload.stage === "route-denied").length,
      route_denied_recovery: events.some((event) => event.type === "done") ? "success" : "failure"
    };

    expect(primary.requests).toBe(0);
    expect(fallback.requests).toBe(1);
    expect(report).toEqual({
      dead_end_denials: 0,
      governance_interruptions: 1,
      route_denied_recovery: "success"
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
