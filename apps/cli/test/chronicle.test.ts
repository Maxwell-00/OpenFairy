import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI_CHRONICLE_E2E_TIMEOUT_MS = 60_000;

const runFairy = (args: readonly string[]): string => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin/fairy.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    timeout: 30000,
    windowsHide: true
  });
  if (result.error) {
    throw new Error([
      `fairy ${args.join(" ")} failed: ${result.error.message}`,
      `stdout:\n${result.stdout ?? ""}`,
      `stderr:\n${result.stderr ?? ""}`
    ].join("\n"));
  }
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
};

describe("fairy chronicle CLI", () => {
  it("logs, queries, lists, and shows workspace entries as stable JSON", () => {
    const dataDir = join(tmpdir(), `fairy-chronicle-cli-${Date.now()}`);
    const logged = JSON.parse(runFairy([
      "chronicle",
      "log",
      "--kind",
      "decision",
      "--summary",
      "Use source-first TS execution",
      "--topic",
      "m2",
      "--file",
      "packages/kernel/src/index.ts",
      "--data-dir",
      dataDir,
      "--json"
    ])) as { entry: { id: string } };

    expect(logged.entry).toMatchObject({
      id: expect.stringMatching(/^chr_/),
      kind: "decision",
      labels: { residency: "global-ok", sensitivity: "internal" },
      summary: "Use source-first TS execution"
    });

    expect(JSON.parse(runFairy(["chronicle", "query", "source-first", "--data-dir", dataDir, "--json"]))).toMatchObject({
      entries: [expect.objectContaining({ id: logged.entry.id, score: expect.any(Number) })]
    });
    expect(JSON.parse(runFairy(["chronicle", "list", "--data-dir", dataDir, "--json"]))).toMatchObject({
      entries: [expect.objectContaining({ id: logged.entry.id })]
    });
    expect(JSON.parse(runFairy(["chronicle", "show", logged.entry.id, "--data-dir", dataDir, "--json"]))).toMatchObject({
      entry: expect.objectContaining({ id: logged.entry.id, topics: ["m2"] })
    });
  }, CLI_CHRONICLE_E2E_TIMEOUT_MS);
});
