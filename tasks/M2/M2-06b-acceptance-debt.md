# Task M2-06b — Acceptance-debt hardening (M2-02/03/04 retro-audit follow-up)

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0–M1 closed. M2-01 through M2-05 closed at task level. M2-06 (perception) may be dispatched in parallel with this task.
>
> This is a small, self-contained hardening slice. It discharges the debt register D1–D10 from `tasks/M2-02-04-retro-audit.md`: one functional gap in research source-independence accounting, plus test/fixture/infra debt. It adds **no new capability, no new tools, no new events, no new suites** — it strengthens what already shipped.
>
> Parallel-run note: file overlap with M2-06 is limited to `packages/research` and test files. If both tasks are in flight, land this one first or rebase it last — do not let merge resolution weaken either side's tests.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — the standing contract (one TurnRunner; JSONL source of truth; source-first TS; no vendor SDKs; CI has no real keys; do not read/edit `docs-zh/`).
2. `REVIEWER-HANDBOOK.md` — §3.5 encoding landmine (any non-ASCII verification must be fail-closed; never paste raw CJK as a check), §4 review method, §5 standing rules.
3. `tasks/M2-02-04-retro-audit.md` — the debt register this task discharges. Each deliverable below cites its D-number.
4. `docs/specs/research.md` — §2 "independence check (N claims from 1 syndicated source ≠ N sources)"; §7 implementation status (independence_key defaults to source family/host, overridable).
5. `docs/specs/data-governance.md` — §1 derivation laws (max/intersection; **hints never gate**; escalation one-way, no automatic downgrade); §1a per-profile default tables; §7 conformance requirements ("seeded secret/personal content provably never reaches a non-cleared provider").
6. `docs/specs/memory.md` §4a and `docs/specs/protocol.md` §2 — `memory.gate.decision` phases; every event type ships valid + invalid fixtures.
7. `docs/specs/evals.md` — suite registry. This task adds **no new suite names**; it strengthens `label.conformance` and the research/memory package tests.

## Deliverables

### 0. Preserve existing invariants

