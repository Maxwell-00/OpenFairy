# M2-04 Owner Manual Checks

Use this after M2-04 implementation commit `14ae2c5` and GitHub Actions green.

Evidence directory:

```powershell
cd E:\Claude_Projects\Projects\Fairy\OpenFairy
$OwnerChecks = Join-Path (Get-Location) "tasks\owner-checks\M2-04"
New-Item -ItemType Directory -Force $OwnerChecks | Out-Null
```

## 1. Governance / label conformance suite

Command:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\testing-governance.txt"
```

Expected:

- `label.conformance` appears and passes.
- `governance.friction-canary` appears and passes.
- Existing suites still pass:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
- Egress blocking / redaction diagnostics are covered by the suite.
- Route-denied recovery succeeds in the friction canary.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\testing-governance.txt" -Pattern "label.conformance"
Select-String -Path "$OwnerChecks\testing-governance.txt" -Pattern "governance.friction-canary"
Select-String -Path "$OwnerChecks\testing-governance.txt" -Pattern "memory.leakage"
Select-String -Path "$OwnerChecks\testing-governance.txt" -Pattern "injection.research-v0"
Select-String -Path "$OwnerChecks\testing-governance.txt" -Pattern "Tests"
```

Verdict: PASS only if the test summary is green.

## 2. Kernel governance tests

Command:

```powershell
pnpm --filter @fairy/kernel test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\kernel-governance.txt"
```

Expected:

- Egress guard unit coverage passes.
- Redaction / fingerprinting passes.
- OTP near-miss non-match passes.
- Permission context / provenance wiring tests pass.
- Existing kernel tests remain green.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\kernel-governance.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\kernel-governance.txt" -Pattern "redact"
Select-String -Path "$OwnerChecks\kernel-governance.txt" -Pattern "provenance"
Select-String -Path "$OwnerChecks\kernel-governance.txt" -Pattern "Test Files"
```

Verdict: PASS only if the test summary is green.

## 3. Config validation tests

Command:

```powershell
pnpm --filter @fairy/config test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\config-governance.txt"
```

Expected:

- Closed governance profile enum is enforced.
- Invalid profile names fail validation.
- Region-restricted providers without `regions` fail validation.
- `governance.egress.external_tools` / `personal_allowed_tools` config shape is accepted through the existing config loader/schema path.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\config-governance.txt" -Pattern "profile"
Select-String -Path "$OwnerChecks\config-governance.txt" -Pattern "region"
Select-String -Path "$OwnerChecks\config-governance.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\config-governance.txt" -Pattern "Test Files"
```

Verdict: PASS only if the test summary is green.

## 4. CLI audit / replay redaction tests

Command:

```powershell
pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
  Tee-Object -FilePath "$OwnerChecks\cli-audit-replay.txt"
```

Expected:

- `fairy audit --json` is parseable.
- Text audit contains redacted details, not raw fake secret.
- Text replay renders `egress.denied <reason>`.
- Replay text redacts secret-shaped content in diagnostic surfaces.
- Replay JSON preserves source events while diagnostic payloads are redacted.
- Corrupt-tail replay tolerance remains green.

Quick checks:

```powershell
Select-String -Path "$OwnerChecks\cli-audit-replay.txt" -Pattern "audit"
Select-String -Path "$OwnerChecks\cli-audit-replay.txt" -Pattern "replay"
Select-String -Path "$OwnerChecks\cli-audit-replay.txt" -Pattern "egress"
Select-String -Path "$OwnerChecks\cli-audit-replay.txt" -Pattern "Test Files"
```

Verdict: PASS only if the test summary is green.

## 5. Optional full acceptance tail

This is optional but useful if you want a single owner artifact mirroring task acceptance commands.

```powershell
pnpm lint 2>&1 | Tee-Object -FilePath "$OwnerChecks\lint.txt"
pnpm -r typecheck 2>&1 | Tee-Object -FilePath "$OwnerChecks\typecheck.txt"
pnpm -r test 2>&1 | Tee-Object -FilePath "$OwnerChecks\all-tests.txt"
pnpm dep-check 2>&1 | Tee-Object -FilePath "$OwnerChecks\dep-check.txt"
pnpm conformance 2>&1 | Tee-Object -FilePath "$OwnerChecks\conformance.txt"
```

Expected:

- all commands pass;
- conformance mock mode remains 18/18 PASS;
- no real API keys;
- no real web calls.

## 6. Owner summary template

Create:

```powershell
notepad "$OwnerChecks\M2-04-owner-checks.md"
```

Paste and fill:

```markdown
# M2-04 Owner Manual Checks

Date: 2026-07-06
Repo: Maxwell-00/OpenFairy
Commit: 14ae2c5
GitHub Actions: GREEN on ubuntu + windows

## 1. Governance / label conformance suite

Evidence:

- `tasks/owner-checks/M2-04/testing-governance.txt`

Observed:

- label.conformance present and PASS: YES / NO
- governance.friction-canary present and PASS: YES / NO
- memory.leakage still PASS: YES / NO
- memory.deletion-permanence still PASS: YES / NO
- research.citation-precision still PASS: YES / NO
- research.zh-en-parity still PASS: YES / NO
- injection.research-v0 still PASS: YES / NO
- Test summary green: YES / NO

Verdict: PASS / FAIL

## 2. Kernel governance tests

Evidence:

- `tasks/owner-checks/M2-04/kernel-governance.txt`

Observed:

- egress guard coverage: YES / NO
- redaction/fingerprint coverage: YES / NO
- OTP near-miss non-match coverage: YES / NO
- provenance permission context coverage: YES / NO
- Test summary green: YES / NO

Verdict: PASS / FAIL

## 3. Config validation tests

Evidence:

- `tasks/owner-checks/M2-04/config-governance.txt`

Observed:

- closed profile enum validation: YES / NO
- invalid profile rejected: YES / NO
- region-restricted provider without regions rejected: YES / NO
- egress config shape validated through existing loader/schema: YES / NO
- Test summary green: YES / NO

Verdict: PASS / FAIL

## 4. CLI audit / replay redaction tests

Evidence:

- `tasks/owner-checks/M2-04/cli-audit-replay.txt`

Observed:

- audit JSON parseable: YES / NO
- text audit redacts secret diagnostics: YES / NO
- replay text renders egress.denied: YES / NO
- replay JSON preserves source events and redacts diagnostic payloads: YES / NO
- corrupt-tail replay tolerance remains green: YES / NO
- Test summary green: YES / NO

Verdict: PASS / FAIL

## 5. Optional full acceptance tail

Evidence:

- `tasks/owner-checks/M2-04/lint.txt`
- `tasks/owner-checks/M2-04/typecheck.txt`
- `tasks/owner-checks/M2-04/all-tests.txt`
- `tasks/owner-checks/M2-04/dep-check.txt`
- `tasks/owner-checks/M2-04/conformance.txt`

Observed:

- lint: PASS / NOT RUN / FAIL
- typecheck: PASS / NOT RUN / FAIL
- all tests: PASS / NOT RUN / FAIL
- dep-check: PASS / NOT RUN / FAIL
- conformance: PASS / NOT RUN / FAIL

Verdict: PASS / N/A / FAIL

## Overall

M2-04 owner manual checks: PASS / FAIL

Notes:

- Checks were fixture/mock based.
- No real web calls were made.
- No real API keys were used.
- No `docs/` or `docs-zh/` edits are part of owner evidence.
```

## 7. Commit owner evidence

After filling the summary:

```powershell
git add tasks\owner-checks\M2-04
git commit -m "M2-04 owner checks"
git push
```
