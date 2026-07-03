import { loadConfig } from "@fairy/config";

import { formatConformanceTable, runLiveConformance, runMockConformance } from "../conformance.js";

const readArg = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const main = async (): Promise<void> => {
  const model = readArg(process.argv, "--model");
  const configPath = readArg(process.argv, "--config");
  const verdict = model
    ? await runLiveConformance(loadConfig(configPath ? { configPath } : {}).config, model)
    : await runMockConformance();

  console.log(formatConformanceTable(verdict));
  console.log(JSON.stringify(verdict));
  process.exitCode = verdict.ok ? 0 : 1;
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