- All named suites remain visible and green: `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, `governance.friction-canary`, `persona.consistency`, `substance.invariance`.
- No changes to kernel/gateway/tools-std/memory runtime code. The ONLY runtime change permitted in this task is Deliverable 1 inside `packages/research`.
- No `docs/` or `docs-zh/` edits.

Acceptance:

- Existing tests green; suite names in output; `git --no-optional-locks diff --name-only <base>..HEAD -- docs docs-zh` empty.
- `git diff --name-only -- packages/kernel packages/tools-std packages/memory apps` shows **only test-file changes** (plus `.dependency-cruiser.cjs` per Deliverable 4).

### 1. Research source-independence accounting (D1 — the one code change)

Problem (retro-audit): `independence_key` is not consulted by dedup and only feeds a family count that no test exercises with more than one source. Syndicated clones with different canonical URLs and different bodies count as independent.

Required behavior:

- Do **not** change canonical/content dedup semantics (they are correct and tested).
- Make independence a first-class output of source-set review:
  - `reviewSources` / `sourceset.reviewed` must report `independent_family_count` derived by grouping the deduped source set on `independence_key` (use the existing `warnings[]` / payload fields additively; no new event type, no schema-breaking change — extend `sourceset.reviewed.v1.json` additively if a field is missing, updating both fixtures).
  - `single_source_family` warning fires when the deduped set has ≥ 2 sources but exactly 1 independence family.
  - `research.sources()` tool output includes each source's `independence_key` and the family count (it already prints keys; add the count).
- Config-driven key override must work end-to-end: a domain override (existing config/fixture override mechanism, per research.md §7) can assign the same `independence_key` to two different hosts. Do not implement automatic content-similarity syndication detection — cross-host same-body cases are already collapsed by `content_signature`; this deliverable covers the *different-body, same-family* case via explicit keys.
- Mock research fixtures: add two seeded sources with different `canonical_url`, different body content, same `independence_key` (e.g., a wire story carried by two seeded outlets).

Acceptance:

- Unit test: deduped set of 3 sources across 2 independence families ⇒ `independent_family_count === 2`; the two same-key sources are not counted as independent.
- Unit test: ≥ 2 sources, 1 family ⇒ `single_source_family` warning present; 2 families ⇒ absent.
- Unit test: override-assigned shared key across two hosts groups them into one family.
- `sourceset.reviewed` schema + valid/invalid fixtures updated additively if a payload field is added; `pnpm conformance` green.
- Existing dedup tests unchanged and green.

### 2. Test/fixture debt — research (D2, D3)

- **D2:** unit test for the provider-throw fetch path: mock provider throws on fetch ⇒ an honest snapshot with empty text and `fetch_error` set is written (metadata intact, no bypass, no crash). This exercises the caught-exception branch, distinct from the tested deny-list branch.
- **D3:** negative planning test: a plain-English intent with no China-local signals yields **en-only** subquery locales.

Acceptance: both tests in `packages/research/test`, non-vacuous (assert the specific fields, not just "no throw").

### 3. Test/fixture debt — governance + memory (D4–D9)

All inside existing suites/test files; no runtime changes.

- **D4:** `governance.egress.personal_allowed_tools` allow-path test: config allow-lists a tool; personal-labeled context string in that tool's outbound args ⇒ guard permits, tool executes, audit records the pass decision. Keep the existing block-path tests untouched.
- **D5:** pin two derivation laws in `label.conformance`:
  - hints-never-gate: a `prefer_local`-style hint on content neither blocks a cleared route nor permits an under-cleared one (assert routing outcome identical with and without the hint);
  - no-auto-downgrade: composing a `secret/local-only` input with `public/global-ok` content never lowers effective labels below `secret/local-only`, and no code path lowers labels without an explicit declassification event.
- **D6:** golden-table tests: assert the **full** `GovernanceProfileDefaults` table (every key) for `balanced`, `sovereign`, and `cloud-friendly` against literal expected objects (a profile change must show up as a test diff).
- **D7:** `label.conformance` provider-clearance area: add `personal`-labeled seeding alongside the existing `secret` case — a personal/local-only seed never reaches a non-cleared provider (zero requests), inside the `label.conformance` suite itself.
- **D8:** add a `phase: "retrieval"` **valid** fixture for `memory.gate.decision` (keep the admission fixture; both must validate; conformance round-trip green).
- **D9:** residency-specific retrieval-gate unit case in `packages/memory/test`: a record whose labels fail residency (e.g. `local-only` record vs `global-ok`-only route context) is denied with the existing reason code; assert the deny is caused by residency (sensitivity otherwise cleared).

Acceptance: each test would fail if the property broke (no `expect(true)`, no empty-set tautologies); suite names unchanged.

### 4. Dep-cruiser boundary rule (D10)

- Add a `.dependency-cruiser.cjs` rule forbidding imports from `packages/research` to `packages/model-gateway` (the planner-stays-deterministic invariant, currently true by fact only).
- Severity `error`; name it so violations are self-explanatory (e.g. `research-no-model-gateway`).

Acceptance: `pnpm dep-check` green; temporarily adding such an import locally must fail dep-check (describe this check in the work report; do not commit the violation).

## Boundaries — do NOT

- Do not touch `packages/kernel`, `packages/tools-std`, `packages/memory`, `apps/gateway`, `apps/cli` runtime code (test files only). The only runtime edits live in `packages/research` (Deliverable 1) and `.dependency-cruiser.cjs` (Deliverable 4).
- Do not change dedup semantics, egress guard behavior, permission rules, or any label derivation code — if a D5/D9 test reveals a genuine behavior bug, STOP and report it as a blocker instead of "fixing" runtime code under this brief.
- Do not add new canonical event types, new eval suite names, new tools, new config keys.
- Do not implement content-similarity syndication detection, embeddings, or scoring changes.
- Do not edit `docs/` or `docs-zh/` (docs proposals only).
- Do not weaken, skip, or loosen any existing assertion to make a new test pass.
- The M2-05 mojibake cleanup is **not** in this task — it is already mandated in M2-06 Deliverable 0; do not touch `governance.ts` here (avoids a merge collision).

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
New-Item -ItemType Directory -Force tasks/owner-checks/M2-06b
```

1. Suite visibility: `pnpm --filter @fairy/testing test -- --reporter=verbose` → all nine named suites pass; save `tasks/owner-checks/M2-06b/testing-suites.txt`.
2. Independence accounting: `pnpm --filter @fairy/research test -- --reporter=verbose` → family-count and single-family-warning tests visible; save `tasks/owner-checks/M2-06b/research-independence.txt`.
3. Sources CLI shows families: `pnpm fairy research sources --json` against a fixture session → parseable, sources carry `independence_key`, family count present; save `tasks/owner-checks/M2-06b/research-sources.json`.
4. Conformance: `pnpm conformance` → 18/18 (or current case count) PASS including updated `sourceset.reviewed` and new `memory.gate.decision` retrieval fixture; save `tasks/owner-checks/M2-06b/conformance.txt`.

## Report back

Use the established format:

1. File tree delta.
2. Verification tails (local commands, CI link/status, conformance verdict, named suite names).
3. Decisions: independence family semantics (grouping, count field name, warning condition), fixture shapes, golden-table representation, dep-cruiser rule shape.
4. Spec ambiguities (an empty list is suspicious — at minimum, state how you resolved the `independent_family_count` field placement in the `sourceset.reviewed` payload).
5. Proposed docs edits: `docs/specs/research.md` (independence accounting semantics + §7 status), `docs/specs/evals.md` (note strengthened `label.conformance` coverage), `docs/specs/data-governance.md` (derivation-law tests now pinned), `docs/specs/protocol.md` (`sourceset.reviewed` payload note if a field was added; `memory.gate.decision` retrieval fixture).
6. Manual owner checklist with exact commands and evidence paths.
