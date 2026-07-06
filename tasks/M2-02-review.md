# M2-02 Review — MemoryStore v1 + gated retrieval digest + memory CLI verbs

Review date: 2026-07-06

Repo: `Maxwell-00/OpenFairy`

Task brief: `tasks/M2-02-memory-store-retrieval.md`

Codex work report: `tasks/M2-02-work.md`

Reviewed commits:

- Implementation: `ea19a3a` — `M2-02`
- CI fix: `9de76d9` — `Update memory.test.ts`
- Owner evidence: `c82d582` — `M2-02-owner-check`

CI evidence:

- GitHub Actions run `28763629203` / `M2-02-owner-check #36`: Success.
- Matrix: `verify`.
- Jobs: `ubuntu-latest` and `windows-latest`, 2/2 completed.
- Remaining annotations are `pnpm/action-setup@v4` Node runtime warnings only.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-02 is accepted at task level. Owner manual checks passed. GitHub Actions is green on the existing CI matrix. M2 remains open.

## BLOCKER

None.

## CARRY-IN

### 1. Reviewer-owned docs pass still needs to be applied

Codex correctly did not edit `docs/` or `docs-zh/` in the M2-02 task. The following documentation changes should be applied by the reviewer before or alongside the next task brief commit:

- `docs/specs/memory.md`
  - MemoryStore v1 as a rebuildable SQLite projection over session JSONL, not a second source of truth.
  - `memory_records` conceptual schema and tombstone semantics.
  - Retrieval gate phase `retrieval` and reason codes: `admit`, `below_relevance_floor`, `deleted_or_superseded`, `label_clearance_denied`, `scope_mismatch`.
  - Compact memory digest shape and provenance pointer.
  - CLI verbs: `memory list/search/show/delete/rebuild`.
  - Vector retrieval remains deferred to the later vector decision gate.

- `docs/specs/context-engine.md`
  - Zone 4 memory digest is populated only by gate-admitted records.
  - Admitted memory digest labels participate in effective labels before route clearance.
  - Register `context.memory_digest_budget`, default `600`.

- `docs/specs/protocol.md`
  - `memory.gate.decision.payload.phase: "admission" | "retrieval"`.
  - Retrieval denials carry reason and memory id but not denied personal/secret text.
  - `memory.deleted` tombstone payload must contain enough to prevent rebuild resurrection.

- `docs/specs/data-governance.md`
  - Memory retrieval is an enforcement point.
  - Admitted memory labels join with request labels before model route clearance.
  - Under-cleared routes must deny retrieval silently to the model and audit via `memory.gate.decision`.

### 2. Owner evidence hygiene

The raw evidence is sufficient and was independently checked, but `tasks/owner-checks/M2-02/M2-02-owner-checks.md` still contains template residue in several sections:

- `Commit: ea19a3a` rather than the final evidence commit `c82d582`.
- `CI: PENDING / GREEN`.
- Several `YES / NO` and `PASS / FAIL` placeholders.
- An empty memory id field in the CLI/delete section.

This is a NIT, not a runtime blocker. Do not rerun manual checks for this alone.

### 3. Do not commit derived SQLite projections as future owner evidence

The owner evidence commit includes `core.db` files under `tasks/owner-checks/M2-02/data-*`. These are rebuildable projection artifacts, not source-of-truth evidence. Future owner evidence should prefer:

- session `log.jsonl`,
- replay JSONL,
- CLI JSON outputs,
- config YAML,
- owner summary.

Projection DBs are acceptable as incidental evidence here but should not become standard practice.

## NIT

`README.md` still appears to describe the project as design-phase/no implementation. This has been stale since M0/M1. Fix in a reviewer docs pass, not as Codex task scope.

## Acceptance review

| Deliverable | Result | Evidence / notes |
|---|---:|---|
| 0. Preserve M2-01 invariants | PASS | M2-01 route-deny, secret remember deny, safe remember allow/write, provider-special-case guard, and replay visibility remain covered by tests and owner evidence. |
| 1. MemoryStore v1 projection | PASS | `@fairy/memory` now owns `MemoryStore`, backed by local `core.db`; session JSONL remains source of truth; projection rebuilds from `memory.written`, `memory.deleted`, and `memory.superseded`; secret records are rejected at projection insert. |
| 2. Explicit remember writes durable projection | PASS | Safe explicit remember creates `memory.gate.decision phase=admission decision=allow`, `memory.written`, and a retrievable memory row. Fake key remember is denied and creates no row. |
| 3. Retrieval gate v1 | PASS | Retrieval decisions use `memory.gate.decision phase=retrieval`; allow/deny reason codes exist; owner route-gate evidence proves a personal/local-only memory can force under-cleared primary denial and local fallback. |
| 4. Memory digest in context zone | PASS | Safe recall evidence shows non-zero memory zone tokens and final answer uses `pwsh`. Route-gate evidence shows admitted memory raises effective labels to personal/local-only before model routing. |
| 5. Evidence pull-through v0 | PASS | `memory show` returns provenance and episode evidence for allowed records. Evidence is label/scope gated. |
| 6. CLI memory verbs | PASS | `pnpm fairy memory list/search/show/delete/rebuild` implemented; CLI test initially exceeded Vitest default timeout on Windows because of multiple TS CLI spawns, then fixed with explicit 60s test budget and diagnostics without weakening assertions. |
| 7. Replay and audit visibility | PASS | Replay renders/preserves admission/retrieval memory gate decisions, `memory.written`, `memory.deleted`, and route-denied trace. |
| 7b. Named eval suites | PASS | `memory.deletion-permanence` and `memory.leakage` are present and run in `packages/testing`; `memory.canary` exists as deferred stub rather than fake pass. |
| 8. Docs proposals only | PASS | Codex proposed docs edits in `tasks/M2-02-work.md`; no direct docs or docs-zh edits in implementation commit. |

