# Review: M1-03 delivery — ACCEPTED (CI green both OS on first push)

Reviewer: Claude (Cowork) · 2026-07-03 · verdict on `tasks/M1-03-work.md` (commit `05b508c`)

## Verified (git objects)

- **Reduction path is model-free ✓** — zero `.generate()` calls in `packages/kernel/src/context.ts`; L1 (folded 32 KiB spillover) → L2 (tool-body elision) → L3 (deterministic turn snipping) only. L4/L5 seams left for M2 as briefed.
- **Pinning + append-only ✓** — kernel unit test asserts L1–L3 determinism, verbatim user-message survival, append-only input history, and `prefix_hash` stability across turns; e2e proves pinned content survives a full ladder run.
- **Projection includes output reserve ✓** — `projected_tokens = prompt + output_reserve` (model `max_output`, else 4096); budget switches with the model's window (test-asserted).
- **CJK-aware estimator ✓** — CJK codepoint ranges weighted at 1/1.6 vs ASCII /4; zh/en/mixed unit tests against usage fixtures.
- **`context.manifest` ✓** — schema #46 + valid/invalid fixtures + registry entry; test asserts the prompt never contains manifest content (observability can't leak into context).
- **`fairy replay` ✓** — offline over `log.jsonl`, `--manifests`/`--turn`/`--json`/`--data-dir`; corrupt-tail test warns and still renders (hard-kill tolerant).
- **Audit e2e carry-in ✓** — two call sites drive `/audit?limit=N` (the exact query path that shipped broken in M1-02).

## On the manifest sample (why row 2 shows only L1)

`projected 9035 ≫ budget 350` with only `L1` applied is **correct, honest behavior**: at turns 1–2 every turn is inside `min_recent_turns` protection, so L2/L3 have nothing eligible — the ladder runs, reclaims what it may, and the call proceeds (mock has no real window). By turn 3 old turns become eligible and `L1,L2,L3` drop history 8953 → 576. The e2e configures `reduce_at: 0.5 / output_reserve: 120 / min_recent_turns: 1` explicitly to force the sequence. Constant `prefix_hash` across rows is by design (stable prefix = system + tools zones).

## Honesty notes

- Codex disclosed that its final local `pnpm install --frozen-lockfile` re-check hit a pnpm-store lock and did not complete, rather than claiming it did. CI green on both OS covers it (no lockfile changes in this task). Disclosure over pretense — keep rewarding this.

## Doc edits applied (per contract)

context-engine §6 (normative M1-03 manifest payload, prefix-hash semantics, observational-only rule) · protocol §2 Context row (never enters prompt assembly, test-asserted) · ARCHITECTURE §10 (context.* keys; `models[].context_window`/`max_output` accepted top-level or under capabilities) · ARCHITECTURE §10 observability (`fairy replay` usage).

## Verdict

Accepted. Optional owner check: `pnpm fairy replay <sid> --manifests` on a real session (mock e2e is the gate; real replay is the feel-check). **M1 remaining: M1-04** — second provider + `openai-chat` conformance kit v1 + fallback chains + prompted-tools fallback + op-ack uniformity carry-in (M1-01 review) — closes milestone M1.
