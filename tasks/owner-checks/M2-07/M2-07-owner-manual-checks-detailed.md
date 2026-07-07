# M2-07 Owner Manual Checks — Detailed Procedure

Date: 2026-07-07  
Repo: Maxwell-00/OpenFairy  
Implementation commit: `dd3b0a6`  
GitHub Actions: `28861229375` GREEN on ubuntu + windows  
Evidence type: deterministic fixture/mock evidence. No real provider key is required.

> Purpose: verify M2-07 context L4/L5 compaction from committed code and deterministic fixtures.  
> This is not a live-provider check. It validates named suites, compaction regression behavior, replay visibility, and governance-after-compaction through tests and saved outputs.

---

## 0. Setup

Open PowerShell in the repo root:

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy

$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-07"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null

git rev-parse --short HEAD
```

Expected for implementation baseline:

```text
dd3b0a6
```

If the current commit is newer because this evidence or review file was committed later, record both:

```text
Implementation commit: dd3b0a6
Owner evidence commit: <new commit after evidence is committed>
```

Optional cleanup before rerun:

```powershell
Remove-Item "$OwnerChecks\*.txt" -ErrorAction SilentlyContinue
Remove-Item "$OwnerChecks\*.jsonl" -ErrorAction SilentlyContinue
Remove-Item "$OwnerChecks\*.json" -ErrorAction SilentlyContinue
```

---

## 1. Full `@fairy/testing` suite visibility

This is the primary owner evidence for M2-07. It verifies that `context.compaction-regression` appears and that all existing M2 named suites still pass.

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-compaction.txt"
```

Expected in the saved output:

- `context.compaction-regression`
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
- final Vitest summary is green.

Check:

```powershell
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "memory.leakage"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "memory.deletion-permanence"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "research.citation-precision"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "research.zh-en-parity"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "injection.research-v0"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "label.conformance"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "governance.friction-canary"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "persona.consistency"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "substance.invariance"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "perception.quarantine-v0"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\testing-compaction.txt" -Pattern "Tests"
```

PASS criteria:

- all required suite names appear;
- final summary has no failed test file;
- `memory.canary` may still be skipped if it remains explicitly deferred.

Verdict: PASS

---

## 2. Focused compaction regression run

This narrows the output to the M2-07 suite. It is useful when the full `@fairy/testing` log is long.

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "context.compaction-regression" 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\focused-compaction-regression.txt"
```

Expected:

- focused run includes `context.compaction-regression`;
- final summary is green;
- tests cover L4/L5 task carry-over, refs surviving compaction, failed tool/error preservation, labels and route-gating, quarantine no-laundering, and replay visibility.

Checks:

```powershell
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "context.compaction-regression"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "Tests"
```

Optional helpful checks, depending on exact test names/output:

```powershell
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "L4"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "L5"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "quarantine"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "personal"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "local-only"
Select-String -Path "$OwnerChecks\focused-compaction-regression.txt" -Pattern "denied"
```

Notes:

- The optional checks may not all match if the test names are phrased differently.
- The decisive evidence is the focused suite name and a green Vitest summary.

Verdict: PASS / FAIL

---

## 3. CLI / replay tests

This verifies replay surfaces: `session.compacted`, compaction artifact rendering, manifest stages, JSON preservation, and corrupt-tail tolerance.

Run:

```powershell
pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-replay-compaction.txt"
```

Expected:

- replay tests pass;
- corrupt-tail replay tolerance remains green;
- text replay renders compaction-related events compactly;
- JSON replay preserves payloads.

Checks:

```powershell
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "replay"
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "session.compacted"
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "artifact.created"
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "corrupt"
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\cli-replay-compaction.txt" -Pattern "Tests"
```

PASS criteria:

- CLI test summary is green;
- replay coverage remains green;
- no corrupt-tail regression.

Verdict: PASS / FAIL

---

## 4. Kernel / context / compaction unit tests

This verifies kernel-level compaction policy, request shape, validation, L4/L5 projections, config wiring, and context invariants.

Run:

```powershell
pnpm --filter @fairy/kernel test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\kernel-compaction.txt"
```

Expected:

- compaction request shape tests pass;
- invalid/missing compactor output fail-closed tests pass;
- L4/L5 trigger/projection tests pass;
- labels/provenance inheritance tests pass;
- context manifest remains observational;
- persona/affect prefix-stability regression remains green.

Checks:

```powershell
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "compaction"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "context"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "L4"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "L5"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "manifest"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\kernel-compaction.txt" -Pattern "Tests"
```

PASS criteria:

- kernel test summary is green;
- no failed unit test;
- no new failure in context/persona/affect tests.

Verdict: PASS / FAIL

---

## 5. Config validation tests

This checks the new minimal context config surface:

```yaml
context:
  l4_placeholder_threshold
  l4_target_tokens
  l5_target_tokens
  compaction_role
