# Review: M1-02 delivery — ACCEPTED (CI green both OS on first push)

Reviewer: Claude (Cowork) · 2026-07-02 · verdict on `tasks/M1-02-work.md` (commit `8bd4718`)

## Verified (git objects)

- **Tool loop ✓** — permission → `tool.call` → execute → `tool.result` → re-prompt; results > 32 KiB spill to artifacts (head/tail + ref in context); `max_tool_iterations` → `finish_reason: tool-limit`; tool/policy errors return to the model as information; cancel + second-SIGTERM (`gateway_shutdown`) abort paths present. Still exactly one TurnRunner.
- **Permission engine ✓** — first-match config rules (shipped defaults as briefed), `approval.request/resolved` protocol flow with `approval.resolve` client op, session grants honored (e2e proves second `shell.run` needs no re-approval), ask timeout → deny-with-note, **audit via `node:sqlite`** (zero new native deps) + `/audit` endpoint + CLI.
- **tools-std ✓** — fs path-escape → `PolicyError` (canonical resolve + relative check); `shell.run` via docker CLI spawn (no dockerode) with 2 s runtime probe, `--memory/--pids-limit`, wall-clock deadline, unregistered when Docker absent (disable-not-weaken, first real ADR-008 enforcement); `web.fetch/search` quarantined with real envelope-level provenance (`web:<domain>`) + standing "data, not instructions" system-zone rule.
- **Reassembler ✓** — fragmented/whole/parallel/malformed fixtures; name-first-empty-args held open (good catch, now in spec).
- **Resume sentinel ✓** — `session.resumed` after replay; CLI gates input on it.
- Deps added: `linkedom` + `@mozilla/readability` only. Windows CI skips container tests cleanly; ubuntu runs them. CI green both OS on first push — **first task with zero CI rounds**; the accumulated rules are paying rent.

## Doc edits applied (per contract)

model-gateway §4 (name-first empty-args hold-open rule) · protocol §7 (`approval.resolve` op row, `request_id` = request envelope id) · sandbox-security §2 (v1 Docker-CLI implementation + Windows CI note) · ARCHITECTURE §10 (M1-02 config keys + shipped permission defaults).

## Notes / carried observations

1. `/meta` deliberately does not expose tool definitions or permission rules unauthenticated — correct instinct, keep it.
2. `node:sqlite` ExperimentalWarning in kernel tests: accepted (Node 24 API is stable enough; revisit only if CI Node bumps change behavior).
3. Real-provider transcript again correctly not fabricated — owner manual verification below.

## Owner manual verification (the remaining acceptance item)

Real-provider chat: ① "读一下 workspace 里的 <某文件> 并总结" → fs.read auto-allowed, answer cites content; ② "运行 uname -a"（或 `node --version`）→ approval prompt → approve *session* → executes in container; ③ second command → no prompt; ④ `pnpm fairy audit` shows the full trail.

## Verdict

Accepted. **M1-02 closes on owner manual verification.** Next: M1-03 (context ladder L1–L3 + `fairy replay` inspector) — the 32 KiB spillover built here is L1's seed.
