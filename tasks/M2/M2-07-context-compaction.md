# Task M2-07 — Context ladder completion: L4/L5 compaction + post-compaction regression

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0–M1 closed. M2-01 through M2-06 are closed at task level.
>
> This task completes the M2 context-engine slice: deterministic trigger policy for L4/L5, model-backed compaction through the existing model-gateway role system, durable compaction artifacts/events, replay visibility, and post-compaction regression suites.
>
> Do not start M3 voice. Do not implement Chronicle/dream-cycle. Do not create a second TurnRunner.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner. Modes are policies, not extra loops.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling package builds for tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - CI never uses real API keys.
   - Do not read or edit `docs-zh/`.

2. `REVIEWER-HANDBOOK.md`
   - Review/brief-gate discipline.
   - Mount staleness and git-lock caveats.
   - Docs reviewer-owned.
   - Any new capability must have a deterministic eval/check.
   - Real-provider checks are owner-run only.

3. `tasks/M2-06-review.md`
   - M2-06 is closed.
   - Perception artifacts are now part of current input/tool-result context and can raise effective labels.
   - Real perception provider remains future work.
   - M2-06 docs pass has been applied by reviewer.

4. `tasks/M2-05b-review.md` and `tasks/M2-05c-work.md`
   - Affect prefix stability is fixed; same bucket should keep stable prefix.
   - Encoding guard is active in `pnpm lint`.
   - Do not reintroduce raw mojibake or patch-context CJK hazards.

5. `docs/ROADMAP.md`
   - M2 still includes: Context engine completes L4/L5; Chronicle/dream-cycle; M2 exit consolidation.
   - M2 exit depends on long-session correctness and replayability.

6. `docs/specs/context-engine.md`
   - L1–L3 exist from M1-03.
   - L4 Micro-compaction: re-summarize accumulated placeholders + stale scratch into one block.
   - L5 Full compaction: whole history → structured handoff `{state, decisions, open todos, file/artifact refs, recent verbatim tail}`.
   - Append-only history: past turns are never edited in place.
   - Reductions are visible placeholders and events, never silent deletion.
   - Context manifest is observational only.

7. `docs/specs/protocol.md`
   - Existing `session.compacted` event exists in the registry.
   - Existing `artifact.created` and `context.manifest` events exist.
   - Do not add new canonical event types unless already registered and schema/fixtures are updated additively.

8. `docs/specs/data-governance.md`
   - Effective labels derive by max sensitivity and residency intersection over the whole assembled prompt.
   - Compaction summaries inherit labels from source ranges.
   - A compaction/handoff containing personal/local-only/secret-derived content must route only to cleared models.
   - Downgrades require explicit declassification, never summary paraphrase.

9. `docs/specs/memory.md`, `docs/specs/research.md`, `docs/specs/model-gateway.md`
   - Memory digest, research snapshots/citations, and perception artifacts already carry labels/provenance.
   - Compaction must preserve refs, not inline bulky blobs.
   - Model calls go through model-gateway roles and fallback rules.

## Deliverables

### 0. Preserve existing invariants

Before adding L4/L5 behavior, preserve or add regression tests proving:

- L1–L3 context ladder behavior remains green.
- All M2 named suites remain visible and green:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - `label.conformance`
  - `governance.friction-canary`
  - `persona.consistency`
  - `substance.invariance`
  - `perception.quarantine-v0`
- Persona/affect stable-prefix behavior from M2-05b remains green.
- M2-05c encoding guard remains part of `pnpm lint`.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No `docs/` or `docs-zh/` edits.

Acceptance:

- Existing tests green.
- Suite names visible in `packages/testing` output.
- `git diff --name-only -- docs docs-zh` has no output.
- `pnpm lint` includes the encoding guard.

### 1. Compaction model path and policy

Implement a compaction service owned by the kernel/context engine.

Required behavior:

- Compaction is called by the single TurnRunner/context engine path. No recursive agent loop.
- Model-backed compaction uses an existing model-gateway role, preferably `summarizer`.
- If no `summarizer` role is configured, use a deterministic mock/no-op fallback in tests or explicit config validation behavior; do not silently call an arbitrary provider in CI.
- CI must use mock model-gateway providers only.
- No real API keys in CI.
- Compaction prompt inputs are explicit and bounded:
  - source event ids / turn ranges;
  - current task state if present;
  - artifact refs;
  - labels/provenance summary;
  - budget target.
