export const PROTOCOL_VERSION = 1 as const;

export const SENSITIVITY_VALUES = ["public", "internal", "personal", "secret"] as const;
export const RESIDENCY_VALUES = ["local-only", "region-restricted", "global-ok"] as const;

export type Sensitivity = (typeof SENSITIVITY_VALUES)[number];
export type Residency = (typeof RESIDENCY_VALUES)[number];

export interface Labels {
  readonly sensitivity: Sensitivity;
  readonly residency: Residency;
}

export type Actor =
  | "user"
  | "agent"
  | "tool"
  | "system"
  | `subagent:${string}`
  | `workflow:${string}`;

export type Provenance =
  | "user"
  | "agent"
  | `tool:${string}`
  | `web:${string}`
  | `mcp:${string}`;

export interface EventEnvelope<TPayload = unknown, TType extends string = string> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly id: `evt_${string}`;
  readonly sid: `ses_${string}`;
  readonly turn: number;
  readonly ts: string;
  readonly actor: Actor;
  readonly type: TType;
  readonly provenance: Provenance;
  readonly labels: Labels;
  readonly payload: TPayload;
  readonly [key: string]: unknown;
}

export interface EventRegistryEntry {
  readonly family: string;
  readonly type: string;
  readonly schemaFile: string;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly event: EventEnvelope; readonly known: boolean }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
