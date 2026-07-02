# Spec: Canonical Protocol — Runtime Event/Item Schema

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-1, FR-14, NFR-9; clarifies ADR-002 via ADR-014 |
| Package | `packages/protocol` (normative home of all schemas) |

External review (ChatGPT deep-research, 2026-07) correctly flagged a risk: if the internal representation stays informally "Chat-Completions-shaped," approvals, progress, citations, and voice end up as bolt-on side channels and the system drifts into a chat wrapper. This spec fixes that by making the **runtime event canon** the normative internal language. It formalizes what ARCHITECTURE §6 sketched.

## 1. Three planes (ADR-014)

| Plane | Shape | Scope |
|---|---|---|
| **Runtime canon** (this spec) | Typed event/item stream | Source of truth: session logs, kernel, orchestrator, workflows, clients, replay, tests |
| **Model-boundary dialect** | Chat Completions superset | Exists *only inside* `model-gateway` transports; canon ⇄ dialect mapping is the gateway's job |
| **Client protocol** | Canon subset + subscriptions | What clients receive/send over WS; a filtered view, never a different schema |

Nothing outside `model-gateway` may construct or parse Chat-Completions shapes. Nothing anywhere invents event types not registered here.

## 2. Event taxonomy (normative registry)

All events use the envelope of ARCHITECTURE §6 (`v, id, sid, turn, ts, actor, type, provenance, labels, payload`). Payload schemas are versioned JSON Schema files in `packages/protocol/schemas/`, one per type. Registry v1:

| Family | Types | Notes |
|---|---|---|
| Turn | `turn.input` · `turn.delta` · `turn.final` · `turn.interrupted` | `input` carries content parts (text/artifact refs); `interrupted` carries last-heard mark |
| Reasoning | `reasoning.delta` | Normalized from vendor channels; never re-sent to models |
| Tool | `tool.call` · `tool.result` | `result` carries provenance + labels + artifact spillover refs |
| Approval | `approval.request` · `approval.resolved` | First-class, not a tool hack; see §4 |
| Progress | `progress.update` | Structured `{stage, detail, pct?}`; voice coordinator + UIs both consume |
| Plan | `plan.proposed` · `plan.step.updated` · `plan.deviation` | Plan artifact by ref; steps by id |
| Loop | `loop.iteration.started` · `loop.iteration.completed` · `loop.stopped` | Budgets snapshot in payload |
| Workflow | `workflow.checkpoint` · `workflow.run.updated` · `workflow.approval.parked` | Checkpoint = durable-execution unit |
| Memory | `memory.written` · `memory.superseded` · `memory.deleted` · `memory.gate.decision` | Gate decisions are auditable events (specs/memory §4a) |
| Research | `citation.recorded` · `snapshot.created` · `sourceset.reviewed` | See specs/research.md |
| Speech | `speech.asr.partial` · `speech.asr.final` · `speech.tts.chunk` · `speech.mark` | Relationship to binary frames: §5 |
| Affect | `affect.updated` | With cause summary |
| Artifact | `artifact.created` | `{path, hash, mime, labels, origin}` |
| Governance | `label.declassified` · `route.denied` · `budget.updated` · `audit.appended` | Router/egress refusals are visible events (specs/data-governance) |
| Delivery | `delivery.sent` · `delivery.digested` · `delivery.collapsed` · `delivery.expired` | Payload: `{class, channel, reason, source_workflow, storm_key?, created_at, expires_at?}`; `storm_key` **required** when `class: critical`. Makes quotas, digest TTL, and storm collapse assertable (COMPANION-CONTRACT §1) |
| Session | `session.created` · `session.compacted` · `session.resumed` | Compaction is an event; pre-state stays inspectable |
| Error | `error` | Normalized taxonomy (ARCHITECTURE §10) |

**Extension events:** namespaced `x.<vendor>.<name>`, tolerated by all readers, never load-bearing for core behavior.

## 3. Evolution rules

- Additive changes (new optional fields, new types) bump minor; readers MUST ignore unknown fields and unknown `x.*`/newer-minor types gracefully. Precisely: an unknown type (extension or newer-minor, i.e. any non-registered name) is validated at **envelope level only**, preserved verbatim in the log, and skipped by consumers — never an error.
- Breaking changes bump the envelope `v` (major) and require a migration script + one release of dual-write.
- Every type ships **golden fixtures** (valid + invalid samples). Client SDKs, the replay debugger, and the conformance kit all test against the same fixtures — one source of truth for "what Fairy speaks."

## 4. Approval flow (normative)

```
tool router / plan / workflow hits `ask` policy
  → approval.request {scope: call|plan-step|workflow-step, summary, risk_class,
                      options: [once, session, always-for-workspace, deny], expires}
  → any attached client may answer (first resolution wins; voice gets spoken digest)
  → approval.resolved {decision, scope, actor_client}
  → grant recorded (revocable; listed by /permissions); execution proceeds or PolicyError
```

Parked approvals (nobody answers) suspend the step, never silently allow. Workflows park durably (`workflow.approval.parked`) and resume on resolution — even across gateway restarts.

## 5. Speech frames ⇄ events

Binary audio frames travel on numbered WS channels (voice spec §2) and are **not** events; they are referenced by events: `speech.asr.final` carries the utterance audio artifact ref; `speech.tts.chunk` carries `{chunk_id, text, audio_ref?}`; `speech.mark` acknowledges client playback position so `turn.interrupted` can record exactly what was heard. Replay of a voice session therefore needs only the event log + artifacts directory.

## 6. Citation block (shared schema)

Used by research, memory evidence, and any sourced claim:

```jsonc
{ "claim": "…", "source": {"url", "title", "snapshot_ref", "span": {"start","end"}},
  "grade": "primary|official|news|blog|forum|unknown", "retrieved_at": "…" }
```

Renderers turn these into footnotes (text), spoken attributions ("据 Reuters…" — voice), or hover cards (desktop). A claim without a resolvable snapshot span fails the citation-precision eval (specs/evals.md).

## 7. Conformance

`packages/testing` ships a protocol conformance suite: fixture round-trips, unknown-type tolerance, approval state machine, mark accounting, envelope ordering (ULID monotonicity per session). Every client and every channel adapter must pass it in CI before merge.
