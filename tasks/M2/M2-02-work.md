# M2-02 Work Report

## 1. File Tree Delta

Added:

- `apps/cli/src/memory.ts`
- `apps/cli/test/memory.test.ts`
- `packages/testing/test/memory.canary.test.ts`
- `packages/testing/test/memory.deletion-permanence.test.ts`
- `packages/testing/test/memory.leakage.test.ts`
- `tasks/M2-02-work.md`

Modified:

- `apps/cli/package.json`
- `apps/cli/src/bin/fairy.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/replay.ts`
- `apps/cli/test/replay.test.ts`
- `apps/gateway/package.json`
- `apps/gateway/src/config.ts`
- `apps/gateway/src/server.ts`
- `packages/config/defaults.yaml`
- `packages/config/src/schema.ts`
- `packages/kernel/src/context.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/test/context.test.ts`
- `packages/memory/src/index.ts`
- `packages/memory/test/index.test.ts`
- `packages/model-gateway/src/gateway.ts`
- `packages/model-gateway/src/index.ts`
- `packages/model-gateway/src/types.ts`
- `packages/protocol/fixtures/memory.gate.decision.valid.json`
- `packages/protocol/fixtures/memory.written.valid.json`
- `packages/protocol/schemas/memory.gate.decision.v1.json`
- `packages/testing/package.json`
- `packages/testing/test/gateway.e2e.test.ts`
- `pnpm-lock.yaml`

## 2. Verification Tails

Local commands:

- `pnpm install` PASS, lockfile already up to date.
- `pnpm lint` PASS, `eslint . --max-warnings=0`.
- `pnpm -r typecheck` PASS, all 12 runnable workspace projects passed.
- `pnpm -r test` PASS, including verbose `packages/testing` output with `memory.deletion-permanence`, `memory.leakage`, and skipped deferred `memory.canary`.
- `pnpm dep-check` PASS, no dependency violations across 79 modules / 185 dependencies.
- `pnpm conformance` PASS, mock conformance `ok: true`, all 18 cases passed.

CI status:

- Not run locally from GitHub Actions in this task.

Mock conformance verdict:

- Mode: `mock`
- Verdict: PASS
- Notable cases: streaming text deltas, fragmented tool args, malformed JSON tool args, reasoning fields, usage missing estimated, retry classification, stream stall watchdog, function-name charset rejection, wire-name codec round-trip.

## 3. Decisions

MemoryStore schema:

- `packages/memory` now owns `MemoryStore`, backed by `core.db`.
- Tables: `memory_records`, `memory_tombstones`, optional `memory_records_fts`.
- Records store semantic text, kind, labels, scope, provenance, confidence, validity timestamps, supersession, and use counts.
- `secret` records are rejected at projection insert time even if an upstream gate is bypassed.
- No vector, embedding, sqlite-vec, LanceDB, external memory service, or provider SDK dependency was added.

Rebuild semantics:

- Session JSONL remains source of truth.
- `memory.written`, `memory.deleted`, and `memory.superseded` rebuild projection state.
- Deletes hard-remove projection rows and create tombstones so rebuild does not resurrect them.
- Repeated equivalent `memory.written` events dedupe by normalized text/kind/scope instead of creating unbounded rows.
- Rebuild tolerates a corrupt final JSONL tail line while still throwing on corrupt middle lines.

Retrieval scoring and gating:

- Search uses FTS5 when available, with deterministic lexical fallback.
- Scoring is lexical overlap plus recency/use/kind weight, but zero lexical hits score `0` for non-empty queries.
- Retrieval gate reason codes implemented: `admit`, `below_relevance_floor`, `deleted_or_superseded`, `label_clearance_denied`, `scope_mismatch`.
- Retrieval audit events use `memory.gate.decision` with `phase: "retrieval"` and never include denied memory text.
- Route clearance is checked with `ModelGateway.canRoute` before digest assembly; admitted memory can raise effective labels and force local fallback.

Digest budget and rendering:

- Config key: `context.memory_digest_budget`, default `600`.
- Digest renders compact bullets with memory id, kind, confidence marker, text, and provenance pointer.
- Digest labels participate in prompt effective labels before model routing.
- `context.manifest` reports non-zero memory zone tokens when digest is present and never enters prompt content.

