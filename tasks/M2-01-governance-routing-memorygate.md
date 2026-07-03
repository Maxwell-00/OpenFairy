# Task M2-01 — Governance routing gate + MemoryGate v0 + live conformance hardening

> Paste this entire file as the task brief.

Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.

M1 is closed. M2 is the trust milestone: memory, persona, research, and governance start becoming enforceable instead of just logged. This task is the first trust slice. It turns data-clearance routing from documentation/logging into an enforced model-selection gate, introduces MemoryGate v0, and clears the M1-04 conformance carry-in.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — invariants:
   - One TurnRunner.
   - Event-sourced JSONL sessions are source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-build-gated tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - Provider quirks only at transport + fixture boundary.
   - CI never uses real API keys.
   - Do not read/edit `docs-zh/`.

2. `tasks/M1-04-review.md`
   - Carry-in #1: harden live conformance's tool-call case.
   - Carry-in #2: docs edits are reviewer-owned; Codex may propose further edits only.
   - Carry-in #3: add a cheap provider-special-case guard.

3. `docs/specs/data-governance.md`
   - Sensitivity axis.
   - Residency axis.
   - Provider clearance.
   - Semantic escalation is one-way: extractors may raise sensitivity, never lower it.
   - `routing_hints.prefer_local` is non-gating. It must not be encoded as residency.

4. `docs/specs/memory.md`
   - MemoryGate.
   - Workspace Chronicle seam.
   - Do not build full long-term memory yet.

5. `docs/specs/protocol.md`
   - `route.denied`
   - `memory.gate.decision`
   - `memory.written`
   - `label.declassified` exists but must not be used for automatic downgrades in this task.

6. `docs/ROADMAP.md`
   - M2 is the trust milestone.
   - Research/persona/proactivity are later M2 slices, not this task.

## Deliverables

### 0. M1-04 carry-in: harden live conformance

Update `packages/testing/src/conformance.ts` live mode:

- `live trivial tool-call shape` must not pass merely because the model returned `done`.
- The case must either:
  - PASS only when a normalized `tool_call` is observed, or
  - return an explicit machine-readable `SKIP` / `DEGRADED` verdict with reason, e.g. `model_did_not_call_tool`, when the endpoint completed normally without a tool call.
- The JSON verdict must distinguish `pass`, `fail`, and `skip/degraded`. Do not overload `ok:true` as proof of tool capability.
- Mock conformance remains strict.
- Existing owner-run command remains:
  - `pnpm conformance --model <model-id>`
  - optional `--config <path>`

Acceptance:
- Add unit/e2e coverage that the old false-positive shape (`done` without `tool_call`) is no longer reported as a full PASS.

### 1. Governance config and provider clearance model

Extend config parsing with a minimal governance section:

```yaml
governance:
  profile: balanced        # balanced | sovereign | cloud-friendly
  home_regions: [cn]       # user-owned list (this owner: cn); region codes are user config, not a fixed enum
```

Provider model configs already have `data_clearance`. Make them enforceable — **shapes per data-governance §2/§4, do not invent values**:

```yaml
models:
  - id: main-model
    transport: openai-chat
    base_url: ...
    model: ...
    data_clearance:
      max_sensitivity: internal
      residency: [global-ok]
      # `regions` is REQUIRED iff residency includes region-restricted
      # (config validation fails otherwise — spec §4). There is no "global" region
      # value; a provider serving region-restricted content must declare real
      # regions and satisfy `regions ⊆ home_regions`. Local models trivially qualify.
```

Rules:

- Sensitivity is ordered. A model may receive a request only if `request.sensitivity <= model.max_sensitivity`.
- Residency is a hard constraint. A model may receive a request only if its allowed residency/region set satisfies the request labels.
- `region-restricted(home)` resolves through `governance.home_regions`.
- `routing_hints.prefer_local` is advisory only. It may influence ordering later, but it must not allow or deny a route in M2-01.
- No automatic declassification. Never lower labels to fit a provider.

Acceptance:
- Unit tests cover sensitivity ordering, residency subset logic, `home` region resolution, and `prefer_local` as non-gating.
- Invalid governance profiles/configs fail config validation.
- No `local-preferred` residency value is reintroduced.

### 2. Enforced route gate before model I/O

Add a routing gate at the model-selection boundary.

Required behavior:

- Before any HTTP/SSE call, compute effective labels for the model request. **Composition rule (data-governance §1, this is the subtle part):** effective labels = derivation over **all content entering the assembled prompt** — history turns, tool results, and system-zone content included, not just the current input. Max sensitivity wins; residency intersects. A secret pasted three turns ago must still gate today's call, and it keeps gating until the ladder/compaction removes it from the assembled context (what's in the *prompt* matters, not what's in the log).
- Reject or skip model candidates that do not satisfy clearance.
- In fallback chains, evaluate each candidate against clearance before trying it.
- If at least one fallback candidate is allowed, route to it and record the skipped/denied candidate in trace/progress.
- If no candidate is allowed:
  - emit a `route.denied` event,
  - emit a user-visible, non-secret-leaking final/error response,
  - do not call any disallowed provider.

Visibility:

- `model_trace` should show the final allowed model when one is used.
- Denied candidates should be observable through `route.denied` and/or `progress.update`.
- JSONL is the source of truth.

