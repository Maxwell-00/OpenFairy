import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ArtifactRegistry, MockPerceptionProvider } from "@fairy/perception";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI_ARTIFACTS_E2E_TIMEOUT_MS = 60_000;

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

describe("fairy artifacts CLI", () => {
  it("lists and shows artifact registry entries without embedding blobs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "fairy-artifacts-cli-"));
    const registry = new ArtifactRegistry(join(dataDir, "artifacts"));
    const provider = new MockPerceptionProvider();
    const input = await registry.registerFixture("bilingual-text-image");
    const output = await provider.ocr(input.record);
    const structured = await registry.registerStructuredOutput(output, "tool:vision.ocr");

    const listed = JSON.parse(runFairy(["artifacts", "list", "--data-dir", dataDir, "--json"])) as {
      artifacts: { artifact_id: string; hash: string; kind: string; labels: unknown; mime: string }[];
    };
    expect(listed.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_id: input.record.artifact_id,
        hash: expect.stringMatching(/^sha256:/),
        kind: "input",
        mime: "image/png"
      }),
      expect.objectContaining({
        artifact_id: structured.record.artifact_id,
        kind: "perception",
        mime: "application/json"
      })
    ]));
    expect(JSON.stringify(listed)).not.toContain("MOCK_IMAGE");

    const shown = JSON.parse(runFairy(["artifacts", "show", structured.record.artifact_id, "--data-dir", dataDir, "--json"])) as {
      artifact: { artifact_id: string; kind: string; labels: unknown };
    };
    expect(shown.artifact).toMatchObject({
      artifact_id: structured.record.artifact_id,
      kind: "perception",
      labels: { residency: "global-ok", sensitivity: "internal" }
    });

    const text = runFairy(["artifacts", "show", structured.record.artifact_id, "--data-dir", dataDir, "--text"]);
    expect(text).toContain("FAIRY QUARANTINE BEGIN");
    expect(text).toContain("perception.ocr");
    expect(text).toContain("Hello Fairy");
    expect(text).toContain("\u4f60\u597d");
  }, CLI_ARTIFACTS_E2E_TIMEOUT_MS);
});
