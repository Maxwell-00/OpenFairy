# M2-04 Work Report

## 1. File tree delta

Changed:

- `apps/cli/package.json`
- `apps/cli/src/chat.ts`
- `apps/cli/src/replay.ts`
- `apps/cli/test/replay.test.ts`
- `apps/gateway/src/config.ts`
- `apps/gateway/src/server.ts`
- `packages/config/defaults.yaml`
- `packages/config/src/schema.ts`
- `packages/config/test/loader.test.ts`
- `packages/kernel/src/governance.ts`
- `packages/kernel/src/index.ts`
- `packages/kernel/test/index.test.ts`
- `packages/testing/package.json`
- `packages/testing/test/gateway.e2e.test.ts`
- `pnpm-lock.yaml`

Added:

- `apps/cli/test/audit.test.ts`
- `packages/testing/test/governance.evals.test.ts`
- `tasks/M2-04-work.md`

Not changed:

- `docs/`
- `docs-zh/`

## 2. Verification tails

Local commands:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:15236"; $env:HTTPS_PROXY = "http://127.0.0.1:15236"; pnpm install
```

Result: PASS. Lockfile passed supply-chain policies; install was already up to date.

```powershell
pnpm lint
```

Result: PASS, `eslint . --max-warnings=0`.

```powershell
pnpm -r typecheck
```

Result: PASS across workspace packages, including `@fairy/kernel`, `@fairy/cli`, `apps/gateway`, and `@fairy/testing`.

```powershell
pnpm -r test
```

Result: PASS.

Tail highlights:

- `packages/protocol`: 107 passed.
- `packages/config`: 10 passed.
- `packages/model-gateway`: 20 passed.
- `packages/research`: 14 passed.
- `packages/tools-std`: 4 passed, 3 skipped.
- `packages/kernel`: 15 passed.
- `apps/cli`: 7 passed.
- `packages/testing`: 44 passed, 1 skipped.

Named suites observed:

- `memory.leakage`
- `memory.deletion-permanence`
- `research.citation-precision`
- `research.zh-en-parity`
- `injection.research-v0`
- `label.conformance`
- `governance.friction-canary`

```powershell
pnpm dep-check
```

Result: PASS, `no dependency violations found (84 modules, 217 dependencies cruised)`.

```powershell
pnpm conformance
```

Result: PASS in mock mode, 18/18 cases passed.

```powershell
git diff --check
git diff --name-only -- docs docs-zh
```

Result: PASS. No whitespace errors; no docs/doc-zh diffs.

CI link/status:

- Not observed in this local turn. No push was performed from this workspace.
- Local acceptance commands from the brief passed.

## 3. Decisions

Egress guard scope and blocked surfaces:

- Added `EgressGuard` in `packages/kernel/src/governance.ts`.
- Default external tools are `web.*` and `shell.run`, configured through `governance.egress.external_tools`.
- `governance.egress.personal_allowed_tools` is the allow-list for personal-context egress.
- The guard runs before permission checks and before tool execution, so denied `web.fetch`, `web.search`, and `shell.run` calls do not reach network/tool execution.
- Denials use existing event types only: redacted `tool.call`, `progress.update` with `stage: "egress.denied"`, redacted `tool.result`, and audit rows with `op: "egress.denied"`.
- No new canonical event type was added.

Redaction patterns and fingerprinting:

- Redaction utilities live with governance helpers: `detectSensitiveText`, `redactText`, `redactDiagnostics`, and `sensitiveFingerprint`.
- Covered patterns include bearer tokens, private keys, env-style secrets, API-key/token assignments, standalone API-key-shaped tokens, passwords/secrets, and context-anchored OTP-like codes.
- Bare 4-8 digit values do not trigger OTP escalation unless an anchor term is nearby.
- Redaction markers include deterministic short SHA-256 fingerprints and are idempotent, so `[REDACTED:...]` markers are not re-redacted.
- Egress decisions expose redacted match text only; audit/error/replay diagnostics do not echo raw secret or personal context.

Provenance permission context shape:

- `PermissionContext` now carries `channelTrust`, `sandboxProfile`, `untrustedContentPresent`, and `provenanceSummary`.
- `PermissionRule` supports `channel_trust`, `untrusted_content`, and `provenance` through the existing config loader/schema path.
- Gateway turn input maps `channel: "untrusted"` and `channel: "external"` to `channelTrust: "untrusted"`.
- Research quarantine/source provenance is summarized from tool-result context, including `Source: web:<domain>` quarantine headers.
- Implemented enforcement is deterministic rule matching only. Broad M5 capability narrowing remains out of scope.

Profile default behavior:

- Governance profile names are closed to `balanced`, `sovereign`, and `cloud-friendly`.
- `profileDefaults()` centralizes default source label tables.
- Gateway user-input defaults now use `profileDefaults(profile).userInputTrusted.labels`.
- Existing `home_regions` ownership and provider region validation remain in the config path.
- Invalid profile names and region-restricted providers without `regions` are covered by config tests.

Label conformance suite coverage:

- Added deterministic `label.conformance` in `packages/testing/test/governance.evals.test.ts`.
- Coverage includes derivation laws, semantic escalation, near-miss non-escalation, provider clearance denial before provider I/O, egress blocking, and redaction diagnostics.
- Suite uses mock providers/tools only and no real secrets.

Friction canary shape:

- Added deterministic `governance.friction-canary` as PR-tier test coverage, not a scheduler or notification service.
- The canary emits a parseable JSON-like report in test code with governance interruption count, route-denied recovery result, and dead-end denial count.
- The fixture proves a route-denied primary can recover through a cleared fallback.

CLI/replay visibility:

- `fairy audit --json` returns parseable audit JSON; text audit includes redacted details.
- Text replay renders egress denial compactly as `egress.denied <reason>`.
- Replay text mode redacts secret-shaped content as a derived diagnostic surface.
- Replay JSON preserves source events, while diagnostic event payloads are redacted.

## 4. Spec ambiguities

- Whether `EgressGuard.matches` should expose raw matched text was not explicit. This implementation returns redacted match text and fingerprints only, because the decision can cross diagnostic/test surfaces.
- Personal/context redaction is exact-string based for label-bearing prompt context. This is deterministic but intentionally not semantic paraphrase detection.
- Provenance rules match summarized recent provenance. They do not claim causal attribution from untrusted content to each tool call.
- `shell.run` remains treated as an egress surface because command/env args can carry secrets outside the session boundary, even when the local sandbox ultimately mediates execution.
- GitHub Actions green status requires a pushed branch/PR; this report records local acceptance only.

## 5. Proposed docs edits

These are proposals only. No `docs/` or `docs-zh/` files were edited.

### `docs/specs/data-governance.md`

- Add M2 Egress Guard v1 status: default external tool globs, pre-execution blocking, secret-pattern scanning, personal/context exact-match scanning, and configured personal egress allow-list.
- Document profile default tables for `balanced`, `sovereign`, and `cloud-friendly`.
- Clarify that invalid governance profile names are rejected by config validation.
- Clarify that label conformance is registered as deterministic PR-tier coverage.

### `docs/specs/sandbox-security.md`

- Add provenance-aware permission context v0 fields: channel trust, sandbox profile, untrusted content presence, and recent provenance summary.
- State that M2 egress guard covers outbound tool args before network/process execution for `web.*` and `shell.run`.
- Explicitly keep broad capability narrowing as M5 unless implemented with precise causal attribution and tests.

### `docs/specs/evals.md`

- Register `label.conformance`.
- Register `governance.friction-canary` v0.
- Note that both suites are deterministic and use mock providers/tools only.

### `docs/specs/protocol.md`

- Clarify egress denials use existing canonical event types: `tool.call`, `progress.update`, `tool.result`, and audit rows.
- State that no `egress.denied` canonical event type exists; `egress.denied` is a stage/op string only.
- Document that denial diagnostics must carry reason codes and fingerprints without raw secret/personal strings.

### `docs/specs/research.md`

- Clarify that M2 research quarantine remains firewall/quarantine behavior.
- Note that provenance-aware permission context is governance hardening and separate from full M5 capability narrowing.
- Mention that research source provenance such as `web:<domain>` may be summarized into permission audit context.

## 6. Manual owner checklist

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

- `tasks/owner-checks/M2-04/testing-governance.txt`

### 2. Secret egress denial

Run a mock/fixture turn where the model attempts to pass `sk_test_1234567890abcdef` to an outbound tool arg.

Expected:

- Tool is denied before execution/network/container spawn.
- Audit/replay shows `egress.denied` and reason `api_key`.
- Raw fake key does not appear in audit/replay text/diagnostic error surfaces.
- JSON evidence contains a `[REDACTED:api_key:<fingerprint>]` marker or fingerprint, not raw key, in diagnostic payloads.

Save:

- `tasks/owner-checks/M2-04/egress-secret-replay.jsonl`
- `tasks/owner-checks/M2-04/egress-secret-audit.txt`

### 3. Personal/local-only egress denial

Seed or use fixture personal/local-only memory/research content and attempt to send it to an external/global web tool.

Expected:

- Egress guard blocks or asks according to config.
- No outbound external request is made.
- Local-cleared route/tool alternative still works where configured.

Save:

- `tasks/owner-checks/M2-04/egress-personal-replay.jsonl`

### 4. Provenance-aware permission context

Run a research-injection fixture that leaves untrusted content in context, then triggers a privileged tool path.

Expected:

- Permission/audit context records `untrustedContentPresent: true`.
- Provenance summary includes the fetched `web:<domain>` source.
- Existing trusted direct user `fs.read` remains allowed under default config.
- Any denial must come from explicit deterministic config rules, not broad M5 narrowing.

Save:

- `tasks/owner-checks/M2-04/provenance-permission-replay.jsonl`
- `tasks/owner-checks/M2-04/provenance-permission-audit.txt`

### 5. Governance friction canary

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `governance.friction-canary` appears and passes.
- Parseable report data is produced by the fixture.
- Route-denied recovery succeeds.
- Dead-end denial cases are visible in the report shape.

Save:

- `tasks/owner-checks/M2-04/governance-friction-canary.json`
