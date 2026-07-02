import { afterEach, describe, expect, it } from "vitest";

import { createModelGateway, ProviderError, type NormalizedModelEvent } from "../src/index.js";
import { MockOpenAIChatServer } from "@fairy/testing";

let server: MockOpenAIChatServer | undefined;

const startServer = async (): Promise<MockOpenAIChatServer> => {
  server = await MockOpenAIChatServer.start();
  return server;
};

const configFor = (baseUrl: string, watchdogS = 1): Record<string, unknown> => ({
  gateway: { watchdog_s: watchdogS },
  models: [
    {
      base_url: baseUrl,
      data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
      id: "mock-main",
      model: "mock-model",
      transport: "openai-chat"
    }
  ],
  roles: { main: { model: "mock-main" } }
});

const collect = async (iterable: AsyncIterable<NormalizedModelEvent>): Promise<NormalizedModelEvent[]> => {
  const events: NormalizedModelEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
};

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("@fairy/model-gateway", () => {
  it("streams OpenAI-compatible text deltas and usage", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      text: ["Hel", "lo"],
      usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 }
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      labels: { residency: "global-ok", sensitivity: "internal" },
      messages: [{ content: "ping", role: "user" }]
    }));

    expect(events.filter((event) => event.type === "text").map((event) => event.text).join("")).toBe("Hello");
    expect(events.at(-1)).toMatchObject({
      finish_reason: "stop",
      type: "done",
      usage: { estimated: false, input_tokens: 3, output_tokens: 2 }
    });
  });

  it("normalizes reasoning_content and think tags into reasoning events", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      reasoning: ["provider-plan"],
      text: ["Visible <think>tag-plan</think> answer"]
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "ping", role: "user" }]
    }));

    expect(events.filter((event) => event.type === "reasoning").map((event) => event.text)).toEqual([
      "provider-plan",
      "tag-plan"
    ]);
    expect(events.filter((event) => event.type === "text").map((event) => event.text).join("")).toBe("Visible  answer");
  });

  it("retries a retryable 429 once and then succeeds", async () => {
    const mock = await startServer();
    mock.enqueueScript({ failStatusOnce: 429, text: ["ok"] });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "retry", role: "user" }]
    }));

    expect(mock.requests).toBe(2);
    expect(events.filter((event) => event.type === "text").map((event) => event.text).join("")).toBe("ok");
  });

  it("aborts a stalled stream with a ProviderError", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      stallAfterChunks: 1,
      stallMs: 200,
      text: ["first", "second"]
    });
    const gateway = createModelGateway(configFor(mock.url, 0.01));

    await expect(collect(gateway.generate("main", {
      messages: [{ content: "stall", role: "user" }]
    }))).rejects.toBeInstanceOf(ProviderError);
  });
});
