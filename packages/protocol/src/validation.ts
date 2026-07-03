import { Ajv2020, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { join } from "node:path";

import { readJsonFile } from "./json.js";
import { eventRegistry, isRegisteredEventType } from "./registry.js";
import { framesDir, schemasDir } from "./paths.js";
import type { EventEnvelope, FrameValidationResult, TransportFrame, ValidationIssue, ValidationResult } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false
});

const envelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: true,
  properties: {
    v: { const: 1 },
    id: { type: "string", pattern: "^evt_[0-9A-HJKMNP-TV-Z]{26}$" },
    sid: { type: "string", pattern: "^ses_[0-9A-HJKMNP-TV-Z]{26}$" },
    turn: { type: "integer", minimum: 0 },
    ts: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" },
    actor: { type: "string", pattern: "^(user|agent|tool|system|subagent:[A-Za-z0-9_.-]+|workflow:[A-Za-z0-9_.-]+)$" },
    type: { type: "string", pattern: "^(x\\.[a-z0-9-]+\\.[a-z0-9_.-]+|[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*)$" },
    provenance: { type: "string", pattern: "^(user|agent|tool:[^\\s]+|web:[^\\s]+|mcp:[^\\s]+)$" },
    labels: {
      type: "object",
      additionalProperties: true,
      properties: {
        sensitivity: { type: "string", enum: ["public", "internal", "personal", "secret"] },
        residency: { type: "string", enum: ["local-only", "region-restricted", "global-ok"] }
      },
      required: ["sensitivity", "residency"]
    },
    payload: { type: "object" }
  },
  required: ["v", "id", "sid", "turn", "ts", "actor", "type", "provenance", "labels", "payload"]
};

const envelopeValidator = ajv.compile(envelopeSchema);

const validators = new Map<string, ValidateFunction>(
  eventRegistry.map((entry) => [
    entry.type,
    ajv.compile(readJsonFile(join(schemasDir, entry.schemaFile)) as AnySchema)
  ])
);

const frameValidators = new Map<string, ValidateFunction>([
  ["ack", ajv.compile(readJsonFile(join(framesDir, "ack.v1.json")) as AnySchema)],
  ["op-error", ajv.compile(readJsonFile(join(framesDir, "op-error.v1.json")) as AnySchema)]
]);

const formatErrors = (errors: ErrorObject[] | null | undefined): ValidationIssue[] =>
  (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? error.keyword
  }));

export const validateEvent = (value: unknown): ValidationResult => {
  if (!envelopeValidator(value)) {
    return { ok: false, issues: formatErrors(envelopeValidator.errors) };
  }

  const event = value as EventEnvelope;

  if (!isRegisteredEventType(event.type)) {
    return { ok: true, event, known: false };
  }

  const validator = validators.get(event.type);
  if (!validator) {
    return {
      ok: false,
      issues: [{ path: "/type", message: `registered event type ${event.type} has no schema` }]
    };
  }

  if (!validator(event)) {
    return { ok: false, issues: formatErrors(validator.errors) };
  }

  return { ok: true, event, known: true };
};

export const assertValidEvent = (value: unknown): EventEnvelope => {
  const result = validateEvent(value);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Fairy protocol event: ${details}`);
  }

  return result.event;
};

export const validateFrame = (value: unknown): FrameValidationResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "/", message: "must be object" }] };
  }

  const kind = (value as { kind?: unknown }).kind;
  if (kind !== "ack" && kind !== "op-error") {
    return { ok: false, issues: [{ path: "/kind", message: "must be ack or op-error" }] };
  }

  const validator = frameValidators.get(kind);
  if (!validator || !validator(value)) {
    return { ok: false, issues: formatErrors(validator?.errors) };
  }

  return { frame: value as TransportFrame, ok: true };
};
