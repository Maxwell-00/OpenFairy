import { defaultDataDir, loadConfig } from "@fairy/config";
import { loadPersonaRuntime, type ContextConfig, type EgressGuardConfig, type PermissionRule, type PersonaRuntime } from "@fairy/kernel";
import { join, resolve } from "node:path";

export interface GatewayCliOptions {
  readonly configPath?: string;
  readonly port?: number;
  readonly dataDir?: string;
}

export interface GatewayRuntimeConfig {
  readonly artifactsDir: string;
  readonly askTimeoutMs: number;
  readonly authToken: string;
  readonly config: Record<string, unknown>;
  readonly contextConfig: ContextConfig;
  readonly dataDir: string;
  readonly egressGuardConfig: EgressGuardConfig;
  readonly host: "127.0.0.1";
  readonly maxToolIterations: number;
  readonly permissionRules: readonly PermissionRule[];
  readonly personaRuntime: PersonaRuntime;
  readonly systemPrompt: string;
  readonly port: number;
  readonly workspaceRoot: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readGatewayBlock = (config: Record<string, unknown>): Record<string, unknown> => {
  const gateway = config.gateway;
  return isRecord(gateway) ? gateway : {};
};

const readBlock = (config: Record<string, unknown>, key: string): Record<string, unknown> => {
  const block = config[key];
  return isRecord(block) ? block : {};
};

const readAuthToken = (gateway: Record<string, unknown>): string => {
  const auth = gateway.auth;
  if (!isRecord(auth) || typeof auth.token !== "string") {
    return "dev-token";
  }
  return auth.token;
};

const readSystemPrompt = (config: Record<string, unknown>): string => {
  const kernel = readBlock(config, "kernel");
  if (typeof kernel.system_prompt === "string") {
    return kernel.system_prompt;
  }
  return "You are Fairy, a helpful bilingual (Chinese/English) AI companion. Be concise, capable, and honest.";
};

const readMaxToolIterations = (config: Record<string, unknown>): number => {
  const kernel = readBlock(config, "kernel");
  return typeof kernel.max_tool_iterations === "number" ? kernel.max_tool_iterations : 16;
};

const readContextConfig = (config: Record<string, unknown>): ContextConfig => {
  const context = readBlock(config, "context");
  const chronicle = readBlock(config, "chronicle");
  return {
    ...(typeof chronicle.digest_budget === "number" ? { chronicleDigestBudget: chronicle.digest_budget } : {}),
    ...(typeof context.chronicle_digest_budget === "number" ? { chronicleDigestBudget: context.chronicle_digest_budget } : {}),
    compactionRole: typeof context.compaction_role === "string" ? context.compaction_role : "summarizer",
    l4PlaceholderThreshold: typeof context.l4_placeholder_threshold === "number" ? context.l4_placeholder_threshold : 6,
    l4TargetTokens: typeof context.l4_target_tokens === "number" ? context.l4_target_tokens : 800,
    l5TargetTokens: typeof context.l5_target_tokens === "number" ? context.l5_target_tokens : 1200,
    ...(typeof context.memory_digest_budget === "number" ? { memoryDigestBudget: context.memory_digest_budget } : {}),
    minRecentTurns: typeof context.min_recent_turns === "number" ? context.min_recent_turns : 4,
    ...(typeof context.output_reserve === "number" ? { outputReserve: context.output_reserve } : {}),
    reduceAt: typeof context.reduce_at === "number" ? context.reduce_at : 0.8
  };
};

const readAskTimeoutMs = (config: Record<string, unknown>): number => {
  const permissions = readBlock(config, "permissions");
  return (typeof permissions.ask_timeout_s === "number" ? permissions.ask_timeout_s : 300) * 1000;
};

const readPermissionRules = (config: Record<string, unknown>): PermissionRule[] => {
  const permissions = readBlock(config, "permissions");
  if (!Array.isArray(permissions.rules)) {
    return [];
  }
  return permissions.rules.flatMap((rule): PermissionRule[] => {
    if (!isRecord(rule) || typeof rule.tool !== "string") {
      return [];
    }
    const decision = rule.decision;
    if (decision !== "allow" && decision !== "ask" && decision !== "deny") {
      return [];
    }
    return [{
      ...(rule.channel_trust === "trusted" || rule.channel_trust === "untrusted" ? { channelTrust: rule.channel_trust } : {}),
      decision,
      ...(typeof rule.path === "string" ? { path: rule.path } : {}),
      ...(typeof rule.provenance === "string" ? { provenance: rule.provenance } : {}),
      tool: rule.tool,
      ...(typeof rule.untrusted_content === "boolean" ? { untrustedContent: rule.untrusted_content } : {})
    }];
  });
};

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

const readEgressGuardConfig = (config: Record<string, unknown>): EgressGuardConfig => {
  const governance = readBlock(config, "governance");
  const egress = isRecord(governance.egress) ? governance.egress : {};
  const externalTools = readStringArray(egress.external_tools);
  const personalAllowedTools = readStringArray(egress.personal_allowed_tools);
  return {
    ...(externalTools.length > 0 ? { externalTools } : {}),
    ...(personalAllowedTools.length > 0 ? { personalAllowedTools } : {})
  };
};

const readWorkspaceRoot = (config: Record<string, unknown>, cwd: string): string => {
  const workspace = readBlock(config, "workspace");
  return resolve(typeof workspace.root === "string" ? workspace.root : cwd);
};

const resolveSecretRefForDevGateway = (ref: string, env: NodeJS.ProcessEnv): string => {
  const name = ref.slice("secret://".length);
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const candidates = [name, normalized, `FAIRY_SECRET_${normalized}`];
  const value = candidates.map((candidate) => env[candidate]).find((candidate) => candidate && candidate.length > 0);

  if (!value) {
    throw new Error(`Gateway auth token secret ${ref} was not found in env (${candidates.join(", ")})`);
  }

  return value;
};

export const parseGatewayArgs = (argv: readonly string[]): GatewayCliOptions => {
  const options: { configPath?: string; port?: number; dataDir?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      options.configPath = value;
      index += 1;
    } else if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--port requires a number");
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      options.port = port;
      index += 1;
    } else if (arg === "--data-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--data-dir requires a path");
      }
      options.dataDir = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("Usage: fairy-gateway [--config path] [--port number] [--data-dir path]");
    } else {
      throw new Error(`Unknown gateway argument: ${arg}`);
    }
  }

  return options;
};

