# M2-08 Owner Manual Checks — Detailed Procedure

Date: 2026-07-07  
Repo: Maxwell-00/OpenFairy  
Implementation commit: `5f3ef12`  
GitHub Actions: `28872338070` GREEN on ubuntu + windows  
Evidence type: deterministic fixture/mock evidence. No real provider key is required.

## 0. Setup

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-08"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null

git rev-parse --short HEAD
```

Expected implementation baseline:

```text
5f3ef12
```

If the current commit is newer because review/evidence files were committed later, record both the implementation commit and owner evidence commit.

## 1. Full testing suite visibility

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-chronicle.txt"
```

Expected:

- `chronicle.workspace-v0` appears and passes.
- `dream-cycle.consolidation-v0` appears and passes.
- Existing M2 suites still pass, including memory, research, governance, persona, perception, and compaction suites.

Checks:

```powershell
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "chronicle.workspace-v0"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "dream-cycle.consolidation-v0"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "memory.leakage"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "perception.quarantine-v0"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\testing-chronicle.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 2. Focused dream-cycle consolidation suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "dream-cycle.consolidation-v0" 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\dream-cycle-consolidation.txt"
```

Expected:

- focused suite appears and passes;
- report artifact creation is covered;
- secret redaction is covered;
- learned-skill draft remains pending;
- idempotence is covered;
- no scheduler/background task is started.

Checks:

```powershell
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "dream-cycle.consolidation-v0"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "report"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "redact|redaction|secret"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "pending"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "idempotent|idempotence"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\dream-cycle-consolidation.txt" -Pattern "Tests"
```

Verdict: PASS / FAIL

## 3. Chronicle CLI

Use a temporary data directory to avoid mixing with regular Fairy data:

```powershell
$ChronicleData = Join-Path $OwnerChecks "data-chronicle"
New-Item -ItemType Directory -Force $ChronicleData | Out-Null

node scripts/run-cli.mjs chronicle log --kind decision --summary "Use source-first TS execution" --topic m2 --data-dir "$ChronicleData" --json |
  Out-File -Encoding utf8 "$OwnerChecks\chronicle-log.json"

node scripts/run-cli.mjs chronicle query source-first --data-dir "$ChronicleData" --json |
  Out-File -Encoding utf8 "$OwnerChecks\chronicle-query.json"

node scripts/run-cli.mjs chronicle list --data-dir "$ChronicleData" --json |
  Out-File -Encoding utf8 "$OwnerChecks\chronicle-list.json"
```

Parse checks:

```powershell
Get-Content "$OwnerChecks\chronicle-log.json" -Raw | ConvertFrom-Json | Out-Null
Get-Content "$OwnerChecks\chronicle-query.json" -Raw | ConvertFrom-Json | Out-Null
Get-Content "$OwnerChecks\chronicle-list.json" -Raw | ConvertFrom-Json | Out-Null
```

Content checks:

```powershell
Select-String -Path "$OwnerChecks\chronicle-log.json" -Pattern "source-first"
Select-String -Path "$OwnerChecks\chronicle-query.json" -Pattern "source-first"
Select-String -Path "$OwnerChecks\chronicle-list.json" -Pattern "source-first"
Select-String -Path "$OwnerChecks\chronicle-log.json" -Pattern '"sensitivity"'
Select-String -Path "$OwnerChecks\chronicle-log.json" -Pattern '"residency"'
```

Expected: JSON parseable; entry has id, labels, workspace/provenance; query/list returns logged entry; no secret labels.

Verdict: PASS / FAIL

## 4. Memory consolidation CLI

Use a deterministic fixture in a temp data dir:

```powershell
$ConData = Join-Path $OwnerChecks "data-consolidation"
$sid = "ses_01M20800000000000000000000"
$sessionDir = Join-Path $ConData "sessions\$sid"
New-Item -ItemType Directory -Force $sessionDir | Out-Null

$fixture = @'
{"v":1,"id":"evt_01M20800000000000000000001","sid":"ses_01M20800000000000000000000","turn":1,"ts":"2026-07-07T00:00:00.000Z","actor":"user","type":"turn.input","provenance":"user","labels":{"sensitivity":"internal","residency":"global-ok"},"payload":{"content":[{"kind":"text","text":"We decided to keep source-first TS execution and avoid dist exports before M5."}]}}
{"v":1,"id":"evt_01M20800000000000000000002","sid":"ses_01M20800000000000000000000","turn":1,"ts":"2026-07-07T00:00:01.000Z","actor":"agent","type":"turn.final","provenance":"agent","labels":{"sensitivity":"internal","residency":"global-ok"},"payload":{"content":[{"kind":"text","text":"Decision recorded: source-first TS execution remains the rule until M5 packaging."}]}}
{"v":1,"id":"evt_01M20800000000000000000003","sid":"ses_01M20800000000000000000000","turn":2,"ts":"2026-07-07T00:00:02.000Z","actor":"user","type":"turn.input","provenance":"user","labels":{"sensitivity":"secret","residency":"local-only"},"payload":{"content":[{"kind":"text","text":"My fake API key is sk_test_1234567890abcdef"}]}}
'@

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $sessionDir "log.jsonl"), $fixture.Trim() + "`n", $utf8NoBom)

