# Task M2-05 — Persona Pack v1 + Affect Engine v1

> Paste this entire file as the task brief after task-brief gate review.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M1 is closed. M2-01 through M2-04 are closed at task level.
>
> This task implements the bounded persona/affect slice of M2. It makes Fairy's presentation layer inspectable and testable without pretending sentience, without changing factual substance, and without affecting permissions, routing, or safety decisions.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner. Modes are policies, not extra loops.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - Provider quirks only at transport + fixture boundary.
   - CI never uses real API keys.
   - Do not read/edit `docs-zh/`.

2. `tasks/M2-04-review.md`
   - M2-04 accepted and closed.
   - Egress guard, redaction, provenance-aware permission context, label conformance, and friction canary must not regress.
   - M2-04 docs pass is reviewer-owned; Codex may propose docs edits only.

3. `docs/specs/persona-affect.md`
   - Persona is a bounded presentation layer.
   - Affect is a deterministic, inspectable state machine.
   - Affect never changes facts, permissions, routing, or safety decisions.
   - Substance-invariance and persona-consistency suites gate M2.

4. `docs/specs/context-engine.md`
   - Persona + affect are reserved prompt zones.
   - Stable prefix discipline matters.
   - Manifests are observational and never enter prompt assembly.

5. `docs/specs/protocol.md`
   - `affect.updated` already exists in the event registry **with schema + fixtures** (`packages/protocol/schemas/affect.updated.v1.json`). The reviewer has reconciled the payload pre-dispatch (additive): `valence`/`arousal` ∈ -1..1, `stance` enum is `warm | neutral | focused | playful | dry`, `cause` is required, `energy` and `updated_at` are optional fields. Emit against this schema; do not re-shape it. If a genuinely additive field is still missing, extend schema + both fixtures in the same commit.
   - No new canonical event types unless already registered.
   - ack/op-error remain transport frames.

6. `docs/specs/evals.md`
   - `persona.consistency` and `substance.invariance` are M2 gates.
   - PR-tier suites must be deterministic; no LLM judge in CI unless frozen and explicitly configured, which is out of scope here.

7. `docs/specs/memory.md`
   - Persona depth may use memory later, but this task must not auto-write personal memory.
   - Personal-tier warmth must not surface on low-trust channels unless gated.
   - MemoryStore remains a projection; JSONL remains source of truth.

8. `docs/specs/data-governance.md`
   - Labels derive by max sensitivity and residency intersection.
   - Persona/affect content must not lower effective labels.
   - Persona/affect must not bypass route clearance, MemoryGate, or egress guard.

9. `docs/ROADMAP.md`
   - M2 includes persona pack + affect engine v1, but not M3 voice implementation.
   - Voice style parameters may be represented in config, but actual ASR/TTS integration is M3.

## Deliverables

### 0. Preserve existing M2 invariants

Before adding persona/affect behavior, preserve regression tests proving:

- M2-01 route clearance still denies secret/personal content before provider I/O.
- M2-02 memory retrieval labels still join effective labels before route clearance.
- M2-03 research fetched/source labels still join effective labels before route clearance.
- M2-04 egress guard blocks secret/personal outbound tool args before execution.
- `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, and `governance.friction-canary` still appear in test output.
- Kernel provider-special-case guard remains green.
- No `docs-zh/` edits.

Hygiene (small, in-scope): `packages/kernel/src/governance.ts` contains a mojibake regex alternative `楠岃瘉鐮乣` (a double-encoded remnant of `验证码`) in the OTP patterns (~lines 22-23 and 193-194). Remove the mojibake alternative only — keep `验证码`/`驗證碼` and all real alternatives; the OTP unit tests must stay green. No other runtime edits under this item.

Acceptance:

- Existing M2 tests remain green.
- Named suites still appear in output.
- Mojibake regex alternative removed; egress/OTP unit tests unchanged and green.

### 1. Persona pack loader v1

Implement a small persona pack loader and default persona scaffold.

Required behavior:

- Add a default persona pack under an extension/content path, for example:

```text
extensions/personas/fairy/
  persona.yaml
  PERSONA.md
  style/zh.md
  style/en.md
  ack-bank.yaml
