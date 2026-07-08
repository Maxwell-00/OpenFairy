# M2 Exit Review

FINAL — gated and countersigned by Claude (Fable 5), 2026-07-08. Verdict: **M2 CLOSED WITH EXPLICIT DEFERRALS** (see gate countersignature at the end of this file). Codex's draft body below is preserved as delivered.

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
- M2-09 GitHub Actions: run `28940423265` green on ubuntu + windows (commit `455f733`). [Updated at gate; the draft predated the push.]

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


---

## M2 Exit Gate — Countersignature, Claude (Fable 5), 2026-07-08

Gate verification: commit `455f733` contains evidence/closeout files only (16 files, no runtime source); all 13 named M2 suites individually visible and green in `testing-full.txt` (cross-checked name-by-name, not just the 67-passed tally); the exit matrix's six verdicts match the per-task reviews and countersignatures on file; the quirks register and docs-zh re-translation list required at brief gate are present; no deferred item is presented as a pass anywhere in the bundle. CI run `28940423265` green (ubuntu + windows).

### Verdict: M2 CLOSED WITH EXPLICIT DEFERRALS

Reasoning on the strict-vs-deferral question: the strict literal reading would require producing, today, (a) a 20-session S4 run, (b) a frozen-judge persona score, and (c) a 200k-record benchmark of a capability M2 never implemented. All three would be manufactured evidence — fixture sessions counted as usage, a judge that does not exist yet, a benchmark of an unbuilt vector path. This project's review discipline has consistently refused synthetic theater (fixture owner-evidence is accepted only where no real surface exists); applying that same standard, the honest deferral register preserves the ROADMAP criteria's intent better than literal compliance would. The PR-tier zero-tolerance trust suites — the actual point of the milestone — are all green, and every one of them was code-level countersigned during M2, not merely trusted.

### Deferral register with binding landing gates

A deferral without an expiry is just hidden debt. Each item below is bound to a named future gate and MUST be re-examined there; carrying one past its landing gate requires an explicit new decision recorded in that gate's review.

| Deferral | Landing gate | Binding condition |
|---|---|---|
| S4 across ≥20 sessions | **M4 entry gate** | Counted from the owner's real M3-period sessions in the data dir (real usage accumulates during voice dogfooding); no fixture sessions count. Voice does not depend on it; proactivity/workflows (M4) do. |
| Persona frozen style-judge ≥90% | **M4 exit gate** (or the first critic-role wiring task, whichever comes first) | Deterministic substitute (`persona.consistency` + `substance.invariance`) remains mandatory-green meanwhile; owner dogfooding notes during M3 feed the judge corpus. |
| sqlite-vec vs LanceDB ≥200k benchmark | **Brief-gate precondition of the first vector-implementation task** (M3-prep at earliest, M5-hardening at latest) | No vector task may be dispatched without this benchmark in its brief's acceptance; benchmark shape per `vector-backend-decision.md`. FTS5 remains the retrieval path until then. |
| `memory.canary` + full contradiction benchmark | **Model-backed consolidation task** (dream-cycle as real workflow, M4) | Stay `describe.skip`-visible until then; never fake-passed. |
| Governance friction canary nightly/soak thresholds | **M5 soak** (per evals.md's own cadence) | PR-tier v0 stays mandatory-green meanwhile. |

### M3 preconditions — accepted

`M3-preconditions.md` is endorsed: no M2 deferral blocks voice. Hard preconditions for M3-01 (protocol + loopback transport skeleton) are already true: one-TurnRunner discipline, event registry closed with speech.* types pre-registered, replay/corrupt-tail tolerance, encoding guard, and the trust stack (labels/route clearance/egress) that voice audio paths must inherit. The M3-01 brief gets gated through the same process before dispatch.

### Milestone note

M2 was the trust milestone. What it actually shipped, verified at code level slice by slice: labels that derive over the whole assembled prompt and gate every provider call including summarizers; memory that cannot resurrect deleted facts and cannot leak denied text even through evidence pull-through; research and OCR content that stays quarantined through citation, compaction, and consolidation; an egress guard that blocks before execution and never echoes what it caught; and a persona layer that provably cannot alter substance. Every green gate above is backed by a countersignature with file:line evidence in the corresponding `tasks/M2-*-review.md`.

**M2 CLOSED. Next: gate the M3-01 brief.**
