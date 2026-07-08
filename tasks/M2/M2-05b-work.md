# M2-05b Work Report

## 1. File tree delta

- `packages/kernel/src/persona.ts`
- `packages/kernel/test/context.test.ts`
- `packages/kernel/test/persona.test.ts`
- `packages/testing/test/persona-affect.evals.test.ts`
- `tasks/owner-checks/M2-05b/affect.json`
- `tasks/owner-checks/M2-05b/affect.stderr.txt`
- `tasks/owner-checks/M2-05b/negative-feedback-data/fairy.yaml`
- `tasks/owner-checks/M2-05b/negative-feedback-data/sessions/ses_01J00000000000000000005556/log.jsonl`
- `tasks/owner-checks/M2-05b/negative-feedback-replay.jsonl`
- `tasks/owner-checks/M2-05b/negative-feedback-replay.stderr.txt`
- `tasks/owner-checks/M2-05b/owner-check-meta.json`
- `tasks/owner-checks/M2-05b/prefix-data/fairy.yaml`
- `tasks/owner-checks/M2-05b/prefix-data/sessions/ses_01J00000000000000000005555/log.jsonl`
- `tasks/owner-checks/M2-05b/prefix-manifests.stderr.txt`
- `tasks/owner-checks/M2-05b/prefix-manifests.txt`
- `tasks/owner-checks/M2-05b/testing-suites.txt`

No `docs/` or `docs-zh/` files were edited.

Runtime changes are limited to `packages/kernel/src/persona.ts`. No `packages/kernel/src/context.ts`, `packages/kernel/src/governance.ts`, or `packages/research` runtime files were changed.

## 2. Verification tails

Local verification completed on Windows from the source-first TS workspace.

```text
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
git diff --name-only -- packages/research packages/kernel/src/governance.ts
pnpm --filter @fairy/kernel test -- --reporter=verbose
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Result:

```text
pnpm install: pass; lockfile up to date
pnpm lint: pass
pnpm -r typecheck: pass
pnpm -r test: pass
pnpm dep-check: pass
pnpm conformance: mock mode pass
git diff --check: pass
git diff --name-only -- docs docs-zh: no output
git diff --name-only -- packages/research packages/kernel/src/governance.ts: no output
pnpm --filter @fairy/kernel test -- --reporter=verbose: pass
pnpm --filter @fairy/testing test -- --reporter=verbose: pass
```

Targeted testing evidence:

- `tasks/owner-checks/M2-05b/testing-suites.txt`: `packages/testing` passed, with named suites visible and green: `persona.consistency`, `substance.invariance`, `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, and `governance.friction-canary`.
- `tasks/owner-checks/M2-05b/prefix-manifests.txt`: turns 1 and 2 share `sha256:8d894c3700a6a0bf`; turn 3 shifts to `sha256:d804998963a6af9b` with a bucket change.
- `tasks/owner-checks/M2-05b/affect.json`: current affect is `cause: "user-negative-feedback"`, `stance: "dry"`, `energy: "medium"`, `valence: 0.145`, `arousal: -0.1`.
- `tasks/owner-checks/M2-05b/negative-feedback-replay.jsonl`: parseable JSONL and contains no `memory.written` event.

CI status: not pushed from this workspace, so GitHub Actions status is pending owner push.

## 3. Decisions

- Prefix approach: chose (a), bucketed line in place. The stable-prefix persona zone now renders only the quantized expression bucket: `stance`, `energy`, and `humor suppressed`. It never renders `cause`, raw `valence`, raw `arousal`, or timestamps.
- Audit cause placement: `cause` remains unchanged in `affect.updated` events and stays visible through replay and `fairy affect --json`; it is removed only from the stable prompt prefix.
- Negative-feedback detector: added one deterministic `negativeFeedbackPattern` beside the existing thanks/distress patterns. It covers conservative assistant-directed English and Chinese phrases such as wrong advice/answer/suggestion, "you said wrong", and "wasted my time" when tied to the assistant.
- Negative-feedback delta: applies `valence -0.14`, suppresses humor, forces `stance: "dry"`, and caps arousal to at most `previous.arousal + 0.03`.
- Ordering: negative feedback blocks the same-turn clean-completion/thanks positive bump; distress still wins afterward and restores the user-wellbeing warm rail.
- Schema/event decision: no new canonical event types and no `affect.updated` schema fields were added.
- Non-interference: affect remains style-only. No permission, routing, egress, MemoryGate, tool, research, or factual payload behavior was changed.