## Boundary review

| Boundary | Result | Notes |
|---|---:|---|
| One TurnRunner | PASS | Research/persona/workflow loops not introduced. Memory retrieval is integrated into existing context assembly path. |
| Event-sourced JSONL source of truth | PASS | `MemoryStore` is a rebuildable projection over events; delete writes tombstone event and rebuild keeps it deleted. |
| Source-first TS workspace | PASS | No dist export/test regression observed. CI green on both OS. |
| Raw HTTP/SSE provider boundary | PASS | No vendor SDK added. |
| Provider quirks only in transport/fixture | PASS | No provider-specific kernel branch found in this task scope. |
| CI secrets | PASS | No real live endpoint required in CI. |
| docs-zh | PASS | No docs-zh changes. |
| No vector/search native dependency | PASS | FTS5 is optional under `node:sqlite`; no sqlite-vec/LanceDB/vector dependency added. |
| Denied memory text must not leak | PASS | `memory.leakage` test asserts denial events do not contain the personal text; owner evidence shows secret search empty and fake key not projected. |

## Owner manual checks

### 1. Safe memory persists and recalls — PASS

Evidence:

- `tasks/owner-checks/M2-02/safe-remember-replay.jsonl`
- `tasks/owner-checks/M2-02/safe-recall-replay.jsonl`
- `tasks/owner-checks/M2-02/safe-memory-list.json`
- `tasks/owner-checks/M2-02/safe-memory-search-before-delete.json`
- `tasks/owner-checks/M2-02/safe-memory-show.json`

Observed:

- admission allow.
- `memory.written` present.
- retrieval allow in recall session.
- `context.manifest` memory zone non-zero.
- final answer used `pwsh`.
- MemoryStore row retrievable and show includes evidence/provenance.

### 2. Fake secret is not persisted — PASS

Evidence:

- `tasks/owner-checks/M2-02/secret-remember-replay.jsonl`
- `tasks/owner-checks/M2-02/secret-memory-search.json`

Observed:

- fake key input escalated to secret/local-only.
- admission gate denied with `secret_denied`.
- no `memory.written`.
- MemoryStore search returned empty memories.

### 3. Retrieval gate / under-cleared primary / local fallback — PASS

Evidence:

- `tasks/owner-checks/M2-02/route-gate-memory-rebuild.json`
- `tasks/owner-checks/M2-02/route-gate-memory-search.json`
- `tasks/owner-checks/M2-02/route-gate-replay.jsonl`

Observed:

- seeded `mem_local_private_shell` rebuilt into MemoryStore.
- retrieval gate admitted it for a route chain with an allowed fallback.
- context effective labels became personal/local-only.
- primary `cloud-under-cleared` denied before provider request.
- final model trace shows denied candidate and `ollama-local` fallback.
- final answer used `pwsh-local`.

### 4. CLI memory verbs and delete/rebuild permanence — PASS

Evidence:

- `safe-memory-delete.json`
- `safe-memory-rebuild-after-delete.json`
- `safe-memory-search-after-delete.json`
- `safe-remember-after-delete-replay.jsonl`

Observed:

- delete emitted a delete event id for `mem_6819e5b1442b5d09d622`.
- rebuild after delete returned `records: 0`, `tombstones: 1`.
- post-delete search returned empty memories.
- replay after delete includes `memory.deleted`.

## Verified / Owner-stated / Not verified

### Verified

- GitHub committed implementation `ea19a3a` contains the expected MemoryStore, context, gateway, CLI, protocol, and testing changes.
- CI timeout fix `9de76d9` is a test-budget/diagnostic fix only; it does not skip Windows or weaken assertions.
- Owner evidence commit `c82d582` contains the M2-02 evidence artifacts.
- Actions run `28763629203` is green with both ubuntu and windows jobs completed.
- Owner replay/search/delete/rebuild evidence proves the required memory behaviors.
- `docs-zh` was not modified.

### Owner-stated

- During manual chat, the under-cleared primary produced no ECONNREFUSED/provider error.
- Ollama local model was available and used for owner checks.

### Not verified

- I did not rerun local tests from a checkout.
- I did not connect to the owner’s Ollama instance.
- I did not packet-capture provider I/O. The “zero request bytes to under-cleared primary” conclusion is inferred from the unreachable primary config, absence of provider error in owner run, progress/trace denial, and local fallback success.

## Final decision

**M2-02 accepted with notes and closed.**

The next task may start after reviewer applies the M2-02 docs pass or at least records the docs pass as an explicit reviewer-owned carry-in.
