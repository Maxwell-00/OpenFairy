// Source-first launcher: the whole repo runs from TypeScript via tsx until the
// M5 packaging milestone (see CLAUDE.md "Internal packages resolve source-first").
// No dist builds at runtime — dist/dual-world resolution caused CI-only failures twice.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--") {
  forwardedArgs.shift();
}

const gateway = spawn(
  process.execPath,
  ["--import", "tsx", "apps/gateway/src/bin/gateway.ts", ...forwardedArgs],
  { cwd: repoRoot, stdio: "inherit" }
);

const forward = (signal) => {
  if (!gateway.killed) {
    gateway.kill(signal);
  }
};

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

gateway.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
