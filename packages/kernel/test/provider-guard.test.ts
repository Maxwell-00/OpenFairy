import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const forbiddenProviderTerms = /\b(ollama|deepseek|anthropic|gemini|openai-chat)\b/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });

describe("kernel provider boundary guard", () => {
  it("keeps provider-specific branches out of packages/kernel/src", () => {
    const offenders = sourceFiles(sourceRoot).flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return forbiddenProviderTerms.test(text)
        ? [path.replace(process.cwd(), ".")]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
