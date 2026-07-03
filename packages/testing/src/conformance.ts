import {
  createModelGateway,
  fromWireName,
  ProviderError,
  toWireName,
  type NormalizedModelEvent
} from "@fairy/model-gateway";

import { MockOpenAIChatServer, type MockOpenAIScript } from "./mock-openai.js";

export interface ConformanceCaseVerdict {
  readonly name: string;
  readonly ok: boolean;
  readonly message?: string;
}

export interface ConformanceVerdict {
  readonly cases: readonly ConformanceCaseVerdict[];
  readonly mode: "mock" | "live";
  readonly model?: string;
  readonly ok: boolean;
}

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const collect = async (iterable: AsyncIterable<NormalizedModelEvent>): Promise<NormalizedModelEvent[]> => {
  const events: NormalizedModelEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
};

const lastDone = (events: readonly NormalizedModelEvent[]): Extract<NormalizedModelEvent, { type: "done" }> => {
  const event = events.at(-1);
  if (!event || event.type !== "done") {
    throw new Error("stream did not finish with done");
  }
  return event;
};

const configFor = (baseUrl: string, options: {
  readonly capabilities?: Record<string, unknown>;
  readonly watchdogS?: number;
} = {}): Record<string, unknown> => ({
  gateway: { watchdog_s: options.watchdogS ?? 1 },
  models: [
    {
      base_url: baseUrl,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
      data_clearance: { max_sensitivity: "internal", residency: ["global-ok"] },
      id: "mock-main",
      model: "mock-model",
      transport: "openai-chat"
    }
  ],
  roles: { main: { model: "mock-main" } }
});

const withMock = async (script: MockOpenAIScript, fn: (server: MockOpenAIChatServer) => Promise<void>): Promise<void> => {
  const server = await MockOpenAIChatServer.start(script);
  try {
    await fn(server);
  } finally {
    await server.stop();
  }
};

const runCase = async (name: string, fn: () => Promise<void> | void): Promise<ConformanceCaseVerdict> => {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name,
      ok: false
    };
  }
};

const providerErrorFrom = async (script: MockOpenAIScript): Promise<ProviderError> => {
  let captured: unknown;
  await withMock(script, async (server) => {
    const gateway = createModelGateway(configFor(server.url, { watchdogS: script.stallMs ? 0.01 : 1 }));
    try {
      await collect(gateway.generate("main", {
        messages: [{ content: "classify error", role: "user" }]
      }));
    } catch (error) {
      captured = error;
    }
  });
  if (!(captured instanceof ProviderError)) {
    throw new Error("expected ProviderError");
  }
  return captured;
};

