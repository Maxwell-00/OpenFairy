# M2-07 Review — Context ladder completion: L4/L5 compaction + post-compaction regression

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-07-context-compaction.md`  
Delivery commit: `dd3b0a6`  
CI: GitHub Actions run `28861229375`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — implementation accepted, task close pending owner evidence.**

M2-07 implements the L4/L5 context compaction slice: compaction policy/config, bounded compaction request shape, validated L4/L5 model outputs, L4 artifact projection, L5 `session.compacted`, replay rendering, and the deterministic `context.compaction-regression` path.

This implementation is accepted at code/CI level. It is not yet owner-closed because `tasks/owner-checks/M2-07/` currently contains only the evidence README, not the expected owner evidence logs.

## Evidence base

- Commit `dd3b0a6` / `M2-07-work`.
- CI run `28861229375` / `M2-07-work #64`: success, matrix `verify`, 2 jobs completed.
- Work report: `tasks/M2-07-work.md`.
- Owner evidence directory currently contains only:
  - `tasks/owner-checks/M2-07/README.md`

## Acceptance review

### 0. Existing invariants

**PASS.**

The work report records the full acceptance command set passed:

- install
- lint
- typecheck
- tests
- dep-check
- conformance
- diff check
- docs/docs-zh diff check

It also records that `pnpm lint` included the encoding guard and that `git diff --name-only -- docs docs-zh` had no output.

The changed file tree contains app/kernel/config/model-gateway/testing/task files, with no `docs/` or `docs-zh/` file changes.

### 1. Compaction model path and policy

**PASS WITH NOTE.**

The work report states that compaction calls the configured `context.compaction_role`, default `summarizer`, through the existing model gateway. It also states that unknown role, route denial, provider error, tool-call output, empty output, or invalid JSON all fail closed.

The new `packages/kernel/src/compaction.ts` defines request/output shapes, validation, sanitization, summary/handoff renderers, and L4/L5 projections. The request shape includes labels, provenance, refs, source range, recent tail, and bounded target token budget.

Important acceptance points are satisfied by reported tests:

- mock summarizer role path;
- bounded input;
- invalid/missing output fail-closed;
- personal/local-only compactor route clearance;
- no second TurnRunner reported.

### 2. L4 micro-compaction

**PASS.**

The work report states:

- L4 runs after L1-L3 projection still exceeds budget, or when L2/L3 placeholders exceed threshold.
- Failed L4 leaves the original L1-L3 path intact.
- L4 writes `artifact.created` with `kind=context.compaction.l4`.
- L4 visibility uses `artifact.created` plus `context.manifest.reduction_stages_applied=["L4"]`.

This matches the brief's allowed choice: L4 may use `artifact.created` + manifest instead of `session.compacted` if range semantics do not fit.

### 3. L5 full compaction / structured handoff

**PASS.**

The work report states L5 runs only after successful L4 when the L4-projected prompt still exceeds budget. It writes `artifact.created` with `kind=context.compaction.l5` and emits existing `session.compacted` with required `{range, summary_ref}`.

Replay test additions include `artifact.created` for a context compaction artifact and `session.compacted` with `range` and `summary_ref`, and assert replay text and JSON visibility.

### 4. Post-compaction regression suite

**PASS.**

The work report states `context.compaction-regression` is visible in verbose `@fairy/testing` output and passes.

The brief-required coverage is represented in the work report and gateway E2E additions:

- task carry-over;
- artifact refs;
- memory/research/perception refs;
- failed tools;
- labels and route gating;
- quarantine no-laundering;
- replay visibility.

### 5. Replay / CLI visibility

**PASS.**

`apps/cli/src/replay.ts` now renders `session.compacted` compactly as:

```text
session.compacted turns=<start>-<end> <summary_ref>
```

Replay tests cover L4/L5 manifest stages, compaction artifact rendering, `session.compacted`, and JSON payload preservation.

### 6. Config surface

**PASS.**

The config surface is minimal and matches the brief:

```yaml
context:
  l4_placeholder_threshold: 6
  l4_target_tokens: 800
  l5_target_tokens: 1200
  compaction_role: summarizer
```

Defaults and schema validation were added, and config tests cover defaults, custom values, and invalid values.

### 7. Docs proposals only

**PASS.**

Codex did not edit `docs/` or `docs-zh/`; docs proposals are in the work report.

## BLOCKER

None for implementation acceptance.

## CARRY-IN

1. **Owner evidence pending.**  
   `tasks/owner-checks/M2-07/README.md` exists, but the expected evidence files are not committed yet:
   - `testing-compaction.txt`
   - `compaction-replay.jsonl`
   - `compaction-manifests.txt`
   - `compaction-governance-replay.jsonl`

2. **Reviewer-owned docs pass pending.**  
   Apply the work report's docs proposals to:
   - `docs/specs/context-engine.md`
   - `docs/specs/protocol.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/evals.md`

3. **Code formatting/reviewability issue.**  
   Several new/modified files are minified into very long lines. CI accepts this, but it materially hurts code review and source-level citation. Future tasks should preserve normal TypeScript/Markdown formatting.

4. **Need code-level countersign for M2 exit.**  
   Given the long-line implementation style and the security-sensitive compactor route-clearance/quarantine requirements, Fable/Opus code-level cross-check is recommended before M2 exit consolidation.

## NIT

- Work report is compressed into very long lines, same as recent prior reports.
- Owner evidence directory currently contains only a README; deterministic fixture evidence can be Codex-generated, but it should be committed as actual logs/JSON before final close.

## Final decision

M2-07 implementation is accepted with notes. Task-level close remains pending owner evidence.
