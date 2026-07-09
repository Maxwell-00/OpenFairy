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
- voice.duplex-transport-v0 present and PASS: YES
- voice.protocol-loopback-v0 still PASS: YES 
- M2 named suites still PASS: YES
- memory.canary still skipped/deferred: YES
- future voice benchmarks not fake-passed: YES

Verdict: PASS

## 2. Package / CLI tests

Evidence:
- `tasks/owner-checks/M3-02/voice-package.txt`
- `tasks/owner-checks/M3-02/cli-voice-duplex.txt`

Observed:
- voice package tests green: YES
- CLI voice/replay tests green: YES
- corrupt-tail replay still green: YES

Verdict: PASS

## 3. Optional CLI/replay smoke

Evidence:
- `voice-duplex-cli.json` or covered by deterministic E2E tests
- `voice-duplex-replay.*` or covered by deterministic E2E tests

Observed:
- direct CLI smoke available: YES / NO
- if NO, deterministic E2E logs cover equivalent properties: YES / NO

Verdict: N/A

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

M3-02 owner manual checks: PASS

Notes:
- No real audio device was used.
- No real ASR/TTS provider was used.
- No real socket/network/Python worker was used.
- No real API key was used.
- Evidence is deterministic fixture/mock evidence.