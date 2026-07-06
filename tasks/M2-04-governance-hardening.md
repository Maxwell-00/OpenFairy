# Task M2-04 — Governance Hardening v1: Egress Guard, Redaction, Label Conformance

> Paste this entire file as the task brief after task-brief gate review.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M1 is closed. M2-01, M2-02, and M2-03 are closed at task level.
>
> This task is the governance hardening slice of M2. It does not add new research, memory, persona, or orchestration capabilities. It makes the label system harder to bypass at tool-egress, telemetry/logging, and permission/audit seams.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner. Modes are policies, not extra loops.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - Provider quirks only at transport + fixture boundary.
   - CI never uses real API keys.
   - Do not read/edit `docs-zh/`.

2. `tasks/M2-03-review.md`
   - M2-03 is closed.
   - Research content is quarantined and label-bearing.
   - Research snapshots/tool results can raise effective prompt labels before route clearance.
   - Injection v0 only proves firewall/quarantine behavior; it does not prove M5 capability narrowing.
   - Carry-ins: provenance→permission wiring, egress guard, telemetry redaction, label conformance.

3. `tasks/M2-03-work.md`
   - Read proposed docs edits only as context.
   - Do not apply docs edits in this task; Codex proposes docs edits only.

4. `docs/specs/data-governance.md`
   - Labels: `public < internal < personal < secret` and `local-only | region-restricted | global-ok`.
   - Effective labels derive from the whole assembled prompt.
   - Enforcement points include role router, MemoryGate, egress guard, telemetry/logs, export/delivery.
   - Egress guard scans outbound tool args for `personal+` content and secret patterns.

5. `docs/specs/sandbox-security.md`
   - Prompt injection defense is layered.
   - M2 has quarantine/instruction firewall; full capability narrowing is M5.
   - Egress guard scans outbound tool args.
   - Secrets never enter model context, session logs, traces, or tool execution environments unless explicitly configured.

6. `docs/specs/evals.md`
   - M2 gates include label conformance, memory leakage, citation precision, zh/en parity, and injection corpus v0.
   - Label conformance must prove seeded secret/personal content never reaches non-cleared providers and derivation laws hold.

7. `docs/specs/protocol.md`
   - Do not invent canonical event types.
   - Use existing event types: `error`, `progress.update`, `audit.appended`, `route.denied`, `tool.call`, `tool.result`, `memory.gate.decision`, etc.
   - `ack` / `op-error` remain transport frames, not session events.

8. `docs/specs/model-gateway.md`
   - Model-boundary transport is the only LLM I/O path.
   - Clearance enforcement is live since M2-01.
   - Denied providers receive zero request bytes.

9. `docs/specs/research.md` and `docs/specs/memory.md`
   - Research findings do not auto-persist to personal memory.
   - MemoryStore is a projection; JSONL sessions remain source of truth.
   - Research and memory labels must not regress.

## Deliverables

### 0. Preserve existing M2 invariants

Before adding governance behavior, preserve or add regression tests proving:

