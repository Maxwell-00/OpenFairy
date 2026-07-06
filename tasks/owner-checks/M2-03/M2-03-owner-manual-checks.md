# M2-03 Owner Manual Checks — Suggested Flow

Date: 2026-07-06  
Repo: Maxwell-00/OpenFairy  
Baseline commit: `cab4c28`  
Purpose: collect owner evidence after CI green.

## 0. Setup

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-03"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null
```

## 1. Capture targeted research/eval output

This produces owner-visible evidence for the named M2 research suites and gateway E2E.

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-research-evals.txt"
```

Expected output contains:

- `research.citation-precision`
- `research.zh-en-parity`
- `injection.research-v0`
- `keeps research injection pages quarantined through the TurnRunner tool loop`
- `memory.leakage`
- `memory.deletion-permanence`

Check quickly:

```powershell
Select-String -Path "$OwnerChecks\testing-research-evals.txt" -Pattern "research.citation-precision"
Select-String -Path "$OwnerChecks\testing-research-evals.txt" -Pattern "research.zh-en-parity"
Select-String -Path "$OwnerChecks\testing-research-evals.txt" -Pattern "injection.research-v0"
Select-String -Path "$OwnerChecks\testing-research-evals.txt" -Pattern "keeps research injection pages quarantined"
```

## 2. Capture research package tests

```powershell
pnpm --filter @fairy/research test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\research-package-test.txt"
```

Expected:

- deterministic planning tests pass;
- snapshot/cache/canonicalization/citation/source-set mechanics pass;
- no real network is used.

## 3. Capture tools-std research tool tests

```powershell
pnpm --filter @fairy/tools-std test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\tools-std-research-test.txt"
```

Expected:

- research tools pass through normal tool layer;
- quarantined content marker appears in tests;
- no unsafe downgrade of web/fetched content.

## 4. Capture CLI/replay tests

```powershell
pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-research-test.txt"
```

Expected:

- `fairy research sources --json`
- `fairy research snapshots --json`
- `fairy research show-snapshot <snapshot_id> --json`
- `fairy research citations --json`
- replay rendering of `snapshot.created`, `citation.recorded`, `sourceset.reviewed`

## 5. Optional full local acceptance tail

This is heavier but mirrors the CI acceptance commands.

```powershell
pnpm lint 2>&1 | Tee-Object -FilePath "$OwnerChecks\lint.txt"
pnpm -r typecheck 2>&1 | Tee-Object -FilePath "$OwnerChecks\typecheck.txt"
pnpm -r test 2>&1 | Tee-Object -FilePath "$OwnerChecks\test.txt"
pnpm dep-check 2>&1 | Tee-Object -FilePath "$OwnerChecks\dep-check.txt"
pnpm conformance 2>&1 | Tee-Object -FilePath "$OwnerChecks\conformance.txt"
```

Expected:

- all pass;
- `pnpm conformance` mock mode remains 18/18 PASS;
- no real API keys or real web calls.

## 6. Owner summary file

Create:

```powershell
notepad "$OwnerChecks\M2-03-owner-checks.md"
```

Suggested content:

```markdown
# M2-03 Owner Manual Checks

Date: 2026-07-06
Repo: Maxwell-00/OpenFairy
Commit: cab4c28
CI: GitHub Actions #40 Success, ubuntu + windows matrix green

## 1. Named research/eval suites

Evidence:

- `tasks/owner-checks/M2-03/testing-research-evals.txt`

Observed:

- research.citation-precision: PASS
- research.zh-en-parity: PASS
- injection.research-v0: PASS
- gateway E2E `keeps research injection pages quarantined through the TurnRunner tool loop`: PASS
- memory.leakage: PASS
- memory.deletion-permanence: PASS

Verdict: PASS

## 2. Research package

Evidence:

- `tasks/owner-checks/M2-03/research-package-test.txt`

Observed:

- deterministic planning: PASS
- zh/en planning: PASS
- snapshot/cache/canonicalization/source grading/citation mechanics: PASS
- no real network: PASS

Verdict: PASS

## 3. Research tool namespace

Evidence:

- `tasks/owner-checks/M2-03/tools-std-research-test.txt`

Observed:

- research.plan/search/fetch/cite/sources tool behavior: PASS
- quarantined fetched content: PASS
- no unsafe instruction treatment: PASS

Verdict: PASS

## 4. CLI and replay visibility

Evidence:

- `tasks/owner-checks/M2-03/cli-research-test.txt`

Observed:

- research CLI JSON commands: PASS
- snapshot/citation/source-set replay rendering: PASS

Verdict: PASS

## Overall

M2-03 owner manual checks: PASS / FAIL

Notes:

- No real public web calls were used.
- No real API keys were used.
- Evidence is deterministic mock/fixture based.
```

## 7. Commit owner evidence

Only commit text evidence. Do not commit derived databases or temp data dirs.

```powershell
git add tasks\owner-checks\M2-03
git commit -m "M2-03 owner checks"
git push
```

After push and CI green, send the evidence summary back for final close review.
