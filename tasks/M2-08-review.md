# M2-08 Final Review — Chronicle v1 + hand-triggered dream-cycle consolidation

Review date: 2026-07-08  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-08-chronicle-dream-cycle.md`  
Implementation commit: `5f3ef12`  
Owner evidence commit: `ce4e648`  
Owner summary commit: `b650e00`  
CI:
- Implementation run `28872338070`: success, ubuntu + windows matrix completed.
- Owner evidence/summary run `28913297784`: success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-08 is task-closed. Chronicle v1 and deterministic hand-triggered dream-cycle consolidation v0 are accepted at mock/fixture level, with owner evidence committed and CI green.

## Evidence base

- Work report: `tasks/M2-08-work.md`.
- Implementation review: `tasks/M2-08-review.md`.
- Owner evidence:
  - `tasks/owner-checks/M2-08/M2-08-owner-checks.md`
  - `tasks/owner-checks/M2-08/testing-chronicle.txt`
  - `tasks/owner-checks/M2-08/dream-cycle-consolidation.txt`
  - `tasks/owner-checks/M2-08/chronicle-log.json`
  - `tasks/owner-checks/M2-08/chronicle-query.json`
  - `tasks/owner-checks/M2-08/chronicle-list.json`
  - `tasks/owner-checks/M2-08/consolidate.json`
  - `tasks/owner-checks/M2-08/memory-report.json`
  - `tasks/owner-checks/M2-08/memory-package.txt`
  - `tasks/owner-checks/M2-08/cli-chronicle-memory.txt`
  - `tasks/owner-checks/M2-08/tools-chronicle.txt`
  - `tasks/owner-checks/M2-08/conformance.txt`

## Acceptance review

### 0. Existing invariants

**PASS.**

Owner evidence shows `@fairy/testing` green with existing M2 suites visible. `memory.canary` remains visibly skipped/deferred rather than fake-passed. GitHub Actions is green for `b650e00`.

### 1. ChronicleStore v1

**PASS.**

Chronicle evidence confirms append/query/list with workspace id, labels, provenance, and no secret labels. Owner summary records the logged decision entry `chr_1939322fe200d2337363`, `internal/global-ok`, workspace id `ws_a668ce9320938ed4`, and provenance `cli:chronicle.log`.

### 2. Chronicle tools and CLI

**PASS.**

CLI evidence is parseable JSON. `chronicle-log.json`, `chronicle-query.json`, and `chronicle-list.json` show the logged `Use source-first TS execution` decision and query/list retrieval.

### 3. Chronicle digest and routing

**PASS.**

The implementation work report and `@fairy/testing` evidence cover `chronicle.workspace-v0`, including relevant digest injection and route gating for under-cleared primary providers.

### 4. Hand-triggered dream-cycle consolidation v0

**PASS.**

Consolidation owner evidence shows:

- deterministic report id `mrep_b5dd998f1b1c7511e111`;
- report artifact ref visible;
- non-secret provenance quotes visible;
- raw fake key absent;
- secret redaction receipt `[REDACTED:secret:eb6a69dca861]`;
- learned skill draft status `pending`;
- deferred items recorded for promotion, decay, index maintenance, scheduler/autonomous jobs, automatic supersession/deletion, and learned-skill activation.

This satisfies the deterministic v0 boundary.

### 5. Evidence pull-through

**PASS.**

Memory package evidence shows Chronicle/consolidation evidence pull-through tests passing. `MemoryStore.evidence()` remains the evidence path.

### 6. Eval suites

**PASS.**

Owner summary records:

- `chronicle.workspace-v0` present and PASS;
- `dream-cycle.consolidation-v0` present and PASS;
- `context.compaction-regression` remains visible and PASS;
- full testing summary: 8 passed / 1 skipped test files; 67 passed / 1 skipped tests;
- focused dream-cycle summary: 1 passed / 8 skipped test files; 1 passed / 67 skipped tests.

### 7. Conformance

**PASS.**

Owner evidence records mock conformance 18/18 PASS and machine-readable `"ok": true`.

### 8. Optional full acceptance tail

**N/A — local environment issue, not implementation failure.**

The owner evidence captured earlier wrapper-command failures for `eslint`, `tsc`, `vitest`, and `dependency-cruiser` due local Windows `node_modules/.bin` shim breakage. Those are not treated as M2-08 failures because direct target/package evidence passed and GitHub Actions is green. The user later repaired local shims by deleting `node_modules` and running `pnpm install`; no source change is required.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply M2-08 docs proposals to:
   - `docs/specs/memory.md`
   - `docs/specs/context-engine.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/evals.md`
   - `docs/specs/protocol.md`

2. **Code-level countersign recommended before M2 exit.**  
   M2-08 touches memory persistence, Chronicle admission, consolidation report redaction, evidence pull-through, and context digest routing. Fable/Opus code-level cross-check should be done before M2 exit consolidation.

3. **Evidence hygiene NIT.**  
   Some owner logs contain mojibake/ANSI artifacts from the previous Windows PowerShell setup. This is reviewable and does not affect verdict. The local terminal/profile issue has been addressed outside source code.

4. **Generated pending learned-skill fixture artifact.**  
   Owner evidence includes a pending learned-skill draft under `extensions/skills/learned/pending/`. It is pending-only and not active. For future tasks, prefer generating such fixture artifacts under `tasks/owner-checks/` unless the product path itself is being validated.

## Final decision

M2-08 is closed. The M2 functional slices are now complete. Proceed to M2-08 code-level countersign and then M2 exit consolidation.

---

## Countersignature — Claude (Fable 5), 2026-07-08

Code-level cross-check delegated to an opus subagent (12-item checklist at `5f3ef12`, file:line evidence, reads via `git show`). **12/12 PASS, zero vacuous assertions; every reviewer-gate clause from the brief gate is confirmed in code:**

- **Both M2-07 carry-in tests landed** inside the existing `context.compaction-regression` suite: terminal no-cleared-summarizer fail-closed (`provider.requests===0`, no L4/L5 stages, turn completes uncompacted, denial visible) and invalid-compactor-output driven to completion on the original path (`context.compaction.skipped reason:/invalid/`). The M2-07 carry-in register is now fully discharged.
- **Zero model calls in consolidation:** `consolidation.ts` imports only node builtins + chronicle; summaries are deterministic field extraction; `reportId = mrep_<hash of stable-stringified input>`; E2E asserts no tool.call in the consolidation path.
- **No auto-supersession/deletion:** no emit path for `memory.superseded`/`memory.deleted` exists in consolidation; contradiction output is suggestions-only; the six deferred items (promotion/decay/index maintenance/scheduler/auto-supersession/skill activation) are recorded in the report's `deferred[]`; `memory.canary` remains `describe.skip` + throw — visibly deferred, not fake-passed.
- **Report labels content-derived:** a fixture with a personal/local-only event yields a report artifact labeled `personal/local-only`, carried on the emitted `artifact.created`. Secret redaction **reuses kernel governance** (`escalateLabelsForContent` + `redactText` fingerprints) — no new detector; raw fake key asserted absent, `[REDACTED:secret:<fp>]` receipt asserted present.
- **ChronicleStore:** append-only JSONL under the data dir per workspace; secret writes throw `ChroniclePolicyError("secret_denied")` via injected governance labeling; personal requires explicit `allowPersonal`; cross-workspace reads return empty (test); no auto personal-memory write (MemoryStore stays empty).
- **Digest routing:** chronicle digest folds into the memory zone via the same `deriveMemoryLabels` join; E2E pins irrelevant-entry exclusion, `provider.requests===0` on the under-cleared primary, cleared fallback completion, manifest effective labels.
- **Evidence:** extends `MemoryStore.evidence()` in place; denied branch returns exactly `{memory_id, ok:false, reason}` — chronicle/report refs cannot leak through a denial.
- **Boundaries:** governance/persona/compaction byte-identical to parent; no docs; no new event types (`memory.consolidation.report` is a payload kind); new CJK regex uses codepoint escapes per M2-05c; weakening scan clean (tool-key assertion strengthened).

Three non-blocking notes for the record: (1) consolidation appends its `artifact.created` into a **synthetic session directory** under `sessions/` (idempotent, dedup-guarded, never rewrites real logs) — replay accounting should remember these exist; (2) the chronicle digest is folded into the `memory` manifest zone rather than a separately-named zone — brief-compliant, revisit only if zone-level observability is wanted later; (3) `learned_skill_pending_dir` resolves under the workspace root (`extensions/skills/learned/pending`) — exactly what the spec mandates, but it is the one consolidation write landing in the repo tree; the primary review's CARRY-IN 4 (prefer owner-check paths for fixture artifacts) stands.

Owner-reported post-review fixes (Windows `.bin` shim repair via node_modules reinstall; terminal mojibake profile fix) are environment-side with no source change — no re-evidence required, consistent with the review's §8 disposition.

Docs pass applied with this countersignature (memory, context-engine, data-governance, evals, protocol). Handbook updated.

**Countersigned: M2-08 ACCEPTED WITH NOTES / CLOSED.** M2 functional slices complete; next is M2-09 exit consolidation.