node scripts/run-cli.mjs memory consolidate --from $sid --data-dir "$ConData" --json |
  Out-File -Encoding utf8 "$OwnerChecks\consolidate.json"

node scripts/run-cli.mjs memory report --data-dir "$ConData" --json |
  Out-File -Encoding utf8 "$OwnerChecks\memory-report.json"
```

Parse checks:

```powershell
Get-Content "$OwnerChecks\consolidate.json" -Raw | ConvertFrom-Json | Out-Null
Get-Content "$OwnerChecks\memory-report.json" -Raw | ConvertFrom-Json | Out-Null
```

Expected checks:

```powershell
Select-String -Path "$OwnerChecks\consolidate.json" -Pattern "artifact"
Select-String -Path "$OwnerChecks\memory-report.json" -Pattern "source-first"
Select-String -Path "$OwnerChecks\memory-report.json" -Pattern "REDACTED"
Select-String -Path "$OwnerChecks\memory-report.json" -Pattern "sk_test"
Select-String -Path "$OwnerChecks\memory-report.json" -Pattern "pending"
```

PASS criteria:

- JSON parseable.
- Report artifact ref visible.
- Provenance quotes visible for non-secret content.
- Raw fake key `sk_test_1234567890abcdef` does not appear.
- Redaction receipt appears.
- Learned-skill draft, if created, is pending only.
- No active learned skill is created.

Verdict: PASS / FAIL

## 5. Focused package tests

Optional:

```powershell
pnpm --filter @fairy/memory test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\memory-package.txt"

pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-chronicle-memory.txt"

pnpm --filter @fairy/tools-std test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\tools-chronicle.txt"
```

Verdict: PASS / N/A / FAIL

## 6. Optional full acceptance tail

Optional if GitHub Actions is already green:

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

Verdict: PASS / N/A / FAIL

## 7. Owner summary

Create:

```powershell
notepad "$OwnerChecks\M2-08-owner-checks.md"
```

Template:

```markdown
# M2-08 Owner Manual Checks

Date: 2026-07-07
Repo: Maxwell-00/OpenFairy
Implementation commit: 5f3ef12
Owner evidence commit: <fill after commit>
GitHub Actions: GREEN on ubuntu + windows

## 1. Chronicle / dream-cycle suites

Evidence:

- `tasks/owner-checks/M2-08/testing-chronicle.txt`
- `tasks/owner-checks/M2-08/dream-cycle-consolidation.txt`

Observed:

- chronicle.workspace-v0 present and PASS: YES / NO
- dream-cycle.consolidation-v0 present and PASS: YES / NO
- existing M2 suites still PASS: YES / NO
- test summary green: YES / NO

Verdict: PASS / FAIL

## 2. Chronicle CLI

Evidence:

- `tasks/owner-checks/M2-08/chronicle-log.json`
- `tasks/owner-checks/M2-08/chronicle-query.json`
- `tasks/owner-checks/M2-08/chronicle-list.json`

Observed:

- JSON parseable: YES / NO
- entry has id/labels/workspace/provenance: YES / NO
- query/list returns logged entry: YES / NO
- no secret labels: YES / NO

Verdict: PASS / FAIL

## 3. Consolidation CLI

Evidence:

- `tasks/owner-checks/M2-08/consolidate.json`
- `tasks/owner-checks/M2-08/memory-report.json`

Observed:

- JSON parseable: YES / NO
- report artifact ref visible: YES / NO
- non-secret provenance quote visible: YES / NO
- raw fake key absent: YES / NO
- redaction receipt visible: YES / NO
- learned skill remains pending only: YES / NO

Verdict: PASS / FAIL

## 4. Overall

M2-08 owner manual checks: PASS / FAIL

Notes:

- Evidence is deterministic fixture/mock evidence.
- No real API key was used.
- No real provider was required.
- No docs/docs-zh edits are part of owner evidence.
```

## 8. Commit evidence

```powershell
git add tasks\owner-checks\M2-08
git commit -m "M2-08 owner checks"
git push
```
