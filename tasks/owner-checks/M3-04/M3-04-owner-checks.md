# M3-04 Owner Checks

- Implementation commit: e3e8089f996f810f6722537225eca0d411391646
- Owner-evidence commit: d170407
- Implementation CI run: 29071874462
- Owner-evidence CI run: 29079889389
- Owner platform: Windows 11 / PowerShell 7
- Date: 2026/7/10
- Overall result: PASS 

## CI evidence

- Ubuntu job: PASS
- Windows job: PASS
- Run URL recorded separately: yes

## Required owner evidence

| Check                                         | Result | Evidence                     |
| --------------------------------------------- | ------ | ---------------------------- |
| Production interpreter discovery and shutdown | PASS   | interpreter-discovery.jsonl  |
| Full named suites                             | PASS   | testing-voice-worker.txt     |
| Focused voice.worker-process-v0               | PASS   | voice-worker-focused.txt     |
| No orphan worker after focused suite          | PASS   | processes-after-focused.txt  |
| Python 3.11 compatibility                     | PASS   | python-311-compatibility.txt |
| @fairy/voice tests                            | PASS   | voice-package.txt            |
| @fairy/cli tests                              | PASS   | cli-voice-worker.txt         |
| ASCII/std-lib/mock-only static checks         | PASS   | python-*.txt                 |
| Windows stdio/spawn hygiene                   | PASS   | stdio-spawn-evidence.txt     |
| Gateway supervisor placement                  | PASS   | supervisor-placement.txt     |
| No English docs implementation edits | PASS | Reviewer-verified from committed diff |

## Optional CLI/replay evidence

- CLI smoke: PASS
- Replay smoke: NOT RUN
- Reason when not run: Optional replay smoke was not preserved as committed evidence; deterministic replay tests passed.

## Python version note

- Production discovery selected: `python`, Python `3.13.9`, source `discovered`
- Python 3.11 compatibility result: PASS with `D:\miniconda3\envs\fairy-py311\python.exe`, Python `3.11.15`, source `test-override`
- The selected workstation version is evidence only and is not a pinned project requirement.

## Deviations or failures

- The initial Python 3.11 focused-suite attempt failed because the production-discovery assertion expected `source: "discovered"` while the explicit test override correctly reported `source: "test-override"`.
- A corrected override handshake and three-test integration subset passed under Python 3.11.15.