- The compactor must not receive raw denied memory text, raw secret text, raw image bytes, raw base64 blobs, or unbounded tool outputs.
- **The compaction model call is itself a provider I/O and is subject to route clearance like any other** (model-gateway §3: role binding → data clearance over the assembled compaction input). If the source ranges carry `personal/local-only` (or stricter) labels, an under-cleared `summarizer` binding must receive **zero request bytes**; behavior must then be deterministic: fall back to a cleared summarizer candidate if configured, else skip model-backed compaction fail-closed (keep the uncompacted path / L1–L3 result) with a visible `route.denied` or `progress.update` — never silently send labeled content to an under-cleared compactor and never silently drop history.
- Compaction result is treated as untrusted model output and validated against a structured schema before use.

Acceptance:

- Unit tests for compaction request shape and validation.
- E2E with mock summarizer role: context triggers L4/L5 and the mock receives bounded compaction input.
- Test that missing/invalid compactor output fails closed and leaves original context path intact rather than silently dropping history.
- E2E (compactor clearance): source ranges labeled `personal/local-only`; the configured summarizer is under-cleared ⇒ zero requests reach it (request-count assertion on the mock), a cleared local summarizer (or the fail-closed skip path) handles it, and the denial is visible. Mirrors the M2-02/03/06 route-gate pattern, applied to the compaction call itself.
- No second TurnRunner class or loop introduced.

### 2. L4 micro-compaction

Implement L4 micro-compaction for accumulated placeholders and stale scratch/tool digests.

Required behavior:

- Trigger L4 only after L1–L3 cannot fit the projected prompt + output reserve under budget, or after accumulated L2/L3 placeholders exceed a configured threshold.
- L4 produces a compact micro-summary block from existing visible placeholders / stale scratch / old tool digests.
- It must not edit past JSONL events.
- It must preserve:
  - user messages and pinned turns verbatim;
  - tool call ids and result artifact refs;
  - memory/research/perception artifact refs;
  - errors and failed tool-call information;
  - labels and provenance.
- Store the L4 summary as an artifact or context projection with source ranges and content hash.
- Emit or append an existing canonical event where appropriate:
  - `session.compacted` is registered with schema + fixtures; its payload REQUIRES `{range: {start_turn, end_turn}, summary_ref}` (reviewer-verified) — `summary_ref` should resolve to the stored summary artifact. Use it at least for L5; L4 may use `artifact.created` + `context.manifest.reduction_stages_applied` if turn-range semantics don't fit micro-compaction — justify the choice in the work report's Spec Ambiguities.
  - Do not invent `context.compacted` or `compaction.*` event types.

Acceptance:

- Unit tests for trigger policy.
- Unit tests for pin/user-message preservation.
- Unit tests for labels/provenance inheritance.
- E2E: a long session triggers L4; replay shows the reduction stage; original JSONL turn events remain unchanged.
- Replay text mode renders L4 compactly enough for debugging.

### 3. L5 full compaction / structured handoff

Implement L5 full compaction for cases where L4 still cannot fit.

Required behavior:

- L5 creates a structured handoff with:
  - current state;
  - decisions made;
  - open todos;
  - active approvals/grants summary if relevant;
  - artifact/file refs;
  - memory/research/perception refs;
  - recent verbatim tail.
- L5 must keep a recent verbatim tail; do not fully replace all human-readable history.
- L5 must keep user messages and task-critical turns pinned according to context-engine rules.
- L5 output must be schema-validated before entering prompt assembly.
- If L5 fails validation, context assembly must fail closed or retry deterministically once; never silently drop history.
- L5 summaries inherit labels from all source ranges and join effective prompt labels before route clearance.

Acceptance:

- Unit tests for handoff schema validation.
- E2E: force L5 with a tiny context window; final answer after compaction preserves a seeded task decision and open todo.
- E2E: labels from a personal/local-only source range survive L5 and deny an under-cleared primary with zero provider request bytes after compaction.
- E2E: recent verbatim tail remains present after L5.
- `context.manifest` shows `L5` in `reduction_stages_applied`.

### 4. Post-compaction regression suite

Register deterministic PR-tier tests in `packages/testing`.

Required suite name:

```text
context.compaction-regression
```

Required coverage:

- task carry-over after L5;
- artifact refs survive L4/L5;
- memory/research/perception refs survive L4/L5;
- failed tool-call/error information remains available;
- labels survive and continue to gate routing;
- **quarantine survives compaction (no laundering):** a compacted range containing quarantined untrusted content (research/OCR injection fixture marker) yields a summary in which that content remains framed/marked as untrusted data — the marker never appears as plain instruction-zone text post-compaction, and never drives a tool call, memory write, or citation after the handoff;
- replay remains readable;
- no real provider calls in CI.

