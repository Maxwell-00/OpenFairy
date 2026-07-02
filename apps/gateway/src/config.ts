import { defaultDataDir, loadConfig } from "@fairy/config";
import { resolve } from "node:path";

export interface GatewayCliOptions {
  readonly configPath?: string;
  readonly port?: number;
  readonly dataDir?: string;
}

export interface GatewayRuntimeConfig {
  readonly authToken: string;
  readonly config: Record<string, unknown>;
  readonly dataDir: string;
  readonly host: "127.0.0.1";
  readonly systemPrompt: string;
  readonly port: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readGatewayBlock = (config: Record<string, unknown>): Record<string, unknown> => {
  const gateway = config.gateway;
  return isRecord(gateway) ? gateway : {};
};

const readAuthToken = (gateway: Record<string, unknown>): string => {
  const auth = gateway.auth;
  if (!isRecord(auth) || typeof auth.token !== "string") {
    return "dev-token";
  }
  return auth.token;
};

const readSystemPrompt = (config: Record<string, unknown>): string => {
  const kernel = config.kernel;
  if (isRecord(kernel) && typeof kernel.system_prompt === "string") {
    return kernel.system_prompt;
  }
  return "You are Fairy, Chidi's helpful bilingual AI companion. Be concise, capable, and honest.";
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

  return {
    authToken: configuredToken.startsWith("secret://")
      ? resolveSecretRefForDevGateway(configuredToken, env)
      : configuredToken,
    config: loaded.config,
    dataDir: resolve(options.dataDir ?? configuredDataDir),
    host: "127.0.0.1",
    systemPrompt: readSystemPrompt(loaded.config),
    port: options.port ?? configuredPort
  };
};