- M2-01 route clearance still denies secret/personal content before provider I/O.
- M2-02 memory retrieval labels still join effective labels before route clearance.
- M2-03 research fetched/source labels still join effective labels before route clearance.
- Research injection pages remain quarantined through TurnRunner.
- `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, and `injection.research-v0` remain visible in test output.
- Kernel provider-special-case guard remains green.
- No `docs-zh/` edits.

Acceptance:

- Existing M2 tests remain green.
- Named suites still appear in output.

### 1. Egress Guard v1

Implement a deterministic egress guard for outbound tool arguments.

Required behavior:

- The guard runs before executing tools that can send data outside the model/session boundary.
- At minimum, cover:
  - `web.fetch` URL/query/body-like args if present,
  - `web.search` query args,
  - `shell.run` command/env args,
  - future-proof hook point for external delivery/export tools.
- The guard scans outbound args for:
  - secret patterns: API keys, tokens, bearer headers, passwords, OTP-like codes,
  - `personal+` content when a label-bearing source is available,
  - exact high-risk strings from current turn/tool-result/memory/research context when tagged `personal` or `secret`.
- Secret content is always blocked.
- `personal` content may leave only through a destination/tool whose clearance/policy allows it; otherwise block or require approval according to config.
- Blocking must happen before the tool process/network call is made.
- Denials must be visible through existing event types only:
  - `tool.result` error payload for the denied call,
  - `audit.appended` or audit SQLite row,
  - optional `progress.update {stage: "egress.denied", ...}`.
- Do not add a new canonical event type.
- Denial messages must not echo the secret/personal string. Use redacted snippets and reason codes.

Acceptance:

- Unit tests for secret regex detection, redaction, and near-miss non-matches.
- E2E: malicious/research-fetched instruction attempts `web.fetch` with a secret marker in URL/query; egress guard blocks; no outbound mock web request happens; replay/audit shows denial without leaking the marker.
- E2E: `shell.run` command containing a fake API key is blocked before container spawn; audit shows `egress.denied`; no `tool.execute shell.run ok` row.
- E2E: safe public search query still executes normally.
- E2E: personal/local-only memory or research text cannot be sent to a global-ok external web tool without explicit allow/clearance.

### 2. Redaction middleware v1 for audit/error/diagnostics

Implement shared redaction utilities used by audit rows, error envelopes, debug traces, and test-visible diagnostics.

Required behavior:

- Redact secret patterns from:
  - audit rows,
  - `error` payloads,
  - `tool.result` error messages,
  - provider error details,
  - CLI output for audit/replay when rendering diagnostic error text.
- Preserve enough metadata to debug:
  - reason code,
  - label class,
  - tool name,
  - hashed fingerprint of redacted content where useful.
- Redaction must be deterministic.
- Redaction must not mutate source-of-truth user input or historical event payloads except where the payload is itself a diagnostic/trace/error surface.
- Session JSONL remains source of truth; redaction applies to derived/diagnostic surfaces and newly emitted diagnostic payloads.

Acceptance:

- Unit tests for redaction patterns and stable fingerprints.
- E2E: fake API key in a denied tool arg never appears in audit CLI output, replay text mode, or `error`/diagnostic payloads; a redacted marker and reason code do appear.
- E2E: JSON replay preserves canonical facts but redacts diagnostic denial strings that were designed to be redacted.

### 3. Provenance-aware permission context v0

Remove the stale hardcoded trust stub where tool permission checks always pass `channelTrust: "trusted"` regardless of actual context.

Required behavior:

- Permission decision context must include:
  - actual client/channel trust where known,
  - mode/policy context,
  - sandbox profile,
  - whether untrusted/quarantined content is present in the assembled context,
  - provenance summary of recent tool results / research snapshots / fetched web content.
- Do **not** implement full M5 capability narrowing in this task.
- Do **not** claim that every tool call is causally attributable to untrusted content.
- v0 semantics:
  - pass accurate provenance/trust metadata to the permission engine and audit;
  - use it for rules that are deterministic and directly testable;
  - keep broad "untrusted content present ⇒ all high-risk tools flip" as M5 unless the implementation is precise and explicitly tested.
- Existing safe CLI/local trusted behavior must not regress.

Acceptance:

- Unit tests: permission engine receives non-hardcoded channel trust and provenance summary.
- E2E: untrusted research content in context is reflected in audit/permission decision context.
- E2E: trusted direct user `fs.read` remains allowed under default config.
- E2E: direct untrusted-provenance tool instruction, where provenance is explicitly known, can be denied/escalated by config rule.
- Work report must state clearly what provenance-driven enforcement is implemented and what remains carry-in.

### 4. Governance profiles + label defaults conformance

Harden config/profile handling around `balanced`, `sovereign`, and `cloud-friendly` defaults.

Required behavior:

- Profile names are closed enum values.
- Default label tables follow `docs/specs/data-governance.md`.
- `home_regions` remains user-owned config.
- `region-restricted(home)` continues to use `regions ⊆ home_regions`.
- Invalid provider claims of `region-restricted` without `regions` fail config validation.
- No invented values such as `global` or `local-preferred`.

Acceptance:

- Unit tests for profile default tables.
- Unit tests for invalid profile names.
- Unit tests for `region-restricted` provider validation.
- E2E: switching profile changes default classification in a deterministic way without changing label enum semantics.

### 5. Label conformance suite v1

Register and implement a M2 `label.conformance` suite in `packages/testing`.

Required coverage:

- Derivation laws:
  - max sensitivity,
  - residency intersection,
  - hints never gate,
  - no automatic downgrade.
- Semantic escalation:
  - credentials/API key ⇒ `secret/local-only`,
  - health/finance/legal ⇒ `personal/local-only`,
  - near-miss corpus does not over-escalate.
- Provider clearance:
  - seeded `secret`/`personal` content never reaches a non-cleared model provider.
- Tool egress:
  - seeded `secret` content never reaches outbound tool args.
- Redaction:
  - secret patterns do not appear in audit/error/diagnostic surfaces.

Acceptance:

- `label.conformance` appears in `packages/testing` output.
- The suite is deterministic and uses mock providers/tools only.
- No real API keys, no real web, no real external network in CI.

### 6. Friction canary v0

Start the M2 governance friction canary as a deterministic test/report, not a nightly service yet.

Required behavior:

- Add a fixture-driven canary that records:
  - number of governance interruptions,
  - route-denied recovery success/failure,
  - dead-end denial cases.
- v0 can run in CI as a small deterministic suite.
- Do not implement nightly scheduling or notifications in this task.

Acceptance:

- `governance.friction-canary` appears in test output or is clearly registered as deterministic PR-tier v0.
- E2E: after `route.denied`, a cleared fallback or safe alternative completes the task.
- Report artifact/JSON is parseable.

### 7. CLI/replay visibility

Add minimal user-facing/debug commands only where useful.

Minimum acceptable behavior:

- `fairy audit` surfaces egress denials with redacted details.
- `fairy replay --json` preserves denial/audit payloads without leaking redacted secrets.
- Text replay renders egress denial compactly.

Optional CLI:

```powershell
pnpm fairy labels inspect <event-or-artifact-id> --json
pnpm fairy governance report --json
```

Do not add optional CLI unless it is small and tested.

Acceptance:

- CLI/replay tests for redacted egress denials.
- JSON outputs parse.
- Corrupt-tail replay tolerance remains green.

### 8. Docs proposals only

Do not edit `docs/` or `docs-zh/` in this task.

In `tasks/M2-04-work.md`, propose exact docs edits for reviewer application:

- `docs/specs/data-governance.md`
  - Egress Guard v1 implementation status.
  - Label conformance suite status.
  - Profile defaults and validation.

- `docs/specs/sandbox-security.md`
  - Provenance-aware permission context v0.
  - Egress guard scope.
  - Explicit note that full capability narrowing remains M5 unless implemented.

- `docs/specs/evals.md`
  - `label.conformance` registration.
  - `governance.friction-canary` v0 status.

- `docs/specs/protocol.md`
  - Existing event usage for egress denials; no new canonical event type.

- `docs/specs/research.md`
  - Research quarantine remains M2 firewall behavior; provenance-driven permission escalation is separate governance hardening.

## Boundaries — do NOT

- Do not implement a second TurnRunner.
- Do not implement full M5 capability narrowing unless explicitly scoped, precise, and tested.
- Do not implement browser automation or computer-use.
- Do not implement MCP/hooks.
- Do not implement third provider in this task.
- Do not implement persona/affect.
- Do not implement Chronicle or dream-cycle consolidation.
- Do not implement embeddings/vector search/sqlite-vec/LanceDB.
- Do not add new canonical event types.
- Do not edit `docs/` or `docs-zh/`; propose docs edits only.
- Do not use real API keys or real web calls in CI.
- Do not add vendor SDKs.
- Do not weaken tests by skipping Windows unless capability is genuinely unavailable on Windows.
- Do not log raw secrets in audit, replay text, error payloads, or test failure messages.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
```

