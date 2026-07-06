# Retro-audit — M2-02 / M2-03 / M2-04 vs. handbook countersignature standard

Date: 2026-07-06
Auditor: Claude (Fable 5) reviewer seat; three parallel opus subagents, read-only, all evidence via `git --no-optional-locks show/grep` at the delivery commits.
Trigger: REVIEWER-HANDBOOK.md §4 (countersignature standard) postdates these three closes; owner requested a conformance re-check.

## Verdicts

| Task | Commit(s) audited | Verdict | Runtime defects | Acceptance debt |
|---|---|---|---|---|
| M2-02 memory store + retrieval | `ea19a3a`+`9de76d9` | **SATISFIED** | none | 2 minor (test granularity) |
| M2-03 research orchestrator | `9939dde`+`cab4c28` | **SATISFIED EXCEPT ONE BULLET** | 1 functional gap (non-security) | 3 items |
| M2-04 governance hardening | `14ae2c5` | **SATISFIED (enforcement); test debt** | none | 4 items |

All security-critical properties across the three slices verified with non-vacuous tests: secret non-persistence, retrieval-gate zero text leakage, deletion permanence across rebuild, labels-join-before-route-clearance (memory + research paths), egress-before-execute ordering, grant-before-provenance rule ordering, canonical-vs-diagnostic redaction split. Invariant sweeps (one TurnRunner, no vendor SDK, no kernel provider strings, all emitted event types registered) pass at every audited commit.

## The one functional gap — M2-03 `independence_key`

Brief §5 acceptance: "`independence_key` prevents syndicated clones from counting as independent sources."
Reality at `cab4c28`: `dedupeSources` (`packages/research/src/index.ts:475-509`) collapses only by `canonical_url` / `content_signature` — **never by `independence_key`**. The key is consumed solely by `reviewSources` family counting (`:715`), whose only test uses a single source. Two syndicated mirrors with different bodies on different hosts count as two independent sources; the existing "tests" touching independence_key are vacuous for this property (equality on one source; a `toContain("independence_key")` string check). Additionally the default key = registrable host, so real cross-host syndication (reuters.com vs apnews.com wire copy) can never share a key.
Impact: source-set review may overstate independence; no label/leakage impact.

## Acceptance debt register (thread into a hardening slice)

D1. **[M2-03/code+test]** Wire `independence_key` into source independence accounting (dedup collapse or independent-count) + non-vacuous test: two sources, different canonical_url + different content, same independence_key ⇒ counted as one source family / flagged `single_source_family`.
D2. **[M2-03/test]** Provider-throw fetch path (`#writeErrorSnapshot` via caught exception) untested — add a test asserting an honest empty-text `fetch_error` snapshot (paywall/denial case). Deny-list branch is already tested.
D3. **[M2-03/test]** Negative zh/en planning case: plain-English intent yields en-only subqueries (positive branch already tested).
D4. **[M2-04/test]** `governance.egress.personal_allowed_tools` allow-path has zero tests (block path well covered) — add: personal-labeled content passes through an allow-listed tool.
D5. **[M2-04/test]** Pin the two structurally-implied derivation laws in `label.conformance`: hints-never-gate (a `prefer_local` hint neither blocks nor permits) and no-auto-downgrade.
D6. **[M2-04/test]** Per-profile golden default tables: assert the full `GovernanceProfileDefaults` table for all three profiles (current tests spot-check ~2 keys each).
D7. **[M2-04/test]** `label.conformance` provider-clearance area seeds only `secret`; add `personal` seeding inside the suite (currently proven only in gateway.e2e).
D8. **[M2-02/fixture]** Add a `phase:"retrieval"` valid fixture for `memory.gate.decision` (both committed fixtures are admission-phase).
D9. **[M2-02/test]** Residency-specific retrieval-gate unit case (currently folded into `label_clearance_denied` upstream; behavior is E2E-covered, unit granularity missing).
D10. **[infra]** Add a dep-cruiser rule forbidding `packages/research` → `packages/model-gateway` (invariant currently holds by fact, not enforcement). Same nice-to-have as the kernel provider-special-case guard upgrade.

Notes for the record: `research.search_warning` is an undocumented (but boundary-legal) progress stage — document in the next research docs touch. M2-04 `#emitToolResult` >32KiB artifact spill is un-redacted by design (canonical content, not diagnostic).

## Disposition

No task reopening — none of the debt is a leakage/permanence/clearance hole, and per proportionality precedent (M2-05 mojibake) closed verdicts stand. D1-D10 should be dispatched as one small self-contained hardening slice (suggested id `M2-06b-acceptance-debt`, runnable in parallel with M2-06 since file overlap is limited to `packages/research` + tests), or folded into the M2 exit-consolidation slice if the owner prefers fewer dispatches.
