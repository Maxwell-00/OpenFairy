# M2-07 Owner Manual Checks

Date: 2026-07-07  
Repo: Maxwell-00/OpenFairy  
Implementation commit: dd3b0a6  
GitHub Actions: 28861229375 GREEN on ubuntu + windows

## Evidence provenance

Deterministic fixture evidence is acceptable for this task. No real provider keys are required. If Codex generates these outputs, label them as Codex-generated deterministic evidence.

## 1. Compaction regression suite

Command:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Save:

```text
tasks/owner-checks/M2-07/testing-compaction.txt
```

Expected:

- `context.compaction-regression` appears and passes.
- Existing M2 suites still pass:
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

Verdict: PASS / FAIL

## 2. Forced L4/L5 replay

Run the deterministic fixture/mock session that forces L4 and L5.

Save:

```text
tasks/owner-checks/M2-07/compaction-replay.jsonl
tasks/owner-checks/M2-07/compaction-manifests.txt
```

Expected:

- `context.manifest` includes `L4` and `L5`.
- Replay renders `artifact.created` for the compaction artifact.
- Replay renders `session.compacted` for L5.
- Final answer preserves seeded decision and open todo.
- Artifact refs survive compaction.
- No historical JSONL turn events are rewritten.

Suggested checks:

```powershell
Select-String -Path tasks/owner-checks/M2-07/compaction-manifests.txt -Pattern "L4"
Select-String -Path tasks/owner-checks/M2-07/compaction-manifests.txt -Pattern "L5"
Select-String -Path tasks/owner-checks/M2-07/compaction-replay.jsonl -Pattern '"type":"session.compacted"'
Select-String -Path tasks/owner-checks/M2-07/compaction-replay.jsonl -Pattern '"type":"artifact.created"'
```

Verdict: PASS / FAIL

## 3. Governance after compaction

Run the fixture with personal/local-only content before compaction.

Save:

```text
tasks/owner-checks/M2-07/compaction-governance-replay.jsonl
```

Expected:

- Compaction summary/handoff labels are `personal/local-only`.
- The compaction call itself did not reach an under-cleared summarizer.
- Under-cleared summarizer request count is zero, or fail-closed skip is visibly recorded.
- Under-cleared main provider receives zero provider request bytes after compaction.
- Cleared fallback completes.
- `model_trace.denied_candidates` is visible.
- Quarantined research/OCR/perception text is not laundered into ordinary instruction text.

Suggested checks:

```powershell
Select-String -Path tasks/owner-checks/M2-07/compaction-governance-replay.jsonl -Pattern '"denied_candidates"'
Select-String -Path tasks/owner-checks/M2-07/compaction-governance-replay.jsonl -Pattern '"model_trace"'
Select-String -Path tasks/owner-checks/M2-07/compaction-governance-replay.jsonl -Pattern 'personal'
Select-String -Path tasks/owner-checks/M2-07/compaction-governance-replay.jsonl -Pattern 'local-only'
Select-String -Path tasks/owner-checks/M2-07/compaction-governance-replay.jsonl -Pattern 'FAIRY QUARANTINE'
```

Verdict: PASS / FAIL

## 4. Overall

M2-07 owner manual checks: PASS / FAIL

Notes:

- No real API keys used.
- No real provider required.
- No real web/OCR/perception provider required.
- Evidence is deterministic fixture/mock evidence.
