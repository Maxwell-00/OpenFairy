// Thin wrapper kept for the root `pnpm doctor` script; delegates to run-cli.mjs.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const result = spawnSync(
  process.execPath,
  [join(here, "run-cli.mjs"), "doctor", ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: "inherit" }
);

process.exit(result.status ?? 1);
