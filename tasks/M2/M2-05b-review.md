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

---

## Countersignature — Claude (Fable 5), 2026-07-07

Verified inline at code level (runtime diff is 24 lines in `packages/kernel/src/persona.ts`; no other runtime file touched — tighter than the brief's allowance, `context.ts` needed no change since the zone content itself became bucket-stable).

- **Prefix fix (approach a) CONFIRMED.** Both the enabled and disabled affect lines drop `cause=` (`persona.ts:389-390`); tests assert byte-identical zone content and identical `prefix_hash` for same-bucket state changes, hash change on bucket shift, and explicitly `not.toContain("cause=")`, `not.toContain("0.39")`, `not.toContain("2026-07-02")` — the exact volatile classes that caused the drift. `affect.updated` emission still carries the full `cause` (`index.ts:800`), so auditability is intact.
- **Negative-feedback branch CONFIRMED.** Detector is conservative, assistant-directed, zh via `\uXXXX` escapes (handbook §3.5 compliant); `(completedCleanly || thanked) && !negativeFeedback` kills the positive bump; valence −0.14 (within the brief's band); arousal capped at `previous + 0.03`; stance forced `dry` via a narrow-scope `forcedStance` local to `update` — exactly the permitted override, global thresholds untouched; distress clears the override and takes precedence (wellbeing rail preserved). Ordering regression test asserts a clean-completion+criticism turn nets a valence **decrease** vs both the prior state and the clean path — the observed turn-4 defect cannot recur silently.
- **False-positive guards CONFIRMED:** thanks and a "CI 又红了"-style vent don't trigger; banned-corpus reuse asserts no self-blame phrasing in the rendered zone; extended `substance.invariance` proves identical tool calls/results/approvals/routes/final payload under the negative-feedback state.
- **Boundaries CONFIRMED:** no docs/docs-zh, no schema change, `governance.ts` and `packages/research` untouched, no new suites, no weakened assertions.

**One recommendation before M2-06 dispatch (non-blocking):** the committed owner evidence is Codex-generated deterministic fixture data (synthetic sids/fairy.yaml), as CARRY-IN 2 notes. Since this task originated from a *real-provider* owner smoke test, the loop should be closed the same way: owner re-runs the original 4-turn deepseek chat (tired → thanks → CI vent → criticism) and checks (1) `--manifests` shows identical `prefix_hash` across same-bucket turns, (2) the criticism turn's `affect.updated` shows `user-negative-feedback` with a terser, non-self-blaming reply. Five minutes, and it verifies the fix where the bug actually lived (handbook §5.5: owner manual tests on real providers are irreplaceable).

Docs pass applied with this countersignature (context-engine §1/§6, persona-affect §2/§3/§7, protocol Affect row). Handbook current-state updated.

**Countersigned: M2-05b ACCEPTED WITH NOTES / CLOSED.**