```

Run:

```powershell
pnpm --filter @fairy/config test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\config-compaction.txt"
```

Expected:

- defaults validate;
- custom valid config validates;
- invalid values fail validation;
- no invented label/residency values.

Checks:

```powershell
Select-String -Path "$OwnerChecks\config-compaction.txt" -Pattern "context"
Select-String -Path "$OwnerChecks\config-compaction.txt" -Pattern "compaction"
Select-String -Path "$OwnerChecks\config-compaction.txt" -Pattern "invalid"
Select-String -Path "$OwnerChecks\config-compaction.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\config-compaction.txt" -Pattern "Tests"
```

PASS criteria:

- config test summary is green.

Verdict: PASS / FAIL

---

## 6. Protocol / conformance checks

This verifies schema/fixture changes, especially if `session.compacted` or compaction artifact payloads were touched.

Run protocol tests:

```powershell
pnpm --filter @fairy/protocol test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\protocol-compaction.txt"
```

Run conformance:

```powershell
pnpm conformance 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\conformance.txt"
```

Expected:

- protocol fixture/schema tests pass;
- mock conformance passes;
- no new unregistered event type.

Checks:

```powershell
Select-String -Path "$OwnerChecks\protocol-compaction.txt" -Pattern "session.compacted"
Select-String -Path "$OwnerChecks\protocol-compaction.txt" -Pattern "artifact.created"
Select-String -Path "$OwnerChecks\protocol-compaction.txt" -Pattern "Test Files"
Select-String -Path "$OwnerChecks\protocol-compaction.txt" -Pattern "Tests"

Select-String -Path "$OwnerChecks\conformance.txt" -Pattern "PASS"
Select-String -Path "$OwnerChecks\conformance.txt" -Pattern "18/18"
Select-String -Path "$OwnerChecks\conformance.txt" -Pattern '"ok":true'
```

PASS criteria:

- protocol tests green;
- conformance reports all cases pass.

Verdict: PASS / FAIL

---

## 7. Full acceptance tail

This step is optional if GitHub Actions is already green, but recommended for a complete local evidence bundle.

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
  Tee-Object -FilePath "$OwnerChecks\conformance-full.txt"

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
- diff-check empty or no errors;
- docs-diff empty.

Checks:

```powershell
Get-Content "$OwnerChecks\docs-diff.txt"
Get-Content "$OwnerChecks\diff-check.txt"
Select-String -Path "$OwnerChecks\lint.txt" -Pattern "eslint|encoding|PASS|Done|error"
Select-String -Path "$OwnerChecks\dep-check.txt" -Pattern "no dependency violations|error"
Select-String -Path "$OwnerChecks\conformance-full.txt" -Pattern "PASS|ok"
```

PASS criteria:

- no command exits failed;
- GitHub Actions for the same commit is green.

Verdict: PASS / N/A / FAIL

---

## 8. Optional direct replay artifact files

The implementation currently has deterministic E2E tests that generate compaction sessions in temp directories. If the test harness exposes stable session IDs or writes fixture logs to `tasks/owner-checks/M2-07/`, save these files:

```text
tasks/owner-checks/M2-07/compaction-replay.jsonl
tasks/owner-checks/M2-07/compaction-manifests.txt
tasks/owner-checks/M2-07/compaction-governance-replay.jsonl
```

If no stable session ID is exposed, do **not** hand-author JSONL. Use the deterministic test logs from sections 1–6 as owner evidence instead.

Direct replay expected if available:

- `context.manifest` shows `L4` and `L5`.
- replay renders `artifact.created` for compaction artifact.
- replay renders `session.compacted` for L5.
- final answer preserves seeded decision and open todo.
- artifact refs survive.
- no JSONL history is rewritten.
- personal/local-only compaction labels deny under-cleared summarizer/main providers.
- quarantined content remains quarantined after compaction.

Suggested checks if the files exist:

```powershell
if (Test-Path "$OwnerChecks\compaction-manifests.txt") {
  Select-String -Path "$OwnerChecks\compaction-manifests.txt" -Pattern "L4"
  Select-String -Path "$OwnerChecks\compaction-manifests.txt" -Pattern "L5"
}

