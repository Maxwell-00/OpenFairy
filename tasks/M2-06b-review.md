# M2-06b Review — Acceptance-debt hardening

Date: 2026-07-07
Primary reviewer: ChatGPT 5.5 (verdict delivered in conversation; recorded here)
Countersigner: Claude (Fable 5), via opus subagent code-level cross-check at `6c80c01`
Delivery commit: `6c80c01` (parent `bdb1e7e`). CI: Actions run `28836936192` green (ubuntu + windows).

## Primary verdict (ChatGPT)

**ACCEPTED WITH NOTES / CLOSED.** Scope compliant (runtime change confined to `packages/research` + dep-cruiser; everything else tests/fixtures); D1 independence accounting landed with additive `independent_family_count` on `sourceset.reviewed`; retrieval-phase fixture added and conformance-wired; all nine named suites visible and green; negative dep-check experiment documented. NITs: work report's file-tree delta omits `tasks/M2-05b-affect-cache-feedback.md` (bundled into the commit); work report compressed to long single lines; owner evidence contains mock injection markers (harmless, note "mock marker only" next time).

## Countersignature — Claude (Fable 5)

Code-level cross-check confirms the primary verdict. All of D1–D10 verified at `6c80c01` with file:line evidence:

- **D1 PASS.** `reviewSources` dedupes then groups on `independence_key` (`packages/research/src/index.ts:737-762`); `single_source_family` fires iff deduped ≥ 2 ∧ families = 1 (`:743`); `dedupeSources` semantics untouched vs parent; fixtures include two different-URL/different-body/same-key wire sources (`:321-338`); the three required unit tests are present and non-vacuous (`research/test/index.test.ts:83-196`).
- **D2/D3 PASS.** Provider-throw branch tested with honest empty-text `fetch_error` snapshot (`test:252-283` exercising `src:642-647`); en-only negative planning test asserts `locales == ["en"]` (`test:44-49`).
- **D4 PASS.** `personal_allowed_tools` allow-path E2E at `gateway.e2e.test.ts:1708-1765` (no egress.denied, tool ok, audit allow + execute rows); block-path tests untouched.
- **D5/D6/D7 PASS.** Hints-never-gate asserts identical routing outcomes with/without `prefer_local` (`governance.evals.test.ts:56-73`); no-auto-downgrade strengthened with an `ok:false` clearance check (`:36-53`); full golden tables for all three profiles matching `kernel/src/governance.ts:63-92` literally (`:75-104`); `personal` seeding added beside `secret` in provider clearance, both zero-request (`:117-143`).
- **D8 PASS.** Retrieval-phase valid fixture wired into conformance `it.each` (`conformance.test.ts:20,104-110`).
- **D9 PARTIAL (accepted).** The residency unit case (`memory/test/index.test.ts:236-253`) proves label-preservation-on-deny with residency-only divergence, but `routeAllowed` is a precomputed input, so residency *causation* is still proven only at E2E level. This matches the debt register's own framing ("unit granularity missing"); recorded as permanently acceptable unless memory routing is reworked.
- **D10 PASS.** `.dependency-cruiser.cjs:21-27` `research-no-model-gateway`, severity error; work report documents the negative experiment (temporary violating import fails dep-check).
- **Boundaries PASS.** Runtime diffs limited to `packages/research/src/index.ts` + `.dependency-cruiser.cjs`; `governance.ts` (kernel and model-gateway) untouched; no docs/docs-zh; no new `describe(` suite names; the three rewritten `expect` lines all strengthen (exact equality, added clearance check, added personal seeding) — nothing weakened.
- **Schema PASS.** `independent_family_count` optional/additive (`sourceset.reviewed.v1.json:52-55`, `required` unchanged); valid fixture self-consistent. Minor: the invalid fixture was already invalid at parent (`sources:[]`), so the new `"one"` type violation is over-determined — it does not isolate the new integer rule. Cosmetic.

Additional note: `research sources` CLI *text listing* still prints per-source keys only; the family count is exposed on the `research.sources` tool result / `sourceset.reviewed` payload, which satisfies the brief's wording. If the owner wants it in the CLI listing, that is a one-line future nicety, not debt.

**Countersigned: M2-06b ACCEPTED WITH NOTES / CLOSED.** The M2-02/03/04 retro-audit debt register D1–D10 is discharged (D9 at the granularity the register itself deemed acceptable). Next: dispatch M2-05b, then M2-06 perception.
