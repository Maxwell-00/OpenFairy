# M2-03 Review — Research Orchestrator v1 + Snapshot Cache + Citation Ledger

Date: 2026-07-06  
Reviewer: ChatGPT 5.5 Thinking  
Repo: Maxwell-00/OpenFairy  
Implementation baseline: `9939dde` (`M2-03-work`) + `cab4c28` (`M2-03-fix`)  
Owner evidence baseline: `4117c1c` (`M2-03-manual-check`) + later owner-summary cleanup  
Task brief: `tasks/M2-03-research-orchestrator.md`  
Work report: `tasks/M2-03-work.md`

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-03 is accepted at task level. Implementation review passed, GitHub Actions was reported green, and owner manual evidence has been committed under `tasks/owner-checks/M2-03/`.

## Evidence checked

- `9939dde` implemented Research Orchestrator v1 across `packages/research`, `packages/tools-std`, `packages/testing`, `apps/cli`, gateway/kernel integration, protocol fixtures, and lockfile.
- `cab4c28` fixed the remaining injection-review blocker by adding gateway/TurnRunner E2E coverage for malicious research pages.
- GitHub Actions for `M2-03-fix #40` was green: ubuntu + windows matrix completed.
- Owner evidence was committed under `tasks/owner-checks/M2-03/` and records GitHub Actions `#41` green on ubuntu + windows.
- Owner evidence includes:
  - `testing-research-evals.txt`
  - `research-package-test.txt`
  - `tools-std-research-test.txt`
  - `cli-research-test.txt`
  - `M2-03-owner-checks.md`
- `tasks/M2-03-work.md` states no `docs/` or `docs-zh/` changes; docs edits are proposed only.

## BLOCKER

**None.**

## Acceptance matrix

| Acceptance item | Result | Notes |
|---|---:|---|
| Preserve M2-01/M2-02 invariants | PASS | Existing memory leakage/deletion suites remain visible. |
| Research is not a second TurnRunner | PASS | Implemented as `packages/research` library + `research.*` tools through existing TurnRunner tool loop. |
| Deterministic planner, no model call | PASS | Planning is local heuristic decomposition. |
| zh/en fan-out | PASS | `research.zh-en-parity` suite passes; shared bilingual canonical source exists. |
| Budget exhaustion visibility | PASS | Uses `progress.update`/existing event fields, no new event type. |
| Research tools via normal tool loop | PASS | Gateway E2E drives `research.plan → search → fetch → cite → sources`. |
| Research governance composition | PASS | Auth/private `personal/local-only` snapshot raises effective labels before route clearance and falls back local. |
| Mock-only CI | PASS | Mock research provider/fixtures; no real web in CI. |
| Snapshot cache v1 | PASS | Content-addressed snapshots with metadata and TTL behavior. |
| URL canonicalization/dedup/source grading | PASS | Tracking params, canonical URL, content signatures, independence keys, full grade taxonomy incl. `sns`. |
| Citation ledger v1 | PASS | Claims bind to snapshot spans; bare URLs are not evidence. |
| Source-set review v0 | PASS | Deterministic heuristic review; no critic subagent. |
| Injection corpus v0 | PASS | `cab4c28` adds TurnRunner/gateway E2E for tool-exfil and zh injection pages. |
| Eval suites | PASS | `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`. |
| CLI/replay visibility | PASS | Research CLI and replay tests pass. |
| No docs/docs-zh edits | PASS | Codex proposed docs edits only in work report. |
| CI | PASS | GitHub Actions reported green on ubuntu + windows. |
| Owner manual checks | PASS | Fixture/mock-based owner checks committed. |

## Notes on withdrawn findings

The initial implementation review incorrectly marked two blockers:

1. RE-1 governance composition E2E missing.
2. Research tool-loop/replay E2E missing.

Fable’s cross-check found both in `packages/testing/test/gateway.e2e.test.ts` at the reviewed commit. Those findings are withdrawn. The actual missing item was injection acceptance-level E2E; `cab4c28` fixed it.

## Fixed blocker — injection.research-v0

`cab4c28` adds the required gateway/TurnRunner E2E:

- mock model calls `research.fetch` for `tool-exfil` and zh-language malicious pages;
- provider request bodies are captured;
- malicious markers appear only in quarantined `tool` messages;
- malicious markers do not appear in system/developer/user messages;
- no `memory.written` is emitted;
- no instruction-driven `citation.recorded` is emitted;
- replay is visible and does not leak `SECRET_TOKEN` outside quarantined tool-result content.

This matches the M2 scope: firewall/quarantine only. It does not claim M5 capability narrowing or provenance-driven permission escalation.

## Owner manual checks

Owner checks are accepted:

- `@fairy/testing` research/eval suites: PASS.
- `@fairy/research` package tests: PASS.
- `@fairy/tools-std` research tools tests: PASS.
- `@fairy/cli` research CLI/replay tests: PASS.
- Optional full local acceptance tail was not used as owner evidence; CI covers task-level acceptance commands.

## CARRY-IN

1. **Reviewer-owned M2-03 docs pass.** Codex correctly proposed docs edits only in `tasks/M2-03-work.md`. Reviewer should update:
   - `docs/specs/research.md`
   - `docs/specs/protocol.md`
   - `docs/specs/sandbox-security.md`
   - `docs/specs/evals.md`
   - `docs/specs/data-governance.md`

2. **Provenance → permission wiring remains a governance hardening task.** Kernel permission path still treats tool calls as trusted-channel context. M2-03 proves quarantine/firewall behavior, not capability narrowing.

3. **Egress guard remains separate.** Personal-content outbound tool-arg scanning, telemetry redaction, governance profiles, and label-conformance suites belong in the next governance slice.

4. **`research.sources()` empty-set semantics should be documented.** Work report states empty source set returns a tool result and does not emit `sourceset.reviewed` because the schema requires at least one source.

## NIT

- Owner evidence summary formatting remains compact in raw GitHub output. The underlying evidence files and PASS statuses are clear enough; no further cleanup is needed.
- Future owner evidence should avoid derived databases or bulky transient artifacts unless specifically required.

## Final status

**M2-03 CLOSED.**

Proceed to M2-04 after task-brief gate review.
