// Generic CLI runner (source-first via tsx): `node scripts/run-cli.mjs chat`,
// `node scripts/run-cli.mjs sessions`, `node scripts/run-cli.mjs doctor`, …
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "apps/cli/src/bin/fairy.ts", ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: "inherit" }
);

process.exit(result.status ?? 1);
