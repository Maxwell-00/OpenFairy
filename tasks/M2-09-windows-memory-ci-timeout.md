# M2-09 Windows memory CI timeout fix

Date: 2026-07-09

Baseline: `683d5d0`

Scope: Windows CI timing hygiene only. No runtime behavior was changed.

GitHub Actions run `28948689613` failed on Windows during `pnpm -r test` because two existing SQLite/projection tests in `packages/memory/test/index.test.ts` exceeded Vitest's default 5000 ms timeout:

- `rejects direct secret projection inserts even when the gate is bypassed`
- `inserts, deduplicates, deletes, and searches projection rows`

Fix: added a shared per-test timeout of `30_000` ms to those two tests only. The tests are not skipped and their assertions are unchanged.

No `docs/` or `docs-zh/` files were edited.
