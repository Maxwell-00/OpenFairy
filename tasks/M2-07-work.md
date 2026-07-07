# M2-07 Work Report: Context Compaction

## File Tree Delta

- `packages/kernel/src/compaction.ts` adds the kernel-owned L4/L5 compaction policy, bounded request builder, structured output validators, projections, and prompt renderers.
- `packages/kernel/src/context.ts` preserves pinned compaction projections across later L2/L3 passes and exposes pre-applied reduction stages/compaction refs in manifests.
- `packages/kernel/src/index.ts` routes compaction through the existing `modelGateway.generate("summarizer", ...)` path, emits existing `artifact.created`, `session.compacted`, `progress.update`, and `route.denied` events, and fails closed on invalid/missing compactor output.
- `packages/model-gateway/src/types.ts` adds optional chat-message metadata used only before provider serialization: `event_id`, `provenance`, and `pinned`.
- `apps/gateway/src/config.ts`, `packages/config/src/schema.ts`, and `packages/config/defaults.yaml` add the minimal `context` compaction config surface.
- `apps/gateway/src/server.ts` preserves event ids/provenance in recovered history metadata.
- `apps/cli/src/replay.ts` renders `session.compacted` compactly.
- Tests updated in `packages/kernel/test/context.test.ts`, `packages/config/test/loader.test.ts`, `apps/cli/test/replay.test.ts`, and `packages/testing/test/gateway.e2e.test.ts`.

## Verification Tails

- Local focused checks run:
  - `pnpm install --offline --trust-lockfile --config.confirmModulesPurge=false`
  - `node_modules\.bin\tsc.CMD -p packages/kernel/tsconfig.json --noEmit`
  - `node_modules\.bin\tsc.CMD -p apps/gateway/tsconfig.json --noEmit`
  - `node_modules\.bin\tsc.CMD -p apps/cli/tsconfig.json --noEmit`
  - `node_modules\.bin\tsc.CMD -p packages/config/tsconfig.json --noEmit`
  - `node_modules\.bin\tsc.CMD -p packages/testing/tsconfig.json --noEmit`
  - `node_modules\.bin\vitest.CMD run packages/kernel/test/context.test.ts --reporter=verbose`
  - `node_modules\.bin\vitest.CMD run packages/config/test/loader.test.ts --reporter=verbose`
  - `node_modules\.bin\vitest.CMD run apps/cli/test/replay.test.ts --reporter=verbose`
  - `node_modules\.bin\vitest.CMD run packages/testing/test/gateway.e2e.test.ts --reporter=verbose -t "context.compaction-regression"`
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `pnpm dep-check`
  - `pnpm conformance`
  - `git diff --check`
  - `git diff --name-only -- docs docs-zh`
  - `pnpm --filter @fairy/testing test -- --reporter=verbose`
- `context.compaction-regression` is visible in verbose output and passes.
- `pnpm lint` included `Encoding guard passed`.
- `pnpm conformance` returned mock mode `ok: true`.
- `git diff --name-only -- docs docs-zh` had no output.

## Decisions

- L4 trigger policy: run after the existing L1-L3 projection still exceeds prompt budget, or after accumulated L2/L3 placeholders exceed `context.l4_placeholder_threshold`.
- L5 trigger policy: run only after successful L4 when the L4-projected prompt still exceeds budget.
- Model path: compaction calls the configured `context.compaction_role`, default `summarizer`, through the existing model gateway. Unknown role, route denial, provider error, tool-call output, empty output, or invalid JSON all fail closed.
- Request shape: strict bounded JSON with source turn range, available source event ids, labels, provenance summary, refs, failed tool summaries, recent verbatim tail, current task preview, and target token budget. Secret text and base64/blob-like content are omitted from request previews.
- Output shape: L4 accepts `l4_micro_summary`; L5 accepts `l5_handoff` with state, decisions, todos, grants, refs, failed tools, recent verbatim tail, and untrusted-data refs.
- Event/artifact shape: both L4 and L5 write `artifact.created` with `kind=context.compaction.l4/l5`; L5 also emits the existing `session.compacted` event with required `{range, summary_ref}`.
- Label/provenance inheritance: compaction request and summary labels derive from all source messages; summaries keep those labels when re-entering prompt assembly.
- Failure behavior: failed L4 leaves the original L1-L3 prompt path intact; failed L5 leaves the successful L4 path intact. Both emit visible `progress.update`/`route.denied` evidence.
- Config shape:
  - `context.l4_placeholder_threshold`
  - `context.l4_target_tokens`
  - `context.l5_target_tokens`
  - `context.compaction_role`

## Spec Ambiguities

- L4 visibility uses `artifact.created` plus `context.manifest.reduction_stages_applied=["L4"]` rather than `session.compacted`, because L4 compacts selected stale placeholders/tool digests and may not represent a whole-session range. L5 uses `session.compacted` because it is a structured handoff over a clear turn range and matches the registered schema.
- Source event ids are now preserved when history is recovered by the gateway, but pure in-memory callers may only provide turn ranges. The request schema therefore carries `source_event_ids` when available and always carries `source_range`.
- Pinned compaction messages are implementation metadata on `ChatMessage` and are deliberately ignored by provider serialization. This is needed so later L2/L3 passes do not erase the L4/L5 projection they just created.

## Proposed Docs Edits

- `docs/specs/context-engine.md`: mark L4/L5 implemented for M2-07; document trigger policy, pinned compaction projections, failure behavior, and replay visibility.
- `docs/specs/protocol.md`: clarify that `session.compacted` is used for L5 handoff artifacts and that L4 may be represented by `artifact.created` plus manifest stage.
- `docs/specs/data-governance.md`: add that compaction summaries inherit source labels/provenance and cannot declassify or launder quarantined data by paraphrase.
- `docs/specs/evals.md`: register `context.compaction-regression` with coverage for carry-over, refs, failed tools, labels, quarantine, and replay.

## Manual Owner Checklist

- Run `pnpm --filter @fairy/testing test -- --reporter=verbose`; save output to `tasks/owner-checks/M2-07/testing-compaction.txt`.
- Run a forced L4/L5 mock replay and save:
  - `tasks/owner-checks/M2-07/compaction-replay.jsonl`
  - `tasks/owner-checks/M2-07/compaction-manifests.txt`
- Run a personal/local-only compaction governance check and save:
  - `tasks/owner-checks/M2-07/compaction-governance-replay.jsonl`