Acceptance:
- E2E: a secret-labeled turn with only an internal/global provider produces `route.denied` and **zero provider requests**.
- E2E: a secret-labeled turn with a fallback to an allowed local/secret-capable provider succeeds and records the denied primary.
- E2E: normal internal/public turn still routes as before.
- **E2E (history contamination):** secret content in turn 1, harmless input in turn 2 → turn 2 is still gated while the secret remains in the assembled prompt (the composition-rule test).
- Tests assert disallowed provider request count remains `0`.

### 3. Semantic escalation v0

Implement a deterministic escalation seam.

Scope:

- Table-driven rules only.
- No model classifier yet.
- Rules may raise sensitivity by obvious content class.
- Rules never lower sensitivity.
- Keep defaults conservative and small.

Minimum rules:

- API keys / bearer tokens / private keys / `.env`-style secrets => raise to `secret`.
- Obvious personal identifiers or personal notes may raise to `personal` if lower.
- Ordinary project text remains at its input label.

Eventing:

- If effective labels are raised, record this in an existing appropriate event/payload.
- Do not use `label.declassified`.
- Do not mutate historical event bytes. New events only.

Acceptance:
- Unit tests for raise-only behavior.
- Tests prove no rule can downgrade labels.
- Tests prove escalation happens before route clearance is checked.

### 4. MemoryGate v0

Build the MemoryGate seam without building full memory.

Required:

- Add a `MemoryGate` module/API in the existing memory/kernel boundary.
- It accepts a proposed memory candidate:
  - text/content
  - source event/session/turn
  - labels
  - reason/category
- It returns a decision:
  - `allow`
  - `deny`
  - `hold`
- Emit `memory.gate.decision` for every evaluated candidate.
- Emit `memory.written` only when decision is `allow`.
- Store v0 memory in the existing event log / current storage primitives only. No vector DB. No embeddings.

Minimal policy:

- Explicit user instruction such as "remember that ..." may generate a memory candidate.
- Secret-labeled content defaults to `deny`.
- Personal/internal content may `hold` or `allow` based on config defaults.
- All decisions carry reason codes.

Acceptance:
- Unit tests for allow/deny/hold.
- E2E: user asks to remember a safe preference -> `memory.gate.decision` then `memory.written`.
- E2E: user asks to remember an API key/secret -> `memory.gate.decision` deny, no `memory.written`.
- Replay can show the memory gate decision.

### 5. Replay/audit visibility

Update `fairy replay` and/or existing inspection commands so that trust decisions are visible offline.

Required:

- `route.denied` appears in replay output.
- `memory.gate.decision` appears in replay output.
- JSON output preserves full payloads.
- Truncated-tail tolerance remains intact.

Acceptance:
- Add replay tests with synthetic logs for `route.denied` and `memory.gate.decision`.

### 6. Provider-special-case guard

Add a cheap automated guard.

Required:

- CI must fail if `packages/kernel` contains provider-specific strings/branches such as `ollama`, `deepseek`, or provider-name conditionals.
- Make the rule narrow enough not to block test fixture names outside kernel.
- Document the guard in the work report.

Acceptance:
- A test or script proves the guard is active.
- Existing legitimate model-gateway/testing provider quirks still pass.

## Boundaries — do NOT

- Do not implement research orchestration.
- Do not implement persona modeling.
- Do not implement proactive delivery quotas.
- Do not implement vector search, embeddings, or a long-term memory database.
- **Do not implement memory retrieval or inject any memory into prompts** — the memory zone stays a reserved placeholder. M2-01 is admission + events only; retrieval arrives with the real stores in a later M2 slice (retrieval has its own gate policy that isn't specced for v0).
- Do not add MCP/hooks.
- Do not add a second TurnRunner.
- Do not add vendor SDKs.
- Do not add new model providers.
- Do not use real API keys in CI.
- Do not edit `docs-zh/`.
- Do not edit `docs/`; propose docs edits in the work report for reviewer application.
- Do not silently declassify labels.
- Do not let a denied provider receive request bytes.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
```

GitHub Actions must be green on both CI OSes.

## Manual owner checks

Owner should run after CI is green:

1. A live conformance run against DeepSeek:
   - verify strict tool-call semantics are no longer falsely reported as PASS.
2. A live conformance run against Ollama:
   - if model does not tool-call, verdict must say `SKIP` / `DEGRADED`, not fake PASS.
3. A chat turn that contains an obvious secret:
   - verify route gate denies cloud/internal-only providers.
   - verify no provider request is made.
4. A chat turn that asks Fairy to remember a harmless preference:
   - verify `memory.gate.decision` and `memory.written`.
5. A chat turn that asks Fairy to remember a fake API key:
   - verify `memory.gate.decision` deny and no `memory.written`.
6. `pnpm fairy replay <sid> --json`
   - verify route/memory decisions are inspectable offline.

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI links/status,
   - mock conformance verdict.
3. Decisions:
   - governance config shape,
   - clearance comparison semantics,
   - route-denied recovery behavior,
   - MemoryGate policy defaults.
4. Spec ambiguities.
5. Proposed docs edits.
6. Manual owner checklist with exact commands.
