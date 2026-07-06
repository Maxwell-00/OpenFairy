# M2-03 Review — Research Orchestrator v1 + Snapshot Cache + Citation Ledger

Date: 2026-07-06  
Reviewer: ChatGPT 5.5 Thinking  
Repo: Maxwell-00/OpenFairy  
Reviewed baseline: `cab4c28` (`M2-03-fix`) on top of `9939dde` (`M2-03-work`)  
Task brief: `tasks/M2-03-research-orchestrator.md`  
Work report: `tasks/M2-03-work.md`

## Verdict

**ACCEPTED WITH NOTES.**

Implementation-level review is accepted. M2-03 should **not** be marked closed until owner manual checks are run and evidence is saved.

## Evidence checked

- GitHub commit history shows `cab4c28` (`M2-03-fix`) as the latest M2-03 commit after `9939dde`.
- GitHub Actions run `M2-03-fix #40` is green: status `Success`, matrix `verify`, 2 jobs completed.
- `cab4c28` only changes:
  - `packages/testing/test/gateway.e2e.test.ts`
  - `tasks/M2-03-work.md`
- `9939dde` implements the M2-03 work across research, tools, CLI, gateway/kernel integration, tests, protocol fixtures, and lockfile.
- `tasks/M2-03-work.md` states local acceptance commands passed:
  - `pnpm install`
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `pnpm dep-check`
  - `pnpm conformance`
  - `git diff --check`
- Named suites observed in Codex report:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - gateway E2E: `keeps research injection pages quarantined through the TurnRunner tool loop`
- Work report states no `docs/` or `docs-zh/` changes.

## BLOCKER

**None.**

The prior blocker against `injection.research-v0` is cleared by `cab4c28`.

## Acceptance matrix

| Acceptance item | Result | Notes |
|---|---:|---|
| Preserve M2-01/M2-02 invariants | PASS | Existing memory/gate named suites remain present. |
| Research is not a second TurnRunner | PASS | Implemented as `packages/research` library + `research.*` tools through the existing tool loop. |
| Deterministic planning, no model call in planner | PASS | Codex report states no model-gateway dependency and no model call from planning. |
| zh/en fan-out | PASS | `research.zh-en-parity` suite present; mock fixtures include shared bilingual source family. |
| Budget exhaustion visible | PASS | Work report states warnings/progress surfaces; no silent drop. |
| Research tools via normal TurnRunner loop | PASS | Fable cross-check identified gateway E2E with `research.plan → search → fetch → cite → sources`; no separate loop. |
| Research governance composition | PASS | Fable cross-check identified gateway E2E for `personal/local-only` authenticated research snapshot raising labels before route clearance and falling back local. |
| Mock-only CI research providers | PASS | Work report states `MockResearchProvider` only; no real public internet in tests. |
| Snapshot cache v1 | PASS | Content-addressed snapshots under data dir; metadata and TTL behavior reported. |
| URL canonicalization/dedup/source grading | PASS | Work report covers tracking param stripping, canonical URLs, content-equivalence dedup, full grade taxonomy. |
| Citation ledger v1 | PASS | `research.cite` validates snapshot/span/claim and emits `citation.recorded`; bare URL is not evidence. |
| Source-set review v0 | PASS | Deterministic heuristic review; no critic subagent. |
| Injection corpus v0 | PASS | Fixed after review. Gateway E2E now covers `tool-exfil` and zh injection pages through TurnRunner. |
| Research eval suites | PASS | `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0` present. |
| CLI/replay visibility | PASS | Research CLI and replay tests added. |
| No docs/docs-zh edits | PASS | Work report and GitHub diff scope agree. |
| CI | PASS | GitHub Actions #40 success, 2 matrix jobs completed. |

## Notes on withdrawn blockers

My earlier review incorrectly marked two blockers:

1. RE-1 governance composition E2E missing.
2. research tool-loop/replay E2E missing.

Fable’s cross-check found both in `packages/testing/test/gateway.e2e.test.ts` at the same reviewed commit. I withdraw both findings.

## Fixed blocker

`injection.research-v0` was initially too unit-level. `cab4c28` adds the missing gateway/TurnRunner E2E:

- mock model calls `research.fetch` for `tool-exfil` and zh-language malicious pages;
- provider request bodies are captured;
- malicious page markers appear only in quarantined `tool` messages;
- malicious markers do not appear in system/developer/user messages;
- no `memory.written` is emitted;
- no instruction-driven `citation.recorded` is emitted;
- replay is visible and does not leak `SECRET_TOKEN` outside quarantined tool-result content.

This matches the M2 scope: firewall/quarantine only. It does not claim M5 capability narrowing or provenance-driven permission escalation.

## CARRY-IN

1. **Owner manual checks pending.**  
   M2-03 is implementation-accepted, but task-level close still requires owner evidence under `tasks/owner-checks/M2-03/`.

2. **Reviewer-owned docs pass pending after owner checks.**  
   Codex correctly only proposed docs edits in `tasks/M2-03-work.md`. Reviewer should later update:
   - `docs/specs/research.md`
   - `docs/specs/protocol.md`
   - `docs/specs/sandbox-security.md`
   - `docs/specs/evals.md`
   - `docs/specs/data-governance.md`

3. **Provenance → permission wiring remains a later governance hardening task.**  
   Kernel permission path still treats tool calls as trusted channel context. M2-03 tests only quarantine/firewall behavior. Do not treat this as capability narrowing.

4. **Egress guard remains separate.**  
   Personal-content outbound tool arg scanning, telemetry redaction, governance profiles, and third-provider policy remain later M2 governance work.

5. **`research.sources()` empty source set semantics should be documented.**  
   Work report states empty source set returns a tool result and does not emit `sourceset.reviewed` because the schema requires at least one source.

## NIT

- Work report still says CI was not observed in the local turn; that was true before push. GitHub #40 is now green.
- Owner evidence should avoid committing derived databases or bulky transient artifacts unless explicitly needed.

## Final status

**M2-03 implementation: ACCEPTED WITH NOTES.**  
**M2-03 task close: PENDING owner manual checks.**