CLI command shapes:

- `pnpm fairy memory list [--json]`
- `pnpm fairy memory search <query> [--json]`
- `pnpm fairy memory show <id> [--json]`
- `pnpm fairy memory delete <id> [--json]`
- `pnpm fairy memory rebuild [--json]`
- Delete appends `memory.deleted` to source JSONL, handles logs without trailing newline, removes projection row, and rebuild keeps it deleted.

## 4. Spec Ambiguities

- Retrieval gate timing says a memory may be admitted only after a cleared route is selected. Implementation checks the role candidate chain before assembly; if a later cleared fallback exists, the digest is admitted, then normal routing skips the under-cleared primary and selects fallback.
- CLI evidence/search has no provider route. M2-02 treats CLI as trusted local channel and passes retrieval gate with local caller clearance; future specs may want explicit CLI clearance flags.
- `memory.canary` is registered as a skipped, loudly failing stub because 100-fact precision requires consolidation/dream-cycle work outside this slice.
- FTS5 is optional under `node:sqlite`; deterministic lexical scan remains the fallback path.

## 5. Proposed Docs Edits

`docs/specs/memory.md`:

- Add MemoryStore v1 as a rebuildable local SQLite projection over session JSONL, not a second source of truth.
- Document `memory_records` and tombstone semantics at conceptual level.
- Add retrieval gate phase `retrieval` and reason codes: `admit`, `below_relevance_floor`, `deleted_or_superseded`, `label_clearance_denied`, `scope_mismatch`.
- Document compact digest bullet shape and provenance pointer.
- Add CLI verbs: `memory list/search/show/delete/rebuild`.
- Note vector retrieval remains deferred to the later vector decision gate.

`docs/specs/context-engine.md`:

- Zone 4 memory digest is now populated only by gate-admitted records.
- Effective labels include admitted memory digest labels before route clearance.
- Register `context.memory_digest_budget` with default `600`.

`docs/specs/protocol.md`:

- Add `memory.gate.decision.payload.phase: "admission" | "retrieval"`.
- State retrieval denials include reason and memory id but not denied personal/secret text.
- Clarify `memory.deleted` tombstone payload must include `memory_id` and reason sufficient for rebuild permanence.

`docs/specs/data-governance.md`:

- Mark memory retrieval as an enforcement point.
- State admitted memory labels join with request labels before model route clearance.
- State under-cleared routes must deny retrieval silently to the model and audit via `memory.gate.decision`.

## 6. Manual Owner Checklist

Safe memory persists and recalls:

```powershell
pnpm fairy memory rebuild --json
pnpm fairy memory list --json
pnpm fairy replay <session-id> --json
```

Expected evidence:

- `memory.gate.decision` with `phase="admission"` and `decision="allow"`.
- `memory.written`.
- Later `memory.gate.decision` with `phase="retrieval"` and `decision="allow"`.
- `context.manifest` memory zone tokens greater than zero.

Fake secret is not persisted:

```powershell
pnpm fairy memory search sk_test --json
pnpm fairy replay <session-id> --json
```

Expected evidence:

- Admission deny with `reason="secret_denied"`.
- No `memory.written`.
- No MemoryStore row.

Retrieval gate blocks under-cleared provider:

```powershell
pnpm fairy replay <session-id> --json
```

Expected evidence:

- Retrieval `memory.gate.decision` denial with `reason="label_clearance_denied"`.
- Denial payload contains memory id/reason/score but not denied text.
- Under-cleared provider prompt contains no denied memory text.

CLI verbs:

```powershell
pnpm fairy memory list --json
pnpm fairy memory search shell --json
pnpm fairy memory show <memory-id> --json
pnpm fairy memory delete <memory-id> --json
pnpm fairy memory rebuild --json
pnpm fairy memory search shell --json
```

Expected evidence:

- JSON parses for list/search/show/delete/rebuild.
- `show` includes provenance and episode slice for allowed evidence.
- Delete removes row and rebuild does not resurrect it.
