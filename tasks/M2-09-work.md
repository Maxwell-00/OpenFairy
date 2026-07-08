# M2-09 Work Report - M2 exit consolidation

Date: 2026-07-08

Baseline: `75bb832` (`Update M2-09-exit-consolidation.md`) on `main`.

This is a milestone-exit evidence task only. No runtime capability, source package, provider, scheduler, workflow, vector backend, or learned-skill activation was implemented.

## File tree delta

Added:

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
- `tasks/M2-exit-review.md`
- `tasks/M2-09-work.md`

Updated:

- `REVIEWER-HANDBOOK.md` status/carry-in paragraph only.

No `docs-zh/` files were read or edited. No `docs/` files were edited.

## Verification tails

Local commands run from `E:\Claude_Projects\Projects\Fairy\OpenFairy`:

| Command | Evidence file | Result |
|---|---|---|
| `pnpm install` | `tasks/owner-checks/M2-09/install.txt` | PASS; lockfile up to date, supply-chain policies pass |
| `pnpm lint` | `tasks/owner-checks/M2-09/lint.txt` | PASS; encoding guard scanned 227 files, eslint clean |
| `pnpm -r typecheck` | `tasks/owner-checks/M2-09/typecheck.txt` | PASS; all workspace package typechecks done |
| `pnpm -r test` | `tasks/owner-checks/M2-09/all-tests.txt` | PASS; includes `@fairy/testing` verbose output |
| `pnpm --filter @fairy/testing test -- --reporter=verbose` | `tasks/owner-checks/M2-09/testing-full.txt` | PASS; `8 passed | 1 skipped` test files, `67 passed | 1 skipped` tests |
| `pnpm dep-check` | `tasks/owner-checks/M2-09/dep-check.txt` | PASS; 98 modules / 293 dependencies, no violations |
| `pnpm conformance` | `tasks/owner-checks/M2-09/conformance.txt` | PASS; mock mode, 18/18 cases, `"ok": true` |
| `git diff --check` | `tasks/owner-checks/M2-09/diff-check.txt` | PASS; no output |
| `git diff --name-only -- docs docs-zh` | `tasks/owner-checks/M2-09/docs-diff.txt` | PASS; no output |

Current M2-09 GitHub Actions status is not available until this closeout bundle is committed and pushed. Historical M2 task reviews record green ubuntu/windows Actions for M2-01 through M2-08.

## Named suite scorecard

The actual M2 named suite list contains 13 suites. All 13 are visible and PASS in `testing-full.txt`.

Deferred/visible gates remain explicitly non-pass:

- `memory.canary`: skipped/deferred.
- `persona style-judge >=90%`: deferred; deterministic `persona.consistency` is only a substitute.
- `governance friction canary nightly/soak threshold`: deferred; PR-tier v0 passes only the deterministic route-denied recovery fixture.
- `full contradiction benchmark`: deferred; M2-08 emits suggestions only.

Full scorecard: `tasks/owner-checks/M2-09/m2-suite-scorecard.md`.

## M2 exit matrix summary

| ROADMAP criterion | Verdict |
|---|---|
| S2 text with verifiable citations | SATISFIED at deterministic M2 text/research level |
| S4 across >=20 sessions | PARTIAL/DEFERRED; no committed evidence proves the 20-session scenario |
| leakage/label zero-tolerance green | PASS |
| S7 screenshot flow | PASS for screenshot/perception v0; not M4 full S7 automation |
| persona >=90% | DEFERRED WITH DETERMINISTIC SUBSTITUTE |
| sqlite-vec vs LanceDB >=200k decision gate | DEFERRED / DECISION GATE NOT LITERALLY CLOSED |

Full matrix: `tasks/owner-checks/M2-09/m2-exit-matrix.md`.

## Deferred items and rationale

- Full `memory.canary`: visible `describe.skip`; requires model-backed consolidation/canary benchmark, not deterministic M2-08 v0.
- Persona frozen style judge >=90%: no frozen judge exists; deterministic marker/substance suites pass but are not the same claim.
- Governance friction canary nightly/soak threshold: PR-tier report exists; real-workload nightly and M5 soak thresholds remain future.
- sqlite-vec vs LanceDB >=200k benchmark: no benchmark evidence exists; vector retrieval is deferred.
- Full contradiction/promotion/decay/index-maintenance behavior: M2-08 produces suggestions/report artifacts only.
- Autonomous scheduler/workflow: explicitly out of M2-08/M2-09 scope.
- Learned-skill activation: drafts stay pending only.

## sqlite-vec vs LanceDB decision note

`tasks/owner-checks/M2-09/vector-backend-decision.md` records that MemoryStore v1 is currently SQLite projection + FTS5-style retrieval, with vector retrieval deferred. No >=200k benchmark evidence exists, so no backend choice is claimed. Recommendation: defer the benchmark to M3-prep/M5-hardening unless the reviewer requires literal ROADMAP gate closure before M3.

## M3 preconditions

`tasks/owner-checks/M2-09/M3-preconditions.md` separates hard blockers from acceptable deferrals. Recommended first M3 slice shape: `M3-01 - voice protocol + loopback audio transport skeleton`, still source-first, mock in CI, one TurnRunner, no workflow/scheduler.

## Spec ambiguities

1. ROADMAP lists S4 >=20 sessions, persona >=90%, and sqlite-vec vs LanceDB >=200k as M2 exit criteria, while current specs and task reviews explicitly defer the memory canary, frozen style judge, nightly/soak friction threshold, contradiction benchmark, and vector benchmark. The exit review must either accept explicit deferrals or block M3.
2. S7 "screenshot flow" is satisfied by M2-06 screenshot/perception v0 evidence, not by the full M4/S7 automation target in ROADMAP M4.
3. The suite count in the M2-09 brief prose says twelve in one stale place, but the required suite list contains 13. This work treats 13 as canonical.

## Reviewer questions

1. Does Fable/Opus accept `M2 CLOSED WITH EXPLICIT DEFERRALS`, or should strict ROADMAP literal closure block M3 until S4/persona judge/vector benchmark evidence exists?
2. Should the sqlite-vec vs LanceDB benchmark be a short M3-prep task before voice, or carried to M5 hardening because M2 has no vector implementation?
3. Should docs-zh re-translation be scheduled immediately after the M2 exit gate, given all changed English `docs/specs/*.md` are now listed in `tasks/M2-exit-review.md`?
