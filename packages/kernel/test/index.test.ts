import { describe, expect, it } from "vitest";

import { PermissionEngine, TurnRunner, type KernelEvent } from "../src/index.js";
import { estimateTextTokens, type ModelGateway, type NormalizedModelEvent } from "@fairy/model-gateway";
import type { EventEnvelope } from "@fairy/protocol";

const labels = { residency: "global-ok", sensitivity: "internal" } as const;

const fakeGateway = (events: readonly NormalizedModelEvent[], onRequest?: (messages: readonly unknown[]) => void): ModelGateway => ({
  estimateTokens(input) {
    return { estimated: true, tokens: estimateTextTokens(input) };
  },
  async *generate(_role, request) {
    onRequest?.(request.messages);
    for (const event of events) {
      yield event;
    }
  },
  modelInfo() {
    return { context_window: 8000, id: "mock-main", max_output: 1024, model: "mock-model" };
  }
});

const makeEmit = (events: KernelEvent[]) => async (event: KernelEvent): Promise<EventEnvelope> => {
  events.push(event);
  return {
    actor: "agent",
    id: `evt_01J0000000000000000000000${String(events.length).padStart(2, "0")}`,
    labels,
    payload: event.payload,
    provenance: "agent",
    sid: "ses_01J00000000000000000000000",
    ts: "2026-07-03T00:00:00.000Z",
    turn: 1,
    type: event.type,
    v: 1
  };
};

describe("@fairy/kernel TurnRunner", () => {
  it("assembles prompt and emits reasoning, text, and final events", async () => {
    const emitted: KernelEvent[] = [];
    const runner = new TurnRunner({
      modelGateway: fakeGateway(
        [
          { text: "thinking", type: "reasoning" },
          { text: "hi", type: "text" },
          { finish_reason: "stop", type: "done", usage: { estimated: false, input_tokens: 1, output_tokens: 1 } }
        ],
        (messages) => {
          expect(messages).toHaveLength(4);
          expect(messages.at(0)).toMatchObject({ role: "system" });
          expect(messages.at(-1)).toMatchObject({ content: "now", role: "user" });
        }
      )
    });

    const result = await runner.runTurn({
      emit: makeEmit(emitted),
      history: { messages: [{ content: "earlier", role: "user" }, { content: "reply", role: "assistant" }] },
      input: "now",
      labels,
      sid: "ses_01J00000000000000000000000",
      turn: 1
    });

    expect(result).toMatchObject({ content: "hi", finish_reason: "stop" });
    expect(emitted.map((event) => event.type)).toEqual(["context.manifest", "reasoning.delta", "turn.delta", "turn.final"]);
    expect(emitted[0]?.payload).toMatchObject({ model: "mock-model", reduction_stages_applied: [] });
    expect(emitted.at(-1)?.payload).toMatchObject({
      content: [{ kind: "text", text: "hi" }],
      usage: { estimated: false, input_tokens: 1, output_tokens: 1 }
    });
  });

  it("emits turn.interrupted when cancelled", async () => {
    let abortSignal: AbortSignal | undefined;
    const gateway: ModelGateway = {
      estimateTokens(input) {
        return { estimated: true, tokens: estimateTextTokens(input) };
      },
      async *generate(_role, _request, options) {
        abortSignal = options?.abort;
        yield { text: "partial", type: "text" };
        await new Promise<void>((_resolve, reject) => {
          if (options?.abort?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          options?.abort?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      modelInfo() {
        return { context_window: 8000, id: "mock-main", max_output: 1024, model: "mock-model" };
      }
    };
    const emitted: KernelEvent[] = [];
    const runner = new TurnRunner({ modelGateway: gateway });
    const run = runner.runTurn({
      emit: makeEmit(emitted),
      history: { messages: [] },
      input: "cancel me",
      labels,
      sid: "ses_01J00000000000000000000001",
      turn: 1
    });

    await Promise.resolve();
    expect(abortSignal).toBeDefined();
    expect(runner.cancel("ses_01J00000000000000000000001")).toBe(true);
    await run;

    expect(emitted.map((event) => event.type)).toEqual(["context.manifest", "turn.delta", "turn.interrupted"]);
    expect(emitted.at(-1)?.payload).toMatchObject({ reason: "user_cancelled" });
  });

  it("interrupts when cancelled while a tool is executing", async () => {
    let started: (() => void) | undefined;
    const toolStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gateway: ModelGateway = {
      estimateTokens(input) {
        return { estimated: true, tokens: estimateTextTokens(input) };
      },
      async *generate() {
        yield { args: {}, call_id: "call_slow", name: "test.slow", type: "tool_call" };
      },
      modelInfo() {
        return { context_window: 8000, id: "mock-main", max_output: 1024, model: "mock-model" };
      }
    };
    const tools = new Map([[
      "test.slow",
      {
        description: "slow test tool",
        labels_out: labels,
        name: "test.slow",
        params: { type: "object" },
        async execute(_args: Record<string, unknown>, ctx: { abort?: AbortSignal }) {
          await new Promise<void>((_resolve, reject) => {
            if (ctx.abort?.aborted) {
              reject(new Error("aborted"));
              return;
            }
            ctx.abort?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            started?.();
          });
          return { content: "done", labels, provenance: "tool:test.slow" };
        }
      }
    ]]);
    const emitted: KernelEvent[] = [];
    const runner = new TurnRunner({
      modelGateway: gateway,
      permissionEngine: new PermissionEngine({ rules: [{ decision: "allow", tool: "test.slow" }] }),
      toolContext: { artifactsDir: process.cwd(), env: process.env, workspaceRoot: process.cwd() },
      tools
    });
    const run = runner.runTurn({
      emit: makeEmit(emitted),
      history: { messages: [] },
      input: "run tool",
      labels,
      sid: "ses_01J00000000000000000000002",
      turn: 1
    });

    await toolStarted;
    expect(runner.cancel("ses_01J00000000000000000000002")).toBe(true);
    const result = await run;

    expect(result).toMatchObject({ finish_reason: "cancelled" });
    expect(emitted.map((event) => event.type)).toEqual(["context.manifest", "tool.call", "turn.interrupted"]);
    expect(emitted.at(-1)?.payload).toMatchObject({ reason: "user_cancelled" });
  });
});
