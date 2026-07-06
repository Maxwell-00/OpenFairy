import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  defaultDataDir,
  findWorkspaceConfigPath,
  loadConfig
} from "../src/index.js";

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fairy-config-"));

describe("loadConfig", () => {
  it("loads defaults and reports layer trace", () => {
    const cwd = makeTempDir();
    const loaded = loadConfig({ cwd, userConfigPath: join(cwd, "missing-user.yaml") });

    expect(loaded.config).toMatchObject({
      models: [],
      roles: {},
      gateway: { port: 8787, auth: { token: "dev-token" } },
      governance: { home_regions: ["cn"] },
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

  it("uses an explicit config path as the user layer", () => {
    const cwd = makeTempDir();
    const configPath = join(cwd, "explicit.yaml");
    writeFileSync(configPath, "gateway:\n  port: 9999\n");

    const loaded = loadConfig({ configPath, cwd });

    expect(loaded.config).toMatchObject({ gateway: { port: 9999 } });
    expect(loaded.sources[1]).toMatchObject({ name: "user", found: true, path: configPath });
  });

  it("finds workspace config by walking up to the repo root", () => {
    const root = makeTempDir();
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    writeFileSync(join(root, "fairy.workspace.yaml"), "gateway:\n  port: 7777\n");

    expect(findWorkspaceConfigPath(nested)).toBe(join(root, "fairy.workspace.yaml"));
    expect(loadConfig({ cwd: nested, userConfigPath: join(root, "missing-user.yaml") }).config).toMatchObject({
      gateway: { port: 7777 }
    });
  });

  it("computes platform default data directories", () => {
    expect(defaultDataDir({ LOCALAPPDATA: "C:\\Data" }, "win32")).toBe("C:\\Data\\fairy");
    expect(defaultDataDir({ XDG_DATA_HOME: "/tmp/data" }, "linux")).toBe("/tmp/data/fairy");
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
        "    base_url: http://127.0.0.1:8000/v1",
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
        "    base_url: https://api.example.test/v1",
        "    model: gpt",
        "    api_key_ref: not-a-secret-ref",
        "    data_clearance:",
        "      max_sensitivity: internal",
        "      residency: [global-ok]"
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

  it("rejects invalid governance profiles", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    writeFileSync(
      userConfigPath,
      [
        "governance:",
        "  profile: fastest"
      ].join("\n")
    );

    expect(() => loadConfig({ cwd, userConfigPath })).toThrow(ConfigValidationError);
  });

  it("rejects region-restricted model clearance without regions", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    writeFileSync(
      userConfigPath,
      [
        "models:",
        "  - id: regional-cloud",
        "    transport: openai-chat",
        "    base_url: https://api.example.test/v1",
        "    model: regional",
        "    data_clearance:",
        "      max_sensitivity: personal",
        "      residency: [region-restricted]"
      ].join("\n")
    );

    expect(() => loadConfig({ cwd, userConfigPath })).toThrow(ConfigValidationError);
  });

  it("validates governance egress and contextual permission rule config", () => {
    const cwd = makeTempDir();
    const userConfigPath = join(cwd, "fairy.yaml");
    writeFileSync(
      userConfigPath,
      [
        "governance:",
        "  egress:",
        "    external_tools: [\"web.*\", \"shell.run\"]",
        "    personal_allowed_tools: [\"internal.export\"]",
        "permissions:",
        "  ask_timeout_s: 3",
        "  rules:",
        "    - tool: \"fs.read\"",
        "      channel_trust: untrusted",
        "      untrusted_content: true",
        "      provenance: \"web:*\"",
        "      decision: deny"
      ].join("\n")
    );

    expect(loadConfig({ cwd, userConfigPath }).config).toMatchObject({
      governance: {
        egress: {
          external_tools: ["web.*", "shell.run"],
          personal_allowed_tools: ["internal.export"]
        }
      },
      permissions: {
        rules: [expect.objectContaining({
          channel_trust: "untrusted",
          provenance: "web:*",
          untrusted_content: true
        })]
      }
    });
  });
});