Acceptance:

- Suite name appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- Suite has non-vacuous assertions and would fail if summaries dropped decisions/refs/labels.
- No LLM judge in CI.

### 5. Replay / CLI visibility

Extend replay visibility for compaction.

Required behavior:

- `fairy replay --manifests` already shows reduction stages; make sure it displays `L4` / `L5`.
- Text replay should render `session.compacted` or compaction artifact creation compactly.
- JSON replay must preserve the full payload.
- Corrupt-tail tolerance remains green.
- Optional but useful: add `--compactions` or equivalent only if it is small and deterministic. Do not grow a UI.

Acceptance:

- CLI/replay tests for L4/L5 rendering.
- Existing replay tests remain green.
- Truncated-tail replay tolerance still passes.

### 6. Config surface

Add only the minimal config needed.

Suggested keys:

```yaml
context:
  l4_placeholder_threshold: 6
  l4_target_tokens: 800
  l5_target_tokens: 1200
  compaction_role: summarizer
```

Rules:

- Extend the existing config loader + schema validation path.
- Defaults must be safe and deterministic.
- Invalid values fail config validation.
- No side-channel config.
- Document final chosen shape in the work report Decisions section.

Acceptance:

- Config loader tests for defaults and invalid values.
- No invented label/residency values.
- No docs edits by Codex.

### 7. Docs proposals only

Do not edit `docs/` or `docs-zh/`.

In `tasks/M2-07-work.md`, propose exact docs edits for reviewer application:

- `docs/specs/context-engine.md`
  - L4/L5 implementation status.
  - Compaction trigger policy.
  - Handoff schema shape.
  - Labels/provenance inheritance.
  - Replay visibility.

- `docs/specs/protocol.md`
  - `session.compacted` payload notes or additive schema/fixture updates if needed.

- `docs/specs/data-governance.md`
  - Compaction summaries inherit source labels and cannot declassify.

- `docs/specs/evals.md`
  - `context.compaction-regression` registration.

## Boundaries — do NOT

- Do not implement Chronicle v1.
- Do not implement dream-cycle consolidation.
- Do not implement workflows/scheduler.
- Do not implement M3 voice.
- Do not implement browser automation or computer-use.
- Do not create a second TurnRunner.
- Do not let compaction silently delete or rewrite JSONL history.
- Do not declassify content by summarizing it.
- Do not summarize denied memory/research/perception text into a prompt-visible block.
- Do not use real API keys or real providers in CI.
- Do not add vendor SDKs.
- Do not add new canonical event types unless already registered and schema/fixtures are updated additively.
- Do not edit `docs/`.
- Do not edit `docs-zh/`.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on the existing ubuntu + windows matrix.

## Manual owner checks

Owner should run after CI is green. Deterministic fixture evidence is acceptable for this task; no real provider is required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-07
```

### 1. Compaction regression suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `context.compaction-regression` appears and passes.
- Existing M2 suites still pass.

Save:

```text
tasks/owner-checks/M2-07/testing-compaction.txt
```

### 2. Forced L4/L5 replay

Run a mock session with tiny context limits that forces L4 and then L5.

Expected:

- `context.manifest` shows L4/L5.
- replay renders compaction event/artifact.
- final answer preserves seeded decision and open todo.
- artifact refs survive.
- no JSONL history is rewritten.

Save:

```text
tasks/owner-checks/M2-07/compaction-replay.jsonl
tasks/owner-checks/M2-07/compaction-manifests.txt
```

### 3. Governance after compaction

Use a personal/local-only source range before compaction.

Expected:

- compaction summary/handoff labels are personal/local-only.
- the compaction call itself never reached an under-cleared summarizer (zero requests on that mock; cleared/local summarizer or fail-closed skip handled it, denial visible).
- under-cleared primary receives zero provider request bytes after compaction.
- cleared fallback completes.
- `model_trace.denied_candidates` visible.

Save:

```text
tasks/owner-checks/M2-07/compaction-governance-replay.jsonl
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named eval suite names.
3. Decisions:
   - L4/L5 trigger policy,
   - compaction role/model path,
   - summary/handoff schema,
   - event/artifact payload shape,
   - label/provenance inheritance,
   - failure behavior,
   - config shape.
4. Spec ambiguities.
   - Non-empty; at minimum explain how `session.compacted` was used or why compaction visibility uses `artifact.created` + `context.manifest` only.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
