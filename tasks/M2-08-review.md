# M2-08 Review — Chronicle v1 + hand-triggered dream-cycle consolidation

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-08-chronicle-dream-cycle.md`  
Delivery commit: `5f3ef12`  
CI: GitHub Actions run `28872338070`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — implementation accepted, task close pending owner evidence.**

M2-08 implements Chronicle v1 and deterministic hand-triggered dream-cycle consolidation v0. The implementation is accepted at code/CI level. Task-level close remains pending owner evidence under `tasks/owner-checks/M2-08/`.

## Evidence base

- Commit `5f3ef12` / `M2-08-work`.
- Work report: `tasks/M2-08-work.md`.
- CI run `28872338070` / `M2-08-work #68`: success, matrix `verify`, 2 jobs completed.

## Acceptance review

### 0. Existing invariants

**PASS.** The work report records acceptance checks or direct equivalents: encoding guard, ESLint, TypeScript package checks, focused/package tests, dep-cruiser, mock conformance 18/18, diff check, and no docs/docs-zh diffs. GitHub Actions for the committed state is green on ubuntu and windows.

### 1. ChronicleStore v1

**PASS.** `packages/memory/src/chronicle.ts` implements workspace-local append-only Chronicle JSONL at `<dataDir>/chronicle/<workspaceId>/chronicle.jsonl`, with stable workspace ids, append-only records, default `internal/global-ok` labels, secret rejection, and explicit personal admission.

### 2. Chronicle tools and CLI

**PASS.** `chronicle.log` and `chronicle.query` were added as normal tools with `tool:chronicle.*` provenance. CLI commands were added for `chronicle log/query/list/show`.

### 3. Chronicle digest for project context

**PASS.** Relevant Chronicle digest is injected through the existing memory zone, contributes labels to effective prompt labels, and can deny an under-cleared primary route before provider I/O.

### 4. Hand-triggered dream-cycle consolidation v0

**PASS.** Consolidation v0 is deterministic only: no summarizer/model role/provider/scheduler/background job. It reads session JSONL and MemoryStore projection data, creates report artifacts, redacts secret text, keeps promotion/deletion candidate-only, and leaves learned skills pending.

### 5. Evidence pull-through

**PASS.** `MemoryStore.evidence()` remains the evidence path and now includes Chronicle refs and report artifact refs when allowed by retrieval gates.

### 6. Eval suites

**PASS.** `chronicle.workspace-v0` and `dream-cycle.consolidation-v0` are visible and pass; existing M2 suites remain visible and green. `memory.canary` and full contradiction benchmark remain honest/deferred.

### 7. Config surface

**PASS.** Minimal config was added: `chronicle.enabled`, `chronicle.digest_budget`, `chronicle.max_results`, `chronicle.storage`, `memory.consolidation.enabled`, and `memory.consolidation.learned_skill_pending_dir`.

### 8. Docs proposals only

**PASS.** Codex did not edit `docs/` or `docs-zh/`; proposed docs edits are in the work report.

## BLOCKER

None for implementation acceptance.

## CARRY-IN

1. **Owner evidence pending.** Commit `5f3ef12` includes `tasks/M2-08-work.md`, but owner evidence under `tasks/owner-checks/M2-08/` has not yet been committed.
2. **Reviewer-owned docs pass pending.** Apply docs proposals from `tasks/M2-08-work.md` to `memory.md`, `context-engine.md`, `data-governance.md`, `evals.md`, and `protocol.md`.
3. **Code-level countersign recommended before M2 exit.** Chronicle/dream-cycle touches memory persistence, report redaction, evidence pull-through, and context digest label gating.
4. **Work report notes local direct-command workaround.** Codex reported wrapper commands failed locally because `.bin` shims were unavailable, then used direct eslint/tsc/vitest checks; CI green is the source of truth.

## NIT

- Work report remains long-line / compressed Markdown.
- If Codex generates owner evidence, label it as deterministic fixture evidence, not owner-live manual evidence.

## Final decision

M2-08 implementation is accepted with notes. Task-level close remains pending owner evidence.
