# ROADMAP M2 exit criteria matrix

Date: 2026-07-08

Source criterion: `docs/ROADMAP.md` M2 exit line.

| # | Criterion | Evidence | Verdict | Rationale |
|---:|---|---|---|---|
| 1 | S2 text with verifiable citations | M2-03 review accepts research orchestrator/citation ledger; `research.citation-precision` and `research.zh-en-parity` PASS in `testing-full.txt`; research E2E/replay exists under the normal TurnRunner tool loop. | SATISFIED at deterministic M2 text/research level | Claims resolve to supporting snapshot spans in deterministic fixtures; zh/en parity is covered. No live LLM judge or real web is claimed for CI. |
| 2 | S4 across >=20 sessions | M2-02 MemoryStore/retrieval/delete/rebuild is closed; M2-08 consolidation v0 is closed; `memory.deletion-permanence` and `memory.leakage` PASS. | PARTIAL/DEFERRED | I found no committed evidence proving the specific S4 scenario after >=20 intervening sessions. Do not mark PASS without that run. |
| 3 | Leakage/label suites zero-tolerance green | `memory.leakage`, `label.conformance`, route clearance/egress/redaction gateway tests, and `pnpm -r test`/`@fairy/testing` evidence. | PASS | The PR-tier zero-tolerance suites are visible and green; under-cleared provider/tool paths are pinned to zero request bytes in the relevant M2 reviews/tests. |
| 4 | S7 screenshot flow | M2-06 perception review; `perception.quarantine-v0` PASS in `testing-full.txt`; artifact CLI/replay evidence from M2-06. | PASS for screenshot/perception v0 | M2-06 covers screenshot/image artifact ingestion, mock vision describe/OCR, replay, quarantine, OCR secret routing, and egress denial. This is not the full M4/S7 automation target. |
| 5 | Persona >=90% | `persona.consistency` and `substance.invariance` PASS; `docs/specs/evals.md` says the style-judge >=90% version is deferred until a frozen judge exists. | DEFERRED WITH DETERMINISTIC SUBSTITUTE | Deterministic style-marker and substance-invariance suites are green, but they are not an empirical >=90% frozen-judge result. Strict reviewer policy may treat this as a blocker. |
| 6 | sqlite-vec vs LanceDB decision gate at >=200k records | `docs/specs/memory.md` records vector retrieval deferred to the ROADMAP decision gate; no benchmark artifact found in M2 evidence. | DEFERRED / DECISION GATE NOT LITERALLY CLOSED | No >=200k ingest/query/disk/rebuild benchmark exists, and M2-09 is not allowed to implement one. See `vector-backend-decision.md`. |

## Deferred criteria register

| Item | Classification | Reviewer impact |
|---|---|---|
| S4 >=20 intervening-session scenario | PARTIAL/DEFERRED | May block M2 closure under strict ROADMAP interpretation. |
| Persona frozen style judge >=90% | DEFERRED WITH DETERMINISTIC SUBSTITUTE | May block M2 closure if the reviewer requires a frozen judge before M3. |
| sqlite-vec vs LanceDB >=200k benchmark | DEFERRED / DECISION GATE OPEN | May require a short benchmark/design task before M3, or can be deferred to M3-prep/M5-hardening by reviewer decision. |
| `memory.canary` | SKIPPED/DEFERRED | Visible non-pass; should not be presented as green. |
| Governance friction nightly/soak threshold | SKIPPED/DEFERRED | PR-tier v0 is green; real workload thresholds remain future/M5. |
| Full contradiction benchmark | SKIPPED/DEFERRED | M2-08 suggestions-only consolidation is accepted; automatic supersession/deletion remains future. |

## Recommendation

Recommend reviewer disposition: `M2 CLOSED WITH EXPLICIT DEFERRALS` if Fable/Opus accepts the deferral register above as honest and non-blocking for M3 voice. Under a literal ROADMAP gate interpretation, the same evidence implies `M2 NOT YET CLOSED` until S4, persona judge, and vector benchmark artifacts exist.
