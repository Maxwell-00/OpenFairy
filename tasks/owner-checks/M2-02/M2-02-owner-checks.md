# M2-02 Owner Manual Checks

Date: 2026-07-06
Repo: Maxwell-00/OpenFairy
Commit: ea19a3a
CI: PENDING / GREEN
Note: Manual checks were run against committed M2-02 code. Final close still requires GitHub Actions green on ubuntu + windows.

## 1. Safe memory persists and recalls

Config:

- `tasks/owner-checks/M2-02/m2-02-ollama.yaml`

Sessions:

- remember: `ses_01KWTG56BHBM60ZEW2VVXF3QCV`
- recall: `ses_01KWTGA4WN2GWSCZ66BCMWX7SJ`

Evidence:

- `tasks/owner-checks/M2-02/safe-remember-replay.jsonl`
- `tasks/owner-checks/M2-02/safe-recall-replay.jsonl`
- `tasks/owner-checks/M2-02/safe-memory-list.json`
- `tasks/owner-checks/M2-02/safe-memory-search-before-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-show.json`

Observed:

- admission memory.gate.decision allow: YES
- memory.written present: YES
- retrieval memory.gate.decision allow: YES
- context.manifest memory zone non-zero: YES
- final answer used remembered shell: YES
- MemoryStore row retrievable: YES
- show includes provenance/evidence episode: YES

Verdict: PASS

## 2. Fake secret is not persisted or recalled

Session:

- `ses_01KWTGZKX6WMN40TFZETDQ77GD`

Evidence:

- `tasks/owner-checks/M2-02/secret-remember-replay.jsonl`
- `tasks/owner-checks/M2-02/secret-memory-search.json`

Observed:

- admission memory.gate.decision deny: YES / NO
- reason secret_denied: YES / NO
- memory.written absent: YES / NO
- MemoryStore search for sk_test empty: YES / NO
- fake key not recalled later: YES / NO

Verdict: PASS / FAIL

## 3. Retrieval gate / under-cleared primary / local fallback

Config:

- `tasks/owner-checks/M2-02/m2-02-fallback.yaml`

Seeded memory:

- `mem_local_private_shell`
- labels: personal/local-only

Session:

- `ses_01KWTJMH2VRSH2G435YFXHY87V`

Evidence:

- `tasks/owner-checks/M2-02/route-gate-memory-search.json`
- `tasks/owner-checks/M2-02/route-gate-replay.jsonl`

Observed:

- seeded memory rebuilt into MemoryStore: YES
- retrieval decision allow for local-capable route chain: YES
- cloud-under-cleared denied before request: YES
- no ECONNREFUSED/provider error from cloud-under-cleared: YES
- denied_candidates visible: YES
- local fallback used: YES 
- denied memory text not sent to under-cleared primary: YES

Verdict: PASS

## 4. CLI memory verbs and delete/rebuild permanence

Memory id:

- `<memId>`

Evidence:

- `tasks/owner-checks/M2-02/safe-memory-list-before-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-search-before-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-show.json`
- `tasks/owner-checks/M2-02/safe-memory-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-rebuild-after-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-search-after-delete.json`
- `tasks/owner-checks/M2-02/safe-remember-after-delete-replay.jsonl`

Observed:

- list JSON parseable: YES / NO
- search JSON parseable: YES / NO
- show JSON parseable: YES / NO
- show includes provenance/evidence: YES / NO
- delete emits memory.deleted: YES / NO
- rebuild succeeds after delete: YES / NO
- search after rebuild does not resurrect deleted memory: YES / NO

Verdict: PASS / FAIL

## 5. Replay evidence

Observed:

- admission/retrieval memory.gate.decision visible: YES / NO
- memory.written visible for safe memory: YES / NO
- memory.deleted visible after delete: YES / NO
- retrieval-denied / route-denied events do not leak denied memory text: YES / NO
- replay JSONL parses cleanly: YES / NO

Verdict: PASS / FAIL

## Overall

M2-02 owner manual checks: PASS / FAIL

Remaining blocker:

- GitHub Actions windows-latest Test step must be green before M2-02 final acceptance.