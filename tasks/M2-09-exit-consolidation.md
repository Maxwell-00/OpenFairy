# Task M2-09 — M2 exit consolidation

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0–M1 closed. M2-01 through M2-08 are closed at task level.
>
> This is a milestone-exit consolidation task. It is **not** a feature slice.
>
> Goal: produce a trustworthy M2 exit evidence bundle and milestone-close draft that a reviewer can gate against ROADMAP and specs before M3 starts.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Raw HTTP/SSE model transport.
   - CI never uses real API keys.
   - Do not read or edit `docs-zh/`.

2. `REVIEWER-HANDBOOK.md`
   - Current project state after M2-08 countersign.
   - Review/brief-gate discipline.
   - Owner commits before review.
   - Docs reviewer-owned.
   - M2-09 is pure closeout, not new capability work.

3. `docs/ROADMAP.md`
   - M2 exit criteria:
     - S2 text with verifiable citations;
     - S4 across at least 20 sessions;
     - leakage/label suites zero-tolerance green;
     - S7 screenshot flow;
     - persona ≥ 90%;
     - decision gate: sqlite-vec vs LanceDB benchmark at ≥ 200k records.
   - M3 starts voice only after M2 exit is honestly closed or explicitly deferred.

4. `docs/specs/evals.md`
   - Every milestone gate must map to named suites.
   - Suite registry and cadence.
   - Important M2 status:
     - deterministic PR-tier suites are implemented for memory leakage/deletion, research, injection, governance, persona/substance, perception, context compaction, Chronicle, dream-cycle;
     - memory canary remains deferred/visible;
     - persona style-judge ≥90% version is deferred until frozen judge exists;
     - governance friction canary v0 is PR-tier; nightly/soak activation later.

5. `docs/specs/memory.md`
   - MemoryStore v1, MemoryGate, evidence pull-through.
   - Chronicle v1.
   - Hand-triggered deterministic dream-cycle v0.
   - Deferred items: full memory canary, promotion/decay/index-maintenance benchmark behavior, autonomous scheduler/workflow.

6. `tasks/M2-07-review.md`
   - M2-07 L4/L5 is closed.
   - Fable/Opus countersign confirms the two M2-07 carry-in tests landed in M2-08:
     - no-cleared-summarizer fail-closed E2E;
     - invalid-compactor-output integration test.
   - Do not duplicate those as open blockers.

7. `tasks/M2-08-review.md`
   - M2-08 is closed and countersigned.
   - Fable/Opus confirmed all seven M2-08 gate clauses.
   - M2-08 docs pass has been applied.
   - Known non-blocking notes:
     - consolidation emits a synthetic session directory for artifact-created receipts;
     - Chronicle digest is accounted under the memory zone;
     - learned-skill pending drafts land under `extensions/skills/learned/pending/`.

8. `tasks/owner-checks/M2-08/M2-08-owner-checks.md`
   - Owner evidence is PASS with local environment notes.
   - Local shim/PowerShell encoding issues were environment-side and later repaired, not source changes.

## Deliverables

### 0. Hard boundaries

This task must not implement new runtime capability.

Allowed changes:

- `tasks/` milestone close documents and owner evidence;
- reviewer-handbook status cleanup if needed;
- test/evidence-only scripts only if they do not change product behavior;
- docs/specs only if a reviewer explicitly asks; otherwise report docs drift rather than editing docs.

Disallowed changes:

- no new memory/research/governance/perception/context/persona feature;
- no scheduler/workflow;
- no M3 voice work;
- no new provider integration;
- no vector backend implementation;
- no learned-skill activation;
- no docs-zh;
- no fake-passing deferred evals;
- no deleting or rewriting historical task evidence.

Acceptance:

- `git diff --name-only` is limited to allowed closeout/evidence files unless justified in the work report.
- No package runtime source changes unless explicitly justified as test/evidence-only support.
- No `docs-zh/` changes.

### 1. M2 named suite scorecard

