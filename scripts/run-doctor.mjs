import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
          encoding: "utf8",
          stdio: "inherit"
        })
      : spawnSync(command, args, {
          encoding: "utf8",
          stdio: "inherit"
        });

  if (result.status !== 0) {
    if (result.error) {
      console.error(result.error.message);
    }
    process.exit(result.status ?? 1);
  }
};

run("pnpm", ["--filter", "@fairy/config", "build"]);
run("pnpm", ["--filter", "@fairy/cli", "build"]);
run("node", ["apps/cli/dist/bin/fairy.js", "doctor"]);
