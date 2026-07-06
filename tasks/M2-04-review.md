# M2-04 Review — Governance Hardening v1

Review date: 2026-07-06  
Reviewed commit: `14ae2c5`  
Task brief: `tasks/M2-04-governance-hardening.md`  
Work report: `tasks/M2-04-work.md`

## Verdict

**ACCEPTED WITH NOTES / OWNER MANUAL CHECKS PENDING**

M2-04 implementation is acceptable at code/CI-evidence level based on committed GitHub state and the reported green CI, with no runtime blocker found in this pass. Task-level close still requires owner evidence under `tasks/owner-checks/M2-04/`.

## Reviewed scope

Commit `14ae2c5` changes the expected M2-04 implementation surface:

- CLI audit/replay support
- gateway config/server plumbing
- config schema/defaults
- kernel governance and TurnRunner egress/permission path
- kernel tests
- testing e2e/evals
- `tasks/M2-04-work.md`

The work report states `docs/` and `docs-zh/` were not changed.

## Acceptance summary

| Area | Result | Notes |
|---|---:|---|
| Preserve M2 invariants | PASS | Work report records M2 suites still visible: memory leakage/deletion permanence, research citation/zh-en/injection, plus new governance suites. |
| Egress Guard v1 | PASS | Guard is reported to run before permission/tool execution; denials use existing event types and audit rows; no new canonical event type. |
| Secret redaction / fingerprints | PASS | Redaction helpers include deterministic fingerprints and context-anchored OTP detection; raw secret diagnostics are avoided. |
| Provenance-aware permission context v0 | PASS WITH NOTE | `channelTrust`, `sandboxProfile`, `untrustedContentPresent`, and provenance summary are now passed into permission context. Broad M5 capability narrowing remains out of scope. |
| Governance profiles | PASS | Profile names closed to `balanced`, `sovereign`, `cloud-friendly`; config validation covers invalid profiles and region-restricted providers without regions. |
| `label.conformance` | PASS | Deterministic suite registered; covers derivation, semantic escalation, near-miss, clearance, egress, redaction. |
| `governance.friction-canary` | PASS | Deterministic PR-tier suite; reports interruption count, recovery, dead-end cases. |
| CLI / replay | PASS | `fairy audit --json`; replay text renders egress denial; replay JSON redacts diagnostic payloads while preserving source events. |
| docs/docs-zh boundary | PASS | No docs or docs-zh edits in implementation commit; docs proposals are in work report. |
| CI | OWNER-STATED GREEN | User reports GitHub Actions green for `14ae2c5`. I did not receive a run URL in this pass; the implementation review should be amended with the run ID after owner evidence if desired. |

## BLOCKER

None.

## CARRY-IN

1. **Owner manual checks pending.**  
   M2-04 cannot close until owner evidence is committed under `tasks/owner-checks/M2-04/`.

2. **Reviewer-owned docs pass pending.**  
   M2-04 work report proposes docs edits for `data-governance.md`, `sandbox-security.md`, `evals.md`, `protocol.md`, and `research.md`. Apply after owner checks and final close decision.

3. **Session grants vs provenance rules should be watched.**  
   Permission rules now accept provenance/trust fields. The permission engine still preserves existing session-grant behavior. If future tasks want untrusted-content rules to override existing session grants, make that explicit and test it.

4. **Personal/context matching is exact-string only.**  
   Work report correctly records this as deterministic and not semantic paraphrase detection. Do not overstate it in docs.

## NIT

- Work report says CI was not observed by Codex because no push occurred from its workspace. That is expected; reviewer/owner CI evidence comes from GitHub after user push.
- Manual owner checks can be fixture/test-output based. No real web, real API key, or live provider is needed for M2-04.

## Verified / Owner-stated / Not verified

### Verified

- Commit `14ae2c5` file tree and diff scope.
- No docs/docs-zh changes in commit file tree.
- M2-04 work report content and local verification claims.
- Config schema includes governance egress and provenance-aware permission rule fields.
- Kernel exports/uses governance helpers and egress guard in the TurnRunner path.
- `governance.evals.test.ts` includes `label.conformance` and `governance.friction-canary` suites.
- Work report proposes docs edits only.

### Owner-stated

- GitHub Actions is green on the existing matrix for commit `14ae2c5`.

### Not verified

- I did not rerun commands locally.
- I did not independently access a GitHub Actions run URL for `14ae2c5`.
- Owner manual evidence is not yet present.

## Decision

**M2-04 implementation accepted with notes.**  
Proceed to owner manual checks. Do not start M2-05 yet.
