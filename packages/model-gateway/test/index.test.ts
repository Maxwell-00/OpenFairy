import { afterEach, describe, expect, it } from "vitest";

import { createModelGateway, estimateTextTokens, ProviderError, type NormalizedModelEvent } from "../src/index.js";
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
  it("estimates English, Chinese, and mixed text with CJK-aware weighting", () => {
    const english = "This is a simple English sentence with about forty characters.";
    const chinese = "\u8fd9\u662f\u4e00\u4e2a\u7528\u4e8e\u4f30\u7b97\u4e2d\u6587\u4e0a\u4e0b\u6587\u957f\u5ea6\u7684\u53e5\u5b50\uff0c\u5e94\u8be5\u6bd4\u82f1\u6587\u6309\u5b57\u7b26\u56db\u5206\u4e4b\u4e00\u66f4\u91cd\u3002";
    const mixed = `${english} ${chinese}`;

    expect(estimateTextTokens(chinese)).toBeGreaterThan(estimateTextTokens(english) * 0.6);
    expect(estimateTextTokens(mixed)).toBeGreaterThan(estimateTextTokens(english));
    expect(estimateTextTokens(chinese)).toBeGreaterThan(Math.ceil(chinese.length / 4));
  });

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

  it("normalizes whole native tool calls", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      toolCalls: [{ id: "call_read", name: "fs.read", args: { path: "README.md" } }]
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { type: "object" } }]
    }));

    expect(events).toEqual([
      { args: { path: "README.md" }, call_id: "call_read", name: "fs.read", type: "tool_call" },
      { type: "usage", usage: { estimated: false, input_tokens: 4, output_tokens: 0 } }
    ]);
  });

  it("reassembles fragmented tool-call arguments", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      toolCalls: [{ fragments: ['{"path"', ':"README.md"}'], id: "call_frag", name: "fs.read" }]
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { type: "object" } }]
    }));

    expect(events.find((event) => event.type === "tool_call")).toMatchObject({
      args: { path: "README.md" },
      call_id: "call_frag",
      name: "fs.read"
    });
  });

  it("waits when a provider sends the tool name before argument fragments", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      toolCalls: [{ fragments: ["", '{"path":"README.md"}'], id: "call_name_first", name: "fs.read" }]
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { type: "object" } }]
    }));

    expect(events.filter((event) => event.type === "tool_call")).toEqual([
      { args: { path: "README.md" }, call_id: "call_name_first", name: "fs.read", type: "tool_call" }
    ]);
  });

  it("preserves parallel tool-call order", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      toolCalls: [
        { id: "call_a", name: "fs.read", args: { path: "a.txt" } },
        { id: "call_b", name: "fs.read", args: { path: "b.txt" } }
      ]
    });
    const gateway = createModelGateway(configFor(mock.url));

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { type: "object" } }]
    }));

    expect(events.filter((event) => event.type === "tool_call").map((event) => event.call_id)).toEqual(["call_a", "call_b"]);
  });

  it("surfaces malformed tool-call JSON as a provider error", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      toolCalls: [{ id: "call_bad", malformedArguments: "{\"path\":", name: "fs.read" }]
    });
    const gateway = createModelGateway(configFor(mock.url));

    await expect(collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { type: "object" } }]
    }))).rejects.toBeInstanceOf(ProviderError);
  });
});
