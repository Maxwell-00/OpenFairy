# Review: M0-01 delivery — ACCEPTED with fixes applied

Reviewer: Claude (Cowork) · 2026-07-02 · verdict on `tasks/M0-01-work.md`

## Verified on disk (not just from the report)

- All **44 event types** of protocol spec §2 present as schemas (+ registry manifest) with 44×2 valid/invalid fixtures + `x.vendor` extension fixture.
- Seeded traps pass: `storm_key` required via JSON-Schema if/then on `class: critical` (all 4 delivery schemas); `local-preferred` rejected by closed enum + dedicated test.
- dependency-cruiser rules correct (protocol → no workspace imports; kernel ↛ channels/apps; vendor-SDK allowlist pattern).
- `packages/config`: layered loader, `secret://` typed-never-resolved, defaults.yaml keys match spec spelling.
- Cross-platform node scripts; `packageManager` pinned; registry↔schema sync test present.

## Owner decisions (resolved 2026-07-02)

1. **Repo location: `OpenFairy/` kept as the canonical repo** (Codex's relocation accepted). Docs inside the repo are now the single normative set; parent `Fairy\` folder holds only non-repo material (ChatGPT_Suggestions, docs-zh, .auto-memory). CLAUDE.md/AGENTS.md updated accordingly. Outer duplicate copies pending manual deletion by owner.
2. **LICENSE: MIT / Maxwell-00 confirmed correct.** Schema `$id` namespace `openfairy.local` kept (consistent with repo name).

## Fixes applied during review (uncommitted — review then commit)

- **CI bug (confirmed by first real run, both OS matrices failed):** `actions/setup-node` with `cache: pnpm` ran *before* pnpm existed → "Unable to locate executable file: pnpm". Final fix in `.github/workflows/ci.yml`: `pnpm/action-setup@v4` (reads the root `packageManager` field, no corepack dependency — corepack is removed from Node ≥ 25) before `setup-node`, and checkout/setup-node bumped to v5 (clears the Node 20 runtime deprecation warning).
- Doc reconciliations from Codex's ambiguity list:
  - `docs/specs/data-governance.md` §1: residency enum now written plainly as `region-restricted` (set resolves from `governance.home_regions` at enforcement, not in the label) — matches implementation and ADR-019.
  - `docs/ARCHITECTURE.md` §9: protocol gloss corrected to "(no workspace deps; ajv + ulid only)".
  - `docs/specs/protocol.md` §3: unknown non-`x.*` type tolerance scoped precisely (envelope-level validation, preserve, skip — never error). Matches implementation.
- CLAUDE.md/AGENTS.md: repo path → `E:\Claude_Projects\Projects\Fairy\OpenFairy`, parent-folder layout notes added; both files kept identical.

## Notes for M0-02 (unchanged from Codex's suggestions, endorsed)

Minimal gateway boot (config load, `/health`, `/meta`, protocol version) · mock client conformance (send `turn.input`, receive canonical stream) · move reusable conformance helpers into `packages/testing` · decide + document config file discovery order before daemon state grows. Add: CI must actually run on GitHub before M0 is called done (the workflow has never executed).
