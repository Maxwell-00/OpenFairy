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
| Memory | `memory.written` · `memory.superseded` · `memory.deleted` · `memory.gate.decision` *(M2-08: Chronicle + consolidation v0 introduce **no** new event types — chronicle tools emit canonical `tool.call`/`tool.result`, reports ride `artifact.created` with payload kind `memory.consolidation.report`)* | Gate decisions are auditable events (specs/memory §4a). `gate.decision.payload.decision ∈ allow \| deny \| hold`; `payload.phase ∈ admission \| retrieval` (additive since M2-02 — one event type, two enforcement points). Retrieval denials carry reason code + record id but **never denied record text** for `personal+` records |
| Research | `citation.recorded` · `snapshot.created` · `sourceset.reviewed` | See specs/research.md. *Live since M2-03:* `snapshot.created` carries content-addressed `snapshot_ref`/`hash`, labels, and optional `fetch_error`; `sourceset.reviewed` requires ≥ 1 source (empty source set ⇒ plain tool result, no event) and carries `warnings[]`; budget/fetch failures reuse these fields or `progress.update` — **no new research event types**. `citation.recorded.payload.grade` accepts the full source taxonomy incl. `sns` |
| Speech | `speech.asr.partial` · `speech.asr.final` · `speech.tts.chunk` · `speech.mark` | Relationship to binary frames: §5. *Live since M3-01 (loopback transport): payload field semantics and the voice-originated `turn.input` convention are normative in §5* |
| Affect | `affect.updated` | With cause summary. *Payload reconciled pre-M2-05 (additive): `valence`/`arousal` ∈ -1..1, `stance` enum gains `dry` (persona-affect baseline), `cause` required, optional `energy` (`low\|medium\|high`) + `updated_at`. Emitted since M2-05 by the deterministic affect engine at turn boundaries; the v1 engine emits the `warm\|neutral\|dry` stance subset. M2-05b: no schema change — `cause` remains required in the event but is no longer rendered into the prompt prefix (context-engine §1)* |
| Artifact | `artifact.created` | `{path, hash, mime, labels, origin}`. *Since M2-06 perception artifacts additively carry `artifact_id`, `kind`, `size_bytes`, `source_filename`, `metadata`; blob/base64 content never enters the payload (test-asserted); replay text renders `artifact.created` compactly* |
| Governance | `label.declassified` · `route.denied` · `budget.updated` · `audit.appended` | Router/egress refusals are visible events (specs/data-governance). *Egress denials (M2-04) reuse existing types: `tool.result` error payload + audit rows + optional `progress.update {stage: "egress.denied"}` — there is **no** `egress.denied` canonical event type; it is a stage/op string only. Denial diagnostics carry reason codes + hashed fingerprints, never raw secret/personal strings* |
| Delivery | `delivery.sent` · `delivery.digested` · `delivery.collapsed` · `delivery.expired` | Payload: `{class, channel, reason, source_workflow, storm_key?, created_at, expires_at?}`; `storm_key` **required** when `class: critical`. Makes quotas, digest TTL, and storm collapse assertable (COMPANION-CONTRACT §1) |
| Session | `session.created` · `session.compacted` · `session.resumed` | Compaction is an event; pre-state stays inspectable. *Since M2-07: `session.compacted {range:{start_turn,end_turn}, summary_ref}` is emitted for L5 handoffs, `summary_ref` resolving to the durable summary artifact; L4 micro-compaction is represented by `artifact.created` (kind `context.compaction.l4`) + `context.manifest.reduction_stages_applied` — no new event types* |
| Context | `context.manifest` | Per assembled prompt: zone sizes (tokens, estimated flag), budgets incl. output reserve, reduction stages applied (L1–L5), stable-prefix hash. **Observational only — never enters prompt/history assembly** (test-asserted). The replay debugger's primary food. Normative since M1-03 |
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

*Normative since M3-01 (loopback transport; see specs/voice-pipeline.md for the pipeline):*

- **Payload field semantics (registered v1, authoritative):** `speech.asr.partial {utterance_id, text}` — interim transcript, observability-only, never model input; `speech.asr.final {utterance_id, text, audio_ref}` — the only ASR event eligible to become user input; partial/final events for one utterance share `utterance_id`; `speech.tts.chunk {chunk_id, text, audio_ref?}` — output-only, never re-enters prompts; `speech.mark {mark_id, position_ms}`.
- **`mark_id` is an open string — never enum-narrowed** (§3 additive-minor law). Conventional vocabulary emitted by the loopback transport: `asr-start`, `asr-end`, `tts-start`, `tts-end`, `turn-boundary`, `barge-in-placeholder` (inert until the barge-in slice). Transports document and transport-level-test their mark vocabulary rather than narrowing the schema. *M3-02 adds `asr-cancelled` via the additive `duplexMarkVocabulary` (emitted when ASR is cancelled before final — no `turn.input` follows); same discipline, still no enum.*
- **Voice-originated turn input:** envelope `provenance: "user"` (the provenance pattern has no `speech` value), `payload.channel: "voice"`, additive `payload.speech: {utterance_id, audio_ref}` linking to the source utterance, and `payload.routing_hints.prefer_local` when the governance profile carries the hint (advisory only, never gating — data-governance §1a/§3). Exactly one `turn.input` per final ASR transcript, authored by the gateway through the normal turn path; ASR partials never become model input.
- **No raw audio/base64 in JSONL payloads** (test-asserted, matching the `artifact.created` precedent); `audio_ref` is always a reference — the loopback transport uses deterministic `loopback://audio/...` / `loopback://tts/...` refs.
- **Replay:** text mode renders all four speech types compactly; `--json` preserves full payloads; corrupt-tail tolerance is unchanged.

