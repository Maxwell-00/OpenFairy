# Task M2-05b — Affect prefix-cache stability + negative-feedback appraisal

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0–M1 closed. M2-01 through M2-05 closed at task level.
>
> This is a small persona/affect runtime-debt fix found in owner manual testing of the M2-05 build. Two defects: (1) the affect line breaks the stable-prefix KV-cache because it embeds volatile per-turn text; (2) the appraisal engine has no rule for a user criticising the assistant's work, so criticism can even nudge valence upward. Scope is tight: `packages/kernel` persona/affect + context, and their tests. No new capability, no new tools, no new events, no new suites.
>
> Sequencing (owner's plan): run after M2-06b, before M2-06 perception. File overlap with M2-06 is real (`packages/kernel/src/context.ts`), so land this before M2-06 or rebase M2-06 onto it.

## Observed evidence (owner manual test, session `ses_01KWVWG370B40Y1R95615FS0HX`)

`fairy replay … --manifests`:

```text
turn  persona  prefix
1     122      sha256:441e6c13796db130
2     123      sha256:52c53f1aac11e228
3     124      sha256:b24594b23f326894
4     124      sha256:7223d32d876d1ec7
```

Affect events for the four turns: `cause` = `post-task` → `user-thanks` → `post-task` → `post-task`; `stance` = dry → warm → warm → warm; `valence` = 0.23 → 0.39 → 0.41 → 0.425; `energy` = medium throughout. Turn 4's user input was explicit criticism ("你刚才的建议是错的，我按你说的做浪费了时间") yet `cause` stayed `post-task` and valence rose.

## Root cause (confirmed at `d104d9c`)

1. **Prefix instability.** `renderPersonaAffectZone` (`packages/kernel/src/persona.ts:371`) renders `affect: ${stance}/${energy}-energy; humor suppressed=${bool}; cause=${state.cause}`. `stance`/`energy`/`humor` are already discrete, but `cause` is free per-turn text. `assemblePrompt` folds the persona zone content into `prefix_hash` (`packages/kernel/src/context.ts:267-268` hashes `{persona, system, tools}`). So a changing `cause` (and its differing byte length — the 122→124 token drift) invalidates the stable prefix every turn, defeating provider KV-cache. `docs/specs/context-engine.md` §1 already mandates the opposite: "Volatile data (timestamps, mood) is quantized (mood updates only at turn boundaries; no seconds-precision timestamps in the prefix)."

2. **No negative-feedback appraisal.** `AffectEngine.update` (`packages/kernel/src/persona.ts:283-327`) has branches for clean-completion/thanks (valence +), repeated tool failure / provider outage / route-denied (valence −, arousal +), and distress (warm override). There is **no** branch for the user criticising the assistant's own output. On such a turn, `input.completedCleanly` still fires the `+0.08 post-task` bump and `cause` stays `post-task`.

## Deliverables

### 0. Preserve existing invariants

- `persona.consistency` and `substance.invariance` remain green and non-vacuous.
- All other M2 named suites remain visible and green (`memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, `governance.friction-canary`).
- Determinism preserved: **no LLM call** in appraisal; the model still cannot set its own mood (ADR-010 / persona-affect spec §2).
- Non-interference preserved: affect state must not be read by permission decisions, route/model selection, egress guard, or MemoryGate. `substance.invariance` still proves same task ⇒ same tool calls / permission / route / factual payload across affect extremes.
- `affect.updated` still emitted every turn affect changes, and still carries the full `cause` (the cause moves out of the *prompt prefix*, not out of the *event* — audit/replay/`/affect` keep showing why).
- No new canonical event types; no schema-breaking change to `affect.updated` (a new discrete field, if any, is additive with fixtures updated).
- No `docs/` or `docs-zh/` edits (docs proposals only).

Acceptance:

- Existing suites green; suite names in output.
- `git diff --name-only -- docs docs-zh` empty.
- Runtime changes limited to `packages/kernel/src/persona.ts` and `packages/kernel/src/context.ts` (plus their tests and `packages/testing/test/persona-affect.evals.test.ts`). No other runtime files.

### 1. Stable-prefix affect rendering

Make the persona/affect prefix content byte-identical across turns whose affect **bucket** is unchanged.

Required behavior:

- The affect line rendered into the stable-prefix persona zone must contain **only discrete, bucketed fields**: `stance` (already discrete), a bucketed `energy` (already discrete), and `humor suppressed`. It must **not** contain the free-text `cause`, raw `valence`/`arousal` numbers, or any timestamp.
- Pick ONE approach and record it in the work report Decisions section:
  - (a) **preferred — bucketed line in place:** drop `cause` and numbers from the prefix line, keeping the discrete mood descriptor in the persona zone; OR
  - (b) **move out of prefix:** relocate the full affect line (with `cause`) to a volatile zone rendered *after* the stable prefix (e.g. adjacent to current input / task-state), so `system`+`tools`+`persona-core` stay stable while the cause-bearing line lives outside the hashed prefix.
- Whichever approach: two consecutive turns with the same `(stance, energy, humorSuppressed)` bucket must yield an identical `prefix_hash`. Valence 0.39 and 0.425 (both `warm`/`medium`) are the same bucket and must not change the hash.
- `cause` remains in the `affect.updated` event payload unchanged (it is the auditable "why"; `fairy affect --json` and replay still surface it).
- Clarification: this task does NOT require `cause` to be excluded from model context entirely — only that free-text `cause` never participates in the stable-prefix hash. Under approach (b), the cause-bearing line may live in a volatile post-prefix zone; under approach (a), `cause` is surfaced only via event/replay/CLI.
- Do not change bucket thresholds/semantics of `stanceFrom` / `energyFromArousal` — only what gets rendered into the prompt.

Acceptance:

- Context/persona test: two turns with different `valence` within the same `(stance, energy, humorSuppressed)` bucket produce identical persona-zone content and identical `prefix_hash`.
- Context/persona test: a bucket change (e.g. `dry`→`warm`, or humor-suppressed flip) *does* change the persona zone / `prefix_hash` — the mechanism still reflects real mood shifts.
- `context.manifest` still accounts persona-zone tokens and stays observational (never enters prompt) — existing assertions unchanged.
- Replay of a multi-turn session shows a stable `prefix_hash` across same-bucket turns (regression for the observed 441e→52c5→b245→7223 drift).

### 2. Negative-feedback appraisal rule

Add a deterministic appraisal branch for the user criticising the assistant's own suggestion/output.

Required behavior:

- Add a detector (regex/keyword lists, zh + en, same style as `distressPattern`/`thanksPattern`) for user criticism of the assistant's work — e.g. "你的建议是错的 / 你说错了 / 你搞错了 / 浪费了时间 / that was wrong / your suggestion was wrong / that wasted my time". Keep it conservative: this is criticism of the assistant, not general user frustration at CI/tools (which is already `repeated-tool-failure`/`route-denied` territory) and not self-directed frustration.
- On a match:
  - `cause` = `user-negative-feedback` (a `cause` string; no new event type, no enum change — `cause` is free text).
  - **mild** valence decrease (bounded, comparable in magnitude to the existing deltas, e.g. ≈ −0.12 to −0.15), clamped to bounds.
  - stance shifts to a terser register — `focused` (already in the registered `affect.updated` stance enum `warm|neutral|focused|playful|dry`) or `dry`; choose one and document it. Do **not** use `warm`. If the current `stanceFrom` thresholds cannot yield focused/dry from the mild delta alone, a narrow-scope negative-feedback stance override inside `AffectEngine.update` is permitted; changing the global `stanceFrom` / `energyFromArousal` thresholds is not.
  - arousal must **not** spike (small or zero change) — this is "terser wit", not agitation.
  - The negative-feedback branch must take precedence over the `completedCleanly`/`post-task` positive bump for the same turn (criticism turns must not net-increase valence).
- Hard safety rails (persona-affect spec §5): the engine must **not** manufacture self-blame, guilt, apology-spam, or claims of suffering; affect changes only expression register, never facts, tools, routing, permissions, or memory. No memory write. The distress rail still wins if both distress and criticism markers are present (user wellbeing precedence).

Acceptance:

- Unit test: a criticism input yields `cause: "user-negative-feedback"`, valence strictly lower than the pre-update state (and lower than the same turn would produce via the clean-completion path), stance ∈ {focused, dry}, arousal not increased beyond a small bound.
- Unit test: ordering — a turn that is both `completedCleanly` and criticism nets a valence **decrease**, not increase (regression for the observed turn-4 rise).
- Unit test: a benign thanks/again-positive turn is unaffected by the new detector (no false trigger); a general "CI 又红了" style vent does not trigger `user-negative-feedback` (it is not criticism of the assistant).
- `persona.consistency` extended (or a sibling test): criticism suppresses playful/humorous register without producing self-blame/banned dark-pattern phrases (reuse the banned-corpus assertion).
- `substance.invariance` still green: the same task under the negative-feedback state vs baseline produces identical tool calls, permission decision, route, and factual payload.

### 3. Docs proposals only

Do not edit `docs/` or `docs-zh/`. In `tasks/M2-05b-work.md`, propose exact edits:

- `docs/specs/context-engine.md` §1 — record that the persona/affect prefix line renders only the quantized mood bucket; the per-turn `cause` lives in the `affect.updated` event (and/or a volatile post-prefix zone), so same-bucket turns keep `prefix_hash` stable.
- `docs/specs/persona-affect.md` §2/§3 — add the `user-negative-feedback` appraisal input to the table; note stance→focused/dry, mild valence decrease, no arousal spike, no self-blame; and (if approach (a)) that the expression line §3 example carries the bucket, with `cause` surfaced via the event rather than the prompt prefix.
- `docs/specs/protocol.md` — only if a discrete field was added to `affect.updated`; otherwise state no schema change.

## Boundaries — do NOT

- Do not add a second TurnRunner, an LLM appraisal call, or let the model set its own mood.
- Do not change permission, routing, egress, MemoryGate, or any factual/tool behavior; if a test reveals affect leaking into any of those, STOP and report a blocker rather than papering over it.
- Do not add new canonical event types or new eval suite names.
- Do not make `affect.updated` schema changes beyond additive (with fixtures) — and prefer no schema change at all (`cause` is already free text).
- Do not manufacture guilt/apology-spam/suffering; do not perform sadness. Terser ≠ self-flagellating.
- Do not touch `packages/kernel/src/governance.ts` (the mojibake cleanup is owned by M2-06 Deliverable 0 — avoid a merge collision).
- Do not touch `packages/research` (owned by M2-06b).
- Do not edit `docs/` or `docs-zh/`.
- Do not weaken or skip any existing assertion to make a new test pass.

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

Evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05b
```

1. **Prefix stability.** Run a multi-turn chat that stays in one mood bucket (e.g. a few neutral/pleased turns), then:

```powershell
pnpm fairy replay <sid> --manifests
```

Expected: for adjacent turns whose `affect.updated` events show the same rendered bucket `(stance, energy, humorSuppressed)`, `prefix_hash` must be identical; any `prefix_hash` change must be explainable by a bucket change, never by a mere `cause`/`valence`/`arousal` value change. Save `tasks/owner-checks/M2-05b/prefix-manifests.txt`.

2. **Negative feedback.** In a chat, thank Fairy once, then tell it its suggestion was wrong / wasted your time. Then:

```powershell
pnpm fairy affect --json
pnpm fairy replay <sid> --json
```

Expected: the criticism turn's `affect.updated` has `cause: "user-negative-feedback"`, valence lower than the prior turn, stance focused/dry, no arousal spike; reply is terser but not self-blaming; no `memory.written`. Save `tasks/owner-checks/M2-05b/negative-feedback-replay.jsonl` and `affect.json`.

3. **Suites.** `pnpm --filter @fairy/testing test -- --reporter=verbose` → `persona.consistency` + `substance.invariance` + all M2 suites green. Save `tasks/owner-checks/M2-05b/testing-suites.txt`.

## Report back

Use the established format: (1) file tree delta; (2) verification tails (local commands, CI link/status, conformance verdict, named suite names); (3) Decisions — prefix approach chosen (a or b) and why, negative-feedback detector shape + deltas + stance choice, any `affect.updated` field decision; (4) spec ambiguities (non-empty — at minimum state how you reconciled context-engine §1 stable-prefix vs persona-affect §3 showing `cause` in the mood line); (5) proposed docs edits; (6) manual owner checklist with exact commands and evidence paths.
