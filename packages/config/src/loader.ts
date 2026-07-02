import { Ajv2020 } from "ajv/dist/2020.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import { ConfigValidationError, formatAjvIssues } from "./errors.js";
import { configSchema } from "./schema.js";
import type { LoadedConfig, LoadConfigOptions, SourceTrace } from "./types.js";

const defaultsPath = resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "defaults.yaml"
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateConfig = ajv.compile(configSchema);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readYamlFile = (path: string): Record<string, unknown> => {
  const parsed = parse(readFileSync(path, "utf8")) as unknown;
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new ConfigValidationError([
      {
        path: "config",
        expected: "YAML mapping/object",
        got: typeof parsed,
        message: "config file root must be an object"
      }
    ]);
  }
  return parsed;
};

const expandEnv = (value: unknown, env: NodeJS.ProcessEnv): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("secret://")) {
      return value;
    }
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandEnv(item, env));
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnv(item, env)]));
  }

  return value;
};

const merge = (base: unknown, overlay: unknown): unknown => {
  if (!isRecord(base) || !isRecord(overlay)) {
    return overlay;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = key in result ? merge(result[key], value) : value;
  }
  return result;
};

const optionalSource = (name: SourceTrace["name"], path: string): { trace: SourceTrace; value: Record<string, unknown> } => {
  const found = existsSync(path);
  return {
    trace: { name, path, found },
    value: found ? readYamlFile(path) : {}
  };
};

export const defaultUserConfigPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.FAIRY_CONFIG ? resolve(env.FAIRY_CONFIG) : join(homedir(), "fairy.yaml");

export const defaultWorkspaceConfigPath = (cwd = process.cwd()): string => join(cwd, "fairy.workspace.yaml");

export const loadConfig = (options: LoadConfigOptions = {}): LoadedConfig => {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const userPath = options.userConfigPath ? resolve(options.userConfigPath) : defaultUserConfigPath(env);
  const workspacePath = options.workspaceConfigPath ? resolve(options.workspaceConfigPath) : defaultWorkspaceConfigPath(cwd);

  const defaults = readYamlFile(defaultsPath);
  const user = optionalSource("user", userPath);
  const workspace = optionalSource("workspace", workspacePath);
  const sessionOverrides = options.sessionOverrides ?? {};

  const merged = [defaults, user.value, workspace.value, sessionOverrides].reduce<unknown>(
    (current, overlay) => merge(current, overlay),
    {}
  );
  const expanded = expandEnv(merged, env);

  if (!validateConfig(expanded)) {
    throw new ConfigValidationError(formatAjvIssues(validateConfig.errors ?? [], expanded));
  }

  return {
    config: expanded as unknown as Record<string, unknown>,
    sources: [
      { name: "defaults", path: defaultsPath, found: true },
      user.trace,
      workspace.trace,
      { name: "session", found: Object.keys(sessionOverrides).length > 0 }
    ]
  };
};
