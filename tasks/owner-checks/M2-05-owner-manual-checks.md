# M2-05 Owner Manual Checks

Use this after M2-05 implementation CI is green.

Suggested evidence directory:

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy
$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-05"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null
```

Every new PowerShell window should reset:

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy
$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-05"
```

## 1. Persona / affect eval suites

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-persona-affect.txt"
```

Expected:

- `persona.consistency` appears and passes.
- `substance.invariance` appears and passes.
- Existing M2 suites still pass:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - `label.conformance`
  - `governance.friction-canary`
- Final Vitest summary is green.

Evidence:

- `tasks/owner-checks/M2-05/testing-persona-affect.txt`

Verdict: PASS

## 2. Kernel persona / affect unit tests

Run:

```powershell
pnpm --filter @fairy/kernel test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\kernel-persona-affect.txt"
```

Expected:

- default persona pack loads.
- invalid persona pack is rejected.
- `persona.enabled=false` and `persona: none` produce plain assistant behavior.
- affect clamp/decay/thanks/repeated-failure/distress/off-switch tests pass.
- banned dark-pattern corpus tests pass.
- context manifest includes persona zone tokens.
- persona labels do not lower existing effective labels.
- prefix hash stays stable when persona/affect state is stable.

Evidence:

- `tasks/owner-checks/M2-05/kernel-persona-affect.txt`

Verdict: PASS

## 3. CLI persona / affect tests

Run:

```powershell
pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-persona-affect.txt"
```

Expected:

- `fairy persona inspect --json` path is tested.
- `fairy affect --json` path is tested.
- replay renders `affect.updated` compactly and preserves JSON payloads.
- corrupt-tail replay tolerance remains green.

Evidence:

- `tasks/owner-checks/M2-05/cli-persona-affect.txt`

Verdict: PASS

## 4. Direct persona CLI evidence

Run:

```powershell
node scripts/run-cli.mjs persona inspect --json |
  Out-File -Encoding utf8 "$OwnerChecks\persona-inspect.json"

Get-Content "$OwnerChecks\persona-inspect.json" -Raw | ConvertFrom-Json | Out-Null
```

Expected:

- JSON parses.
- persona id/name/languages visible.
- disclosure string visible.
- style summary visible.
- long style file bodies are not dumped by default.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\persona-inspect.json" -Pattern '"id"'
Select-String -Path "$OwnerChecks\persona-inspect.json" -Pattern '"name"'
Select-String -Path "$OwnerChecks\persona-inspect.json" -Pattern 'disclosure'
```

Evidence:

- `tasks/owner-checks/M2-05/persona-inspect.json`

Verdict: PASS

## 5. Direct affect CLI evidence

Run:

```powershell
node scripts/run-cli.mjs affect --json |
  Out-File -Encoding utf8 "$OwnerChecks\affect.json"

Get-Content "$OwnerChecks\affect.json" -Raw | ConvertFrom-Json | Out-Null
```

Expected:

- JSON parses.
- enabled flag is visible.
- valence/arousal/stance/energy visible.
- bounds visible.
- last cause or baseline cause visible.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\affect.json" -Pattern '"enabled"'
Select-String -Path "$OwnerChecks\affect.json" -Pattern '"valence"'
Select-String -Path "$OwnerChecks\affect.json" -Pattern '"arousal"'
Select-String -Path "$OwnerChecks\affect.json" -Pattern '"stance"'
```

Evidence:

- `tasks/owner-checks/M2-05/affect.json`

Verdict: PASS

## 6. Affect event replay evidence

This can be satisfied by the gateway E2E from step 1 and CLI/replay tests from step 3. For direct evidence, save the relevant replay output if you have a test session/data dir.

Expected:

- `affect.updated` appears in JSON replay for a turn that triggers affect update.
- text replay renders `affect.updated` compactly.
- `context.manifest` shows persona zone tokens.
- no `memory.written` appears unless an explicit remember command was used.

Suggested evidence filenames:

- `tasks/owner-checks/M2-05/affect-replay.jsonl`
- `tasks/owner-checks/M2-05/affect-replay-manifests.txt`

Verdict: PASS

## 7. Off-switch evidence

This can be satisfied by kernel/CLI tests. Optional direct config check:

```powershell
@'
persona:
  enabled: false
