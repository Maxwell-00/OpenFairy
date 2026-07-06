# M2-05 Review — Persona Pack v1 + Affect Engine v1

Review date: 2026-07-06  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-05-persona-affect.md`  
Work report: `tasks/M2-05-work.md`  
Reviewed commit: `77ed93e`  
CI: GitHub Actions run `28794363643`, status success, ubuntu + windows matrix completed

## Verdict

**ACCEPTED WITH NOTES.**  
**Task close remains PENDING owner manual checks.**

M2-05 implements the bounded persona/affect slice without introducing a second TurnRunner, without LLM affect appraisal, and without changing routing, permissions, egress, MemoryGate, or factual payload behavior. The implementation is accepted for code review, subject to owner evidence.

## Evidence base

- GitHub commit `77ed93e` shows 30 changed files, including persona pack files, kernel persona/affect runtime, context/gateway/CLI/replay wiring, persona-affect evals, and `tasks/M2-05-work.md`.
- GitHub Actions run `28794363643` is `Status Success`; matrix `verify` completed two jobs.
- Codex reported local `pnpm install`, `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm dep-check`, `pnpm conformance`, `git diff --check`, and `git diff --name-only -- docs docs-zh` as passing.
- The work report records that `persona.consistency` and `substance.invariance` are present and passing, while the existing M2 named suites remain visible.

## Acceptance review

### 0. Preserve existing M2 invariants

**PASS.**

The work report says the existing M2 suites remain visible: `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, and `governance.friction-canary`. It also records mock conformance 18/18 PASS and no `docs/` or `docs-zh/` diffs.

The hygiene carry-in for OTP mojibake was handled: the work report records a no-match search for the mojibake remnants in `packages/kernel/src/governance.ts`.

### 1. Persona pack loader v1

**PASS.**

The commit adds the default persona pack under `extensions/personas/fairy/` with `persona.yaml`, `PERSONA.md`, `style/en.md`, `style/zh.md`, and `ack-bank.yaml`. The runtime loader supports id/name/languages/disclosure/style summary/affect baseline/bounds, optional voice map data, labels, and inert content loading.

The kernel persona tests cover default pack load, invalid `persona.yaml`, `persona.enabled=false`, `persona: none`, baseline/bounds behavior, and style-only rendering.

### 2. Deterministic Affect Engine v1

**PASS.**

The implementation exposes `AffectEngine` and a schema-aligned `AffectState` with `valence`, `arousal`, `stance`, required `cause`, plus `energy` and `updated_at`. Appraisal is deterministic: clean completion / user thanks, repeated failures, provider outage / route denial, distress markers, and decay toward baseline.

The work report explicitly states there are no model calls for affect appraisal. The code-level tests cover clamp, decay, thanks, repeated failures, distress override, and off switch.

### 3. Persona + affect prompt integration

**PASS.**

The context tests verify that persona/affect content is included as a persona zone, that `context.manifest` reports persona tokens, that effective labels are not lowered by persona labels, and that prefix hashing stays stable when persona/affect state is stable. The tests also verify an affect-line-only change does not alter tool schemas or unrelated history.

### 4. CLI / replay visibility

**PASS.**

The CLI test covers `fairy persona inspect --json` and `fairy affect --json`, including metadata output, disclosure visibility, no large style dump, and reading the latest `affect.updated` JSONL event. Replay tests were extended for compact text rendering and full JSON preservation of `affect.updated`.

### 5. Persona consistency and substance invariance suites

**PASS.**

`packages/testing/test/persona-affect.evals.test.ts` defines:

- `persona.consistency`: asserts allowed style markers and distress humor suppression.
- `substance.invariance`: asserts the same task under affect extremes preserves tool calls, tool results, absence of approval/route-denied events, and final factual payload.

These are deterministic PR-tier suites with no LLM judge.

### 6. Safety rails

**PASS.**

The implementation includes deterministic banned-pattern tests for dependency/guilt/suffering/shutdown-discouragement language. Distress suppresses humor. The task’s boundary that persona/affect must not write memory by itself is covered by E2E/work report claims and should be confirmed again in owner evidence.

## BLOCKER

**None.**

## CARRY-IN

1. **Owner manual checks pending.**  
   M2-05 is implementation-accepted but not task-closed until owner evidence is committed under `tasks/owner-checks/M2-05/`.

2. **Reviewer-owned M2-05 docs pass pending.**  
   Codex correctly did not edit `docs/` or `docs-zh/`. Its proposed docs edits must later be applied to `persona-affect.md`, `context-engine.md`, `protocol.md`, `evals.md`, and `data-governance.md`.

3. **Root reviewer/coding-agent docs need cleanup before the next task.**  
   Commit `77ed93e` includes `AGENTS.md`, `CLAUDE.md`, and a new `REVIEWER-HANDBOOK.md`. This is outside the runtime implementation and does not block M2-05, but `AGENTS.md` and `CLAUDE.md` are no longer identical: `CLAUDE.md` says single owner `Maxwell`, while `AGENTS.md` still says `Chidi`. The project convention says they are twins. Before dispatching the next task, copy the corrected `CLAUDE.md` content to `AGENTS.md` or otherwise deliberately reconcile them.

4. **Affect state v1 is in-memory.**  
   This is allowed by the brief, provided JSONL `affect.updated` remains inspectable evidence. Owner checks should verify replay visibility and CLI behavior.

## NIT

- The work report omits `AGENTS.md`, `CLAUDE.md`, and `REVIEWER-HANDBOOK.md` from the file-tree delta because they were pre-existing local changes. The commit includes them. Keep future work reports aligned with the committed diff, even if some changes predate the task.

## Verified / Owner-stated / Not verified

### Verified

- Commit `77ed93e` exists and CI run `28794363643` is green.
- Commit diff includes persona pack, kernel persona/affect runtime, prompt/context wiring, gateway/CLI/replay wiring, eval suites, and work report.
- No `docs/` or `docs-zh/` paths appear in the commit file tree.
- Persona loader, affect engine, context integration, CLI, and eval tests exist in committed files.
- `AGENTS.md` / `CLAUDE.md` inconsistency exists in committed files.

### Owner/Codex-stated

- Local acceptance commands passed.
- OTP mojibake remnant search found no matches.
- Race around `turn.final` / `affect.updated` / active turn release was fixed.

### Not verified

- I did not run the test suite locally.
- I did not run owner manual checks.
- I did not connect to a live provider; none is required for M2-05 owner checks.

## Final decision

**M2-05 implementation accepted with notes. Owner manual checks are required before task-level close.**