Produce a machine-checkable and human-readable scorecard for all M2 named suites.

Required output:

```text
tasks/M2-09-work.md
tasks/owner-checks/M2-09/m2-suite-scorecard.md
tasks/owner-checks/M2-09/testing-full.txt
```

Required suite list:

```text
memory.leakage
memory.deletion-permanence
research.citation-precision
research.zh-en-parity
injection.research-v0
label.conformance
governance.friction-canary
persona.consistency
substance.invariance
perception.quarantine-v0
context.compaction-regression
chronicle.workspace-v0
dream-cycle.consolidation-v0
```

Also report deferred/visible suites or benchmarks:

```text
memory.canary
persona style-judge >=90%
governance friction canary nightly/soak threshold
full contradiction benchmark
```

Required behavior:

- Run `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- Parse or manually summarize visible suite names and final pass/skip counts.
- Do not treat skipped/deferred suites as pass.
- Explain whether each suite is PR-tier implemented, skipped/deferred, or future/nightly.

Acceptance:

- Scorecard shows every required suite with `PASS`, `SKIPPED/DEFERRED`, or `NOT FOUND`.
- Any `NOT FOUND` is a blocker unless justified by spec.
- `memory.canary` remains explicit `SKIPPED/DEFERRED`, not PASS.

### 2. ROADMAP M2 exit criteria matrix

Produce:

```text
tasks/owner-checks/M2-09/m2-exit-matrix.md
```

Map each ROADMAP M2 exit criterion to evidence and verdict.

Required rows:

1. **S2 text with verifiable citations**
   - Evidence from M2-03 research orchestrator and citation suite.
   - Include owner/manual evidence if already present.
   - Verdict: satisfied / partial / deferred, with reason.

2. **S4 across ≥20 sessions**
   - Determine whether committed evidence already proves this.
   - If not proven, mark `PARTIAL/DEFERRED`, not pass.
   - Do not invent session count.

3. **leakage/label suites zero-tolerance green**
   - Evidence from `memory.leakage`, `label.conformance`, governance route/egress tests, CI.
   - Verdict should be pass only if suite evidence is green.

4. **S7 screenshot flow**
   - Evidence from M2-06 perception/image/OCR flow and `perception.quarantine-v0`.
   - Clarify whether this is screenshot/perception v0, not full M4/S7 automation.

5. **persona ≥90%**
   - Deterministic `persona.consistency` exists.
   - Style-judge ≥90% is deferred until frozen judge exists.
   - Decide explicitly:
     - `DEFERRED WITH DETERMINISTIC SUBSTITUTE`, or
     - `BLOCKER`, if reviewer policy requires judge before M3.
   - Do not silently pass.

6. **sqlite-vec vs LanceDB decision gate**
   - Determine whether a ≥200k record benchmark exists.
   - If absent, produce a decision-gate note and recommendation.
   - Do not implement vector backend in this task.

Acceptance:

- Matrix has explicit verdict for every criterion.
- Deferred criteria are named and justified.
- No criterion is marked PASS without evidence.

### 3. sqlite-vec vs LanceDB decision gate note

Produce:

```text
tasks/owner-checks/M2-09/vector-backend-decision.md
```

Required content:

- Current memory implementation status: SQLite + FTS5 projection, vector retrieval deferred.
- ROADMAP says decision gate at ≥200k records benchmark.
- State whether benchmark evidence exists.
- Recommend one of:
  - defer benchmark to M3-prep/M5-hardening because M2 has no vector implementation;
  - run a small design/benchmark task before M3 if reviewer requires ROADMAP gate literal closure.
- List benchmark acceptance shape if deferred:
  - 200k synthetic records;
  - ingest time;
  - query p50/p95;
  - disk size;
  - rebuild time;
  - Windows local dev compatibility;
  - data-governance labels preserved;
  - no external managed service.

Acceptance:

- Honest status.
- No premature backend choice without benchmark.
- No implementation.

### 4. M2 exit review draft

Produce a draft milestone-close document for reviewer finalization:

```text
tasks/M2-exit-review.md
```

This is a **draft** for reviewer gate. Label it clearly:

```text
DRAFT — pending Fable/Opus gate
```

Required sections:

1. Scope summary: M2-01 through M2-08.
2. Evidence sources:
   - task reviews,
   - countersigns,
   - owner checks,
   - CI links if known,
   - suite scorecard,
   - exit matrix.
3. Closed capabilities:
   - route deny/fallback and MemoryGate;
   - MemoryStore v1/retrieval/evidence;
   - research orchestrator/citations;
   - governance profiles/egress/redaction;
   - persona/affect;
   - perception artifacts/OCR;
   - L4/L5 compaction;
   - Chronicle/dream-cycle v0.
4. Deferred items:
   - memory canary full benchmark;
   - persona frozen style-judge ≥90%;
   - friction canary nightly/soak threshold;
   - sqlite-vec vs LanceDB ≥200k benchmark;
   - full contradiction/promotion/decay/index maintenance;
   - autonomous scheduler/workflow.
5. Open risks.
6. Recommendation:
   - either `M2 CLOSED WITH EXPLICIT DEFERRALS` or `M2 NOT YET CLOSED`;
   - include a reviewer-facing rationale.

Acceptance:

- Draft does not claim final closure without reviewer gate.
- Deferred items are explicit.
- No unsupported milestone claims.

### 5. M3 preconditions

Produce:

```text
tasks/owner-checks/M2-09/M3-preconditions.md
```

Required content:

- what must be true before starting M3 voice;
- what can safely defer to M4/M5;
- which M2 deferrals may block voice if reviewer chooses strict ROADMAP interpretation;
- recommended first M3 brief shape.

Suggested M3 first slice:

```text
M3-01 — voice protocol + loopback audio transport skeleton
```

Do not write the full M3-01 task brief in this task unless explicitly requested later.

Acceptance:

- Clear distinction between hard blockers and acceptable deferrals.
- No M3 implementation.

### 6. Handbook cleanup

If `REVIEWER-HANDBOOK.md` still says stale M2 state, update only the status/carry-in section.

Required behavior:

- State M2-08 countersigned closed.
- State M2-09 exit consolidation in progress or drafted.
- Remove stale "context L4/L5 remaining" phrasing.
- Do not rewrite the handbook wholesale.

Acceptance:

- Diff is small.
- No style churn.

### 7. Owner evidence bundle

Suggested commands:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-09 | Out-Null

pnpm lint 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/lint.txt
pnpm -r typecheck 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/typecheck.txt
pnpm -r test 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/all-tests.txt
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/testing-full.txt
pnpm dep-check 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/dep-check.txt
pnpm conformance 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/conformance.txt
git diff --check 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/diff-check.txt
git diff --name-only -- docs docs-zh 2>&1 | Tee-Object -FilePath tasks/owner-checks/M2-09/docs-diff.txt
```

If running from PowerShell 7 with the owner's `Save-Utf8Log` helper, use that to avoid mojibake.

Acceptance:

- GitHub Actions green on ubuntu + windows.
- Evidence committed under `tasks/owner-checks/M2-09/`.
- Any local environment issue is clearly separated from project failures.

## Boundaries — do NOT

- Do not implement new runtime features.
- Do not add new providers.
- Do not implement vector backend or benchmark unless the approved brief is revised.
- Do not start M3 voice.
- Do not implement scheduler/workflows.
- Do not activate learned skills.
- Do not fake-pass memory canary or persona judge.
- Do not claim ROADMAP criteria are satisfied without evidence.
- Do not edit `docs-zh/`.
- Do not delete owner-check evidence from earlier tasks.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on ubuntu + windows.

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named suite scorecard.
3. M2 exit matrix summary.
4. Deferred items and rationale.
5. sqlite-vec vs LanceDB decision note.
6. M3 preconditions.
7. Spec ambiguities.
8. Reviewer questions.