if (Test-Path "$OwnerChecks\compaction-replay.jsonl") {
  Select-String -Path "$OwnerChecks\compaction-replay.jsonl" -Pattern '"type":"session.compacted"'
  Select-String -Path "$OwnerChecks\compaction-replay.jsonl" -Pattern '"type":"artifact.created"'
}

if (Test-Path "$OwnerChecks\compaction-governance-replay.jsonl") {
  Select-String -Path "$OwnerChecks\compaction-governance-replay.jsonl" -Pattern '"denied_candidates"'
  Select-String -Path "$OwnerChecks\compaction-governance-replay.jsonl" -Pattern '"model_trace"'
  Select-String -Path "$OwnerChecks\compaction-governance-replay.jsonl" -Pattern 'personal'
  Select-String -Path "$OwnerChecks\compaction-governance-replay.jsonl" -Pattern 'local-only'
  Select-String -Path "$OwnerChecks\compaction-governance-replay.jsonl" -Pattern 'FAIRY QUARANTINE'
}
```

Verdict: PASS / N/A / FAIL

---

## 9. Owner summary template

Create or update:

```powershell
notepad "$OwnerChecks\M2-07-owner-checks.md"
```

Suggested content:

```markdown
# M2-07 Owner Manual Checks

Date: 2026-07-07
Repo: Maxwell-00/OpenFairy
Implementation commit: dd3b0a6
Owner evidence commit: <fill after commit>
GitHub Actions: GREEN on ubuntu + windows

## 1. Full testing suite visibility

Evidence:

- `tasks/owner-checks/M2-07/testing-compaction.txt`

Observed:

- context.compaction-regression present and PASS: YES / NO
- existing M2 suites still PASS: YES / NO
- test summary green: YES / NO

Verdict: PASS / FAIL

## 2. Focused compaction regression

Evidence:

- `tasks/owner-checks/M2-07/focused-compaction-regression.txt`

Observed:

- focused context.compaction-regression run green: YES / NO
- L4/L5 behavior covered: YES / NO
- quarantine/no-laundering covered: YES / NO
- labels/routing after compaction covered: YES / NO

Verdict: PASS / FAIL

## 3. CLI replay compaction

Evidence:

- `tasks/owner-checks/M2-07/cli-replay-compaction.txt`

Observed:

- replay tests green: YES / NO
- session.compacted rendering covered: YES / NO
- artifact.created rendering covered: YES / NO
- corrupt-tail replay tolerance remains green: YES / NO

Verdict: PASS / FAIL

## 4. Kernel/context/config/protocol checks

Evidence:

- `tasks/owner-checks/M2-07/kernel-compaction.txt`
- `tasks/owner-checks/M2-07/config-compaction.txt`
- `tasks/owner-checks/M2-07/protocol-compaction.txt`
- `tasks/owner-checks/M2-07/conformance.txt`

Observed:

- kernel/context compaction tests green: YES / NO
- config validation tests green: YES / NO
- protocol/conformance green: YES / NO

Verdict: PASS / FAIL

## 5. Optional direct replay evidence

Evidence:

- `tasks/owner-checks/M2-07/compaction-replay.jsonl` or covered by deterministic tests
- `tasks/owner-checks/M2-07/compaction-manifests.txt` or covered by deterministic tests
- `tasks/owner-checks/M2-07/compaction-governance-replay.jsonl` or covered by deterministic tests

Observed:

- direct replay files available: YES / NO
- if NO, deterministic test logs cover the same properties: YES / NO

Verdict: PASS / N/A / FAIL

## Overall

M2-07 owner manual checks: PASS / FAIL

Notes:

- Evidence is deterministic fixture/mock evidence.
- No real API key was used.
- No real provider was required.
- No docs/docs-zh edits are part of owner evidence.
```

---

## 10. Commit evidence

After all relevant evidence is saved:

```powershell
git add tasks\owner-checks\M2-07
git commit -m "M2-07 owner checks"
git push
```

After push:

- wait for GitHub Actions to finish;
- send the commit hash and run link to the reviewer;
- final close review can then be issued.

---

## Quick verdict guide

M2-07 owner checks are sufficient if:

- `context.compaction-regression` is visible and passing;
- existing M2 suites remain green;
- CLI/replay tests for compaction are green;
- kernel/config/protocol tests are green;
- conformance passes;
- GitHub Actions is green;
- no real provider/key was used.

Direct replay JSONL files are useful but not mandatory if deterministic E2E logs prove the same properties.
