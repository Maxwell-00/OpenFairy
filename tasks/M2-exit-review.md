# M2 Exit Review

DRAFT — pending Fable/Opus gate

Date: 2026-07-08

## 1. Scope summary

M2 ran from M2-01 through M2-08 and is now in M2-09 exit consolidation. This draft does not claim final closure; it packages evidence for reviewer gate.

Covered slices:

- M2-01: governance routing gate, MemoryGate v0, live conformance hardening.
- M2-02: MemoryStore v1, gated retrieval digest, memory CLI verbs.
- M2-03: research orchestrator, citations, source review, injection corpus v0.
- M2-04: governance hardening, egress guard, redaction, label conformance.
- M2-05: persona pack and deterministic affect engine.
- M2-05b/M2-05c/M2-06b: accepted hygiene/debt closeouts.
- M2-06: perception service, artifact pipeline, mock screenshot/OCR flow.
- M2-07: context ladder L4/L5 compaction and replay.
- M2-08: Chronicle v1 and deterministic hand-triggered dream-cycle consolidation v0.
- M2-09: exit scorecard, ROADMAP matrix, vector decision note, M3 preconditions.

## 2. Evidence sources

Task reviews and countersigns:

- `tasks/M2-01-review.md`: accepted with notes, closed; route denial, assembled-label governance, MemoryGate admission, and replay evidence.
- `tasks/M2-02-review.md`: accepted with notes, closed; MemoryStore projection, retrieval gate, deletion permanence, CLI evidence, and CI run `28763629203`.
- `tasks/M2-03-review.md`: accepted with notes, closed; research tools through TurnRunner, citation ledger, zh/en parity, injection E2E, and GitHub Actions `#40/#41`.
- `tasks/M2-04-review.md`: accepted at task level; governance hardening, label/egress/redaction evidence, and CI `M2-04-work #45`.
- `tasks/M2-05-review.md`, `tasks/M2-05b-review.md`, `tasks/M2-05c-review.md`: persona/affect accepted with notes; negative-feedback and encoding fixes countersigned.
- `tasks/M2-06-review.md`: accepted with notes, closed; perception artifact/OCR flow, mock-only suite, CI run `28852734183`.
- `tasks/M2-06b-review.md`: accepted with notes, closed; retro-audit debt D1-D10 discharged, D9 accepted at recorded granularity.
- `tasks/M2-07-review.md`: accepted with notes, closed; L4/L5 compaction countersigned, with later carry-in tests discharged by M2-08.
- `tasks/M2-08-review.md`: accepted with notes, closed; Chronicle/dream-cycle v0 countersigned, M2-07 carry-ins discharged, CI run `28872338070`.

Owner checks and M2-09 evidence:

- `tasks/owner-checks/M2-08/M2-08-owner-checks.md`: PASS with local environment notes; deterministic fixture/mock evidence, no real keys.
- `tasks/owner-checks/M2-09/testing-full.txt`: `@fairy/testing` PASS with 13 named M2 suites visible and `memory.canary` skipped/deferred.
- `tasks/owner-checks/M2-09/m2-suite-scorecard.md`: suite-by-suite status.
- `tasks/owner-checks/M2-09/m2-exit-matrix.md`: ROADMAP criterion matrix.
- `tasks/owner-checks/M2-09/vector-backend-decision.md`: vector decision gate note.
- `tasks/owner-checks/M2-09/M3-preconditions.md`: M3 gate preconditions.

Known CI links/status:

- Historical review files record ubuntu + windows green CI for M2-01 through M2-08.
- Current M2-09 GitHub Actions status is pending until this draft/evidence bundle is committed and pushed.

## 3. Closed capabilities

