import { writeFileSync } from "node:fs";
import { MockOpenAIChatServer } from "../packages/testing/src/mock-openai.ts";

async function main(): Promise<void> {
  const outputPath = process.argv[2];

  if (!outputPath) {
    throw new Error("output path is required");
  }

  const server = await MockOpenAIChatServer.start({
    text: ["R0.9-05 deterministic owner model response."],
  });

  writeFileSync(outputPath, server.url, "utf8");
  console.log("mock model ready");

  const stop = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  await new Promise(() => undefined);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
