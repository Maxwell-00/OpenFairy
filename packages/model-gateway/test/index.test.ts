import { afterEach, describe, expect, it } from "vitest";

import { canRouteToModel, createModelGateway, estimateTextTokens, fromWireName, parseModelGatewayConfig, ProviderError, toWireName, type ModelConfig, type NormalizedModelEvent } from "../src/index.js";
import { MockOpenAIChatServer } from "../../testing/src/mock-openai.js";

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

const governanceModel = (data_clearance: ModelConfig["data_clearance"]): ModelConfig => ({
  base_url: "http://127.0.0.1:1",
  capabilities: { tools: "native" },
  context_window: 8000,
  data_clearance,
  id: "model",
  model: "mock-model",
  transport: "openai-chat"
});

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

  it("round-trips dotted internal tool names through OpenAI-safe wire names", () => {
    expect(toWireName("fs.read")).toBe("fs__read");
    expect(fromWireName("fs__read")).toBe("fs.read");
  });

  it("enforces sensitivity ordering in clearance checks", () => {
    const internalModel = governanceModel({ max_sensitivity: "internal", residency: ["global-ok"] });

    expect(canRouteToModel({ residency: "global-ok", sensitivity: "public" }, internalModel, { home_regions: [], profile: "balanced" }).ok).toBe(true);
    expect(canRouteToModel({ residency: "global-ok", sensitivity: "internal" }, internalModel, { home_regions: [], profile: "balanced" }).ok).toBe(true);
    expect(canRouteToModel({ residency: "global-ok", sensitivity: "personal" }, internalModel, { home_regions: [], profile: "balanced" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("exceeds")
    });
  });

  it("enforces residency clearance and resolves region-restricted through home regions", () => {
    const local = governanceModel({ max_sensitivity: "secret", residency: ["local-only"] });
    const cnRegion = governanceModel({ max_sensitivity: "secret", regions: ["cn"], residency: ["region-restricted"] });
    const usRegion = governanceModel({ max_sensitivity: "secret", regions: ["us"], residency: ["region-restricted"] });
    const global = governanceModel({ max_sensitivity: "secret", residency: ["global-ok"] });
    const governance = { home_regions: ["cn"], profile: "balanced" } as const;

    expect(canRouteToModel({ residency: "region-restricted", sensitivity: "internal" }, cnRegion, governance).ok).toBe(true);
    expect(canRouteToModel({ residency: "region-restricted", sensitivity: "internal" }, local, governance).ok).toBe(true);
    expect(canRouteToModel({ residency: "region-restricted", sensitivity: "internal" }, usRegion, governance)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("home_regions")
    });
    expect(canRouteToModel({ residency: "local-only", sensitivity: "internal" }, cnRegion, governance).ok).toBe(false);
    expect(canRouteToModel({ residency: "local-only", sensitivity: "internal" }, global, governance).ok).toBe(false);
  });

  it("treats routing_hints.prefer_local as advisory rather than gating", () => {
    const global = governanceModel({ max_sensitivity: "internal", residency: ["global-ok"] });
    const governance = { home_regions: [], profile: "balanced" } as const;

    expect(canRouteToModel(
      { residency: "global-ok", sensitivity: "internal" },
      global,
      governance,
      { prefer_local: true }
    ).ok).toBe(true);
    expect(canRouteToModel(
      { residency: "local-only", sensitivity: "internal" },
      global,
      governance,
      { prefer_local: false }
    ).ok).toBe(false);
  });

  it("rejects invalid governance and region-restricted provider config", () => {
    expect(() => parseModelGatewayConfig({
      governance: { profile: "fast" },
      gateway: { watchdog_s: 1 },
      models: [
        {
          base_url: "http://127.0.0.1:1",
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "mock-main",
          model: "mock-model",
          transport: "openai-chat"
        }
      ],
      roles: { main: { model: "mock-main" } }
    })).toThrow(/governance\.profile/);

    expect(() => parseModelGatewayConfig({
      gateway: { watchdog_s: 1 },
      models: [
        {
          base_url: "http://127.0.0.1:1",
          data_clearance: { max_sensitivity: "internal", residency: ["region-restricted"] },
          id: "mock-main",
          model: "mock-model",
          transport: "openai-chat"
        }
      ],
      roles: { main: { model: "mock-main" } }
    })).toThrow(/requires data_clearance\.regions/);
  });

  it("falls back after retry exhaustion and reports progress plus trace", async () => {
    const primary = await MockOpenAIChatServer.start({ failStatus: 500 });
    const fallback = await MockOpenAIChatServer.start({
      text: ["fallback ok"],
      usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 }
    });
    server = primary;
    try {
      const gateway = createModelGateway({
        gateway: { watchdog_s: 1 },
        models: [
          {
            base_url: primary.url,
            data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
            id: "primary",
            model: "mock-model",
            transport: "openai-chat"
          },
          {
            base_url: fallback.url,
            data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
            id: "fallback",
            model: "mock-model",
            transport: "openai-chat"
          }
        ],
        roles: { main: { fallback: ["fallback"], model: "primary" } }
      });

      const events = await collect(gateway.generate("main", {
        messages: [{ content: "fallback", role: "user" }]
      }));

      expect(primary.requests).toBe(3);
      expect(fallback.requests).toBe(1);
      expect(events.find((event) => event.type === "progress")).toMatchObject({
        payload: { from: "primary", reason: "retryable", stage: "model-fallback", to: "fallback" }
      });
      expect(events.at(-1)).toMatchObject({
        trace: {
          fallbacks: [{ from: "primary", reason: "retryable", to: "fallback" }],
          model_id: "fallback"
        },
        type: "done"
      });
    } finally {
      await fallback.stop();
    }
  });

  it("rejects tool-requiring main roles bound to tools=none models", async () => {
    const mock = await startServer();

    expect(() => createModelGateway({
      gateway: { watchdog_s: 1 },
      models: [
        {
          base_url: mock.url,
          capabilities: { tools: "none" },
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "no-tools",
          model: "mock-model",
          transport: "openai-chat"
        }
      ],
      roles: { main: { model: "no-tools" } }
    })).toThrow(/tools=none/);
  });

  it("parses prompted tool calls as normalized tool_call events", async () => {
    const mock = await startServer();
    mock.setDefaultScript({
      text: ["```tool_call\n{\"name\":\"fs.read\",\"arguments\":{\"path\":\"README.md\"}}\n```"]
    });
    const gateway = createModelGateway({
      ...configFor(mock.url),
      models: [
        {
          base_url: mock.url,
          capabilities: { tools: "prompted" },
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "mock-main",
          model: "mock-model",
          transport: "openai-chat"
        }
      ]
    });

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"], type: "object" } }]
    }));

    expect(events.find((event) => event.type === "tool_call")).toMatchObject({
      args: { path: "README.md" },
      name: "fs.read"
    });
  });

  it("repairs malformed prompted tool calls", async () => {
    const mock = await startServer();
    mock.enqueueScript({ text: ["```tool_call\n{'name':'fs.read','arguments':{}}\n```"] });
    mock.enqueueScript({ text: ["好的：```tool_call\n｛\"name\"：\"fs.read\"，\"arguments\"：｛\"path\"：\"README.md\"｝｝\n```"] });
    const gateway = createModelGateway({
      ...configFor(mock.url),
      models: [
        {
          base_url: mock.url,
          capabilities: { tools: "prompted" },
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "mock-main",
          model: "mock-model",
          transport: "openai-chat"
        }
      ]
    });

    const events = await collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"], type: "object" } }]
    }));

    expect(mock.requests).toBe(2);
    expect(events.find((event) => event.type === "tool_call")).toMatchObject({
      args: { path: "README.md" },
      name: "fs.read"
    });
    expect(JSON.stringify(mock.requestBodies.at(-1))).toContain("Validation error");
  });

  it("surfaces prompted tool repair exhaustion", async () => {
    const mock = await startServer();
    mock.setDefaultScript({ text: ["```tool_call\n{\"name\":\"fs.read\",\"arguments\":{}}\n```"] });
    const gateway = createModelGateway({
      ...configFor(mock.url),
      models: [
        {
          base_url: mock.url,
          capabilities: { tools: "prompted" },
          data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
          id: "mock-main",
          model: "mock-model",
          transport: "openai-chat"
        }
      ]
    });

    await expect(collect(gateway.generate("main", {
      messages: [{ content: "read", role: "user" }],
      tools: [{ description: "read file", name: "fs.read", params: { additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"], type: "object" } }]
    }))).rejects.toBeInstanceOf(ProviderError);
    expect(mock.requests).toBe(3);
  });
});