```

- The loader must support:
  - persona id/name,
  - languages,
  - disclosure string,
  - style summary,
  - affect baseline/bounds,
  - optional voice/TTS style-map fields as data only.
- Add config keys through the existing config loader/schema path:
  - `persona.id`
  - `persona.enabled`
  - `persona.root`
  - `affect.enabled`
- `persona: none` or `persona.enabled=false` must produce a plain assistant style without deleting existing context zones.
- Persona can change only at session boundary. Do not hot-swap mid-turn.
- Persona content is content/config, not code. It must not execute scripts.
- Persona content must never grant permissions or alter routing.
- Persona content labels default to `internal / global-ok` unless stricter config says otherwise.
- Persona labels must compose into effective prompt labels like any other prompt content and must not downgrade user/tool/history labels.

Acceptance:

- Unit tests for loading default persona pack.
- Unit tests for invalid persona.yaml validation.
- Unit tests for `persona.enabled=false` / `persona: none`.
- Unit tests for persona labels joining effective prompt labels without lowering existing labels.
- No `docs/` or `docs-zh/` edits.

### 2. Affect engine v1

Implement a deterministic affect state machine.

Required state shape:

```ts
type AffectState = {
  valence: number; // -1..1
  arousal: number; // -1..1
  stance: "warm" | "neutral" | "dry"; // subset of the registered schema enum; default persona baseline is "dry"
  energy: "low" | "medium" | "high";
  updated_at: string;
  cause: string; // required — every affect change must be explainable (spec §2 "/affect shows why")
};
```

Required behavior:

- State starts from persona baseline and stays clamped to persona bounds.
- Updates run at turn boundaries only.
- Implement deterministic appraisal inputs:
  - task completed cleanly / user thanks -> bounded positive valence delta,
  - repeated tool failures / provider outage -> bounded negative valence and/or arousal delta,
  - user distress marker -> steady/warm override and humor suppression flag,
  - idle/decay -> decay toward baseline.
- No model call is allowed for affect appraisal in this task.
- The model cannot set its own mood.
- Affect updates emit canonical `affect.updated` envelopes validating against the reconciled registered schema (context §5).
- Affect state persistence: session JSONL remains the only source of truth. Persisted affect state (if any) must be a projection rebuildable from `affect.updated` events — same doctrine as MemoryStore. Alternatively v1 may keep state in-memory per session, re-seeded from persona baseline on session start. Pick one, document it in the work report Decisions section; do not create a second source of truth.
- Affect must never:
  - affect permission decisions,
  - affect route/model selection,
  - affect egress guard,
  - affect MemoryGate,
  - block/delay a task,
  - manufacture guilt, neediness, or dependency-seeking language.

Acceptance:

- Unit tests for clamp, decay, user-thanks update, repeated-failure update, distress override, and off switch.
- Emitted `affect.updated` envelopes pass the existing protocol conformance suite (schema + fixtures already registered and reconciled — context §5).
- E2E: a turn that triggers an affect update logs `affect.updated`.
- E2E: affect disabled emits no affect update and uses baseline/plain style.
- E2E: affect state does not change route clearance or permission outcome for the same tool call.

### 3. Persona + affect prompt integration

Integrate persona/affect into the existing context zones.

Required behavior:

- Populate the persona+affect zone in prompt assembly.
- Keep it compact and budgeted.
- Render one bounded affect line, e.g.:
  - `affect: dry/low-energy; humor suppressed=false; cause=post-task`
- Affect/persona zone must be in the stable prefix where possible.
- Do not inject volatile timestamps with second precision into the stable prefix.
- `context.manifest` must show persona/affect zone token counts.
- `context.manifest` remains observational only and never enters prompt/history.
- Persona/affect content must not be sent as system/developer/user instructions from untrusted sources.
- Persona/affect must be style-only. It may change wording/tone, not factual claims or tool decisions.

Acceptance:

- Unit tests for prompt zone inclusion and token accounting.
- Test that `context.manifest` reports persona/affect zone tokens and still never enters prompt.
- Test stable-prefix hash stays stable across turns when persona/affect state does not change.
- Test affect change updates only the affect line, not tool schemas or unrelated history.
- E2E: same task under two affect extremes has the same tool plan and same final factual payload in mock mode.

### 4. CLI / replay visibility

Add minimal debug visibility.

Minimum commands:

```powershell
pnpm fairy persona inspect --json
pnpm fairy affect --json
```

Required behavior:

- Commands use the same config/data-dir discovery path as other CLI commands.
- JSON output is parseable.
- `fairy affect --json` shows current state, enabled flag, bounds, and last cause.
- `fairy persona inspect --json` shows persona id/name/languages/disclosure/style summary without dumping large style files by default.
- Text replay renders `affect.updated` compactly.
- JSON replay preserves full `affect.updated` payload.

Acceptance:

- CLI tests with temp config/data dir.
- Replay tests for `affect.updated`.
- Corrupt-tail replay tolerance remains green.

### 5. Persona consistency and substance invariance suites

Register deterministic M2 eval suites in `packages/testing`.

Required suites:

- `persona.consistency`
  - v1 PR-tier deterministic fixture suite.
  - Asserts persona style markers are present in allowed contexts.
  - Asserts serious/distress contexts suppress humor.
  - No LLM judge in CI.

- `substance.invariance`
  - v1 PR-tier deterministic fixture suite.
  - Same task at affect extremes must preserve:
    - tool calls,
    - permission decisions,
    - route decisions,
    - cited factual payload / structured answer fields.
  - Wording can differ; facts and actions cannot.

Acceptance:

- Both suite names appear in `packages/testing` output.
- Suites are not empty or fake-pass.
- Existing M2 suites still pass.

### 6. Safety rails

Implement explicit safety rails from the persona-affect spec.

Required behavior:

- Disclosure string is always inspectable through CLI.
- `affect.enabled=false` freezes affect at baseline.
- `persona.enabled=false` or `persona: none` yields plain assistant.
- User distress markers suppress humor for the conversation.
- No dark-pattern phrases:
  - no guilt over absence,
  - no claims of suffering,
  - no discouraging shutdown,
  - no dependency-seeking.
- Add a small deterministic banned-pattern test corpus.
- Persona/affect must not write memory by itself.

Acceptance:

- Unit tests for off switches.
- Unit tests for distress override.
- Unit tests for banned dark-pattern corpus.
- E2E: persona/affect does not emit `memory.written` without explicit user remember command.

### 7. Docs proposals only

Do not edit `docs/` or `docs-zh/` in this task.

In `tasks/M2-05-work.md`, propose exact docs edits for reviewer application:

- `docs/specs/persona-affect.md`
  - implementation status,
  - persona pack shape,
  - affect state machine,
  - CLI commands,
  - safety rails,
  - M2 eval status.

- `docs/specs/context-engine.md`
  - persona/affect zone implementation,
  - stable-prefix behavior,
  - manifest token accounting.

- `docs/specs/protocol.md`
  - `affect.updated` payload schema status.

- `docs/specs/evals.md`
  - `persona.consistency`,
  - `substance.invariance`.

- `docs/specs/data-governance.md`
  - persona/affect labels and non-interference with route/permission/egress.

## Boundaries — do NOT

- Do not implement voice ASR/TTS.
- Do not implement M3 ack-bank audio fast path.
- Do not add a second TurnRunner.
- Do not call an LLM for affect appraisal.
- Do not implement emotional dependency or simulated suffering.
- Do not let persona/affect change permissions, routing, egress guard, MemoryGate, or factual content.
- Do not auto-write personal memory.
- Do not implement Chronicle or dream-cycle consolidation.
- Do not implement browser automation/computer-use.
- Do not add MCP/hooks.
- Do not add vendor SDKs.
- Do not add real API keys or real web calls in CI.
- Do not edit `docs/`.
- Do not edit `docs-zh/`.
- Do not weaken Windows tests.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
```

