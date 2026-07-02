import type { EventEnvelope } from "@fairy/protocol";

type Emit = (type: "turn.delta" | "turn.final", payload: Record<string, unknown>) => Promise<EventEnvelope>;

const inputText = (event: EventEnvelope): string => {
  const content = (event.payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  const parts = content
    .map((part) => {
      if (part && typeof part === "object" && (part as { kind?: unknown }).kind === "text") {
        return (part as { text?: unknown }).text;
      }
      return undefined;
    })
    .filter((text): text is string => typeof text === "string" && text.length > 0);

  return parts.join("\n") || "[artifact input]";
};

// M0 wire-test placeholder only. In M1 this single call site is replaced by the kernel TurnRunner.
export const runDevEchoResponder = async (input: EventEnvelope, emit: Emit): Promise<void> => {
  const text = inputText(input);
  await emit("turn.delta", { index: 0, text: "Echo: " });
  await emit("turn.delta", { index: 1, text });
  await emit("turn.final", {
    content: [{ kind: "text", text: `Echo: ${text}` }],
    finish_reason: "stop"
  });
};
