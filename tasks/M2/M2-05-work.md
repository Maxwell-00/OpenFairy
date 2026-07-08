# M2-05 Work Report

## 1. File tree delta

- Added persona pack content under `extensions/personas/fairy/`:
  - `persona.yaml`
  - `PERSONA.md`
  - `style/en.md`
  - `style/zh.md`
  - `ack-bank.yaml`
- Added persona/affect runtime:
  - `packages/kernel/src/persona.ts`
  - `packages/kernel/test/persona.test.ts`
- Updated prompt assembly and TurnRunner integration:
  - `packages/kernel/src/context.ts`
  - `packages/kernel/src/index.ts`
  - `packages/kernel/test/context.test.ts`
  - `packages/kernel/test/index.test.ts`
- Added config support:
  - `packages/config/defaults.yaml`
  - `packages/config/src/schema.ts`
  - `packages/config/test/loader.test.ts`
- Added gateway wiring and E2E coverage:
  - `apps/gateway/src/config.ts`
  - `apps/gateway/src/server.ts`
  - `packages/testing/test/gateway.e2e.test.ts`
  - `packages/testing/test/persona-affect.evals.test.ts`
- Added CLI/replay visibility:
  - `apps/cli/src/persona.ts`
  - `apps/cli/src/bin/fairy.ts`
  - `apps/cli/src/index.ts`
  - `apps/cli/src/replay.ts`
  - `apps/cli/test/persona.test.ts`
  - `apps/cli/test/replay.test.ts`
- Updated dependency metadata:
  - `packages/kernel/package.json`
  - `pnpm-lock.yaml`

## 2. Verification tails

Local verification completed on Windows from the source-first TS workspace.

```text
pnpm install --config.proxy=http://127.0.0.1:15236 --config.https-proxy=http://127.0.0.1:15236
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
node --check apps/cli/src/persona.ts
node --check packages/kernel/src/persona.ts
node --check apps/cli/test/persona.test.ts
node --check packages/kernel/test/persona.test.ts
node --check packages/testing/test/persona-affect.evals.test.ts
node --check packages/testing/test/gateway.e2e.test.ts
rg -n "妤犲矁|鐦夐惍涔" packages/kernel/src/governance.ts
```

Result:

```text
pnpm install: pass; lockfile up to date; supply-chain policy check passed
pnpm lint: pass
pnpm -r typecheck: pass
pnpm -r test: pass
pnpm dep-check: pass, no dependency violations found
pnpm conformance: mock mode PASS for all 18 cases
git diff --check: pass
git diff --name-only -- docs docs-zh: no output
node --check: pass for all listed files
OTP mojibake remnant search: no matches
```

CI status: not checked in this local run.

Conformance verdict: mock conformance passed locally.

Named eval suites added:

```text
persona.consistency
substance.invariance
```

Existing named suites expected to remain visible:

```text
memory.leakage
memory.deletion-permanence
research.citation-precision
research.zh-en-parity
injection.research-v0
label.conformance
governance.friction-canary
```

## 3. Decisions

- Persona pack path: `extensions/personas/fairy`.
- Persona content schema: YAML content/config only, no executable hooks or script loading. Loader reads `persona.yaml`, `PERSONA.md`, optional `style/en.md`, `style/zh.md`, and optional `ack-bank.yaml`.
- Config keys: `persona.id`, `persona.enabled`, `persona.root`, `affect.enabled`; `persona: none` is accepted.
- Persona labels: default `internal/global-ok`; they join prompt effective labels and never downgrade existing labels.
- Affect persistence: v1 uses in-memory state per `TurnRunner` session. JSONL `affect.updated` events are the inspectable/rebuildable projection evidence; no second source of truth was added.
- Affect state shape: emits the registered `affect.updated` payload with `valence`, `arousal`, `stance`, required `cause`, plus optional `energy` and `updated_at`.
- Appraisal rules: deterministic only; clean completion/user thanks raise valence, repeated failures/provider outage/route denial reduce valence and may raise arousal, distress sets warm stance and suppresses humor, idle decays toward baseline. No LLM call is used.
- Prompt-zone rendering: persona/affect is a compact system-zone prefix message with one affect line and style-only safety line. No second-precision timestamp is included in the prefix content.
- CLI/replay behavior: `fairy persona inspect --json` reports metadata/disclosure/style summary without dumping long style files; `fairy affect --json` reads latest JSONL affect event or baseline. Text replay renders `affect.updated` compactly; JSON replay preserves full payload.
- Safety rails: off switches produce plain assistant style or frozen baseline; distress suppresses humor; banned dependency/guilt/suffering phrases have deterministic tests; persona/affect does not auto-write memory.

