# M2 named suite scorecard

Date: 2026-07-08

Evidence:

- `tasks/owner-checks/M2-09/testing-full.txt`
- Required command: `pnpm --filter @fairy/testing test -- --reporter=verbose`

Summary from `testing-full.txt`:

```text
Test Files  8 passed | 1 skipped (9)
Tests       67 passed | 1 skipped (68)
```

Machine-readable status:

```text
memory.leakage: PASS
memory.deletion-permanence: PASS
research.citation-precision: PASS
research.zh-en-parity: PASS
injection.research-v0: PASS
label.conformance: PASS
governance.friction-canary: PASS
persona.consistency: PASS
substance.invariance: PASS
perception.quarantine-v0: PASS
context.compaction-regression: PASS
chronicle.workspace-v0: PASS
dream-cycle.consolidation-v0: PASS
memory.canary: SKIPPED/DEFERRED
persona style-judge >=90%: SKIPPED/DEFERRED
governance friction canary nightly/soak threshold: SKIPPED/DEFERRED
full contradiction benchmark: SKIPPED/DEFERRED
```

## PR-tier suites

| Suite | Status | Tier | Evidence | Notes |
|---|---:|---|---|---|
| `memory.leakage` | PASS | PR-tier deterministic | `test/memory.leakage.test.ts` | Retrieval denials do not leak under-cleared personal text. |
| `memory.deletion-permanence` | PASS | PR-tier deterministic | `test/memory.deletion-permanence.test.ts` | Tombstoned deleted memories stay deleted across rebuild/retrieval. |
| `research.citation-precision` | PASS | PR-tier deterministic | `test/research.evals.test.ts` | Cited claims resolve to supporting snapshot spans. |
| `research.zh-en-parity` | PASS | PR-tier deterministic | `test/research.evals.test.ts` | Seeded zh/en source quality and canonical overlap are checked. |
| `injection.research-v0` | PASS | PR-tier deterministic gateway E2E | `test/research.evals.test.ts` and `test/gateway.e2e.test.ts` | Research injection stays quarantined and out of memory/instruction roles. |
| `label.conformance` | PASS | PR-tier deterministic | `test/governance.evals.test.ts` | Derivation laws, routing hints, profile tables, escalation, clearance, egress, and redaction are covered. |
| `governance.friction-canary` | PASS | PR-tier deterministic v0 | `test/governance.evals.test.ts` | Emits parseable route-denied recovery report; nightly/soak thresholds are not activated. |
| `persona.consistency` | PASS | PR-tier deterministic substitute | `test/persona-affect.evals.test.ts` | Style markers and distress/negative-feedback behavior are deterministic; not the frozen style-judge >=90% gate. |
| `substance.invariance` | PASS | PR-tier deterministic | `test/persona-affect.evals.test.ts` | Affect extremes preserve tools, permissions, routing, and factual payload. |
| `perception.quarantine-v0` | PASS | PR-tier deterministic gateway E2E | `test/gateway.e2e.test.ts` | Mock screenshot/OCR artifact flow, quarantine, OCR secret routing, and egress denial are covered. |
| `context.compaction-regression` | PASS | PR-tier deterministic gateway E2E | `test/gateway.e2e.test.ts` | L4/L5 compaction, clearance, quarantine no-laundering, replay, no-cleared summarizer skip, and invalid-output fallback are covered. |
| `chronicle.workspace-v0` | PASS | PR-tier deterministic gateway E2E | `test/gateway.e2e.test.ts` | Append/query/list, workspace scope, secret-write denial, digest relevance, and label routing are covered. |
| `dream-cycle.consolidation-v0` | PASS | PR-tier deterministic gateway E2E | `test/gateway.e2e.test.ts` | Manual deterministic reports, redaction, provenance, pending skills, and no scheduler/model call are covered. |

No required M2 named suite is `NOT FOUND`.

## Deferred / visible items

| Item | Status | Evidence | Why not PASS |
|---|---:|---|---|
| `memory.canary` | SKIPPED/DEFERRED | `testing-full.txt` shows `test/memory.canary.test.ts` skipped | Spec says canary remains visibly deferred until model-backed consolidation/canary benchmark exists. |
| `persona style-judge >=90%` | SKIPPED/DEFERRED | `docs/specs/evals.md` M2-05 registration status | Deterministic `persona.consistency` passes, but a frozen judge is not configured. |
| `governance friction canary nightly/soak threshold` | SKIPPED/DEFERRED | `docs/specs/evals.md` M2-04 registration status | PR-tier v0 passes; nightly cadence and M5 soak thresholds activate later with real workloads. |
| `full contradiction benchmark` | SKIPPED/DEFERRED | `docs/specs/memory.md` and M2-08 review | M2-08 consolidation emits contradiction suggestions only; no auto-supersession benchmark. |
