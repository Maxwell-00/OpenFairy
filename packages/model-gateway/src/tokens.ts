import type { ChatMessage, ToolDefinition } from "./types.js";

const isCjk = (codePoint: number): boolean =>
  (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
  (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7af);

export const estimateTextTokens = (text: string): number => {
  let weight = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (/\s/.test(char)) {
      weight += 0.1;
    } else if (isCjk(codePoint)) {
      weight += 1 / 1.6;
    } else if (codePoint < 128) {
      weight += 0.25;
    } else {
      weight += 0.5;
    }
  }
  return Math.max(1, Math.ceil(weight));
};

export const estimateChatTokens = (
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[] = []
): number => {
  const messageTokens = messages.reduce((sum, message) => sum + estimateTextTokens(JSON.stringify(message)), 0);
  const toolTokens = tools.length > 0 ? estimateTextTokens(JSON.stringify(tools)) : 0;
  return messageTokens + toolTokens;
};