export const loadGatewayConfig = (
  options: GatewayCliOptions = {},
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): GatewayRuntimeConfig => {
  const loaded = loadConfig(options.configPath ? { configPath: options.configPath, cwd, env } : { cwd, env });
  const gateway = readGatewayBlock(loaded.config);
  const configuredPort = typeof gateway.port === "number" ? gateway.port : 8787;
  const configuredDataDir = typeof gateway.data_dir === "string" ? gateway.data_dir : defaultDataDir(env);
  const configuredToken = readAuthToken(gateway);
  const dataDir = resolve(options.dataDir ?? configuredDataDir);

  return {
    artifactsDir: join(dataDir, "artifacts"),
    askTimeoutMs: readAskTimeoutMs(loaded.config),
    authToken: configuredToken.startsWith("secret://")
      ? resolveSecretRefForDevGateway(configuredToken, env)
      : configuredToken,
    config: loaded.config,
    contextConfig: readContextConfig(loaded.config),
    dataDir,
    egressGuardConfig: readEgressGuardConfig(loaded.config),
    host: "127.0.0.1",
    maxToolIterations: readMaxToolIterations(loaded.config),
    permissionRules: readPermissionRules(loaded.config),
    personaRuntime: loadPersonaRuntime(loaded.config, cwd),
    systemPrompt: readSystemPrompt(loaded.config),
    port: options.port ?? configuredPort,
    workspaceRoot: readWorkspaceRoot(loaded.config, cwd)
  };
};
