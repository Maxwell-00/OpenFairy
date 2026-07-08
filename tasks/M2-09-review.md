# M2-09 Review — M2 exit consolidation

Review date: 2026-07-08  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-09-exit-consolidation.md`  
Delivery commit: `455f733`  
CI: GitHub Actions run `28940423265`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — M2-09 closeout task accepted, M2 milestone close pending Fable/Opus exit gate.**

M2-09 is a pure milestone-exit consolidation commit. It does not introduce new runtime capability. It assembles the requested M2 suite scorecard, ROADMAP exit matrix, vector-backend decision note, M3 preconditions, draft M2 exit review, and owner evidence bundle. GitHub Actions is green.

The milestone itself is not final-closed by this primary review because `tasks/M2-exit-review.md` is correctly labelled `DRAFT — pending Fable/Opus gate`.

## Evidence base

- Commit: `455f733` / `M2-09-work`.
- CI: Actions run `28940423265`, success, matrix `verify`, 2 jobs completed.
- Work report: `tasks/M2-09-work.md`.
- Draft milestone review: `tasks/M2-exit-review.md`.
- Owner evidence:
  - `tasks/owner-checks/M2-09/install.txt`
  - `tasks/owner-checks/M2-09/lint.txt`
  - `tasks/owner-checks/M2-09/typecheck.txt`
  - `tasks/owner-checks/M2-09/all-tests.txt`
  - `tasks/owner-checks/M2-09/testing-full.txt`
  - `tasks/owner-checks/M2-09/dep-check.txt`
  - `tasks/owner-checks/M2-09/conformance.txt`
  - `tasks/owner-checks/M2-09/diff-check.txt`
  - `tasks/owner-checks/M2-09/docs-diff.txt`
  - `tasks/owner-checks/M2-09/m2-suite-scorecard.md`
  - `tasks/owner-checks/M2-09/m2-exit-matrix.md`
  - `tasks/owner-checks/M2-09/vector-backend-decision.md`
  - `tasks/owner-checks/M2-09/M3-preconditions.md`

## Acceptance review

### 0. Hard boundaries

**PASS.**

The commit is limited to M2 closeout/evidence work:

- `REVIEWER-HANDBOOK.md` status paragraph update.
- `tasks/M2-09-work.md`.
- `tasks/M2-exit-review.md`.
- `tasks/owner-checks/M2-09/*`.

No runtime package source, provider, scheduler, workflow, vector backend, learned-skill activation, `docs/`, or `docs-zh/` change is present in the commit.

### 1. M2 named suite scorecard

**PASS.**

`m2-suite-scorecard.md` lists all 13 required M2 named suites and marks all 13 PASS:

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
- `context.compaction-regression`
- `chronicle.workspace-v0`
- `dream-cycle.consolidation-v0`

It also explicitly marks the deferred/non-pass items as `SKIPPED/DEFERRED`:

- `memory.canary`
- persona style-judge >=90%
- governance friction canary nightly/soak threshold
- full contradiction benchmark

The testing evidence shows `8 passed | 1 skipped` test files and `67 passed | 1 skipped` tests.

### 2. ROADMAP M2 exit criteria matrix

**PASS.**

`m2-exit-matrix.md` honestly maps the six ROADMAP exit criteria:

- S2 text with verifiable citations: satisfied at deterministic M2 text/research level.
- S4 across >=20 sessions: partial/deferred; no committed evidence proves the specific 20-session scenario.
- leakage/label zero-tolerance: pass.
- S7 screenshot flow: pass for M2 screenshot/perception v0, not full M4/S7 automation.
- persona >=90%: deferred with deterministic substitute.
- sqlite-vec vs LanceDB >=200k decision gate: deferred / decision gate not literally closed.

This is the correct honesty posture. It does not silently pass deferred criteria.

### 3. sqlite-vec vs LanceDB decision gate note

**PASS.**

`vector-backend-decision.md` states:

- current memory implementation is SQLite projection + FTS5-style text retrieval behavior;
- vector retrieval is deferred;
- no >=200k-record sqlite-vec vs LanceDB benchmark evidence exists;
- no backend choice is claimed;
- future benchmark acceptance shape is listed.

No vector backend, benchmark harness, or provider integration was implemented.

### 4. M2 exit review draft

**PASS WITH NOTE.**

`tasks/M2-exit-review.md` is correctly labelled:

```text
DRAFT — pending Fable/Opus gate
```

It includes the required sections: scope, evidence sources, closed capabilities, deferred items, open risks, accepted quirks/notes register, docs-zh re-translation TODO, and recommendation.

The recommendation is appropriately conditional:

- recommended: `M2 CLOSED WITH EXPLICIT DEFERRALS`;
- alternate strict ROADMAP verdict: `M2 NOT YET CLOSED` until S4 >=20 sessions, persona frozen style judge, and vector benchmark evidence exist.

Note: the draft still says the current M2-09 GitHub Actions status is pending until committed/pushed. That was true at generation time, but is stale after run `28940423265` passed. This is a Fable/finalization note, not a blocker.

### 5. M3 preconditions

**PASS.**

`M3-preconditions.md` separates:

- hard preconditions before voice;
- strict ROADMAP deferrals that may block voice;
- deferrals that can carry to M4/M5 if accepted;
- recommended first M3 slice: `M3-01 - voice protocol + loopback audio transport skeleton`.

It correctly does not write the full M3 brief or implement voice.

### 6. Handbook cleanup

**PASS.**

`REVIEWER-HANDBOOK.md` was updated only in the current-state paragraph. It removes stale "context L4/L5 remaining" phrasing and records M2 functional slices M2-01 through M2-08 closed, M2-09 drafted, docs-zh translation still owner-maintained, and parallel Cowork caveat.

### 7. Owner evidence bundle

**PASS.**

Evidence files show:

- `pnpm lint`: encoding guard passed and eslint clean.
- `pnpm -r typecheck`: all workspace package typechecks done.
- `pnpm --filter @fairy/testing test -- --reporter=verbose`: all required M2 PR-tier suites visible and green.
- `pnpm dep-check`: no dependency violations.
- `pnpm conformance`: mock mode, 18/18 PASS, `"ok": true`.
- `git diff --check`: no issues.
- `git diff --name-only -- docs docs-zh`: no output.

GitHub Actions run `28940423265` is green.

## BLOCKER

None for M2-09 closeout task acceptance.

## CARRY-IN / Fable gate items

1. **M2 milestone final closure still requires Fable/Opus gate.**  
   `tasks/M2-exit-review.md` is intentionally a draft. Fable/Opus must decide whether `M2 CLOSED WITH EXPLICIT DEFERRALS` is acceptable or whether strict ROADMAP literal closure blocks M3.

2. **Update stale CI sentence during finalization.**  
   `tasks/M2-exit-review.md` currently says M2-09 Actions status is pending until committed/pushed. Final gate should update this to Actions run `28940423265` green.

3. **Strict ROADMAP deferrals require explicit reviewer decision.**  
   The M2 exit matrix leaves these as non-pass:
   - S4 >=20 intervening-session scenario;
   - persona frozen style judge >=90%;
   - sqlite-vec vs LanceDB >=200k benchmark;
   - memory canary;
   - governance friction nightly/soak threshold;
   - full contradiction benchmark.

4. **docs-zh re-translation TODO is correctly only a TODO.**  
   M2-09 does not edit `docs-zh/`. Owner should handle translations after final gate.

## NIT

- Some generated Markdown files remain long-line formatted, but they are readable and pass evidence is redundant.
- The work report still contains a stale note that M2-09 GitHub Actions was pending before push; the final answer/review should treat `28940423265` as source of truth.

## Final decision

M2-09 closeout task is accepted with notes. Send this to Fable/Opus for the final M2 exit gate.
