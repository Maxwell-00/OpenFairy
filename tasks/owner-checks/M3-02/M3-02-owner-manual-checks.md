# M3-02 Owner Manual Checks — Detailed Procedure

Date: 2026-07-09  
Repo: Maxwell-00/OpenFairy  
Implementation commit: `fe8afc3`  
GitHub Actions: `29007278951` GREEN on ubuntu + windows  
Evidence type: deterministic fixture/mock evidence. No real audio device, provider, socket, network, or Python worker is required.

## 0. Setup

Use PowerShell 7 if possible.

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M3-02"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null

git rev-parse --short HEAD
```

Expected implementation baseline:

```text
fe8afc3
```

If the current commit is newer because review/evidence files were committed later, record both the implementation commit and owner evidence commit.

## 1. Full voice duplex suite visibility

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-voice-duplex.txt"
```

Expected:

- `voice.duplex-transport-v0` appears and passes.
- `voice.protocol-loopback-v0` remains green.
- All M2 named suites remain green.
- `memory.canary` remains visibly skipped/deferred.
- Future voice latency/barge-in/ASR/provider benchmarks are not fake-passed.

Checks:

```powershell
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "voice.duplex-transport-v0"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "voice.protocol-loopback-v0"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "chronicle.workspace-v0"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "dream-cycle.consolidation-v0"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "memory.canary"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\testing-voice-duplex.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 2. Focused duplex suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.duplex-transport-v0" 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-duplex-focused.txt"
```

Expected:

- focused suite appears and passes;
- frame protocol / encode-decode / valid-invalid fixtures covered;
- in-memory transport FIFO/close/overflow covered;
- mock speech worker covered;
- label clamp covered on emitted `speech.asr.final` and `turn.input`;
- route gate / MemoryGate / egress inherited;
- cancel replayable session covered;
- no raw audio/base64 in JSONL;
- no real provider/network/device.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "voice.duplex-transport-v0"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "fixture|fixtures"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "clamp|floor|region-restricted|prefer_local"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "cancel|cancelled"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "MemoryGate|personal_default_hold|memory"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-duplex-focused.txt" -Pattern "Tests"
```

Some greps may not match depending on exact test wording. The decisive evidence is that `voice.duplex-transport-v0` appears and the focused run is green.

Verdict: PASS / FAIL

## 3. Package-level voice / CLI tests

Run:

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-package.txt"

pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-voice-duplex.txt"
```

Expected:

- voice package tests pass;
- CLI voice duplex tests pass;
- replay/corrupt-tail tests remain green.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "duplex|VoiceControlFrame|MockSpeechDuplexWorker|InMemoryVoiceDuplexTransport"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Tests"

Select-String -Path "$OwnerChecks\cli-voice-duplex.txt" -Pattern "voice|duplex|replay|corrupt"
Select-String -Path "$OwnerChecks\cli-voice-duplex.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\cli-voice-duplex.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 4. Optional CLI conformance smoke

The implementation exposes:

```powershell
pnpm fairy voice duplex --script <fixture.json> --json
```

If a stable fixture is easy to locate, run it with a temp data dir. Otherwise mark this section N/A and rely on deterministic E2E tests; do not hand-author session JSONL.

Save output if run:

```text
tasks/owner-checks/M3-02/voice-duplex-cli.json
```

Expected:

- JSON parseable.
- `sid` visible if session created.
- frame counts visible.
- speech event counts visible.
- model request count visible.
- exactly one normal turn for non-cancelled ASR final.
- no raw audio/base64.
- no real speech provider/device/network transport.

Verdict: PASS / N/A / FAIL

## 5. Optional replay smoke

Replay a duplex-produced session only if the CLI smoke exposes a stable session/data-dir.

Save, if available:

```text
tasks/owner-checks/M3-02/voice-duplex-replay.txt
tasks/owner-checks/M3-02/voice-duplex-replay.json
tasks/owner-checks/M3-02/voice-duplex-manifests.txt
```

Expected:

- speech events render in text replay.
- JSON replay preserves payload.
- manifests still render.
- corrupt-tail tolerance remains green.
- no transport-frame event types appear.

If no stable session is exposed, mark N/A and point to deterministic replay tests.

Verdict: PASS / N/A / FAIL

## 6. Full acceptance tail

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

## 7. Owner summary template

Create:

```powershell
notepad "$OwnerChecks\M3-02-owner-checks.md"
```

Suggested content:

```markdown
# M3-02 Owner Manual Checks

Date: 2026-07-09
Repo: Maxwell-00/OpenFairy
Implementation commit: fe8afc3
Owner evidence commit: <fill after commit>
GitHub Actions: GREEN on ubuntu + windows

## 1. Voice duplex suite visibility

Evidence:
- `tasks/owner-checks/M3-02/testing-voice-duplex.txt`
- `tasks/owner-checks/M3-02/voice-duplex-focused.txt`

Observed:
- voice.duplex-transport-v0 present and PASS: YES / NO
- voice.protocol-loopback-v0 still PASS: YES / NO
- M2 named suites still PASS: YES / NO
- memory.canary still skipped/deferred: YES / NO
- future voice benchmarks not fake-passed: YES / NO

Verdict: PASS / FAIL

## 2. Package / CLI tests

Evidence:
- `tasks/owner-checks/M3-02/voice-package.txt`
- `tasks/owner-checks/M3-02/cli-voice-duplex.txt`

Observed:
- voice package tests green: YES / NO
- CLI voice/replay tests green: YES / NO
- corrupt-tail replay still green: YES / NO

Verdict: PASS / FAIL

## 3. Optional CLI/replay smoke

Evidence:
- `voice-duplex-cli.json` or covered by deterministic E2E tests
- `voice-duplex-replay.*` or covered by deterministic E2E tests

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

M3-02 owner manual checks: PASS / FAIL

Notes:
- No real audio device was used.
- No real ASR/TTS provider was used.
- No real socket/network/Python worker was used.
- No real API key was used.
- Evidence is deterministic fixture/mock evidence.
```

## 8. Commit evidence

```powershell
git add tasks\owner-checks\M3-02
git commit -m "M3-02 owner checks"
git push
```

Then send the reviewer:

- owner evidence commit hash;
- GitHub Actions run link.
