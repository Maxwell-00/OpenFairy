# M2-08 Work Report: Chronicle and Dream-Cycle Consolidation

## File Tree Delta

- `packages/memory/src/chronicle.ts` adds the workspace-local append-only Chronicle store, deterministic workspace ids, record ids, query scoring, digest rendering, and secret/personal admission policy errors.
- `packages/memory/src/consolidation.ts` adds deterministic hand-triggered consolidation v0 over session JSONL logs, memory records, report artifact creation, redaction receipts, contradiction suggestions, Chronicle candidates, and pending learned-skill drafts.
- `packages/memory/src/index.ts` exports Chronicle/consolidation APIs and extends `MemoryStore.evidence()` with Chronicle refs and memory report artifact refs.
- `packages/tools-std/src/index.ts` adds `chronicle.log` and `chronicle.query` tools using the existing TurnRunner tool loop and `tool:chronicle.*` provenance.
- `apps/cli/src/chronicle.ts`, `apps/cli/src/index.ts`, and `apps/cli/src/bin/fairy.ts` add `fairy chronicle log/query/list/show`.
- `apps/cli/src/memory.ts` adds `memory evidence`, `memory consolidate`, and `memory report`.
- `packages/kernel/src/context.ts` and `packages/kernel/src/index.ts` add bounded Chronicle digest injection through the memory zone, with label participation in effective prompt labels.
- `apps/gateway/src/config.ts` and `apps/gateway/src/server.ts` wire Chronicle store, Chronicle digest budget, tool registry data dir, and existing governance label escalation into the gateway.
- `packages/config/defaults.yaml`, `packages/config/src/schema.ts`, and `packages/config/test/loader.test.ts` add minimal `chronicle` and `memory.consolidation` config validation.
- Tests were added or expanded in `packages/memory/test/index.test.ts`, `packages/tools-std/test/index.test.ts`, `packages/kernel/test/index.test.ts`, `apps/cli/test/chronicle.test.ts`, `apps/cli/test/memory.test.ts`, and `packages/testing/test/gateway.e2e.test.ts`.

## Verification Tails

- Dependency install:
  - `pnpm install --offline --config.confirmModulesPurge=false`: already up to date.
- `pnpm lint` and `pnpm -r typecheck` were attempted with offline/verify-disabled config but failed before code execution because `node_modules/.bin` shims are missing in this local environment (`eslint`/`tsc` not recognized). Equivalent direct package entry checks below passed.
- Direct lint checks:
  - `node scripts\check-encoding.mjs`: `Encoding guard passed (227 files scanned)`.
  - `node node_modules\eslint\bin\eslint.js . --max-warnings=0`: passed.
- Direct typecheck checks:
  - `node node_modules\typescript\bin\tsc -p packages/channels/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/config/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/kernel/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/model-gateway/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/orchestrator/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/perception/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/protocol/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/research/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/memory/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/testing/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p packages/tools-std/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p apps/gateway/tsconfig.json --noEmit`
  - `node node_modules\typescript\bin\tsc -p apps/cli/tsconfig.json --noEmit`
- Focused and package test checks:
  - `node node_modules\vitest\vitest.mjs run apps\cli\test\chronicle.test.ts --reporter=verbose`
  - `node node_modules\vitest\vitest.mjs run apps\cli\test\memory.test.ts --reporter=verbose`
  - `node node_modules\vitest\vitest.mjs run packages\memory\test\index.test.ts --reporter=verbose`
  - `node node_modules\vitest\vitest.mjs run packages\tools-std\test\index.test.ts --reporter=verbose`
  - `node node_modules\vitest\vitest.mjs run packages\kernel\test\index.test.ts --reporter=verbose`
  - `node node_modules\vitest\vitest.mjs run packages\testing\test\gateway.e2e.test.ts --reporter=verbose -t "chronicle.workspace-v0|dream-cycle.consolidation-v0|context.compaction-regression"`
  - From `packages/testing`: `node ..\..\node_modules\vitest\vitest.mjs run --reporter=verbose`
- Full test sweep:
  - Root-level `node node_modules\vitest\vitest.mjs run --reporter=verbose` ran all tests and reported `306 passed | 4 skipped`, with one environment-only failure in `packages/kernel/test/provider-guard.test.ts` because root-level direct Vitest set `process.cwd()` to a sandbox cwd instead of the package cwd.
  - The same provider guard was rerun from `packages/kernel` with `node ..\..\node_modules\vitest\vitest.mjs run test\provider-guard.test.ts --reporter=verbose`: 1 passed.