- Route deny/fallback and MemoryGate: route clearance before provider I/O, assembled prompt labels, denied candidates in trace/progress, admission and retrieval gate decisions.
- MemoryStore v1/retrieval/evidence: SQLite projection over session JSONL, tombstones, rebuild, evidence pull-through, gated digest, CLI list/search/show/delete/rebuild.
- Research orchestrator/citations: deterministic planning, zh/en fan-out, source dedupe/grading, snapshot cache, citation ledger, source-set review, research tools through the normal tool loop.
- Governance profiles/egress/redaction: profile defaults, semantic escalation, label derivation, route/egress enforcement, redacted diagnostics, permission audit context.
- Persona/affect: deterministic style-only persona/affect zone, `affect.updated`, negative-feedback handling, substance invariance, off switch.
- Perception artifacts/OCR: artifact registry, mock `vision.describe`/`vision.ocr`, OCR spill/replay, quarantine, OCR secret escalation/routing, egress denial.
- L4/L5 compaction: cleared summarizer routing, zero bytes to under-cleared summarizer, invalid-output fallback, quarantine no-laundering, `session.compacted` and artifact/replay visibility.
- Chronicle/dream-cycle v0: workspace-scoped Chronicle JSONL, `chronicle.log/query`, relevant digest with label gating, deterministic manual consolidation report, redaction receipts, pending learned-skill drafts, no scheduler/model call.

## 4. Deferred items

- Full `memory.canary` benchmark.
- Persona frozen style-judge >=90%.
- Governance friction canary nightly/soak threshold.
- sqlite-vec vs LanceDB >=200k benchmark.
- S4 >=20 intervening-session scenario evidence.
- Full contradiction/promotion/decay/index-maintenance behavior.
- Autonomous scheduler/workflow.
- Learned-skill activation.
- Real vision/OCR provider and `perception.vision` role wiring.
- Full M4/S7 automation beyond M2 screenshot/perception v0.

## 5. Open risks

- Strict ROADMAP interpretation may block M3 until S4, persona style-judge, and vector benchmark evidence exists.
- The M2-09 draft is local evidence until committed/pushed and GitHub Actions runs on ubuntu + windows.
- Several accepted M2 paths are deterministic fixture/mock evidence; real provider/manual owner checks remain important for future real-provider slices.
- Some work reports/evidence remain long-line or Windows-terminal noisy, though the committed test logs and reviews provide redundant pass evidence.

## 6. Known accepted quirks / notes register

- M2-06b D9 residency-causation unit granularity is accepted: the unit test proves label-preservation-on-deny with residency-only divergence, while causation remains proven at E2E level unless future memory routing makes a tighter unit test natural.
- M2-07 `session.compacted.summary_ref` uses an absolute artifact path rather than the `artifact://` convention used inside summaries; schema-valid and recorded as a future consistency nicety.
- M2-08 consolidation appends `artifact.created` into synthetic session directories under `sessions/`; this is idempotent, dedup-guarded, and does not rewrite real logs.
- M2-08 Chronicle digest folds into the `memory` manifest zone rather than a separately named zone; accepted unless later zone-level observability is desired.
- M2-08 learned-skill pending drafts land under `extensions/skills/learned/pending/`; pending-only and not active, but it is a repo-tree write to remember in fixture hygiene.
- Eval nightly/soak activations and friction canary thresholds remain pending real workloads; current governance friction canary is PR-tier deterministic v0.
- M2-06 perception is in-process mock/tools-std for now; real vision/OCR provider plus `perception.vision` model-gateway role wiring is future work.

## 7. docs-zh re-translation TODO

Command basis: `git diff --name-only 08fc692..HEAD -- docs/`.

English docs changed during M2 and need owner-maintained `docs-zh/` re-translation review:

- `docs/specs/context-engine.md`
- `docs/specs/data-governance.md`
- `docs/specs/evals.md`
- `docs/specs/memory.md`
- `docs/specs/model-gateway.md`
- `docs/specs/persona-affect.md`
- `docs/specs/protocol.md`
- `docs/specs/research.md`
- `docs/specs/sandbox-security.md`

`docs/ROADMAP.md` was not listed by the range command and is not included in the re-translation TODO from this evidence pass.

## 8. Recommendation

Recommendation: `M2 CLOSED WITH EXPLICIT DEFERRALS`.

Rationale: all 13 deterministic PR-tier M2 named suites are visible and green; M2-01 through M2-08 are task-closed with reviews/countersigns; local M2-09 acceptance commands pass; and the remaining unsatisfied ROADMAP/eval items are explicit rather than hidden. This recommendation depends on Fable/Opus accepting the deferral register. Under a strict literal ROADMAP interpretation, the correct alternate verdict is `M2 NOT YET CLOSED` until S4 >=20 sessions, persona frozen style judge, and sqlite-vec vs LanceDB benchmark evidence are produced.