## 6. Citation block (shared schema)

Used by research, memory evidence, and any sourced claim:

```jsonc
{ "claim": "…", "source": {"url", "title", "snapshot_ref", "span": {"start","end"}},
  "grade": "primary|official|news|blog|forum|sns|unknown", "retrieved_at": "…" }
```

Renderers turn these into footnotes (text), spoken attributions ("据 Reuters…" — voice), or hover cards (desktop). A claim without a resolvable snapshot span fails the citation-precision eval (specs/evals.md). `grade` equals the source's grade — no lossy remap; the enum is the full 7-value source taxonomy (incl. `sns`, reconciled at M2-03).

## 7. Client operations (WS) — normative since M0-02

Client→gateway messages are small **op frames**, not envelopes; only the gateway authors canonical envelopes (ids, turn numbers, labels — clients never self-assign these):

| Op | Shape | Gateway behavior |
|---|---|---|
| `session.create` | `{op}` | Creates session, emits `session.created` |
| `turn.input` | `{op, sid, content}` | Constructs + logs + streams the canonical `turn.input` envelope, then the response stream |
| `event` | `{op, event}` | Pass-through for pre-built envelopes; validated; **M0 accepts only `turn.input`** (accepted set will be advertised via `/meta` capabilities as it widens) |
| `turn.cancel` | `{op, sid}` | Aborts the in-flight turn for the session: model stream aborted, `turn.interrupted` emitted with a cancellation mark. Nothing in flight → transport-level ack frame (below), no envelope. Normative since M1-01 |
| `session.attach` | `{op, sid, replay_from?}` | Replays historical envelopes (from `replay_from` event id; default all), then live events. Replay/live boundary: gateway emits a fresh `session.resumed` envelope after the historical batch (**normative from M1-02**; M1-01 streams without a marker). Normative since M1-01 |
| `approval.resolve` | `{op, sid, request_id, decision: once\|session\|deny}` | Answers a pending `approval.request`; `request_id` is the **envelope id** of the request (no separate payload id). First resolution wins; gateway emits `approval.resolved`. Normative since M1-02 |

**Transport-level frames vs. envelopes (normative shapes since M1-04):** the gateway→client stream is canonical envelopes, plus exactly two **transport frame** kinds for op-level responses that are not session facts — `{kind: "ack", op, ...}` (op accepted, nothing to log) and `{kind: "op-error", op, message, ...}` (malformed op, unknown sid, bad `request_id` — transport mistakes, not session facts). Every client op yields a deterministic response: session facts as envelopes, non-facts as frames; silent drops are forbidden. Frames are schema'd + fixture-tested in `packages/protocol/frames/` — deliberately **outside** the event registry (they are never appended to session logs). Session-scoped errors remain `error` envelopes. *Since M3-02 a third frame family exists: the gateway⇄speech-worker duplex control frames (voice-pipeline §2 / M3-02 status note), validated + fixture-tested in `packages/voice/fixtures/` — equally outside the event registry, never appended to session logs; binary audio frames are in-memory only, and the replay surface remains canonical `speech.*` events exclusively. M3-03 carries this family over a real loopback WebSocket (text = JSON control frames, binary = audio envelope) without changing the rule: WebSocket messages are transport frames, never events, never JSONL; the canonical voice replay surface is still exactly the four registered `speech.*` types.* **HTTP endpoints** (`/health`, `/meta`, `/sessions`) share the gateway token via `Authorization: Bearer` (`/health` may be exempted by config for probes — default requires auth only for `/sessions`).

Gateway→client is the **raw canonical envelope stream** — no wrapper. Auth at WS connect: `Authorization: Bearer <token>` or `?token=` query; missing/invalid → close `4401` with no stream (details: sandbox-security §7). Unknown ops → `error` event; connection stays open.

## 8. Conformance

`packages/testing` ships a protocol conformance suite: fixture round-trips, unknown-type tolerance, approval state machine, mark accounting, envelope ordering (ULID monotonicity per session), and the client-op contract of §7. Every client and every channel adapter must pass it in CI before merge.
