# Task M0-02 — Minimal gateway boot + mock client conformance

> Paste this entire file as the task brief. Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy` (remote: Maxwell-00/OpenFairy). This completes milestone M0.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — invariants (non-negotiable).
2. `tasks/M0-01-review.md` — what was accepted, what was fixed (CI is green as of the last push; keep it green).
3. `docs/ARCHITECTURE.md` §7 (client protocol), §8 (data architecture), §10 (config), §11 (deployment posture).
4. `docs/specs/protocol.md` — the event canon your gateway must speak; §7 conformance expectations.
5. `docs/specs/sandbox-security.md` §7 — network posture (localhost bind, token auth).

M0 exit criteria (ROADMAP): "empty-but-wired gateway boots; mock client passes protocol conformance; CI green."

## Deliverables

### 1. `apps/gateway` — minimal daemon
- Boots from `@fairy/config`; binds `127.0.0.1` only; single port (`gateway.port`, default `8787`).
- HTTP: `GET /health` → `{status:"ok", gateway_version, protocol_version:1, uptime_s}`; `GET /meta` → protocol version, supported event families (from the protocol registry), capabilities stub.
- WebSocket endpoint on the same port: token auth on connect (`gateway.auth.token`, may be plaintext dev token or `secret://` ref — resolve env-var-style for now, document as dev-only edge resolution), reject without token (4401 close).
- Client can: create a session (`session.created` emitted), send `turn.input`, receive a canonical event stream back.
- **Echo responder (wire-test placeholder, NOT a kernel):** on `turn.input`, emit 2+ `turn.delta` chunks echoing the input text, then `turn.final`. Lives in one file (`apps/gateway/src/dev/echo-responder.ts`), wired by one line, documented as "replaced by kernel TurnRunner in M1". Do not add tool calls, model calls, or any agent-loop structure to it.
- **Event log (write-only):** every emitted envelope appended to `<data_dir>/sessions/<sid>/log.jsonl`. Resume/snapshots are **M1 — out of scope**; write-only append is in scope because events-as-truth is an invariant from day one.
- Envelope discipline: ULIDs via `@fairy/protocol`, per-session monotonic ordering, correct `turn` numbering, `labels` present on every event (default `internal / global-ok` for now, sourced from config default).
- Graceful shutdown (SIGINT/SIGTERM): close WS connections, flush log appends, exit 0.

### 2. Config discovery (decide = this order, document it)
Resolution order (first found wins per layer; merge order stays defaults → user → workspace → session):
1. Explicit: `--config <path>` flag or `FAIRY_CONFIG` env.
2. User config: Windows `%APPDATA%\fairy\fairy.yaml`; macOS/Linux `$XDG_CONFIG_HOME/fairy/fairy.yaml` else `~/.config/fairy/fairy.yaml`.
3. Workspace: `fairy.workspace.yaml`, walking up from cwd (stop at repo root or filesystem root).
4. Built-in `defaults.yaml`.

Data dir: `gateway.data_dir`, defaulting to `%LOCALAPPDATA%\fairy` (Windows) / `$XDG_DATA_HOME/fairy` else `~/.local/share/fairy`. Document all of this in `packages/config/README.md`; propose (in your report, do not edit) a one-line addition to ARCHITECTURE §10.

### 3. `packages/testing` — mock client conformance harness (reusable)
- Client helper: connect + auth + create session + send fixtures + collect stream.
- Conformance assertions (reuse `@fairy/protocol` validation): every received event schema-valid; ULID monotonic per session; turn numbers correct; unknown `x.*` event injected by the harness is tolerated by the client helper itself.
- End-to-end test: spawn gateway on an ephemeral port (port 0 → report actual), run the mock client against it, assert the echo stream shape, assert `log.jsonl` on disk parses as valid envelopes. Must run in CI on both OS (temp dirs, no hardcoded paths).
- Move any conformance helpers currently living in `packages/protocol` tests that are reusable here (M0-01 follow-up); protocol package keeps only its own unit fixtures.

### 4. `fairy doctor` addition
- New check: gateway reachability (`/health` on configured port) — reports running/not-running, not an error when absent.

## Boundaries — do NOT

- No kernel, no TurnRunner, no model gateway usage, no LLM/vendor SDKs, no channels, no session resume/snapshots (all M1+).
- No new protocol event types and no schema edits. If the wire work reveals a genuine schema gap, **stop and list it in the report** — do not invent.
- New deps allowed: a WebSocket lib (`ws` + types) only. Justify anything else in the report.
- Do not weaken CI; both OS matrices must stay green including the new e2e test.
- Do not touch `docs/` (propose doc edits in the report instead — reviewer applies them).

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
pnpm --filter @fairy/gateway start   # boots, /health 200, /meta correct, Ctrl+C clean exit
e2e conformance test passes on windows-latest AND ubuntu-latest
```

## Report back (same format as M0-01)

1. File tree delta. 2. Verification tails (incl. e2e on both OS). 3. **Decisions made** (one line + reason each). 4. **Spec ambiguities found** (look hard; empty list is suspicious). 5. Proposed doc edits (for reviewer to apply). 6. Suggested M1 first slice.
