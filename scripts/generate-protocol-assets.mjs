import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const protocolRoot = join(repoRoot, "packages", "protocol");
const schemasDir = join(protocolRoot, "schemas");
const fixturesDir = join(protocolRoot, "fixtures");

const sensitivityEnum = ["public", "internal", "personal", "secret"];
const residencyEnum = ["local-only", "region-restricted", "global-ok"];
const deliveryClassEnum = ["critical", "briefing", "completion", "suggestion"];

const string = (extra = {}) => ({ type: "string", ...extra });
const number = (extra = {}) => ({ type: "number", ...extra });
const integer = (extra = {}) => ({ type: "integer", ...extra });
const array = (items, extra = {}) => ({ type: "array", items, ...extra });
const object = (properties, required = Object.keys(properties), extra = {}) => ({
  type: "object",
  additionalProperties: true,
  properties,
  required,
  ...extra
});

const labelsSchema = object({
  sensitivity: string({ enum: sensitivityEnum }),
  residency: string({ enum: residencyEnum })
});

const artifactRefSchema = object({
  ref: string({ minLength: 1 }),
  hash: string({ minLength: 1 }),
  mime: string({ minLength: 1 })
}, ["ref"]);

const contentPartSchema = {
  oneOf: [
    object({
      kind: string({ const: "text" }),
      text: string({ minLength: 1 })
    }),
    object({
      kind: string({ const: "artifact" }),
      ref: string({ minLength: 1 }),
      mime: string({ minLength: 1 })
    }, ["kind", "ref"])
  ]
};

const labelPairSchema = object({
  sensitivity: string({ enum: sensitivityEnum }),
  residency: string({ enum: residencyEnum })
});

const citationSchema = object({
  claim: string({ minLength: 1 }),
  source: object({
    url: string({ minLength: 1 }),
    title: string(),
    snapshot_ref: string({ minLength: 1 }),
    span: object({
      start: integer({ minimum: 0 }),
      end: integer({ minimum: 0 })
    })
  }),
  grade: string({ enum: ["primary", "official", "news", "blog", "forum", "unknown"] }),
  retrieved_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" })
});

const deliveryPayloadSchema = object({
  class: string({ enum: deliveryClassEnum }),
  channel: string({ minLength: 1 }),
  reason: string({ minLength: 1 }),
  source_workflow: string({ minLength: 1 }),
  storm_key: string({ minLength: 1 }),
  created_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" }),
  expires_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" })
}, ["class", "channel", "reason", "source_workflow", "created_at"], {
  allOf: [
    {
      if: {
        properties: {
          class: { const: "critical" }
        },
        required: ["class"]
      },
      then: {
        required: ["storm_key"]
      }
    }
  ]
});

