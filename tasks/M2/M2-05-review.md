# M2-05 Final Review — Persona Pack v1 + Affect Engine v1

Review date: 2026-07-06  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-05-persona-affect.md`  
Implementation baseline: `77ed93e`  
Owner evidence baseline: `ebc3621`  
CI:
- Implementation run `28794363643`: success, ubuntu + windows matrix completed.
- Owner-evidence run `28795528904` / `M2-05-owner-check #49`: success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-05 is task-closed. Persona Pack v1 and deterministic Affect Engine v1 are accepted, with owner manual checks complete and committed.

## Evidence base

- Commit `77ed93e` implemented the persona pack, deterministic affect runtime, context persona/affect zone, gateway wiring, CLI/replay visibility, and `persona.consistency` / `substance.invariance` suites.
- Commit `ebc3621` committed owner evidence and reviewer artifacts for M2-05.
- GitHub Actions for both implementation and owner-evidence commits are green.
- Owner summary: `tasks/owner-checks/M2-05/M2-05-owner-checks.md`.
- Work report: `tasks/M2-05-work.md`.

## Acceptance review

### 0. Existing M2 invariants

**PASS.**

M2 memory/research/governance suites remain visible and passing, including:

- `memory.leakage`
- `memory.deletion-permanence`
- `research.citation-precision`
- `research.zh-en-parity`
- `injection.research-v0`
- `label.conformance`
- `governance.friction-canary`

No `docs/` or `docs-zh/` edits were part of the Codex implementation. The OTP mojibake carry-in was handled; the work report records no match for the mojibake remnants in `packages/kernel/src/governance.ts`.

### 1. Persona Pack v1

**PASS.**

The default Fairy persona pack is present under `extensions/personas/fairy/`:

- `persona.yaml`
- `PERSONA.md`
- `style/en.md`
- `style/zh.md`
- `ack-bank.yaml`

The loader handles persona metadata, disclosure, style summaries, labels, affect baseline/bounds, off switches, and inert content loading. The persona is content/config only; no executable hooks were added.

### 2. Deterministic Affect Engine v1

**PASS.**

The affect engine is deterministic and emits the reconciled `affect.updated` payload shape:

- `valence`
- `arousal`
- `stance`
- required `cause`
- optional `energy`
- optional `updated_at`

No LLM appraisal path was introduced. The engine handles clean completion, thanks, repeated failures, provider outage/route denial, user distress, decay toward baseline, clamping, and off switch behavior.

### 3. Persona/affect prompt zone

**PASS.**

Persona/affect enters the prompt as a bounded presentation layer. Context tests cover:

- persona zone token accounting;
- persona labels joining effective labels without lowering existing labels;
- prefix hash stability when persona/affect state is stable;
- affect-line-only changes not mutating tools/history;
- `context.manifest` remaining observational only.

### 4. CLI / replay visibility

**PASS.**

The following CLI surfaces are implemented and tested:

- `fairy persona inspect --json`
- `fairy affect --json`
- replay text rendering for `affect.updated`
- replay JSON payload preservation

Owner evidence includes parseable `persona-inspect.json` and `affect.json`.

### 5. Eval suites

**PASS.**

The task adds deterministic PR-tier suites:

- `persona.consistency`
- `substance.invariance`

They are implemented without LLM judges in CI. Substance invariance checks that persona/affect does not alter tool calls, permission decisions, route decisions, approvals, or factual payloads.

### 6. Safety rails

**PASS.**

The implementation includes deterministic checks for:

- disclosure / inspectability;
- off switches;
- distress suppressing humor;
- dark-pattern banned phrases;
- no auto memory write by persona/affect;
- style-only persona behavior.

## Owner manual checks

**PASS.**

Owner evidence covers:

1. Persona / affect eval suites.
2. Kernel persona / affect tests.
3. CLI / replay tests.
4. Direct replay/off-switch evidence covered by tests and JSON CLI outputs.

Owner summary verdict: `M2-05 owner manual checks: PASS`.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply the docs proposals from `tasks/M2-05-work.md` to:
   - `docs/specs/persona-affect.md`
   - `docs/specs/context-engine.md`
   - `docs/specs/protocol.md`
   - `docs/specs/evals.md`
   - `docs/specs/data-governance.md`

