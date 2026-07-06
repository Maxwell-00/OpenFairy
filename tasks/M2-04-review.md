# M2-04 Review — Governance Hardening v1

Review date: 2026-07-06  
Reviewed implementation commit: `14ae2c5`  
Reviewed owner-evidence commit: `5dad00c`  
Task brief: `tasks/M2-04-governance-hardening.md`  
Work report: `tasks/M2-04-work.md`  
Owner evidence: `tasks/owner-checks/M2-04/`

## Verdict

**ACCEPTED WITH NOTES / CLOSED**

M2-04 is accepted at task level. The implementation commit delivered the governance hardening slice, and the owner-evidence commit records deterministic fixture/mock validation for label conformance, egress guard behavior, redaction, config validation, provenance-aware permission context, CLI audit/replay behavior, and the optional acceptance tail.

## Reviewed scope

### Implementation commit `14ae2c5`

M2-04 implementation changed the expected governance surface:

- CLI audit/replay support
- gateway config/server plumbing
- config schema/defaults
- kernel governance and TurnRunner egress/permission path
- kernel tests
- testing e2e/evals
- `tasks/M2-04-work.md`

The file tree did not include `docs/` or `docs-zh/`.

### Owner-evidence commit `5dad00c`

Owner evidence added only `tasks/` material:

- `tasks/M2-04-owner-manual-checks.md`
- `tasks/M2-04-review.md`
- `tasks/owner-checks/M2-04/*`

No runtime code, no docs, no `docs-zh/`, and no owner DB artifacts were added.

## Acceptance evidence

### CI

GitHub Actions for the implementation commit `14ae2c5` are green on the existing matrix. The action list shows `M2-04-work` / CI #45 for commit `14ae2c5`, on `main`, duration 2m10s.

The owner-evidence summary also records GitHub Actions green on ubuntu + windows. The owner evidence commit itself is task/evidence-only, so the runtime acceptance baseline remains the implementation CI plus committed test logs.

### Local / owner evidence

The committed owner logs establish:

- `@fairy/testing`: `7 passed | 1 skipped` test files; `44 passed | 1 skipped` tests.
- `@fairy/kernel`: `3 passed` test files; `15 passed` tests.
- `@fairy/config`: `1 passed` test file; `10 passed` tests.
- `@fairy/cli`: `5 passed` test files; `7 passed` tests.
- full `pnpm -r test`: no `Failed` marker; package summaries are green.
- `pnpm -r typecheck`: all workspace packages report `Done`.
- `pnpm dep-check`: no dependency violations.
- `pnpm conformance`: mock mode 18/18 PASS.

The committed owner summary lists M2-04 owner manual checks as PASS. Some sub-section placeholders remain in the summary, but the raw logs prove the pass conditions directly.

## Deliverable verification

| Deliverable | Result | Notes |
|---|---:|---|
| Preserve M2 invariants | PASS | Existing memory/research/injection/gateway suites still appear and pass. |
| Egress Guard v1 | PASS | Egress guard blocks seeded secret and personal content before outbound tool execution; `web.*` and `shell.run` are covered in e2e/evals. |
| Redaction middleware v1 | PASS | Diagnostic/audit/replay surfaces redact secret-shaped content with deterministic fingerprints; raw source-of-truth events are not blanket-mutated. |
| Provenance-aware permission context v0 | PASS | Kernel tests show non-hardcoded permission context and provenance summary. Full M5 capability narrowing remains out of scope. |
| Governance profiles + label defaults | PASS | Config tests validate closed profile enum, invalid profile rejection, region validation, and egress/permission config shape. |
| Label conformance suite | PASS | `label.conformance` appears in `packages/testing` and covers derivation, escalation, near-miss, provider clearance, egress blocking, and redaction diagnostics. |
| Friction canary v0 | PASS | `governance.friction-canary` appears and covers deterministic route-denied recovery reporting. |
| CLI/replay visibility | PASS | Audit JSON/text and replay JSON/text paths are tested with redacted egress diagnostics. |
| Docs boundary | PASS | Codex did not edit `docs/` or `docs-zh/`; proposed docs edits are in the work report only. |

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned M2-04 docs pass.**  
   Apply Codex's proposed docs edits to English specs after this close:
   - `docs/specs/data-governance.md`
   - `docs/specs/sandbox-security.md`
   - `docs/specs/evals.md`
   - `docs/specs/protocol.md`
   - `docs/specs/research.md`

2. **Owner-summary hygiene.**  
   `tasks/owner-checks/M2-04/M2-04-owner-checks.md` still contains some `PASS / FAIL` placeholders and references implementation commit `14ae2c5` rather than evidence commit `5dad00c`. Not a runtime blocker, because raw logs and overall PASS are sufficient. A future evidence-cleanup commit may normalize it.

3. **M5 capability narrowing remains out of scope.**  
   M2-04 passes accurate provenance/trust context and deterministic rule matching. Broad automatic narrowing based on untrusted-content presence remains an M5 hardening task unless scoped separately with causal attribution tests.

4. **Semantic personal-content redaction is intentionally narrow.**  
   The implementation uses exact-string/context-derived matching, not semantic paraphrase detection. This is acceptable for M2. Broader semantic egress detection should be a later task with a false-positive budget.

## NIT

PowerShell evidence logs contain stderr wrapping and mojibake (`node.exe :`, `鉁?`). This is display noise. Vitest summaries are green and sufficient.

## Final decision

**M2-04 CLOSED.**

The M2 trust stack now has MemoryGate/admission, MemoryStore/retrieval, research snapshot/citation pipeline, route clearance, egress guard, provenance-aware permission context, redaction, and deterministic label/friction suites. M2 is not yet closed: persona/affect, perception, context L4/L5, Chronicle/dream-cycle, and final docs pass remain.
