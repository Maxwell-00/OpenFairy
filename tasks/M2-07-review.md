# M2-07 Final Review — Context ladder completion: L4/L5 compaction + post-compaction regression

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-07-context-compaction.md`  
Implementation commit: `dd3b0a6`  
Owner evidence commit: `817fc96`  
CI:
- Implementation run `28861229375`: success, ubuntu + windows matrix completed.
- Owner-evidence run `28864850370`: success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-07 is task-closed. L4/L5 context compaction is accepted at deterministic mock/fixture level, with owner evidence committed and CI green.

## Evidence base

- Work report: `tasks/M2-07-work.md`.
- Review: `tasks/M2-07-review.md`.
- Owner evidence:
  - `tasks/owner-checks/M2-07/M2-07-owner-checks.md`
  - `tasks/owner-checks/M2-07/testing-compaction.txt`
  - `tasks/owner-checks/M2-07/focused-compaction-regression.txt`
  - `tasks/owner-checks/M2-07/cli-replay-compaction.txt`
  - `tasks/owner-checks/M2-07/kernel-compaction.txt`
  - `tasks/owner-checks/M2-07/config-compaction.txt`
  - `tasks/owner-checks/M2-07/protocol-compaction.txt`
  - `tasks/owner-checks/M2-07/conformance.txt`

## Acceptance review

### 0. Existing invariants

**PASS.**

`testing-compaction.txt` shows the full `@fairy/testing` suite green:

- `context.compaction-regression` appears and passes.
- Existing M2 suites remain visible and green.
- Summary: `8 passed | 1 skipped` test files, `60 passed | 1 skipped` tests.

### 1. Compaction model path and policy

**PASS.**

The focused suite verifies:

- L4/L5 forced compaction;
- preservation of decisions, refs, errors, and quarantine;
- compaction routed through a cleared summarizer fallback;
- labels continue gating the main model.

### 2. L4 micro-compaction

**PASS.**

Evidence shows L4 behavior is exercised by the compaction regression suite and replay/manifest tests. L4 visibility is through `context.manifest.reduction_stages_applied` and compaction artifact rendering.

### 3. L5 full compaction / structured handoff

**PASS.**

Evidence shows L5 behavior is exercised by the compaction regression suite. Replay tests cover `session.compacted`, `artifact.created`, manifest stages, and JSON preservation.

### 4. Post-compaction regression suite

**PASS.**

The deterministic `context.compaction-regression` suite appears and passes. The focused run shows 2 tests passed and 59 skipped under the `-t context.compaction-regression` filter.

### 5. Replay / CLI visibility

**PASS.**

`cli-replay-compaction.txt` and the prior implementation review show replay coverage for compaction rendering. Owner evidence records CLI/replay compaction checks as PASS.

### 6. Config / protocol / conformance

**PASS.**

Owner evidence shows:

- kernel/context compaction tests green;
- config validation tests green;
- protocol/conformance green;
- mock conformance reports `ok:true` across all 18 cases.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply M2-07 docs proposals to:
   - `docs/specs/context-engine.md`
   - `docs/specs/protocol.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/evals.md`

2. **Optional direct replay evidence not required.**  
   `M2-07-owner-checks.md` leaves the optional direct replay section as `YES / NO` / `PASS / N/A / FAIL`. This is acceptable because deterministic test logs cover the same properties and the overall owner check is PASS.

3. **Code-level countersign recommended before M2 exit.**  
   Because compaction is security-sensitive and the implementation is long-line compressed in places, Fable/Opus code-level cross-check is recommended before using this as M2 exit evidence.

## NIT

- Owner summary omits `Owner evidence commit: 817fc96`. This is evidence-hygiene only.
- Work report / some generated files remain difficult to line-cite due to long-line formatting.

## Final decision

M2-07 is closed. Proceed to the next M2 slice after applying or explicitly deferring the M2-07 docs pass.

---

## Countersignature — Claude (Fable 5), 2026-07-07

Code-level cross-check delegated to an opus subagent (12-item checklist at `dd3b0a6`, file:line evidence, reads via `git show`). **PASS on all items, including the three reviewer-gate additions from the brief gate:**

- **Compactor-call clearance CONFIRMED.** The compaction request carries `deriveLabels(sourceMessages, currentLabels)` and goes through the normal gateway generate/clearance path; the governance E2E pins `provider.requests === 0` on the under-cleared summarizer binding (personal/local-only source range — zero bytes), `fallback.requests === 3` (cleared local handled L4 + L5 + main), visible `route-denied` progress with compaction stage tags, and `denied_candidates` in the final trace. The leak channel the gate patch targeted is closed and test-locked.
- **Quarantine no-laundering CONFIRMED.** Handoff `untrusted_data_refs` render only inside FAIRY QUARANTINE fences in a non-instruction-role message; the E2E asserts marker presence (`carrying.length > 0`) before the role/framing partition, plus no memory.written / citation.recorded / tool.call post-handoff, and replay leaks nothing. Non-vacuous by construction.
- **`session.compacted` payload CONFIRMED:** emitted for L5 with required `{range:{start_turn,end_turn}, summary_ref}` resolving to the durable artifact (never emitted without artifact backing); L4 uses `artifact.created` + manifest stage with the justification recorded in Spec Ambiguities — exactly the decision path the brief prescribed. No invented event types (compaction strings appear only as payload `stage`/artifact `kind` values).

Also verified: bounded compactor input (secret text hash-omitted, base64/blob runs stripped, 1400-char previews, capped ref arrays — asserted in both unit and request-body E2E); fail-closed output validation (invalid ⇒ skip + keep L1–L3/L4 path, visible `context.compaction.skipped`); append-only JSONL (original turn events survive, summaries are appended artifacts/events); L4/L5 trigger policy, pin/user preservation, decision/todo/ref/error carry-over, verbatim tail; label inheritance re-gating the main route post-compaction; config keys with validation (threshold 0 fails); replay/manifest rendering; one TurnRunner, no SDK/provider strings, governance/persona untouched, ASCII-clean compaction.ts, no weakened assertions (the two "deletions" are an import expansion and a trailing-newline fix).

**Two minor PARTIALs, recorded as M2-exit carry-in (logic present and correct; tests missing):**

1. The terminal fail-closed branch — *no cleared summarizer candidate at all* ⇒ keep-uncompacted path — has no dedicated E2E (the governance test always has a cleared fallback available).
2. Invalid-compactor-output fail-closed is unit-proven at the validators but no integration test drives a bad-output turn to completion on the original context path. (Implementation performs zero retries — compliant with the brief's "at most once".)

Both are two-test additions; thread them into the M2 exit consolidation slice's Deliverable 0 rather than reopening. Cosmetic note: `summary_ref` is an absolute artifact path rather than the `artifact://` convention used inside summaries — schema-valid, consistency nicety for a future touch.

Docs pass applied with this countersignature (context-engine, protocol, data-governance, evals). Handbook current-state updated.

**Countersigned: M2-07 ACCEPTED WITH NOTES / CLOSED.**

