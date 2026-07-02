export type SecretRef = `secret://${string}`;

export interface SourceTrace {
  readonly name: "defaults" | "user" | "workspace" | "session";
  readonly path?: string;
  readonly found: boolean;
}

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly userConfigPath?: string;
  readonly workspaceConfigPath?: string;
  readonly sessionOverrides?: Record<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LoadedConfig<TConfig = Record<string, unknown>> {
  readonly config: TConfig;
  readonly sources: readonly SourceTrace[];
}

export interface ConfigIssue {
  readonly path: string;
  readonly expected: string;
  readonly got: string;
  readonly message: string;
}