## 4. Spec ambiguities

- The task allows either JSONL projection rebuild or in-memory v1 affect state. This implementation chose in-memory v1 to avoid creating a second persistence surface.
- Persona baseline declared `energy: low` while arousal is only `-0.1`; loader preserves the explicit baseline energy, while post-update states derive energy from arousal.
- Gateway tests now explicitly disable persona/affect in the shared test config helper unless a test opts in, so legacy event-sequence assertions stay focused.

## 5. Proposed docs edits

For reviewer application only; no `docs/` or `docs-zh/` files were edited.

`docs/specs/persona-affect.md`:

- Mark Persona Pack v1 as implemented with default pack path `extensions/personas/fairy`.
- Document supported fields: id/name/languages/disclosure/style summary/labels/affect baseline/bounds/optional voice map/ack bank.
- Mark Affect Engine v1 as deterministic and inspectable, with no model appraisal.
- Document off switches: `persona: none`, `persona.enabled=false`, `affect.enabled=false`.
- Add CLI visibility: `fairy persona inspect --json`, `fairy affect --json`.
- Record safety rails: distress humor suppression, banned dark-pattern corpus, no memory writes by persona/affect.

`docs/specs/context-engine.md`:

- Mark persona/affect reserved zone as implemented.
- Note `context.manifest.zones[]` includes `persona` token accounting.
- Note `prefix_hash` covers system, tools, and persona/affect prefix content; affect cause changes intentionally change the prefix hash.
- Reaffirm `context.manifest` remains observational only and never enters prompt/history.

`docs/specs/protocol.md`:

- Mark `affect.updated` schema as implemented for v1 emission.
- Note emitted payload uses registered shape: required `valence`, `arousal`, `stance`, `cause`; optional `energy`, `updated_at`.

`docs/specs/evals.md`:

- Add implementation status for deterministic PR-tier suites `persona.consistency` and `substance.invariance` in `packages/testing`.
- State that no LLM judge is used in CI.

`docs/specs/data-governance.md`:

- Document persona labels as label-bearing prompt content defaulting to `internal/global-ok`.
- Reaffirm persona/affect labels can raise effective prompt labels but cannot lower user/history/tool/memory/research labels.
- Reaffirm persona/affect does not affect route clearance, permissions, MemoryGate, or egress guard.

## 6. Manual owner checklist

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05
```

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

```text
persona.consistency
substance.invariance
memory.leakage
memory.deletion-permanence
research.citation-precision
research.zh-en-parity
injection.research-v0
label.conformance
governance.friction-canary
```

Save:

```text
tasks/owner-checks/M2-05/testing-persona-affect.txt
```

Run:

```powershell
pnpm fairy persona inspect --json
pnpm fairy affect --json
```

Save:

```text
tasks/owner-checks/M2-05/persona-inspect.json
tasks/owner-checks/M2-05/affect.json
```

Run a mock turn that triggers a deterministic affect update, then replay:

```powershell
pnpm fairy replay <sid> --data-dir <data-dir> --json
pnpm fairy replay <sid> --data-dir <data-dir> --manifests
```

Expected:

```text
affect.updated appears in JSON replay
text replay renders affect.updated compactly
context.manifest shows persona zone tokens
no memory.written appears without explicit remember command
```

Save:

```text
tasks/owner-checks/M2-05/affect-replay.jsonl
```

Run off-switch check with `affect.enabled=false` and/or `persona.enabled=false`.

Expected:

```text
no affect.updated
plain persona style
normal tool/permission/routing behavior unchanged
```

Save:

```text
tasks/owner-checks/M2-05/off-switch-replay.jsonl
```