2. **Reviewer handbook status is stale.**  
   `REVIEWER-HANDBOOK.md` exists and is useful, but its current-state note still says M2-05 is in progress. Update it when applying the M2-05 docs pass or before M2-06 dispatch.

3. **Affect state v1 remains in-memory.**  
   Accepted. JSONL `affect.updated` events are auditable evidence; cross-session affect persistence can be revisited later if the persona/affect spec requires it.

4. **M2 still has remaining roadmap slices.**  
   M2 is not closed. Remaining likely slices include perception service, L4/L5 context compaction, Chronicle/dream-cycle, and M2 exit consolidation.

## NIT

- Owner-check logs captured from Windows may contain mojibake or PowerShell stderr wrapping; owner summary and test tails are still sufficient.
- `AGENTS.md` and `CLAUDE.md` are now aligned and point reviewers to `REVIEWER-HANDBOOK.md`; keep them synchronized after future edits.

## Final decision

M2-05 is closed. Proceed to M2-06 after applying/gating the next task brief.

---

## Countersignature — Claude (Fable 5), 2026-07-06

Verification method: delegated a read-only code audit of `77ed93e` to an opus subagent (14-item checklist, file:line evidence, all reads via `git --no-optional-locks show`), then spot-verified the decisive findings myself at `ebc3621`. Brief-critical items confirmed at code level:

- **Determinism / "model cannot set its own mood": CONFIRMED.** `packages/kernel/src/persona.ts` imports no model gateway; appraisal inputs in `TurnRunner` are user text + mechanical flags only (`index.ts:733-742`); model output never feeds affect state.
- **Schema compliance: CONFIRMED.** Emitted payload matches the reconciled `affect.updated` schema; engine stances (`warm|neutral|dry`) are a subset of the registered enum; baseline `dry` valid.
- **Turn-boundary-only, non-interference (permission/route/egress/MemoryGate), label join without downgrade, off switches, stable prefix, manifest observability, content-only loader, config surface: all CONFIRMED** with non-vacuous tests. `substance.invariance` genuinely diffs tool calls / permission / route / factual payload across affect extremes and would fail on divergence.
- Invariant sweep: one TurnRunner, no vendor SDK, no kernel provider strings, no unregistered event types, no docs edits in the implementation commit — CONFIRMED.

**CORRECTION to §0 / carry-in status — OTP mojibake was NOT removed.** `packages/kernel/src/governance.ts` lines 22-23 and 193-194 still contain the mojibake alternative (the double-encoded remnant of 验证码) at both `77ed93e` and `ebc3621`. Root cause of the false "handled" claim: the work report's verification command (`rg -n "妤犲矁|鐦夐惍涔" ...`) searched for a *differently*-mangled string — the target got re-encoded by the Windows terminal before the search ran, so "no matches" was honest but the check was invalid; the primary review accepted the work-report claim without a code read. This is the encoding-landmine class the handbook warns about, now with a concrete incident.

Disposition: **CLOSED verdict stands** — the item is a 4-line cosmetic cleanup with no runtime effect (the mojibake alternative cannot match real text), and every substantive deliverable passes. The cleanup is re-threaded into M2-06 Deliverable 0 with an **encoding-safe, ASCII-only verification command** (see brief); it must not be verified by pasting CJK through a terminal again.

Notes for the record (non-blocking):

1. Legacy gateway E2E now run with `persona.enabled=false` by default (`gateway.e2e.test.ts` `writeConfig`); prior assertions are unaffected and the plain-zone path is itself tested, but enabled-persona coverage lives only in the dedicated persona E2E + kernel/evals tests. Acceptable; keep in mind when reading green legacy suites.
2. Schema stance enum (`focused`, `playful`) is a superset of what the engine can emit — valid additive design, recorded in the persona-affect docs pass.
3. Codex again disclosed unverified steps plainly ("CI status: not checked in this local run") — the disclosure norm holds; the mojibake miss was an invalid check honestly reported, not a fabrication.

Standing rule added to the handbook: verification of CJK/encoding-sensitive edits must use codepoint-escape (`\uXXXX`) checks, never raw CJK pasted through PowerShell.

Countersigned: M2-05 **ACCEPTED WITH NOTES / CLOSED**, with the correction above.
