# M3-03 Owner Manual Checks — Detailed Procedure

Date: 2026-07-09
Repo: Maxwell-00/OpenFairy
Implementation commit: `524dd33`
GitHub Actions: `29019686865` GREEN on ubuntu + windows
Evidence type: deterministic fixture/mock evidence. No real audio device, provider, external network, or Python worker is required.

## 0. Setup

Use PowerShell 7 if possible.

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M3-03"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null

git rev-parse --short HEAD
```

Expected implementation baseline:

```text
524dd33
```

If the current commit is newer because review/evidence files were committed later, record both the implementation commit and owner evidence commit.

## 1. Full voice WebSocket suite visibility

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-voice-websocket.txt"
```

Expected:

- `voice.websocket-transport-v0` appears and passes.
- `voice.duplex-transport-v0` remains green.
- `voice.protocol-loopback-v0` remains green.
- All M2 named suites remain green.
- `memory.canary` remains visibly skipped/deferred.
- Future voice latency/barge-in/ASR/provider/desktop benchmarks are not fake-passed.

Checks:

```powershell
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "voice.websocket-transport-v0"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "voice.duplex-transport-v0"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "voice.protocol-loopback-v0"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "chronicle.workspace-v0"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "dream-cycle.consolidation-v0"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "memory.canary"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\testing-voice-websocket.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 2. Focused WebSocket suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.websocket-transport-v0" 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-websocket-focused.txt"
```

Expected:

- focused suite appears and passes;
- codec covered;
- auth failure covered;
- loopback/local endpoint covered;
- two-stream FIFO covered;
- route gate / MemoryGate / egress inherited;
- replay covered.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "voice.websocket-transport-v0"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "4401|auth|token"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "127.0.0.1|loopback"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "FIFO|two-stream|stream"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "MemoryGate|personal_default_hold|memory"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-websocket-focused.txt" -Pattern "Tests"
```

Some grep patterns may not match depending on exact test names. The decisive evidence is that `voice.websocket-transport-v0` appears and the focused run is green.

Verdict: PASS / FAIL

## 3. Package / CLI tests

Run:

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\voice-package.txt"

pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-voice-websocket.txt"
```

Expected:

- voice package tests green;
- CLI/replay tests green;
- corrupt-tail replay still green;
- websocket CLI smoke covered.

Checks:

```powershell
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "WebSocket|websocket|ws|FIFO|auth|token"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\voice-package.txt" -Pattern "Tests"

Select-String -Path "$OwnerChecks\cli-voice-websocket.txt" -Pattern "voice|ws|websocket|replay|corrupt"
Select-String -Path "$OwnerChecks\cli-voice-websocket.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\cli-voice-websocket.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 4. Optional CLI smoke

If a stable fixture is easy to locate, run:

```powershell
pnpm fairy voice ws --script <fixture.json> --json
```

Save if run:

```text
tasks/owner-checks/M3-03/voice-websocket-cli.json
```

Expected:

- JSON parseable.
- loopback/local WS only.
- frame counts visible.
- speech event counts visible.
- model request count visible.
- exactly one normal turn for non-cancelled ASR final.
- no raw audio/base64.
- no external network/device/provider.

If no stable standalone CLI smoke exists, mark N/A and rely on deterministic E2E tests.

Verdict: PASS / N/A / FAIL

## 5. Replay smoke

Replay a WebSocket-produced session if a stable session/data-dir is exposed.

Save if available:

```text
tasks/owner-checks/M3-03/voice-websocket-replay.txt
tasks/owner-checks/M3-03/voice-websocket-replay.json
tasks/owner-checks/M3-03/voice-websocket-manifests.txt
```

If not available, mark N/A and point to deterministic replay tests.

Expected:

- speech events render in text replay.
- JSON replay preserves payload.
- manifests still render.
- corrupt-tail tolerance remains green.
- no transport-frame event types appear.

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
notepad "$OwnerChecks\M3-03-owner-checks.md"
```

Suggested content:

```markdown
# M3-03 Owner Manual Checks

Date: 2026-07-09
Repo: Maxwell-00/OpenFairy
Implementation commit: 524dd33
Owner evidence commit: <fill after commit>
GitHub Actions: GREEN on ubuntu + windows

## 1. Voice WebSocket suite visibility

Evidence:
- `tasks/owner-checks/M3-03/testing-voice-websocket.txt`
- `tasks/owner-checks/M3-03/voice-websocket-focused.txt`

Observed:
- voice.websocket-transport-v0 present and PASS: YES / NO
- voice.duplex-transport-v0 still PASS: YES / NO
- voice.protocol-loopback-v0 still PASS: YES / NO
- M2 named suites still PASS: YES / NO
- memory.canary still skipped/deferred: YES / NO
- future voice benchmarks not fake-passed: YES / NO

Verdict: PASS / FAIL

## 2. Package / CLI tests

Evidence:
- `tasks/owner-checks/M3-03/voice-package.txt`
- `tasks/owner-checks/M3-03/cli-voice-websocket.txt`

Observed:
- voice package tests green: YES / NO
- CLI voice/replay tests green: YES / NO
- corrupt-tail replay still green: YES / NO

Verdict: PASS / FAIL

## 3. Optional CLI/replay smoke

Evidence:
- `voice-websocket-cli.json` or covered by deterministic E2E tests
- `voice-websocket-replay.*` or covered by deterministic E2E tests

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

M3-03 owner manual checks: PASS / FAIL

Notes:
- No real audio device was used.
- No real ASR/TTS provider was used.
- No external network was used.
- No Python worker was used.
- No real API key was used.
- Evidence is deterministic fixture/mock evidence.
```

## 8. Commit evidence

```powershell
git add tasks\owner-checks\M3-03
git commit -m "M3-03 owner checks"
git push
```

Then send the reviewer:

- owner evidence commit hash;
- GitHub Actions run link.
