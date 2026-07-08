# M2-06b Work Report

## 1. File tree delta

- `.dependency-cruiser.cjs`
- `packages/research/src/index.ts`
- `packages/research/test/index.test.ts`
- `packages/protocol/schemas/sourceset.reviewed.v1.json`
- `packages/protocol/fixtures/sourceset.reviewed.valid.json`
- `packages/protocol/fixtures/sourceset.reviewed.invalid.json`
- `packages/protocol/fixtures/memory.gate.decision.retrieval.valid.json`
- `packages/protocol/test/conformance.test.ts`
- `packages/testing/test/governance.evals.test.ts`
- `packages/testing/test/gateway.e2e.test.ts`
- `packages/memory/test/index.test.ts`
- `packages/tools-std/test/index.test.ts`
- `tasks/owner-checks/M2-06b/conformance.txt`
- `tasks/owner-checks/M2-06b/research-independence.txt`
- `tasks/owner-checks/M2-06b/research-sources.json`
- `tasks/owner-checks/M2-06b/research-cli-data/artifacts/research/sources.json`
- `tasks/owner-checks/M2-06b/testing-suites.txt`

No `docs/` or `docs-zh/` files were edited.

## 2. Verification tails

- `pnpm install`: already up to date.
- `pnpm lint`: PASS, `eslint . --max-warnings=0`.
- `pnpm -r typecheck`: PASS across workspace TS packages.
- `pnpm -r test`: PASS, including `apps/cli` 6 files / 9 tests and `packages/testing` 8 files passed / 1 skipped, 52 passed / 1 skipped.
- `pnpm dep-check`: PASS, `no dependency violations found (89 modules, 243 dependencies cruised)`.
- Negative dep-cruiser check: temporarily added `packages/research/src/index.ts -> @fairy/model-gateway`; `pnpm dep-check` failed with `error research-no-model-gateway`, then the temporary import was removed and final `pnpm dep-check` passed.
- `pnpm conformance`: PASS, mock mode 18/18 cases passed.
- `git diff --check`: PASS.
- `git diff --name-only -- docs docs-zh`: empty.
- `git diff --name-only -- packages/kernel packages/tools-std packages/memory apps`: only `packages/memory/test/index.test.ts` and `packages/tools-std/test/index.test.ts`.

Targeted evidence:

- `pnpm --filter @fairy/research test -- --reporter=verbose`: `tasks/owner-checks/M2-06b/research-independence.txt`; 20 tests passed, including family-count, single-family-warning, override-shared-key, provider-throw snapshot, and en-only planning coverage.
- `pnpm --filter @fairy/testing test -- --reporter=verbose`: `tasks/owner-checks/M2-06b/testing-suites.txt`; named suites visible and green: `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `label.conformance`, `governance.friction-canary`, `persona.consistency`, `substance.invariance`.
- `pnpm conformance`: `tasks/owner-checks/M2-06b/conformance.txt`; mock conformance verdict `ok: true`.
- Research sources evidence: `tasks/owner-checks/M2-06b/research-sources.json`; CLI source listing is parseable, sources carry `independence_key`, and the paired review reports `independent_family_count`.

CI status: not pushed from this workspace, so GitHub Actions status is pending owner push.

## 3. Decisions

- Independence accounting is review-time accounting, not dedup semantics: `reviewSources()` first applies the existing canonical/content dedupe and then groups the deduped set by `independence_key`.
- The new count field is `independent_family_count` on `SourceSetReview` and on `sourceset.reviewed.payload`, not per-source.
- `single_source_family` now fires only when the deduped set has at least two sources and exactly one independence family.
- Mock fixtures add two seeded wire-family pages with different `canonical_url` values, different bodies, and shared `independence_key: "wire:local-memory-policy"`.
- Override coverage uses the existing provider/search-result `independence_key` override path. No content-similarity syndication detection and no new config key were added.
- Provider fetch exceptions write honest fetch-error snapshots with empty `text`, `cleaning_method: "fetch-error-v1"`, preserved URL/canonical metadata, and no crash.
- `GovernanceProfileDefaults` are asserted as full literal golden objects for all three profiles.
- `memory.gate.decision` keeps the canonical admission valid fixture and adds a supplemental retrieval valid fixture validated by the existing protocol conformance test file.
- The dep-cruiser boundary rule is `research-no-model-gateway`, severity `error`, and covers both resolved workspace paths and package-name imports (`@fairy/model-gateway`).

## 4. Spec ambiguities

- Field placement: the brief required `independent_family_count` but did not prescribe exact placement. I placed it on the source-set review payload, next to `decision`, `review_id`, `sources`, and `warnings`, because it describes the whole reviewed set.
- Override mechanism: the brief says config/fixture override. Current research v1 has fixture/provider-level `independence_key` override but no dedicated domain-to-family config key. I used the existing fixture/provider override path and did not introduce a config key.
- CLI owner check vs runtime boundary: the owner checklist asks the sources CLI JSON to show family count, but the task also forbids apps/cli runtime edits. I left CLI runtime unchanged, added `research.sources()` tool-output coverage, and saved owner evidence that pairs CLI sources with a review count in the same JSON file.
- Retrieval-gate residency cause: `evaluateRetrievalGate()` receives `routeAllowed` rather than a structured route-denial reason. The unit test pins the residency-specific scenario by using an `internal/local-only` record with `routeAllowed: false`, so sensitivity is otherwise cleared and the existing reason code remains `label_clearance_denied`.

## 5. Proposed docs edits

- `docs/specs/research.md`: document that source-set review reports `independent_family_count`, grouping deduped sources by `independence_key`, and that `single_source_family` requires at least two deduped sources in one family.
- `docs/specs/research.md` section 7: note seeded shared-family wire fixtures and explicit fixture/provider independence-key overrides.
- `docs/specs/evals.md`: note strengthened `label.conformance` coverage for hints-never-gate, no-auto-downgrade, personal provider clearance, and full profile defaults.
- `docs/specs/data-governance.md`: note that derivation-law tests now pin hints as advisory and forbid automatic downgrade without declassification.
- `docs/specs/protocol.md`: note additive `sourceset.reviewed.payload.independent_family_count` and that `memory.gate.decision` has both admission and retrieval valid fixtures.

## 6. Manual owner checklist

- Suite visibility: `pnpm --filter @fairy/testing test -- --reporter=verbose`; saved to `tasks/owner-checks/M2-06b/testing-suites.txt`.
- Independence accounting: `pnpm --filter @fairy/research test -- --reporter=verbose`; saved to `tasks/owner-checks/M2-06b/research-independence.txt`.
- Sources JSON evidence: seeded mock sources under `tasks/owner-checks/M2-06b/research-cli-data`, then CLI source JSON plus review family count saved to `tasks/owner-checks/M2-06b/research-sources.json`.
- Conformance: `pnpm conformance`; saved to `tasks/owner-checks/M2-06b/conformance.txt`.
