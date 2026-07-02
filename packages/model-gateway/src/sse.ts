export const parseSseDataBlocks = (chunk: string, carry: string): { blocks: string[]; carry: string } => {
  const normalized = `${carry}${chunk}`.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const nextCarry = parts.pop() ?? "";
  const blocks = parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n")
        .trim()
    )
    .filter((part) => part.length > 0);
  return { blocks, carry: nextCarry };
};