const registry = [
  {
    type: "turn.input",
    family: "turn",
    payload: object({
      content: array(contentPartSchema, { minItems: 1 }),
      channel: string()
    }, ["content"]),
    valid: { content: [{ kind: "text", text: "Hello Fairy" }], channel: "cli" },
    invalid: { content: [{ kind: "text", text: "Hello Fairy" }], channel: "cli" },
    invalidEnvelopePatch: { labels: { sensitivity: "internal", residency: "local-preferred" } }
  },
  {
    type: "turn.delta",
    family: "turn",
    payload: object({ text: string({ minLength: 1 }), index: integer({ minimum: 0 }) }, ["text"]),
    valid: { text: "Hi", index: 0 },
    invalid: { index: 0 }
  },
  {
    type: "turn.final",
    family: "turn",
    payload: object({
      content: array(contentPartSchema, { minItems: 1 }),
      finish_reason: string({ enum: ["stop", "cancelled", "error", "tool-limit"] })
    }, ["content"]),
    valid: { content: [{ kind: "text", text: "Done" }], finish_reason: "stop" },
    invalid: { content: [] }
  },
  {
    type: "turn.interrupted",
    family: "turn",
    payload: object({ last_heard_mark: string({ minLength: 1 }), reason: string() }),
    valid: { last_heard_mark: "mark-1", reason: "barge-in" },
    invalid: { reason: "barge-in" }
  },
  {
    type: "reasoning.delta",
    family: "reasoning",
    payload: object({ text: string({ minLength: 1 }) }),
    valid: { text: "Considering tool use" },
    invalid: { text: "" }
  },
  {
    type: "tool.call",
    family: "tool",
    payload: object({ call_id: string({ minLength: 1 }), tool: string({ minLength: 1 }), args: object({}, []) }),
    valid: { call_id: "call-1", tool: "web.search", args: { q: "Fairy" } },
    invalid: { tool: "web.search", args: {} }
  },
  {
    type: "tool.result",
    family: "tool",
    payload: object({
      call_id: string({ minLength: 1 }),
      status: string({ enum: ["ok", "error"] }),
      result: {},
      error: object({ message: string({ minLength: 1 }), class: string() }, ["message"]),
      provenance: string({ minLength: 1 }),
      labels: labelsSchema,
      artifacts: array(artifactRefSchema)
    }, ["call_id", "status", "labels"]),
    valid: { call_id: "call-1", status: "ok", result: { items: [] }, provenance: "tool:web.search", labels: { sensitivity: "public", residency: "global-ok" }, artifacts: [] },
    invalid: { call_id: "call-1", status: "ok" }
  },
  {
    type: "approval.request",
    family: "approval",
    payload: object({
      scope: string({ enum: ["call", "plan-step", "workflow-step"] }),
      summary: string({ minLength: 1 }),
      risk_class: string({ enum: ["low", "medium", "high", "critical"] }),
      options: array(string({ enum: ["once", "session", "always-for-workspace", "deny"] }), { minItems: 1 }),
      expires: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" })
    }),
    valid: { scope: "call", summary: "Run shell command", risk_class: "medium", options: ["once", "deny"], expires: "2026-07-02T10:00:00.000Z" },
    invalid: { scope: "call", summary: "Run shell command", risk_class: "medium", options: [] }
  },
  {
    type: "approval.resolved",
    family: "approval",
    payload: object({
      decision: string({ enum: ["once", "session", "always-for-workspace", "deny"] }),
      scope: string({ enum: ["call", "plan-step", "workflow-step"] }),
      actor_client: string({ minLength: 1 })
    }),
    valid: { decision: "once", scope: "call", actor_client: "cli" },
    invalid: { decision: "allow", scope: "call", actor_client: "cli" }
  },
  {
    type: "progress.update",
    family: "progress",
    payload: object({ stage: string({ minLength: 1 }), detail: string({ minLength: 1 }), pct: number({ minimum: 0, maximum: 1 }) }, ["stage", "detail"]),
    valid: { stage: "search", detail: "Fetching sources", pct: 0.5 },
    invalid: { stage: "search", detail: "Fetching sources", pct: 2 }
  },
  {
    type: "plan.proposed",
    family: "plan",
    payload: object({
      plan_ref: string({ minLength: 1 }),
      steps: array(object({
        id: string({ minLength: 1 }),
        title: string({ minLength: 1 }),
        status: string({ enum: ["pending", "in_progress", "completed", "blocked", "skipped"] })
      }), { minItems: 1 })
    }),
    valid: { plan_ref: "artifacts/plan.md", steps: [{ id: "s1", title: "Inspect repo", status: "pending" }] },
    invalid: { plan_ref: "artifacts/plan.md", steps: [] }
  },
  {
    type: "plan.step.updated",
    family: "plan",
    payload: object({
      step_id: string({ minLength: 1 }),
      status: string({ enum: ["pending", "in_progress", "completed", "blocked", "skipped"] }),
      detail: string()
    }, ["step_id", "status"]),
    valid: { step_id: "s1", status: "in_progress", detail: "Reading files" },
    invalid: { step_id: "s1", status: "started" }
  },
  {
    type: "plan.deviation",
    family: "plan",
    payload: object({
      step_id: string({ minLength: 1 }),
      reason: string({ minLength: 1 }),
      severity: string({ enum: ["minor", "major"] })
    }),
    valid: { step_id: "s1", reason: "New required file discovered", severity: "minor" },
    invalid: { step_id: "s1", reason: "New required file discovered", severity: "huge" }
  },
  {
    type: "loop.iteration.started",
    family: "loop",
    payload: object({ iteration: integer({ minimum: 1 }), budgets: object({}, []) }),
    valid: { iteration: 1, budgets: { max_tokens: 1000 } },
    invalid: { iteration: 0, budgets: {} }
  },
  {
    type: "loop.iteration.completed",
    family: "loop",
    payload: object({
      iteration: integer({ minimum: 1 }),
      outcome: string({ enum: ["progress", "no_progress", "completed", "failed"] }),
      budgets: object({}, [])
    }, ["iteration", "outcome"]),
    valid: { iteration: 1, outcome: "progress", budgets: { remaining_tokens: 500 } },
    invalid: { iteration: 1, outcome: "maybe" }
  },
  {
    type: "loop.stopped",
    family: "loop",
    payload: object({ reason: string({ enum: ["completed", "budget_exhausted", "user_stopped", "anomaly", "error"] }), detail: string() }, ["reason"]),
    valid: { reason: "completed", detail: "Predicate passed" },
    invalid: { reason: "tired" }
  },
  {
    type: "workflow.checkpoint",
    family: "workflow",
    payload: object({ workflow_id: string({ minLength: 1 }), checkpoint_id: string({ minLength: 1 }), state_ref: string({ minLength: 1 }) }),
    valid: { workflow_id: "morning", checkpoint_id: "cp-1", state_ref: "workflows/morning/cp-1.json" },
    invalid: { workflow_id: "morning", checkpoint_id: "cp-1" }
  },
  {
    type: "workflow.run.updated",
    family: "workflow",
    payload: object({
      workflow_id: string({ minLength: 1 }),
      run_id: string({ minLength: 1 }),
      status: string({ enum: ["queued", "running", "parked", "completed", "failed", "cancelled"] })
    }),
    valid: { workflow_id: "morning", run_id: "run-1", status: "running" },
    invalid: { workflow_id: "morning", run_id: "run-1", status: "halfway" }
  },
  {
    type: "workflow.approval.parked",
    family: "workflow",
    payload: object({ workflow_id: string({ minLength: 1 }), approval_id: string({ minLength: 1 }), checkpoint_id: string({ minLength: 1 }) }),
    valid: { workflow_id: "deploy", approval_id: "approval-1", checkpoint_id: "cp-2" },
    invalid: { workflow_id: "deploy", approval_id: "approval-1" }
  },
  {
    type: "memory.written",
    family: "memory",
    payload: object({
      memory_id: string({ minLength: 1 }),
      tier: string({ enum: ["working", "episodic", "semantic", "procedural", "chronicle"] }),
      summary: string({ minLength: 1 })
    }),
    valid: { memory_id: "mem-1", tier: "semantic", summary: "User prefers concise answers." },
    invalid: { memory_id: "mem-1", tier: "secret", summary: "Do not persist" }
  },
  {
    type: "memory.superseded",
    family: "memory",
    payload: object({ memory_id: string({ minLength: 1 }), superseded_by: string({ minLength: 1 }), reason: string({ minLength: 1 }) }),
    valid: { memory_id: "mem-1", superseded_by: "mem-2", reason: "Preference changed" },
    invalid: { memory_id: "mem-1", reason: "Preference changed" }
  },
  {
    type: "memory.deleted",
    family: "memory",
    payload: object({ memory_id: string({ minLength: 1 }), reason: string({ minLength: 1 }) }),
    valid: { memory_id: "mem-1", reason: "User requested deletion" },
    invalid: { reason: "User requested deletion" }
  },
  {
    type: "memory.gate.decision",
    family: "memory",
    payload: object({ memory_id: string({ minLength: 1 }), decision: string({ enum: ["admit", "deny"] }), reason: string({ minLength: 1 }) }),
    valid: { memory_id: "mem-1", decision: "deny", reason: "Channel trust too low" },
    invalid: { memory_id: "mem-1", decision: "maybe", reason: "Unsure" }
  },
  {
    type: "citation.recorded",
    family: "research",
    payload: citationSchema,
    valid: { claim: "Fairy uses event logs.", source: { url: "https://example.test/fairy", title: "Fairy", snapshot_ref: "snap-1", span: { start: 0, end: 42 } }, grade: "official", retrieved_at: "2026-07-02T10:00:00.000Z" },
    invalid: { claim: "Fairy uses event logs.", source: { url: "https://example.test/fairy", title: "Fairy", snapshot_ref: "snap-1", span: { start: 0 } }, grade: "official", retrieved_at: "2026-07-02T10:00:00.000Z" }
  },
  {
    type: "snapshot.created",
    family: "research",
    payload: object({ snapshot_ref: string({ minLength: 1 }), url: string({ minLength: 1 }), hash: string({ minLength: 1 }), retrieved_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" }) }),
    valid: { snapshot_ref: "snap-1", url: "https://example.test", hash: "sha256:abc", retrieved_at: "2026-07-02T10:00:00.000Z" },
    invalid: { snapshot_ref: "snap-1", url: "https://example.test", retrieved_at: "2026-07-02T10:00:00.000Z" }
  },
  {
    type: "sourceset.reviewed",
    family: "research",
    payload: object({
      review_id: string({ minLength: 1 }),
      sources: array(object({ url: string({ minLength: 1 }), grade: string({ enum: ["primary", "official", "news", "blog", "forum", "sns", "unknown"] }) }), { minItems: 1 }),
      decision: string({ enum: ["approved", "needs_more_sources", "rejected"] })
    }),
    valid: { review_id: "review-1", sources: [{ url: "https://example.test", grade: "official" }], decision: "approved" },
    invalid: { review_id: "review-1", sources: [], decision: "approved" }
  },
  {
    type: "speech.asr.partial",
    family: "speech",
    payload: object({ utterance_id: string({ minLength: 1 }), text: string() }),
    valid: { utterance_id: "utt-1", text: "hello" },
    invalid: { utterance_id: "", text: "hello" }
  },
  {
    type: "speech.asr.final",
    family: "speech",
    payload: object({ utterance_id: string({ minLength: 1 }), text: string({ minLength: 1 }), audio_ref: string({ minLength: 1 }) }),
    valid: { utterance_id: "utt-1", text: "hello", audio_ref: "artifacts/utt-1.opus" },
    invalid: { utterance_id: "utt-1", text: "hello" }
  },
  {
    type: "speech.tts.chunk",
    family: "speech",
    payload: object({ chunk_id: string({ minLength: 1 }), text: string({ minLength: 1 }), audio_ref: string({ minLength: 1 }) }, ["chunk_id", "text"]),
    valid: { chunk_id: "chunk-1", text: "On it.", audio_ref: "artifacts/chunk-1.opus" },
    invalid: { chunk_id: "chunk-1", text: "" }
  },
  {
    type: "speech.mark",
    family: "speech",
    payload: object({ mark_id: string({ minLength: 1 }), position_ms: integer({ minimum: 0 }) }),
    valid: { mark_id: "mark-1", position_ms: 1200 },
    invalid: { mark_id: "mark-1", position_ms: -1 }
  },
  {
    type: "affect.updated",
    family: "affect",
    payload: object({
      valence: number({ minimum: -1, maximum: 1 }),
      arousal: number({ minimum: 0, maximum: 1 }),
      stance: string({ enum: ["warm", "neutral", "focused", "playful"] }),
      cause: string({ minLength: 1 })
    }),
    valid: { valence: 0.2, arousal: 0.4, stance: "warm", cause: "User completed a task" },
    invalid: { valence: 2, arousal: 0.4, stance: "warm", cause: "Too much" }
  },
  {
    type: "artifact.created",
    family: "artifact",
    payload: object({
      path: string({ minLength: 1 }),
      hash: string({ minLength: 1 }),
      mime: string({ minLength: 1 }),
      labels: labelsSchema,
      origin: string({ minLength: 1 })
    }),
    valid: { path: "artifacts/report.md", hash: "sha256:def", mime: "text/markdown", labels: { sensitivity: "internal", residency: "global-ok" }, origin: "tool:research" },
    invalid: { path: "artifacts/report.md", mime: "text/markdown", labels: { sensitivity: "internal", residency: "global-ok" }, origin: "tool:research" }
  },
  {
    type: "label.declassified",
    family: "governance",
    payload: object({ target_ref: string({ minLength: 1 }), from: labelPairSchema, to: labelPairSchema, reason: string({ minLength: 1 }) }),
    valid: { target_ref: "artifact:report", from: { sensitivity: "personal", residency: "local-only" }, to: { sensitivity: "internal", residency: "global-ok" }, reason: "User approved sharing" },
    invalid: { target_ref: "artifact:report", from: { sensitivity: "personal", residency: "local-only" }, to: { sensitivity: "unknown", residency: "global-ok" }, reason: "User approved sharing" }
  },
  {
    type: "route.denied",
    family: "governance",
    payload: object({ role: string({ minLength: 1 }), reason: string({ minLength: 1 }), required_clearance: labelPairSchema }),
    valid: { role: "main", reason: "No model satisfies local-only", required_clearance: { sensitivity: "personal", residency: "local-only" } },
    invalid: { role: "main", reason: "No model satisfies local-only", required_clearance: { sensitivity: "personal", residency: "local-preferred" } }
  },
  {
    type: "budget.updated",
    family: "governance",
    payload: object({ scope: string({ minLength: 1 }), limit: number({ minimum: 0 }), used: number({ minimum: 0 }), unit: string({ enum: ["tokens", "usd", "calls", "ms"] }) }),
    valid: { scope: "session", limit: 10000, used: 250, unit: "tokens" },
    invalid: { scope: "session", limit: 10000, used: 250, unit: "minutes" }
  },
  {
    type: "audit.appended",
    family: "governance",
    payload: object({ audit_id: string({ minLength: 1 }), action: string({ minLength: 1 }), decision: string({ enum: ["allow", "ask", "deny"] }) }),
    valid: { audit_id: "audit-1", action: "shell", decision: "ask" },
    invalid: { audit_id: "audit-1", action: "shell", decision: "maybe" }
  },
  ...["delivery.sent", "delivery.digested", "delivery.collapsed", "delivery.expired"].map((type) => ({
    type,
    family: "delivery",
    payload: deliveryPayloadSchema,
    valid: { class: "briefing", channel: "desktop", reason: "Morning briefing", source_workflow: "morning", created_at: "2026-07-02T08:00:00.000Z", expires_at: "2026-07-05T08:00:00.000Z" },
    invalid: { class: "critical", channel: "desktop", reason: "Task failed", source_workflow: "overnight", created_at: "2026-07-02T08:00:00.000Z" }
  })),
  {
    type: "session.created",
    family: "session",
    payload: object({ created_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" }), title: string() }, ["created_at"]),
    valid: { created_at: "2026-07-02T10:00:00.000Z", title: "Default session" },
    invalid: { title: "Default session" }
  },
  {
    type: "session.compacted",
    family: "session",
    payload: object({
      range: object({ start_turn: integer({ minimum: 0 }), end_turn: integer({ minimum: 0 }) }),
      summary_ref: string({ minLength: 1 })
    }),
    valid: { range: { start_turn: 1, end_turn: 10 }, summary_ref: "artifacts/compaction-1.md" },
    invalid: { range: { start_turn: 1 }, summary_ref: "artifacts/compaction-1.md" }
  },
  {
    type: "session.resumed",
    family: "session",
    payload: object({ resumed_at: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" }), snapshot_ref: string({ minLength: 1 }) }, ["resumed_at"]),
    valid: { resumed_at: "2026-07-02T10:00:00.000Z", snapshot_ref: "snapshot.json" },
    invalid: { snapshot_ref: "snapshot.json" }
  },
  {
    type: "error",
    family: "error",
    payload: object({
      class: string({ enum: ["UserError", "ProviderError", "ToolError", "PolicyError", "Fatal"] }),
      message: string({ minLength: 1 }),
      retryable: { type: "boolean" }
    }, ["class", "message"]),
    valid: { class: "ToolError", message: "Command failed", retryable: false },
    invalid: { class: "MysteryError", message: "Command failed" }
  }
];

const envelopeSchema = (event) => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://openfairy.local/schemas/protocol/v1/${event.type}.json`,
  title: `Fairy protocol event ${event.type} v1`,
  type: "object",
  additionalProperties: true,
  properties: {
    v: { const: 1 },
    id: string({ pattern: "^evt_[0-9A-HJKMNP-TV-Z]{26}$" }),
    sid: string({ pattern: "^ses_[0-9A-HJKMNP-TV-Z]{26}$" }),
    turn: integer({ minimum: 0 }),
    ts: string({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" }),
    actor: string({ pattern: "^(user|agent|tool|system|subagent:[A-Za-z0-9_.-]+|workflow:[A-Za-z0-9_.-]+)$" }),
    type: { const: event.type },
    provenance: string({ pattern: "^(user|agent|tool:[^\\s]+|web:[^\\s]+|mcp:[^\\s]+)$" }),
    labels: labelsSchema,
    payload: event.payload
  },
  required: ["v", "id", "sid", "turn", "ts", "actor", "type", "provenance", "labels", "payload"]
});

const stableStringify = (value) => {
  const normalize = (input) => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)])
      );
    }
    return input;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
};

const fixtureUlid = (index) => `01J${String(index).padStart(23, "0").slice(-23)}`;

const fixtureEnvelope = (event, payload, index) => ({
  actor: event.family === "tool" ? "tool" : "agent",
  id: `evt_${fixtureUlid(index)}`,
  labels: { sensitivity: "internal", residency: "global-ok" },
  payload,
  provenance: event.family === "research" ? "web:example.test" : "agent",
  sid: `ses_${fixtureUlid(0)}`,
  ts: "2026-07-02T10:00:00.000Z",
  turn: 1,
  type: event.type,
  v: 1
});

rmSync(schemasDir, { recursive: true, force: true });
rmSync(fixturesDir, { recursive: true, force: true });
mkdirSync(schemasDir, { recursive: true });
mkdirSync(fixturesDir, { recursive: true });

const manifest = {
  protocol_version: 1,
  event_types: registry.map(({ family, type }) => ({ family, type }))
};

writeFileSync(join(schemasDir, "registry.v1.json"), stableStringify(manifest));

registry.forEach((event, index) => {
  writeFileSync(join(schemasDir, `${event.type}.v1.json`), stableStringify(envelopeSchema(event)));

  const valid = fixtureEnvelope(event, event.valid, index);
  const invalid = {
    ...fixtureEnvelope(event, event.invalid, index),
    ...(event.invalidEnvelopePatch ?? {})
  };

  writeFileSync(join(fixturesDir, `${event.type}.valid.json`), stableStringify(valid));
  writeFileSync(join(fixturesDir, `${event.type}.invalid.json`), stableStringify(invalid));
});

writeFileSync(join(fixturesDir, "x.vendor.event.valid.json"), stableStringify({
  actor: "agent",
  id: "evt_01J00000000000000000000000",
  labels: { sensitivity: "public", residency: "global-ok" },
  payload: { vendor_payload: true },
  provenance: "agent",
  sid: "ses_01J00000000000000000000000",
  ts: "2026-07-02T10:00:00.000Z",
  turn: 1,
  type: "x.vendor.event",
  v: 1
}));

console.log(`Generated ${registry.length} protocol schemas and ${registry.length * 2 + 1} fixtures.`);
