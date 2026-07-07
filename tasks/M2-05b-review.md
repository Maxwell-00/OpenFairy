# M2-05b Review — Affect prefix-cache stability + negative-feedback appraisal

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-05b-affect-cache-feedback.md`  
Delivery commit: `123fe69`  
CI: GitHub Actions run `28838809391`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-05b closes the two M2-05 owner-smoke findings:

1. Affect `cause` no longer participates in the stable-prefix persona/affect line.
2. Assistant-directed negative feedback is appraised deterministically as `user-negative-feedback`, with mild valence decrease, dry register, humor suppression, and no substance/routing/tool side effects.

## Evidence base

- Commit `123fe69` / `M2-05b work`.
- Work report: `tasks/M2-05b-work.md`.
- Owner evidence:
  - `tasks/owner-checks/M2-05b/prefix-manifests.txt`
  - `tasks/owner-checks/M2-05b/negative-feedback-replay.jsonl`
  - `tasks/owner-checks/M2-05b/affect.json`
  - `tasks/owner-checks/M2-05b/testing-suites.txt`

## Acceptance review

### 0. Existing invariants

**PASS.**

The testing evidence shows existing M2 suites remain visible and green:

- `memory.leakage`
- `memory.deletion-permanence`
- `research.citation-precision`
- `research.zh-en-parity`
- `injection.research-v0`
- `label.conformance`
- `governance.friction-canary`
- `persona.consistency`
- `substance.invariance`

The commit scope is limited to persona/affect runtime/tests plus owner evidence and work report. No `docs/` or `docs-zh/` changes are part of the Codex implementation.

### 1. Stable-prefix affect rendering

**PASS.**

`renderPersonaAffectZone()` now renders the stable affect line from bucketed fields only:

```text
affect: <stance>/<energy>-energy; humor suppressed=<bool>
```

It no longer renders free-text `cause`, raw `valence`, raw `arousal`, or timestamps in the stable persona zone.

Owner evidence shows turns 1 and 2 share the same prefix hash when they remain in the same rendered bucket:

```text
turn 1 prefix sha256:8d894c3700a6a0bf
turn 2 prefix sha256:8d894c3700a6a0bf
turn 3 prefix sha256:d804998963a6af9b
```

Turn 3 changes bucket, so a prefix hash change is expected.

### 2. Negative-feedback appraisal

**PASS.**

The AffectEngine now detects assistant-directed criticism through a conservative English/Chinese regex. On match:

- `cause = "user-negative-feedback"`
- clean-completion positive bump is skipped
- valence decreases mildly
- stance is forced to `dry`
- humor is suppressed
- arousal is capped to avoid agitation
- distress still takes precedence

Owner evidence confirms current affect after the negative-feedback turn:

```json
{
  "cause": "user-negative-feedback",
  "stance": "dry",
  "energy": "medium",
  "valence": 0.145,
  "arousal": -0.1
}
```

The negative-feedback replay contains no `memory.written`.

### 3. Persona/substance invariance

**PASS.**

The testing evidence shows `persona.consistency` and `substance.invariance` remain green, including the new negative-feedback affect path. The change remains style-only and does not alter permissions, routing, tool calls, MemoryGate, egress, or factual payload behavior.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply the work report's proposed docs edits to:
   - `docs/specs/context-engine.md`
   - `docs/specs/persona-affect.md`
   - `docs/specs/protocol.md` if desired as an implementation note, though no schema change is required.

2. **Owner evidence provenance.**  
   The owner evidence was Codex-generated deterministic fixture evidence. That is acceptable for this task, but future summaries should label it as such when no real provider/manual UI judgment is involved.

3. **M2-06 perception should rebase on this commit.**  
   M2-06 touches context/perception prompt assembly. It should use the M2-05b prefix-cache behavior as baseline.

## NIT

- `M2-05b-work.md` is compressed into very long Markdown lines. It is readable but harder to line-cite.
- The negative-feedback regex uses Unicode escapes for Chinese markers. This is acceptable and preferable to raw CJK patch anchors given the repository's prior mojibake issues.

## Final decision

M2-05b is closed. Proceed to M2-06 perception after applying/gating any necessary docs-pass update.