GitHub Actions must be green on the existing CI matrix.

## Manual owner checks

Owner should run after CI is green.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-04
```

### 1. Label conformance suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `label.conformance` appears and passes.
- `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, and `injection.research-v0` still pass.

Save:

```text
tasks/owner-checks/M2-04/testing-governance.txt
```

### 2. Secret egress denial

Run a mock/fixture turn where the model attempts to pass `sk_test_1234567890abcdef` to an outbound tool arg.

Expected:

- Tool is denied before execution/network/container spawn.
- Audit/replay shows denial reason.
- Raw fake key does not appear in audit/replay text/diagnostic error surfaces.
- JSON evidence contains redacted marker or hash, not raw key.

Save:

```text
tasks/owner-checks/M2-04/egress-secret-replay.jsonl
tasks/owner-checks/M2-04/egress-secret-audit.txt
```

### 3. Personal/local-only egress denial

Seed or use fixture personal/local-only memory/research content and attempt to send it to an external/global tool.

Expected:

- Egress guard blocks or asks according to config.
- No outbound external request is made.
- Local-cleared route/tool alternative still works where configured.

Save:

```text
tasks/owner-checks/M2-04/egress-personal-replay.jsonl
```

### 4. Provenance-aware permission context

Run a research-injection fixture that leaves untrusted content in context, then triggers a privileged tool path.

Expected:

- Permission/audit context records untrusted/quarantined content presence or provenance summary.
- Do not require M5 capability narrowing unless implemented.
- Existing trusted direct user `fs.read` remains allowed.

Save:

```text
tasks/owner-checks/M2-04/provenance-permission-replay.jsonl
tasks/owner-checks/M2-04/provenance-permission-audit.txt
```

### 5. Governance friction canary

Run the deterministic canary command or suite.

Expected:

- Parseable report.
- Route-denied recovery succeeds in the fixture.
- Dead-end denial cases are visible.

Save:

```text
tasks/owner-checks/M2-04/governance-friction-canary.json
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named eval suite names.
3. Decisions:
   - egress guard scope and blocked surfaces,
   - redaction patterns and fingerprinting,
   - provenance permission context shape,
   - profile default behavior,
   - label conformance suite coverage,
   - friction canary shape.
4. Spec ambiguities.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
