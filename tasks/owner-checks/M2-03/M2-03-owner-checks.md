# M2-03 Owner Manual Checks

Date: 2026-07-06
Repo: Maxwell-00/OpenFairy
Commit: 4117c1c
GitHub Actions: #41 GREEN on ubuntu + windows

## 1. Testing research/eval suites

Command:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Evidence:

- `tasks/owner-checks/M2-03/testing-research-evals.txt`

Observed:

- `memory.leakage`: PASS
- `memory.deletion-permanence`: PASS
- `research.citation-precision`: PASS
- `research.zh-en-parity`: PASS
- `injection.research-v0`: PASS
- gateway E2E `runs research tools through the normal tool loop and renders replay`: PASS
- gateway E2E `keeps research injection pages quarantined through the TurnRunner tool loop`: PASS
- gateway E2E `composes authenticated research snapshot labels before route clearance`: PASS
- Test Files: 6 passed | 1 skipped
- Tests: 33 passed | 1 skipped

Verdict: PASS

## 2. Research package tests

Command:

```powershell
pnpm --filter @fairy/research test -- --reporter=verbose
```

Evidence:

- `tasks/owner-checks/M2-03/research-package-test.txt`

Observed:

- deterministic planning with bounded budgets: PASS
- zh/en fan-out for Chinese intents: PASS
- China-related English local coverage: PASS
- deterministic recency classification: PASS
- URL canonicalization, tracking-param removal, and AMP-like normalization: PASS
- deduplication and duplicate counts: PASS
- mirrored content-signature collapse: PASS
- source grade overrides and domain heuristics: PASS
- seeded zh/en source family on same canonical URL: PASS
- content-addressed snapshots and TTL cache: PASS
- deny-listed domains without provider fetch: PASS
- citation validation and grade propagation: PASS
- source-set warning review: PASS
- five-page injection corpus: PASS
- Test Files: 1 passed
- Tests: 14 passed

Verdict: PASS

## 3. Research tools tests

Command:

```powershell
pnpm --filter @fairy/tools-std test -- --reporter=verbose
```

Evidence:

- `tasks/owner-checks/M2-03/tools-std-research-test.txt`

Observed:

- `runs research tools with quarantined snapshots, citations, and source reviews`: PASS
- Docker/sandbox-dependent tests skipped as environment-dependent
- Test Files: 1 passed
- Tests: 4 passed | 3 skipped

Verdict: PASS

## 4. CLI and replay tests

Command:

```powershell
pnpm --filter @fairy/cli test -- --reporter=verbose
```

Evidence:

- `tasks/owner-checks/M2-03/cli-research-test.txt`

Observed:

- replay corrupt-tail tolerance: PASS
- replay trust-decision JSON preservation: PASS
- `fairy research` CLI lists sources, snapshots, quarantined snapshot bodies, and citations: PASS
- memory CLI regression remains green: PASS
- Test Files: 4 passed
- Tests: 6 passed

Verdict: PASS

## 5. Optional full local acceptance tail

Status: NOT USED AS OWNER EVIDENCE.

Notes:

- The optional full local acceptance tail is not required for M2-03 owner evidence.
- The task-level acceptance commands are already covered by GitHub Actions #41, which is green on ubuntu + windows.
- The owner evidence above is limited to deterministic fixture/mock research checks and CLI/replay checks.

Verdict: N/A

## Overall

M2-03 owner manual checks: PASS

## Evidence scope

- Checks were fixture/mock based.
- No real web calls were made.
- No real API keys were used.
- No `docs/` or `docs-zh/` edits are part of owner evidence.
- PowerShell stderr wrapping and mojibake in captured output are display artifacts; Vitest summaries show PASS.