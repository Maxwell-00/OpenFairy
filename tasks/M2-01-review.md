# M2-01 Review — Governance routing gate + MemoryGate v0 + live conformance hardening

Date: 2026-07-04
Reviewer: ChatGPT 5.5 Pro, acting as OpenFairy reviewer
Repo: `Maxwell-00/OpenFairy`
Reviewed implementation commit: `737aa8a684a1294f518fa987b87e3a9dd9d4c109`
Owner evidence commits: `00cdf7b`, `ab08485`, `8170333`, `b0577e5`
Latest reviewed branch head: `b0577e5d5680f321642c505ca309d4c16b3348b0`
CI evidence: GitHub Actions run `M2-01-user-test #29`, status `Success`, matrix `verify`, 2 jobs completed, commit `ab08485`.

## Verdict

**ACCEPTED WITH NOTES.**

**M2-01 task-level status: CLOSED.**

M2-01 implementation satisfies the task brief and the owner manual checks. The runtime behavior is accepted. The latest cleanup commit only edited `tasks/owner-checks/M2-01/M2-01-owner-checks.md`; it did not change code. The last code/evidence CI run visible on GitHub is `#29` on `ab08485`, green on the two-job matrix.

## Sources reviewed

- Task brief: `tasks/M2-01-governance-routing-memorygate.md`
- Work report: `tasks/M2-01-work.md`
- Implementation baseline: commit `737aa8a`
- Owner evidence summary: `tasks/owner-checks/M2-01/M2-01-owner-checks.md`
- Owner evidence replays:
  - `tasks/owner-checks/M2-01/route-deny-replay.jsonl`
  - `tasks/owner-checks/M2-01/memory-safe-replay.jsonl`
  - `tasks/owner-checks/M2-01/memory-secret-replay.jsonl`
- Live conformance logs:
  - `tasks/owner-checks/M2-01/deepseek-conformance.txt`
  - `tasks/owner-checks/M2-01/ollama-conformance.txt`
- GitHub Actions summary for `M2-01-user-test #29`

## Acceptance matrix

| Deliverable | Result | Evidence |
|---|---:|---|
| M1-04 carry-in: strict live conformance | PASS | `live trivial tool-call shape` no longer treats `done` without a normalized `tool_call` as full PASS; work report records pass/degraded distinction. Owner DeepSeek/Ollama live logs both show full PASS. |
| Governance config and provider clearance | PASS | Implementation adds profile/home-region clearance semantics and tests. Task brief's `home_regions: [cn]` and no-`global` invariant were preserved. |
| Enforced route gate before provider I/O | PASS | Owner route-deny replay shows `route.denied`, denied candidates, and final trace without provider/network failure. |
| Effective labels over assembled prompt | PASS | Implementation and tests cover history contamination: labels derive from the assembled prompt, not only current input. |
| Semantic escalation v0 | PASS | Table-driven raise-only escalation exists; no declassification path was introduced. |
| MemoryGate v0 admission | PASS | Safe explicit remember produced `memory.gate.decision allow` and `memory.written`; fake API-key remember produced `memory.gate.decision deny` and no `memory.written`. |
| Replay/audit visibility | PASS | Route and memory gate decisions are visible in JSON replay artifacts. |
| Provider-special-case guard | PASS | Kernel guard exists; provider strings are allowed only at model-gateway/testing boundary, not in kernel branches. |
| No docs-zh edits | PASS | Reviewed commit and owner evidence commits do not require or rely on `docs-zh/` edits. |
| CI | PASS | `M2-01-user-test #29` completed successfully on the configured two-job matrix. |

## BLOCKER

None.

## CARRY-IN

### 1. Reviewer-owned docs pass still needs to be applied

Codex correctly did not edit `docs/` or `docs-zh/`. The following English spec updates should be applied by the reviewer, not Codex:

- `docs/specs/protocol.md`
  - Clarify `memory.gate.decision.payload.decision` as `allow | deny | hold` for admission.
  - Record that later retrieval-gate decisions will reuse the same event type with an explicit phase/reason field.
- `docs/specs/data-governance.md`
  - Add M2-01 concrete route-denied behavior: no disallowed provider receives request bytes; allowed fallback records denied candidates in trace/progress.
  - Record implemented profile defaults and the `regions ⊆ home_regions` check.
- `docs/specs/memory.md`
  - Mark MemoryGate v0 as **admission-only** for M2-01.
  - Explicitly state no retrieval, no embeddings, no vector DB, and no prompt injection in M2-01.
  - Point M2-02 at retrieval-gate semantics.
- `README.md`
  - Update status from “design phase / no implementation yet” to “early implementation; M0/M1 complete; M2 in progress”.

This is a documentation carry-in, not a runtime blocker.

### 2. Evidence replay encoding remains imperfect but acceptable

The owner did not regenerate replay JSONL after the earlier PowerShell encoding issue. This is acceptable for M2-01 because the critical events are readable and sufficient:

- `route.denied` and `denied_candidates` are present in route-deny evidence.
- `memory.gate.decision allow` and `memory.written` are present in safe-memory evidence.
- `memory.gate.decision deny` is present and `memory.written` is absent in fake-secret evidence.

Do not block M2-01 on replay file hygiene. Future owner-check instructions should prefer raw-byte capture or repository-native replay output to avoid UTF-16/stdout encoding artifacts.

### 3. CI warning: `pnpm/action-setup@v4` Node runtime deprecation

GitHub Actions still reports the Node 20 deprecation warning for `pnpm/action-setup@v4`, forced onto Node 24. This is not a failure. Track it as a maintenance item only.

## NIT

- Latest owner summary commit `b0577e5` cleaned the important placeholders and section structure, but the raw file presentation may still be less pleasant than hand-written markdown due earlier formatting churn. It is good enough for evidence.
- `README.md` repo status remains stale.

## Verified / Owner-stated / Not verified

### Verified

- Implementation baseline exists as committed GitHub state.
- Owner evidence commits are in GitHub history.
- Latest owner summary cleanup commit changes only `tasks/owner-checks/M2-01/M2-01-owner-checks.md`.
- GitHub Actions run `#29` is green for the code/evidence baseline.
- Owner evidence replays support the route-deny and MemoryGate outcomes.
- No runtime blocker remains.

### Owner-stated with evidence

- DeepSeek and Ollama live conformance were run with real local/private endpoints.
- Real DeepSeek key was supplied only via local environment variable.
- No real API key was pasted into chat.

### Not independently verified

- I did not connect to the private DeepSeek or Ollama endpoints.
- I did not rerun the live manual checks locally.
- I did not apply English spec docs in the repository.

## Final decision

M2-01 is accepted and closed at task level.

Proceed to M2-02 after applying or consciously carrying the reviewer-owned docs pass. The next implementation slice should be memory storage + gated retrieval digest, not research/persona/proactivity.
