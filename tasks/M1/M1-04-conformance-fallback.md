# Task M1-04 — Conformance kit v1 + second provider + fallback chains + prompted tools (closes M1)

> Paste this entire file as the task brief. Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`. M1-01/02/03 are closed. This task makes "any OpenAI-compatible model, switchable by config" a **tested claim** instead of a slogan — and closes milestone M1.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — invariants; especially the **mock-parity rule** (M1-02) — this task industrializes it.
2. `tasks/M1-02-review.md` addendum #1 (the dotted-name incident) and `tasks/M1-01-review.md` carry-in #2 (op-ack uniformity) — both come due here.
3. `docs/specs/model-gateway.md` §4 (normalization variance table — your fixture checklist), §5 (tool-calling degradation ladder — you implement rung 2), §8–§9 (failure behavior, conformance intent).
4. `docs/specs/protocol.md` §7 (client ops + "transport-level frames vs. envelopes" ruling — the op-ack contract to make uniform).
5. `docs/ROADMAP.md` M1 — the exit criteria this task completes.

## Deliverables

### 1. Conformance kit v1 (`packages/testing`)
A named, runnable suite that certifies an OpenAI-compatible endpoint against Fairy's transport expectations:

- **Coverage (one fixture/case per row of model-gateway §4):** streaming text deltas; tool-call deltas (fragmented args / whole-call / parallel / name-first-empty-args / malformed JSON); reasoning channels (`reasoning_content` field AND `<think>` tags); usage present / missing (→ `estimated: true`); finish_reason mapping; error bodies (429 retry, 5xx retry, 400 context-overflow classification, 401/403 auth); stream stall → watchdog abort; **function-name charset rejection** (the M1-02 incident, now a permanent case); wire-name codec round-trip.
- **Two run modes:** ① against the mock in CI (every PR, both OS); ② against any **live configured endpoint**: `pnpm conformance --model <registry-id>` — owner-run, never in CI, no secrets in CI. Live mode tolerates non-deterministic content but asserts protocol shape (deltas parse, tool call round-trips with a trivial echo tool, usage/finish present or classified).
- Output: per-case pass/fail table + a machine-readable JSON verdict (this becomes the eval-suite hook later).

### 2. Second provider verified: Ollama (local, zero cost)
- Whatever the kit reveals about Ollama's OpenAI-compat quirks (`/v1/chat/completions` shapes, tool support varying by model, usage fields, stream termination) gets fixed **in the transport/normalizer with a fixture**, never with an Ollama special-case in the kernel.
- Config example in the report (`base_url: http://127.0.0.1:11434/v1`, key optional/dummy). Owner will run live conformance against Ollama + DeepSeek.

### 3. Fallback chains (role router)
- `roles.<role>.fallback: [model-ids]` (config). On `ProviderError` with `auth` or retries-exhausted `retryable`/5xx: advance to the next candidate.
- **Switch boundaries only:** at turn start or between tool-loop iterations — never silently mid-stream (a partial stream from model A is aborted and the iteration restarted on B).
- **Visible, never silent:** fallback recorded in `model_trace` AND emitted as a `progress.update` (`{stage: "model-fallback", from, to, reason}`) — no new event types needed.
- E2E: mock primary fails 5xx persistently → fallback mock succeeds → turn completes; trace + progress assert the switch.

### 4. Prompted-tools fallback (degradation ladder rung 2 — model-gateway §5)
For `models[].capabilities.tools: "prompted"` (and the registry gains this field; `native` default, `none` refuses tool-requiring roles at config validation):
- Render tool schemas compactly into the system zone; instruct a fenced ```tool_call``` JSON output grammar; parse with a **tolerant parser** (prose-wrapped calls, CJK punctuation, single vs double quotes tolerated where unambiguous); validate against the tool's JSON Schema; **repair loop ≤ 2** (re-prompt with the validation error) before surfacing `ToolError`.
- Emitted normalized `tool_call` events are indistinguishable downstream from native ones (kernel/permission/audit unchanged).
- Mock gains a "prompted mode" script (returns fenced JSON in text, including one malformed-then-repaired sequence) → CI e2e covers happy path + repair + exhaustion.

### 5. Op-ack uniformity (M1-01 carry-in)
Apply protocol §7's "transport frames vs. envelopes" ruling consistently across **all** ops: every client op gets a deterministic response — session facts as envelopes (already), non-facts as `{kind: "ack", op, ...}` transport frames; op errors (bad `request_id`, unknown sid, malformed op) as a consistent `{kind: "op-error", op, message}` frame (never a silent drop, never a session-logged `error` envelope for transport-level mistakes — those aren't session facts). Add these cases to the protocol conformance suite. Propose the exact frame shapes as a doc edit.

### 6. Sandbox escape mini-suite (closes the M1 exit criterion honestly)
Three focused tests (ubuntu CI; skip cleanly without Docker): ① `safe` profile has no network (`curl`/DNS fails inside container); ② writes outside `/workspace` mount don't reach the host; ③ `fs.*` symlink-escape attempt (symlink inside workspace pointing outside → `PolicyError`, not a read).

## Boundaries — do NOT

- No memory/persona/research/MCP/hooks (M2+). No `anthropic`/`openai-responses` transports (post-M1 adapters). No new protocol event types; the two transport frame kinds (`ack`, `op-error`) are frames, not envelopes — schema them in the protocol package anyway (frames deserve fixtures too).
- No new runtime deps without justification. Labels stay log-only (M2 flips enforcement).
- Live conformance runs are owner-executed — CI must stay secret-free and Ollama-free.
- No docs/ edits — propose in report (op-ack frame shapes especially).

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
```
- Conformance kit green against the mock in CI (both OS); fallback e2e, prompted-tools e2e (happy/repair/exhaustion), op-ack conformance, escape mini-suite (ubuntu) all green.
- Manual (owner): `pnpm conformance --model <deepseek-id>` and `--model <ollama-id>` both produce verdict tables (documented deviations acceptable, silent failures not); a real `fairy chat` turn on Ollama with a tool call (prompted mode if the local model lacks native tools).
- `git grep`: still one TurnRunner; no vendor SDKs; no kernel special-cases per provider.

## Report back (same format)

1. File tree delta. 2. Verification tails (both OS). 3. Decisions (registry field semantics, parser tolerances, frame shapes). 4. Spec ambiguities. 5. Proposed doc edits (op-ack frames; any §4 table rows learned from Ollama). 6. Both live conformance verdict tables (redact endpoints/keys).