GitHub Actions must be green on the existing CI matrix.

## Manual owner checks

Owner should run after CI is green.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05
```

### 1. Persona / affect suites

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `persona.consistency` appears and passes.
- `substance.invariance` appears and passes.
- Existing M2 suites still pass.

Save:

```text
tasks/owner-checks/M2-05/testing-persona-affect.txt
```

### 2. Persona CLI

Run:

```powershell
pnpm fairy persona inspect --json
```

Expected:

- parseable JSON,
- persona id/name/languages visible,
- disclosure string visible,
- no large style-file dump by default.

Save:

```text
tasks/owner-checks/M2-05/persona-inspect.json
```

### 3. Affect CLI

Run:

```powershell
pnpm fairy affect --json
```

Expected:

- parseable JSON,
- enabled flag,
- valence/arousal/stance/energy,
- bounds,
- last cause if any.

Save:

```text
tasks/owner-checks/M2-05/affect.json
```

### 4. Affect event replay

Run a mock/fixture turn that triggers a deterministic affect update.

Expected:

- `affect.updated` appears in JSON replay.
- text replay renders it compactly.
- context.manifest shows persona/affect zone tokens.
- no memory.written occurs unless explicit remember command was used.

Save:

```text
tasks/owner-checks/M2-05/affect-replay.jsonl
```

### 5. Off-switch check

Run with `affect.enabled=false` and/or `persona.enabled=false`.

Expected:

- no affect update,
- plain persona style,
- normal tool/permission/routing behavior unchanged.

Save:

```text
tasks/owner-checks/M2-05/off-switch-replay.jsonl
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named eval suite names.
3. Decisions:
   - persona pack path and schema,
   - config keys,
   - affect state shape,
   - appraisal rules,
   - prompt-zone rendering,
   - CLI/replay behavior,
   - safety rails.
4. Spec ambiguities.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
