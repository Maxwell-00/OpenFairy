export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly turn?: number;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[];
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly params: Record<string, unknown>;
}

export interface GenerateRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly labels?: {
    readonly sensitivity: "public" | "internal" | "personal" | "secret";
    readonly residency: "local-only" | "region-restricted" | "global-ok";
  };
}

export interface GenerateOptions {
  readonly abort?: AbortSignal;
}

export interface UsageSnapshot {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly estimated: boolean;
}

export interface ModelTrace {
  readonly clearance?: {
    readonly violation: boolean;
    readonly reason?: string;
  };
}

export interface TokenEstimate {
  readonly estimated: true;
  readonly tokens: number;
}

export interface ModelMetadata {
  readonly context_window: number;
  readonly id: string;
  readonly max_output?: number;
  readonly model: string;
}

export type NormalizedModelEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | {
      readonly type: "tool_call";
      readonly call_id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | { readonly type: "usage"; readonly usage: UsageSnapshot }
  | {
      readonly type: "done";
      readonly finish_reason: "stop" | "cancelled" | "error" | "tool-limit";
      readonly usage: UsageSnapshot;
      readonly trace?: ModelTrace;
    };

export interface DataClearance {
  readonly max_sensitivity: "public" | "internal" | "personal" | "secret";
  readonly residency: readonly ("local-only" | "region-restricted" | "global-ok")[];
  readonly regions?: readonly string[];
}

export interface ModelConfig {
  readonly id: string;
  readonly transport: "openai-chat";
  readonly base_url: string;
  readonly api_key_ref?: string;
  readonly model: string;
  readonly context_window: number;
  readonly max_output?: number;
  readonly data_clearance: DataClearance;
}

export interface RoleBinding {
  readonly model: string;
}

export interface ModelGatewayConfig {
  readonly models: readonly ModelConfig[];
  readonly roles: Readonly<Record<string, RoleBinding>>;
  readonly watchdogMs: number;
}

export class ProviderError extends Error {
  readonly auth: boolean;
  readonly context_overflow: boolean;
  readonly rate_limited: boolean;
  readonly retryable: boolean;

  constructor(message: string, options: { auth?: boolean; context_overflow?: boolean; rate_limited?: boolean; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.auth = options.auth ?? false;
    this.context_overflow = options.context_overflow ?? false;
    this.rate_limited = options.rate_limited ?? false;
    this.retryable = options.retryable ?? false;
  }
}

export interface ModelGateway {
  estimateTokens(input: string): TokenEstimate;
  generate(role: string, request: GenerateRequest, options?: GenerateOptions): AsyncIterable<NormalizedModelEvent>;
  modelInfo(role: string): ModelMetadata;
}
