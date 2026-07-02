# Task M1-01 — Kernel TurnRunner + model gateway (one provider) + CLI chat + session resume

> Paste this entire file as the task brief. Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`. M0 is closed (CI green both OS). This is the first slice of M1: after this task, Fairy is a daily-usable chat assistant.

## Context — read first, in this order

1. `CLAUDE.md` — invariants. Two rule this task lives or dies by: **one TurnRunner (ADR-012)** and **vendor SDKs only inside model-gateway transports (ADR-002/011)**.
2. `tasks/M0-02-review.md` — accepted state + standing process (owner commits, reviewer reviews from git).
3. `docs/specs/protocol.md` §7 — client ops, **including the new `turn.cancel` op** (normative for this task).
4. `docs/specs/model-gateway.md` — registry, roles, normalization (§4 table is your checklist subset).
5. `docs/ARCHITECTURE.md` §5.1 (text turn), §9 (dependency rules), §10 (config).

## Deliverables

### 1. `packages/model-gateway` v0
- **`openai-chat` transport speaking raw HTTP + SSE — the `openai` npm package is forbidden** (dep-cruiser already enforces this; the wire format is hand-rolled per spec §1). Streaming chat completions: request build, SSE parse, delta assembly.
- Normalization v0 (subset of spec §4): text deltas → normalized stream; `reasoning_content` field and `<think>`-tag extraction → separate `reasoning` deltas (never echoed back into history); usage (missing usage → `estimated: true` via char-count heuristic); finish_reason mapping; error taxonomy (`ProviderError{retryable, rate_limited, auth, context_overflow}`) with jittered retry (≤ 3) on retryables; stream idle watchdog (config, default 60 s) with clean abort. **Tool calls are M1-02 — do not implement.**
- Model registry from config (`models:` — validate entries incl. `data_clearance`; `api_key_ref: secret://…` resolved **only inside the transport** via the M0-02 env convention).
- Role router v0: `roles.main` → model binding; unknown role or unbound → config validation error. Clearance check runs **log-only** (compute violation, attach to trace, never block — enforcement is M2). No fallback chains yet (M1-04).
- Interface per spec §7: `generate(role, request, {abort}) → AsyncIterable<normalized events>`.

### 2. `packages/kernel` — TurnRunner v0
- **Replaces the echo responder**: delete `apps/gateway/src/dev/echo-responder.ts`, swap the single call site. From this commit on there is exactly one agent loop in the codebase.
- Turn flow: assemble prompt (zone skeleton: system zone from config `kernel.system_prompt` with a sensible default; full session history; current input) → `generate(main, …)` → emit `turn.delta` / `reasoning.delta` as they stream → `turn.final` with content + usage → all events through the existing EventLog.
- The runner API must be **tool-ready** (a tool-execution seam exists but is empty — no registry, no execution) and **abort-ready**: `turn.cancel` op wires to an AbortSignal → model stream aborted → `turn.interrupted` emitted with a cancellation mark; concurrent input during a running turn → reject with `error` event (one turn in flight per session; TurnRunner serializes).
- No memory taps, no affect, no context reduction (M2/M1-03). History that exceeds the model window → clean `context_overflow` error surfaced to the user (the ladder comes later; failing honestly beats failing weirdly).

### 3. Session resume (gateway)
- On gateway start / session attach: rebuild session state (turn counter, prompt history) from `log.jsonl`. New op `session.attach {op, sid, replay_from?}` → gateway streams back historical envelopes (from `replay_from` event id, default: all) then live events. *(Op shape per protocol §7 — if you need to deviate, stop and report.)*
- Kill-mid-turn safety: on boot, a session whose log ends inside an open turn gets a synthetic `turn.interrupted` (reason: `gateway_restart`) appended — the log never lies about a turn that half-happened.
- Turn numbering and ULID monotonicity must survive restart (e2e-asserted).

### 4. `apps/cli` — `fairy chat`
- `fairy chat [--session <sid>] [--gateway ws://…]`: creates or attaches; renders history on attach; streams deltas as they arrive; reasoning deltas rendered dim/prefixed (toggle `--show-reasoning`, default on); usage line after each turn (`tokens in/out · est?`); `Ctrl+C` once = `turn.cancel`, twice = exit; plain readline, no TUI framework (that's later).
- `fairy sessions` — list sessions from the gateway (needs a tiny HTTP endpoint `GET /sessions`; id + created + last-active + turn count).

### 5. Mock provider (for CI — no secrets in CI, ever)
- `packages/testing`: minimal OpenAI-compat mock server (HTTP + SSE): scripted streaming responses, optional `reasoning_content`, configurable delays/errors (429 once → success; mid-stream stall for watchdog test).
- E2E (both OS): gateway + mock provider → chat round-trip (deltas → final, usage present) → **kill gateway process mid-stream → restart → `session.attach` replays history, synthetic `turn.interrupted` present, next turn numbered correctly** → `turn.cancel` mid-stream → `turn.interrupted` with cancellation mark. All envelopes schema-valid; `log.jsonl` parses.

## Boundaries — do NOT

- No tools, no permission engine (M1-02). No context reduction ladder (M1-03). No second provider / conformance kit / fallback chains (M1-04). No memory/persona (M2).
- No `openai`/`@anthropic-ai/*`/vendor SDKs anywhere. Allowed new deps: `eventsource-parser` (or hand-rolled SSE — your call, justify). Nothing else without justification.
- No new event types; no schema edits; `session.attach` is the only op addition beyond protocol §7 as written — implement exactly the documented `turn.cancel` semantics.
- Do not touch `docs/` (propose edits in the report — reviewer applies). Do not weaken or skip existing tests.
- Config keys: extend `packages/config` schema for `kernel.system_prompt`, `gateway.watchdog_s` etc. — keys must be spelled in your report's decisions list.

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
```
- E2E suite above passes on `windows-latest` and `ubuntu-latest`.
- Manual (owner will verify): real provider configured in `fairy.yaml` (any OpenAI-compatible endpoint) → `fairy chat` streams a conversation; kill gateway; `fairy chat --session <sid>` shows history and continues.
- `git grep -l "echo-responder"` returns nothing; exactly one implementation of the agent loop exists.

## Report back (same format)

1. File tree delta. 2. Verification tails (incl. both-OS e2e). 3. **Decisions made** (incl. every new config key). 4. **Spec ambiguities found**. 5. Proposed doc edits (incl. `session.attach` op row + `/sessions` endpoint for protocol §7 / ARCHITECTURE §7 — reviewer applies). 6. A short real-provider chat transcript (redact the endpoint/key).
