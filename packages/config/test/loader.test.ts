import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ConfigValidationError, loadConfig } from "../src/index.js";

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fairy-config-"));

describe("loadConfig", () => {
  it("loads defaults and reports layer trace", () => {
    const cwd = makeTempDir();
    const loaded = loadConfig({ cwd, userConfigPath: join(cwd, "missing-user.yaml") });

    expect(loaded.config).toMatchObject({
      models: [],
      roles: {},
      governance: { home_regions: [] },
      sandbox: { default_profile: "safe" }
    });
    expect(loaded.sources.map((source) => [source.name, source.found])).toEqual([
      ["defaults", true],
      ["user", false],
      ["workspace", false],
      ["session", false]
    ]);
  });

  it("merges defaults, user, workspace, and session overrides in order", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    const workspaceConfigPath = join(cwd, "fairy.workspace.yaml");

    writeFileSync(
      userConfigPath,
      [
        "governance:",
        "  home_regions: [us]",
        "sandbox:",
        "  image: ${FAIRY_SANDBOX_IMAGE}"
      ].join("\n")
    );
    writeFileSync(
      workspaceConfigPath,
      [
        "roles:",
        "  main:",
        "    model: local-glm"
      ].join("\n")
    );

    const loaded = loadConfig({
      cwd,
      env: { FAIRY_SANDBOX_IMAGE: "custom-image:latest" },
      sessionOverrides: {
        roles: {
          main: {
            model: "session-model"
          }
        }
      },
      userConfigPath,
      workspaceConfigPath
    });

    expect(loaded.config).toMatchObject({
      governance: { home_regions: ["us"] },
      roles: { main: { model: "session-model" } },
      sandbox: { image: "custom-image:latest" }
    });
  });

  it("keeps secret refs typed but unresolved", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    writeFileSync(
      userConfigPath,
      [
        "models:",
        "  - id: local-glm",
        "    transport: openai-chat",
        "    model: glm-4.7",
        "    api_key_ref: secret://vllm",
        "    data_clearance:",
        "      max_sensitivity: secret",
        "      residency: [local-only, global-ok]"
      ].join("\n")
    );

    const loaded = loadConfig({ cwd, userConfigPath });

    expect(loaded.config.models).toEqual([
      expect.objectContaining({ api_key_ref: "secret://vllm" })
    ]);
  });

  it("returns actionable validation errors", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    writeFileSync(
      userConfigPath,
      [
        "models:",
        "  - id: cloud",
        "    transport: openai-chat",
        "    model: gpt",
        "    api_key_ref: not-a-secret-ref"
      ].join("\n")
    );

    expect(() => loadConfig({ cwd, userConfigPath })).toThrow(ConfigValidationError);

    try {
      loadConfig({ cwd, userConfigPath });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const issue = (error as ConfigValidationError).issues[0];
      expect(issue).toBeDefined();
      if (!issue) {
        return;
      }
      expect(issue.path).toBe("config.models[0].api_key_ref");
      expect(issue.expected).toContain("secret://");
      expect(issue.got).toBe('"not-a-secret-ref"');
    }
  });
});