export const runMockConformance = async (): Promise<ConformanceVerdict> => {
  const cases = await Promise.all([
    runCase("streaming text deltas", async () => {
      await withMock({ text: ["Hel", "lo"], usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 } }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "ping", role: "user" }]
        }));
        assert(events.filter((event) => event.type === "text").map((event) => event.text).join("") === "Hello", "text deltas did not assemble");
        lastDone(events);
      });
    }),
    runCase("tool deltas whole call", async () => {
      await withMock({ toolCalls: [{ id: "call_whole", name: "fs.read", args: { path: "README.md" } }] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "read", role: "user" }],
          tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
        }));
        assert(events.some((event) => event.type === "tool_call" && event.call_id === "call_whole"), "whole tool call missing");
      });
    }),
    runCase("tool deltas fragmented args", async () => {
      await withMock({ toolCalls: [{ fragments: ["{\"path\"", ":\"README.md\"}"], id: "call_frag", name: "fs.read" }] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "read", role: "user" }],
          tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
        }));
        assert(events.some((event) => event.type === "tool_call" && event.name === "fs.read"), "fragmented tool call missing");
      });
    }),
    runCase("tool deltas parallel", async () => {
      await withMock({
        toolCalls: [
          { id: "call_a", name: "fs.read", args: { path: "a.txt" } },
          { id: "call_b", name: "fs.read", args: { path: "b.txt" } }
        ]
      }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "read", role: "user" }],
          tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
        }));
        assert(events.filter((event) => event.type === "tool_call").map((event) => event.call_id).join(",") === "call_a,call_b", "parallel order changed");
      });
    }),
    runCase("tool deltas name-first empty args", async () => {
      await withMock({ toolCalls: [{ fragments: ["", "{\"path\":\"README.md\"}"], id: "call_name_first", name: "fs.read" }] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "read", role: "user" }],
          tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
        }));
        assert(events.some((event) => event.type === "tool_call" && event.call_id === "call_name_first"), "name-first call missing");
      });
    }),
    runCase("tool deltas malformed JSON", async () => {
      await withMock({ toolCalls: [{ id: "call_bad", malformedArguments: "{\"path\":", name: "fs.read" }] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        let failed = false;
        try {
          await collect(gateway.generate("main", {
            messages: [{ content: "read", role: "user" }],
            tools: [{ description: "read", name: "fs.read", params: { type: "object" } }]
          }));
        } catch (error) {
          failed = error instanceof ProviderError;
        }
        assert(failed, "malformed tool JSON was not rejected");
      });
    }),
    runCase("reasoning field and think tags", async () => {
      await withMock({ reasoning: ["field"], text: ["visible <think>tag</think> answer"] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "reason", role: "user" }]
        }));
        assert(events.filter((event) => event.type === "reasoning").map((event) => event.text).join("|") === "field|tag", "reasoning not normalized");
      });
    }),
    runCase("usage present", async () => {
      await withMock({ text: ["ok"], usage: { completion_tokens: 7, prompt_tokens: 5, total_tokens: 12 } }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "usage", role: "user" }]
        }));
        assert(lastDone(events).usage.estimated === false, "present usage was not preserved");
      });
    }),
    runCase("usage missing estimated", async () => {
      await withMock({ omitUsage: true, text: ["estimate me"] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "usage", role: "user" }]
        }));
        assert(lastDone(events).usage.estimated === true, "missing usage was not estimated");
      });
    }),
    runCase("finish_reason mapping", async () => {
      await withMock({ finishReason: "length", text: ["too long"] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        const events = await collect(gateway.generate("main", {
          messages: [{ content: "finish", role: "user" }]
        }));
        assert(lastDone(events).finish_reason === "error", "length did not map to error");
      });
    }),
    runCase("429 retry", async () => {
      await withMock({ failStatusOnce: 429, text: ["ok"] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        await collect(gateway.generate("main", { messages: [{ content: "retry", role: "user" }] }));
        assert(server.requests === 2, "429 did not retry once");
      });
    }),
    runCase("5xx retry", async () => {
      await withMock({ failStatusOnce: 500, text: ["ok"] }, async (server) => {
        const gateway = createModelGateway(configFor(server.url));
        await collect(gateway.generate("main", { messages: [{ content: "retry", role: "user" }] }));
        assert(server.requests === 2, "5xx did not retry once");
      });
    }),
    runCase("400 context overflow classification", async () => {
      const error = await providerErrorFrom({
        failBody: { error: { message: "context length exceeded" } },
        failStatus: 400
      });
      assert(error.context_overflow === true, "400 context error was not classified");
    }),
    runCase("401 auth classification", async () => {
      const error = await providerErrorFrom({ failStatus: 401 });
      assert(error.auth === true, "401 was not classified as auth");
    }),
    runCase("403 auth classification", async () => {
      const error = await providerErrorFrom({ failStatus: 403 });
      assert(error.auth === true, "403 was not classified as auth");
    }),
    runCase("stream stall watchdog", async () => {
      const error = await providerErrorFrom({ stallAfterChunks: 1, stallMs: 200, text: ["first", "second"] });
      assert(error.retryable === true, "stall did not become retryable provider error");
    }),
    runCase("function-name charset rejection", async () => {
      await withMock({}, async (server) => {
        const response = await fetch(`${server.url}/chat/completions`, {
          body: JSON.stringify({
            messages: [{ content: "bad tool", role: "user" }],
            model: "mock-model",
            stream: true,
            tools: [{ function: { name: "fs.read", parameters: { type: "object" } }, type: "function" }]
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        });
        assert(response.status === 400, "mock accepted dotted wire function name");
      });
    }),
    runCase("wire-name codec round-trip", () => {
      assert(toWireName("fs.read") === "fs__read", "dot was not encoded");
      assert(fromWireName("fs__read") === "fs.read", "wire name was not decoded");
    })
  ]);

  return {
    cases,
    mode: "mock",
    ok: cases.every((testCase) => testCase.ok)
  };
};

export const runLiveConformance = async (config: Record<string, unknown>, modelId: string): Promise<ConformanceVerdict> => {
  const liveConfig = {
    ...config,
    roles: { main: { model: modelId } }
  };
  const gateway = createModelGateway(liveConfig);
  const cases = await Promise.all([
    runCase("live streaming shape", async () => {
      const events = await collect(gateway.generate("main", {
        messages: [{ content: "Reply with the word Fairy.", role: "user" }]
      }));
      assert(events.some((event) => event.type === "text"), "live endpoint produced no text deltas");
      assert(events.at(-1)?.type === "done", "live endpoint did not produce done");
    }),
    runCase("live trivial tool-call shape", async () => {
      const events = await collect(gateway.generate("main", {
        messages: [{ content: "Call the echo tool with {\"text\":\"fairy\"}.", role: "user" }],
        tools: [{
          description: "Echo text back to the caller.",
          name: "echo.run",
          params: {
            additionalProperties: false,
            properties: { text: { type: "string" } },
            required: ["text"],
            type: "object"
          }
        }]
      }));
      assert(
        events.some((event) => event.type === "tool_call" || event.type === "done"),
        "live endpoint produced neither a tool call nor a classified final response"
      );
    })
  ]);

  return {
    cases,
    mode: "live",
    model: modelId,
    ok: cases.every((testCase) => testCase.ok)
  };
};

export const formatConformanceTable = (verdict: ConformanceVerdict): string => {
  const rows = [
    `Mode: ${verdict.mode}${verdict.model ? ` (${verdict.model})` : ""}`,
    "| Case | Result | Detail |",
    "|---|---:|---|",
    ...verdict.cases.map((testCase) =>
      `| ${testCase.name} | ${testCase.ok ? "PASS" : "FAIL"} | ${testCase.message ? testCase.message.replace(/\|/g, "\\|") : ""} |`
    )
  ];
  return rows.join("\n");
};
