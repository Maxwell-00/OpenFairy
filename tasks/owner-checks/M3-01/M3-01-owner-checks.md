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
- voice.protocol-loopback-v0 present and PASS: YES
- M2 named suites still PASS: YES
- future latency/barge-in/ASR benchmarks not fake-passed: YES

Verdict: PASS

## 2. Package / CLI / replay tests

Evidence:
- `tasks/owner-checks/M3-01/voice-package.txt`
- `tasks/owner-checks/M3-01/cli-voice-replay.txt`

Observed:
- voice package tests green: YES
- CLI voice/replay tests green: YES
- corrupt-tail replay still green: YES

Verdict: PASS

## 3. Optional manual loopback CLI

Evidence:
- `voice-loopback.json` or covered by deterministic E2E tests
- `voice-replay.*` or covered by deterministic E2E tests
- `voice-governance.txt` or covered by deterministic E2E tests

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
- all commands green or CI confirms equivalent: YES
- docs/docs-zh unchanged: YES

Verdict: PASS

## Overall

M3-01 owner manual checks: PASS

Notes:
- No real audio device was used.
- No real ASR/TTS provider was used.
- No real API key was used.
- Evidence is deterministic fixture/mock evidence.