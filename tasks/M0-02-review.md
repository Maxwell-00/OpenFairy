# Review: M0-02 delivery — ACCEPTED with one CI fix

Reviewer: Claude (Cowork) · 2026-07-02 · verdict on `tasks/M0-02-work.md` (commit `5748693`)

## Verified (via git HEAD content)

- **Echo responder containment ✓** — single file, single exported function, no loop/tool structure, M1 replacement comment present. Invariant ADR-012 not threatened.
- **Server ✓** — Bearer + `?token=` auth with `4401` close; `session.create` / `turn.input` / `event` (validated, turn.input-only) ops; gateway-authored envelopes (ULID, turn numbering, labels on every event); graceful shutdown with log flush.
- **Event log ✓** — per-session serialized JSONL appends + flush. (`fsync` on turn boundaries deferred to M1 with resume — noted, acceptable for write-only M0.)
- **Config discovery ✓** — matches the decided order exactly (flag/env → APPDATA/XDG → `fairy.workspace.yaml` walk-up with repo-root stop → defaults); data dir per platform; README present.
- **Mock client harness ✓** — schema-valid stream, per-session ULID monotonicity, M0 turn shape, unknown-`x.*` tolerance; e2e spawns a real gateway on an ephemeral port in a temp dir and validates `log.jsonl` from disk.
- Only new deps: `ws` + `@types/ws` ✓ (lockfile-consistent).

## CI outcome & fix

Windows matrix **green**; Ubuntu failed one test: `defaultDataDir({LOCALAPPDATA:"C:\\Data"}, "win32")` returned `C:\Data/fairy` on Linux — platform-parameterized helpers used the **ambient** `path.join`. Fixed by reviewer in `packages/config/src/loader.ts`: `win32.join` in both `win32` branches (4 sites), import extended. The test was correct; the implementation was host-dependent. Rule recorded in ARCHITECTURE §10: platform-parameterized path helpers must use `path.win32`/`path.posix` explicitly.

## Incidents recorded

1. **PRD.md NUL-byte tail** — Codex's toolchain appended 4 NUL bytes to `docs/PRD.md` (committed in `5748693`). Cleaned by reviewer from git content. Boundary reminder: M0-02 brief said do-not-touch `docs/`; the NUL write appears accidental, but the rule stands.
2. **Reviewer-side mount staleness** — the review environment served stale/truncated views of freshly written files, initially misdiagnosed as corruption; three `package.json` files were rebuilt from `pnpm-lock.yaml` (verified equivalent — user's full suite passed with them). Process fix now standing: **Codex delivers → owner commits (WIP ok) → review runs against git objects (`git show HEAD:…`), never against possibly-stale working-tree reads.**

## Doc edits applied (per proposed-edits contract)

- `docs/specs/protocol.md` — new §7 "Client operations (WS)": op frames, gateway-authored envelopes, raw stream, auth + 4401; conformance renumbered §8 and now covers the op contract.
- `docs/ARCHITECTURE.md` §10 — config discovery order + data dir + explicit-platform-join rule.
- `docs/specs/sandbox-security.md` §7 — auth mechanics + `dev-token` refuse-on-non-loopback requirement (M1).
- `docs/PRD.md` — NUL tail removed (content unchanged).

## M0 status

With CI green on both OS after the loader fix: **M0 exit criteria met — milestone closed.** Next: M1 first slice (replace echo wiring with kernel TurnRunner; CLI chat over WS; model gateway with one provider).
