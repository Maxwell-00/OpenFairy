import { describe, expect, it } from "vitest";

import { TurnRunner, type KernelEvent } from "../src/index.js";
import type { ModelGateway, NormalizedModelEvent } from "@fairy/model-gateway";

const labels = { residency: "global-ok", sensitivity: "internal" } as const;

const fakeGateway = (events: readonly NormalizedModelEvent[], onRequest?: (messages: readonly unknown[]) => void): ModelGateway => ({
  async *generate(_role, request) {
    onRequest?.(request.messages);
    for (const event of events) {
      yield event;
    }
  }
});

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
      emit: async (event) => {
        emitted.push(event);
      },
      history: { messages: [{ content: "earlier", role: "user" }, { content: "reply", role: "assistant" }] },
      input: "now",
      labels,
      sid: "ses_01J00000000000000000000000",
      turn: 1
    });

    expect(result).toMatchObject({ content: "hi", finish_reason: "stop" });
    expect(emitted.map((event) => event.type)).toEqual(["reasoning.delta", "turn.delta", "turn.final"]);
    expect(emitted.at(-1)?.payload).toMatchObject({
      content: [{ kind: "text", text: "hi" }],
      usage: { estimated: false, input_tokens: 1, output_tokens: 1 }
    });
  });

  it("emits turn.interrupted when cancelled", async () => {
    let abortSignal: AbortSignal | undefined;
    const gateway: ModelGateway = {
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
      }
    };
    const emitted: KernelEvent[] = [];
    const runner = new TurnRunner({ modelGateway: gateway });
    const run = runner.runTurn({
      emit: async (event) => {
        emitted.push(event);
      },
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

    expect(emitted.map((event) => event.type)).toEqual(["turn.delta", "turn.interrupted"]);
    expect(emitted.at(-1)?.payload).toMatchObject({ reason: "user_cancelled" });
  });
});