affect:
  enabled: false
'@ | Set-Content -Encoding UTF8 "$OwnerChecks\m2-05-off.yaml"

node scripts/run-cli.mjs persona inspect --config "$OwnerChecks\m2-05-off.yaml" --json |
  Out-File -Encoding utf8 "$OwnerChecks\off-persona-inspect.json"

node scripts/run-cli.mjs affect --config "$OwnerChecks\m2-05-off.yaml" --json |
  Out-File -Encoding utf8 "$OwnerChecks\off-affect.json"

Get-Content "$OwnerChecks\off-persona-inspect.json" -Raw | ConvertFrom-Json | Out-Null
Get-Content "$OwnerChecks\off-affect.json" -Raw | ConvertFrom-Json | Out-Null
```

Expected:

- persona disabled/plain style visible.
- affect disabled or baseline/frozen visible.
- normal tool/permission/routing behavior is unchanged by the tests.

Evidence:

- `tasks/owner-checks/M2-05/off-persona-inspect.json`
- `tasks/owner-checks/M2-05/off-affect.json`

Verdict: PASS

## Owner summary template

Create:

```powershell
notepad "$OwnerChecks\M2-05-owner-checks.md"
```

Use:

```markdown
# M2-05 Owner Manual Checks

Date: 2026-07-06
Repo: Maxwell-00/OpenFairy
Commit: 77ed93e
GitHub Actions: GREEN on ubuntu + windows

## 1. Persona / affect eval suites

Evidence:

- `tasks/owner-checks/M2-05/testing-persona-affect.txt`

Observed:

- persona.consistency present and PASS: YES / NO
- substance.invariance present and PASS: YES / NO
- existing M2 named suites still PASS: YES / NO
- test summary green: YES / NO

Verdict: PASS / FAIL

## 2. Kernel persona / affect tests

Evidence:

- `tasks/owner-checks/M2-05/kernel-persona-affect.txt`

Observed:

- persona loader tests pass: YES / NO
- off-switch tests pass: YES / NO
- affect deterministic update tests pass: YES / NO
- banned dark-pattern corpus tests pass: YES / NO
- context persona-zone tests pass: YES / NO
- test summary green: YES / NO

Verdict: PASS / FAIL

## 3. CLI / replay tests

Evidence:

- `tasks/owner-checks/M2-05/cli-persona-affect.txt`
- `tasks/owner-checks/M2-05/persona-inspect.json`
- `tasks/owner-checks/M2-05/affect.json`

Observed:

- persona inspect JSON parseable: YES / NO
- affect JSON parseable: YES / NO
- replay affect rendering tests pass: YES / NO
- corrupt-tail replay tolerance remains green: YES / NO

Verdict: PASS / FAIL

## 4. Optional direct replay/off-switch evidence

Evidence:

- `tasks/owner-checks/M2-05/affect-replay.jsonl` or test evidence
- `tasks/owner-checks/M2-05/off-persona-inspect.json`
- `tasks/owner-checks/M2-05/off-affect.json`

Observed:

- affect.updated visible in replay or covered by tests: YES / NO
- persona/affect off switches visible or covered by tests: YES / NO
- no memory.written without explicit remember: YES / NO

Verdict: PASS / N/A / FAIL

## Overall

M2-05 owner manual checks: PASS / FAIL

Notes:

- Checks are deterministic fixture/mock checks.
- No real API key is required.
- No real web call is required.
```

After checks:

```powershell
git add tasks\owner-checks\M2-05
git commit -m "M2-05 owner checks"
git push
```
