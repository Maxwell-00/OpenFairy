import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args) => {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "inherit"
        })
      : spawnSync(command, args, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "inherit"
        });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("pnpm", ["--filter", "@fairy/protocol", "build"]);
run("pnpm", ["--filter", "@fairy/config", "build"]);
run("pnpm", ["--filter", "@fairy/model-gateway", "build"]);
run("pnpm", ["--filter", "@fairy/kernel", "build"]);
run("pnpm", ["--filter", "@fairy/gateway", "build"]);

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--") {
  forwardedArgs.shift();
}

const gateway = spawn(process.execPath, ["apps/gateway/dist/bin/gateway.js", ...forwardedArgs], {
  cwd: repoRoot,
  stdio: "inherit"
});

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
