# M3-01 Owner Manual Checks — Detailed Procedure

Date: 2026-07-09  
Repo: Maxwell-00/OpenFairy  
Implementation commit: `bf6896e`  
GitHub Actions: `28992694192` GREEN on ubuntu + windows  
Evidence type: deterministic fixture/mock evidence. No real audio device, provider, or API key is required.

## 0. Setup

Use PowerShell 7 if possible.

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M3-01"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null

git rev-parse --short HEAD
```

Expected implementation baseline:

```text
bf6896e
```

If the current commit is newer because review/evidence files were committed later, record both implementation commit and owner evidence commit.

## 1. Full voice protocol suite visibility

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-voice.txt"
```

Expected:

- `voice.protocol-loopback-v0` appears and passes.
- All M2 named suites remain green:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - `label.conformance`
  - `governance.friction-canary`
  - `persona.consistency`
  - `substance.invariance`
  - `perception.quarantine-v0`
  - `context.compaction-regression`
  - `chronicle.workspace-v0`
  - `dream-cycle.consolidation-v0`
- Future M3 latency/barge-in/ASR-quality benchmarks are not fake-passed.

Checks:

```powershell
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "voice.protocol-loopback-v0"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "chronicle.workspace-v0"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "dream-cycle.consolidation-v0"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "memory.canary"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\testing-voice.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 2. Focused voice suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.protocol-loopback-v0" 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-protocol-loopback.txt"
```

Expected:

- target suite appears and passes;
- schema fixture validation visible;
- ASR partial/final ordering covered;
- exactly-one-turn behavior covered;
- TTS output-only behavior covered;
- label-floor / route-gating behavior covered;
- MemoryGate / egress inheritance covered.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "voice.protocol-loopback-v0"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "speech.asr.final"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "route|routing|under-cleared|fallback"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "MemoryGate|memory"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-protocol-loopback.txt" -Pattern "Tests"
```

Some greps may not match depending on exact test name wording. The decisive evidence is that `voice.protocol-loopback-v0` appears and the focused run is green.

Verdict: PASS / FAIL

## 3. Package-level voice / CLI / replay tests

Run:

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-package.txt"

pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-voice-replay.txt"
```

Expected:

- `@fairy/voice` unit tests pass.
- CLI voice tests pass.
- Replay tests still pass, including corrupt-tail behavior.
- Speech events render in replay.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Loopback|voice|speech|mark"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Tests"

Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "voice"
Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "speech.asr"
Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "speech.tts"
Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "corrupt"
Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\cli-voice-replay.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 4. Optional manual CLI smoke

The deterministic E2E suite already validates the loopback path with a mock gateway. Manual CLI smoke is optional unless the reviewer asks for direct CLI evidence.

If you run it, use a temp data dir and a local test gateway. Do not use real audio devices or real ASR/TTS providers.

Save outputs, if available:

```text
tasks/owner-checks/M3-01/voice-loopback.json
tasks/owner-checks/M3-01/voice-replay.txt
tasks/owner-checks/M3-01/voice-replay.json
tasks/owner-checks/M3-01/voice-manifests.txt
tasks/owner-checks/M3-01/voice-governance.txt
```

If no stable mock-gateway CLI harness is available, mark this section N/A and rely on deterministic E2E/CLI tests. Do not hand-author JSONL.

Verdict: PASS / N/A / FAIL

## 5. Full acceptance tail

Run:

```powershell
pnpm lint 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\lint.txt"

pnpm -r typecheck 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\typecheck.txt"

pnpm -r test 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\all-tests.txt"

pnpm dep-check 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\dep-check.txt"

pnpm conformance 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\conformance.txt"

git diff --check 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\diff-check.txt"

git diff --name-only -- docs docs-zh 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\docs-diff.txt"
```

Expected:

- lint PASS, including encoding guard;
- typecheck PASS;
- all tests PASS;
- dep-check PASS;
- conformance PASS;
- diff-check clean;
- docs-diff empty.

Verdict: PASS / N/A / FAIL

## 6. Owner summary template

Create:

```powershell
notepad "$OwnerChecks\M3-01-owner-checks.md"
```

Suggested content:

```markdown
# M3-01 Owner Manual Checks

Date: 2026-07-09
Repo: Maxwell-00/OpenFairy
Implementation commit: bf6896e
Owner evidence commit: <fill after commit>
GitHub Actions: GREEN on ubuntu + windows

## 1. Voice suite visibility

Evidence:
- `tasks/owner-checks/M3-01/testing-voice.txt`
- `tasks/owner-checks/M3-01/voice-protocol-loopback.txt`

Observed:
- voice.protocol-loopback-v0 present and PASS: YES / NO
- M2 named suites still PASS: YES / NO
- future latency/barge-in/ASR benchmarks not fake-passed: YES / NO

Verdict: PASS / FAIL

## 2. Package / CLI / replay tests

Evidence:
- `tasks/owner-checks/M3-01/voice-package.txt`
- `tasks/owner-checks/M3-01/cli-voice-replay.txt`

Observed:
- voice package tests green: YES / NO
- CLI voice/replay tests green: YES / NO
- corrupt-tail replay still green: YES / NO

Verdict: PASS / FAIL

## 3. Optional manual loopback CLI

Evidence:
- `voice-loopback.json` or covered by deterministic E2E tests
- `voice-replay.*` or covered by deterministic E2E tests
- `voice-governance.txt` or covered by deterministic E2E tests

Observed:
- direct CLI smoke available: YES / NO
- if NO, deterministic E2E logs cover equivalent properties: YES / NO

Verdict: PASS / N/A / FAIL

## 4. Full acceptance tail

Evidence:
- `lint.txt`
- `typecheck.txt`
- `all-tests.txt`
- `dep-check.txt`
- `conformance.txt`
- `diff-check.txt`
- `docs-diff.txt`

Observed:
- all commands green or CI confirms equivalent: YES / NO
- docs/docs-zh unchanged: YES / NO

Verdict: PASS / FAIL

## Overall

M3-01 owner manual checks: PASS / FAIL

Notes:
- No real audio device was used.
- No real ASR/TTS provider was used.
- No real API key was used.
- Evidence is deterministic fixture/mock evidence.
```

## 7. Commit evidence

```powershell
git add tasks\owner-checks\M3-01
git commit -m "M3-01 owner checks"
git push
```

Then send the reviewer:

- owner evidence commit hash;
- GitHub Actions run link.