- Architecture/conformance:
  - `node node_modules\dependency-cruiser\bin\dependency-cruise.mjs --config .dependency-cruiser.cjs packages apps`: `no dependency violations found (98 modules, 293 dependencies cruised)`.
  - `pnpm --config.offline=true --config.verifyDepsBeforeRun=false conformance`: mock mode all 18 cases PASS, `ok:true`.
- Diff hygiene:
  - `git diff --check`: passed.
  - `git diff --name-only -- docs docs-zh`: no output.
- Focused verdicts:
  - `apps/cli/test/chronicle.test.ts`: 1 passed.
  - `apps/cli/test/memory.test.ts`: 1 passed.
  - `packages/memory/test/index.test.ts`: 14 passed.
  - `packages/tools-std/test/index.test.ts`: 6 passed, 3 skipped Docker-dependent tests.
  - `packages/kernel/test/index.test.ts`: 14 passed.
  - Focused gateway run: 9 passed, 39 skipped by `-t`; visible suites include `context.compaction-regression`, `chronicle.workspace-v0`, and `dream-cycle.consolidation-v0`.
- `packages/testing` package verdict: 8 passed test files, 1 skipped; 67 passed tests, 1 skipped. The named suites `chronicle.workspace-v0` and `dream-cycle.consolidation-v0` appear and pass in verbose output.
- CI link/status: owner/GitHub run pending.

## Decisions

- Chronicle storage path: `ChronicleStore` writes append-only JSONL at `<dataDir>/chronicle/<workspaceId>/chronicle.jsonl`. The workspace id is a stable hash of the resolved workspace root.
- Chronicle source of truth: append-only Chronicle JSONL records are the source of truth for Chronicle. No session JSONL is rewritten, and no mutable summary table or projection was added.
- Chronicle record shape: records contain `id`, `created_at`, `kind`, `summary`, optional `details`, `labels`, `workspace`, `files`, `topics`, `provenance`, and optional `supersedes`/`related`.
- Chronicle admission: labels default to `internal/global-ok`. `secret` Chronicle writes throw `ChroniclePolicyError` and create no record. `personal` content requires explicit workspace-scoped admission; v1 tools/CLI do not expose automatic personal Chronicle writes.
- Chronicle query/digest scoring: query terms match summaries, details, files, and topics. Failure/fragile-file records receive a small deterministic risk bump, so tests assert ordering/relevance rather than exact singleton results.
- Chronicle digest accounting: relevant digest text is injected through the existing memory zone and counts under `context.manifest.zones[name=memory]`. Its labels join effective prompt labels before route clearance.
- Routing behavior: if a relevant Chronicle digest is `internal/local-only`, under-cleared primary providers receive zero request bytes and a cleared fallback can complete the turn.
- Tool namespace: `chronicle.log` and `chronicle.query` are normal tools with canonical `tool.call`/`tool.result` events and `tool:chronicle.*` provenance.
- Consolidation command shape: `fairy memory consolidate --from <session-or-date> [--to <date>] --json`; latest report is read with `fairy memory report --json`.
- Consolidation model policy: v0 is deterministic only. It reads session JSONL and MemoryStore projection data; it does not call a summarizer, model role, provider, scheduler, or background job.
- Report artifact shape: reports are JSON artifacts under `<dataDir>/artifacts/memory/reports/<reportId>.json`; `latest.json` points to the latest report. A synthetic report session emits the existing `artifact.created` event once per deterministic report id.
- Report hashing: `report.artifact.hash` is a deterministic stable-body hash used inside the report; the emitted `artifact.created.payload.hash` is the actual SHA-256 of the report file bytes.
- Redaction behavior: secret-class event text is dropped from candidate extraction and persisted only as deterministic redaction receipts like `[REDACTED:secret:<hash>]`; raw secret markers do not appear in reports.
- Report labels: report labels derive from included non-redacted content by max sensitivity and residency strictness. Secret content is redacted rather than raising the persisted report to secret.
- Promotion/deletion behavior: consolidation v0 lists candidate memories and contradiction suggestions only. It never emits `memory.written`, `memory.deleted`, or `memory.superseded`.
- Learned-skill gate: repeated-operation drafts are written only under the configured pending directory and carry `status: "pending"`. No active skill is created.
- Evidence pull-through: `MemoryStore.evidence()` remains the single evidence path and now includes Chronicle refs and report artifact refs when allowed by retrieval gates.
- Config shape:
  - `chronicle.enabled`
  - `chronicle.digest_budget`
  - `chronicle.max_results`
  - `chronicle.storage`
  - `memory.consolidation.enabled`
  - `memory.consolidation.learned_skill_pending_dir`