## 4. Spec ambiguities

- `docs/specs/context-engine.md` already requires stable quantized prefix data, while the earlier persona-affect prompt example showed `cause` inside the affect line. I reconciled this by treating `cause` as audit/replay state, not stable-prefix content. Same-bucket turns keep a stable `prefix_hash`; the full cause remains in `affect.updated`.
- The brief allows either `focused` or `dry` for assistant-directed criticism. I chose `dry` because it is already the terse register in the current stance mapping and avoids inventing a new threshold rule.
- The brief asks for Chinese coverage but the task file itself contains mojibake in the examples. The detector uses Unicode-escaped real Chinese phrases in source/tests to keep the code encoding-stable while still covering the intended inputs.

## 5. Proposed docs edits

For reviewer application only; no `docs/` or `docs-zh/` files were edited.

`docs/specs/context-engine.md` section 1:

- Replace the prior persona/affect stable-prefix wording with: "The persona/affect prefix line renders only quantized bucket fields: stance, energy, and humor-suppression. Per-turn affect causes, raw valence/arousal values, and timestamps do not participate in the stable prefix hash. The cause remains available through `affect.updated` and replay/affect inspection."
- Add: "Adjacent turns with the same `(stance, energy, humorSuppressed)` bucket must produce byte-identical persona-zone content and an identical `prefix_hash`; bucket changes are expected to change the hash."

`docs/specs/persona-affect.md` sections 2 and 3:

- Add appraisal input row: `user-negative-feedback` is detected deterministically from conservative assistant-directed criticism. It causes a mild valence decrease, suppresses humor, uses a focused/dry terse register, does not spike arousal, and must not produce self-blame, guilt, apology spam, suffering claims, memory writes, or behavior beyond style.
- Update the expression-line example to omit `cause` from stable prompt content, e.g. `affect: dry/medium-energy; humor suppressed=true`.
- Add: "The auditable reason for an affect change is the `cause` field on `affect.updated`; approach (a) keeps that cause out of the stable prompt prefix."

`docs/specs/protocol.md`:

- No schema edit is required because no `affect.updated` field was added or reshaped. If documenting this task, add only an implementation note that `cause: "user-negative-feedback"` is a valid free-text cause value under the existing schema.

## 6. Manual owner checklist

Evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05b
```

Prefix stability evidence:

```powershell
node --import tsx apps\cli\src\bin\fairy.ts replay ses_01J00000000000000000005555 --data-dir tasks\owner-checks\M2-05b\prefix-data --manifests > tasks\owner-checks\M2-05b\prefix-manifests.txt 2> tasks\owner-checks\M2-05b\prefix-manifests.stderr.txt
```

Saved:

```text
tasks/owner-checks/M2-05b/prefix-manifests.txt
tasks/owner-checks/M2-05b/prefix-manifests.stderr.txt
```

Negative-feedback evidence:

```powershell
node --import tsx apps\cli\src\bin\fairy.ts replay ses_01J00000000000000000005556 --data-dir tasks\owner-checks\M2-05b\negative-feedback-data --json > tasks\owner-checks\M2-05b\negative-feedback-replay.jsonl 2> tasks\owner-checks\M2-05b\negative-feedback-replay.stderr.txt
node --import tsx apps\cli\src\bin\fairy.ts affect --config tasks\owner-checks\M2-05b\negative-feedback-data\fairy.yaml --data-dir tasks\owner-checks\M2-05b\negative-feedback-data --json > tasks\owner-checks\M2-05b\affect.json 2> tasks\owner-checks\M2-05b\affect.stderr.txt
```

Saved:

```text
tasks/owner-checks/M2-05b/negative-feedback-replay.jsonl
tasks/owner-checks/M2-05b/negative-feedback-replay.stderr.txt
tasks/owner-checks/M2-05b/affect.json
tasks/owner-checks/M2-05b/affect.stderr.txt
```

Suite evidence:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Saved:

```text
tasks/owner-checks/M2-05b/testing-suites.txt
```