## Spec Ambiguities

- Chronicle append-only records are project/workspace memory and are separate from session JSONL. Session JSONL remains the source of truth for turns and canonical runtime events; Chronicle JSONL is the source of truth for workspace memory records admitted through Chronicle APIs.
- The memory/context manifest has no dedicated Chronicle zone enum. I accounted Chronicle digest under the existing `memory` zone because it behaves like memory retrieval and must participate in the same label derivation and route clearance.
- `artifact.created.payload.hash` can be the actual content hash of the report file, but a report cannot include its own exact content hash without a self-referential fixed point. The report therefore carries a deterministic stable-body hash in `report.artifact.hash`, while the emitted event carries the actual file hash.
- Consolidation v0 creates Chronicle candidates in the report but does not auto-append them to Chronicle. That keeps reviewability and avoids turning deterministic extraction into silent project memory mutation.
- Secret events are listed in `redactions` with hashed redaction markers, not as provenance quotes. This preserves auditability without persisting secret text.

## Proposed Docs Edits

- `docs/specs/memory.md`:
  - Mark Chronicle v1 implemented as workspace-local append-only JSONL under the Fairy data dir.
  - Document Chronicle record shape, secret rejection, personal admission boundary, and query/digest behavior.
  - Mark dream-cycle consolidation v0 as hand-triggered deterministic extraction only.
  - Document report artifact shape, redaction receipts, candidate-only memory promotion, contradiction suggestions, and pending learned-skill drafts.
  - Explicitly state no scheduler/autonomous nightly jobs and no automatic learned-skill activation in this slice.
- `docs/specs/context-engine.md`:
  - Add Chronicle digest as memory-zone context accounting.
  - State Chronicle digest labels join effective prompt labels before route clearance.
  - State under-cleared providers receive zero bytes when Chronicle digest labels exceed clearance.
- `docs/specs/data-governance.md`:
  - Add Chronicle workspace label defaults and no automatic declassification.
  - State `secret` Chronicle entries are denied and personal entries require explicit workspace admission.
  - Add consolidation report label inheritance and redaction retention behavior.
- `docs/specs/evals.md`:
  - Register `chronicle.workspace-v0`.
  - Register `dream-cycle.consolidation-v0`.
  - Keep memory canary/contradiction benchmark deferred unless a later slice implements full consolidation benchmark behavior.
- `docs/specs/protocol.md`:
  - Clarify that Chronicle and dream-cycle v0 reuse existing events: `tool.call`, `tool.result`, `memory.gate.decision`, `artifact.created`, and replay over session JSONL.
  - Note no new canonical event types were introduced for Chronicle or consolidation.

## Manual Owner Checklist

- Create `tasks/owner-checks/M2-08`.
- Run `pnpm --filter @fairy/testing test -- --reporter=verbose`; save as `tasks/owner-checks/M2-08/testing-chronicle.txt`.
- Run `pnpm --filter @fairy/testing test -- --reporter=verbose -t "dream-cycle.consolidation-v0"`; save as `tasks/owner-checks/M2-08/dream-cycle-consolidation.txt`.
- Run:
  - `pnpm fairy chronicle log --kind decision --summary "Use source-first TS execution" --topic m2 --json`
  - `pnpm fairy chronicle query source-first --json`
  - `pnpm fairy chronicle list --json`
- Save outputs as:
  - `tasks/owner-checks/M2-08/chronicle-log.json`
  - `tasks/owner-checks/M2-08/chronicle-query.json`
  - `tasks/owner-checks/M2-08/chronicle-list.json`
- Run the manual consolidation command used in this task shape:
  - `pnpm fairy memory consolidate --from <fixture-session-or-date> --json`
  - `pnpm fairy memory report --json`
- Save outputs as:
  - `tasks/owner-checks/M2-08/consolidate.json`
  - `tasks/owner-checks/M2-08/memory-report.json`
- Expected owner evidence:
  - `chronicle.workspace-v0` and `dream-cycle.consolidation-v0` appear and pass.
  - Chronicle CLI JSON is parseable and contains no secret labels.
  - Consolidation report JSON is parseable, has an `artifact.created` receipt, redacts secret text, creates only pending learned-skill drafts, and is idempotent on repeated runs.
