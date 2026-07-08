# Reviewer Handbook — for the Claude taking over this seat

Written 2026-07-03 by the Claude (Fable 5) that held this role from the first design doc through M2-04. If you are a Claude (Opus 4.8 Max, Fable 5 High, or later) opening a fresh Cowork conversation on this project: this file is your inheritance. Read it before acting. It is deliberately on disk and versioned — the institutional memory of this project lives in files, not in any one model's context.

## 1. Your role in the three-party loop

**Codex (ChatGPT 5.5) implements. ChatGPT-5.5-Pro reviews first. You gate, verify, and countersign.** The owner (Maxwell, communicates in Chinese, commits via GitHub Desktop on Windows) carries artifacts between parties.

The loop, per task slice:
1. A task brief (`tasks/M<x>-<nn>-<name>.md`) is gated by you *before* dispatch — spec-fidelity audit (see §4).
2. Owner dispatches to Codex → Codex delivers + writes `tasks/M<x>-<nn>-work.md` → **owner commits before you review** (non-negotiable, see §3).
3. ChatGPT-Pro writes `tasks/M<x>-<nn>-review.md` (primary review).
4. You verify at code level and **countersign** (append to the review file), apply reviewer-owned doc edits, patch the next brief, thread carry-ins.

Division of judgment, learned from experience: ChatGPT-Pro's delivery reviews reach correct verdicts but are **trust-based** (work report + owner artifacts, rarely code reading with file:line evidence). Its briefs are structurally good but weak on **spec fidelity** — it has invented config values not in any spec (`regions: [global]`, `local-preferred`), missed derivation subtleties (labels must compose over the WHOLE assembled prompt, not the current input), used wrong owner-environment examples (`home_regions` is `[cn]`), and skipped evals.md suite registration. Your verification and brief-gating exist precisely to cover these holes. Also: Codex and ChatGPT are the same vendor family — correlated blind spots are real (the dotted-tool-name incident was an OpenAI-convention blind spot). You are the cross-vendor eye.

**Cost directive from the owner:** delegate sizable self-contained verification (delivery code-reads, multi-file audits) to an **opus subagent** with a tight evidence-checklist prompt; do inline only what is too small to amortize a subagent cold start. The M2-01 verification prompt (see that review's countersignature and the conversation records) is the template: read-only, explicit git commands, fixed return format with file:line evidence.

## 2. Where everything lives

- `docs/` — **normative**. PRD (FR/NFR ids), ARCHITECTURE, ROADMAP (milestone gates), DECISIONS (20+ ADRs, append-only law), 12 specs. Specs win arguments.
- `tasks/` — the implementation trail: brief → work report → review (+ countersignature). **Read the newest 2–3 review files first when orienting**; every incident and its standing rule is recorded there.
- `CLAUDE.md` / `AGENTS.md` — identical twins (sync with `cp CLAUDE.md AGENTS.md` after edits); the coding-agent contract.
- `.auto-memory/` in the parent folder — Claude session memory (compressed project history). Background, not authority; files win.
- Parent folder (`E:\...\Fairy\`) — non-repo material (`ChatGPT_Suggestions/`, `docs-zh/` owner-maintained translations — never edit, flag re-translation when English docs change).

## 3. Environment landmines (each cost us a debugging round)

1. **Mount staleness:** the Cowork mount serves stale/truncated reads of files recently written on the Windows side — looks like mid-token corruption. Never trust working-tree reads for fresh files. Read via `git --no-optional-locks show HEAD:<path>`. Never `Edit` from a possibly-stale view — compose full content from git truth and `Write`.
2. **Git locks:** plain `git` commands leave orphan `index.lock` on this mount. Always `git --no-optional-locks`. Never commit/checkout/restore from the sandbox — the owner commits locally.
3. **Deletes need permission** and the owner will ask what you're deleting — list files and reasons *before* attempting.
4. Owner environment: Windows + Docker Desktop (WSL2), pnpm via corepack (`packageManager` pinned; new native build scripts need `pnpm approve-builds` **and the approval file must be committed** or CI breaks), conda/uv habits (Python side only), provider keys via `FAIRY_SECRET_<NAME>` env in the gateway terminal, `pnpm fairy <cmd>` for CLI.
5. **CJK/encoding verification through Windows terminals is unreliable.** M2-05 incident: Codex was told to remove a mojibake regex alternative and verify with `rg "<mojibake>"`; the target string got re-mangled by the terminal before the search ran, "no matches" was reported honestly, and the mojibake survived two green reviews. Rule: any check involving non-ASCII target strings must be written with `\uXXXX` codepoint escapes inside a `node -e` script (fully ASCII on the command line), never by pasting raw CJK. Reviewers: verify such claims by `git show` + grep yourself, not from work-report tails. Second-order trap (M2-05c): the escape-form check is shell-sensitive — bash double quotes collapse `\\u` so node decodes to raw CJK and reports a spurious FAIL; PowerShell passes it through as written. Fail-closed design means the artifact is always FAIL, never false PASS — if a check fails unexpectedly, suspect your shell quoting before suspecting the code. Also: JS `\b` is inert adjacent to CJK — never wrap CJK regex alternatives in `\b...\b` (the pre-M2-05c OTP anchors silently failed on space-separated forms because of this).

## 4. Review method

**Delivery verification (countersignature standard):** verify the brief's critical items at code level with file:line evidence, via `git show`/`git grep` at the delivery commit. Always run the checks the primary review merely recommends. Standard invariant sweep: exactly one TurnRunner; no vendor SDKs (`git grep "from \"openai\|@anthropic"`); no provider strings in `packages/kernel`; no new event types outside `docs/specs/protocol.md` §2 registry; schemas+fixtures for anything new; dep-cruiser rules intact.

**Brief gating checklist:** every config key/value exists in a spec (or is explicitly proposed as a doc edit); derivation/composition rules stated where labels or budgets flow across components; carry-ins from the last review threaded in; eval suites named per `docs/specs/evals.md` registry ("new capability lands with its suite"); boundaries exclude the next slices explicitly; owner-env examples correct; acceptance is command-runnable, both CI OSes; report-back format kept (file tree / tails / decisions / **spec ambiguities — an empty list is suspicious** / proposed doc edits / owner checklist).

**Docs are reviewer-owned.** Codex and ChatGPT propose; you apply. Apply promptly after countersigning or edits get lost between tasks. Event types must be registered in protocol.md *before* implementation; additive-minor evolution rules apply; config keys get spec-registered.

**Reward disclosure.** Codex has honestly declined to fake transcripts and disclosed incomplete verification steps; this norm was cultivated deliberately. Praise it in reviews; never punish honest gaps — punish silent ones.

## 5. Standing engineering rules (incident-derived; enforce, don't relitigate)

Origins in the corresponding `tasks/*-review.md` addenda.

1. Source-first workspace: `exports.import` → `src/index.ts` everywhere; never `dist/` exports; never gate a test on building a sibling.
2. One execution world: everything runs via tsx (`node --import tsx entry.ts`); spawning plain `node` on `.ts` or `dist/` is a bug until M5 packaging.
3. Crash tests kill the process under test, never a wrapper (POSIX orphans defeat the test).
4. Every environment probe carries a deadline; in-container probes carry their *own* deadline (never rely on resolver/library defaults — DNS under `--network none` is nondeterministic); docker-dependent tests declare explicit generous timeouts; CI pre-pulls the sandbox image.
5. The mock provider must reject what real providers reject (wire-format constraints live in the mock, or e2e green is meaningless). Corollary: owner manual tests on real providers are irreplaceable — they caught what every green CI hid.
6. Provider quirks are fixed in the transport + a fixture, never as kernel special-cases (vitest guard exists; upgrading it to a dep-cruiser rule is an open nice-to-have).
7. Local green ≠ CI green only when environments diverge; since the single-world fix they match — trust local runs, but CI on both OSes is the gate. `windows-latest` cannot run Linux containers; skip container tests there with visible reasons.
8. Labels: residency is a closed hard enum; `prefer_local` is a hint, never gating; escalation is table-driven and one-way; effective labels derive over the whole assembled prompt including the memory digest; a denied provider receives zero request bytes.
9. Briefs scope `git grep` acceptance assertions to code paths (`-- packages apps`), or they match the brief itself.
10. CI is secret-free and Ollama-free; live conformance is owner-run (`pnpm conformance --model <id>`); verdicts distinguish pass/fail/skip/degraded — never overload PASS.

## 6. Current state (as of writing — verify against git log and newest review files)

M0–M1 closed (text spine). M2 functional slices M2-01 through M2-08 are closed, including M2-06b acceptance-debt hardening, M2-05b affect cache/negative-feedback, and M2-05c encoding hygiene. M2-06 perception service is closed at `ceb2a74` (mock artifact pipeline, `vision.describe`/`vision.ocr`, `perception.quarantine-v0`; real vision/OCR provider + `perception.vision` role wiring remain future work). M2-07 context ladder L4/L5 is closed at `dd3b0a6`, and its two exit carry-ins were discharged by M2-08. M2-08 Chronicle v1 + dream-cycle v0 is closed at `5f3ef12`; consolidation is deterministic/no-model, canary + contradiction benchmarks remain visibly deferred, and synthetic session dirs under `sessions/` are an accepted accounting note. M2-09 exit consolidation is drafted in `tasks/M2-exit-review.md` with the actual 13 named suites visible/green, explicit ROADMAP deferrals, the sqlite-vec vs LanceDB decision note, and M3 preconditions. Docs passes through M2-08 are already applied; `docs-zh/` re-translation remains owner-maintained. Parallel Cowork conversations exist — check their outputs in `tasks/` rather than assuming this file knows everything.

M2-05 landed clean on its hard rails (deterministic affect, substance invariance test-gated, off switches, no model-set mood). Note for future suite-reading: legacy gateway E2E now default `persona.enabled=false`; enabled-persona coverage lives in the dedicated persona E2E + kernel/evals tests.

## 7. Working with the owner

Communicate in Chinese; keep docs/code English. Be direct about verdicts; the owner values honest root-cause narration over reassurance, and has consistently accepted "my previous fix caused this" when said plainly — say it plainly (this seat's own misfixes are logged in the M1-01 addenda; keep that tradition). Explain money-costing steps before running them. When CI fails: read the log first, locate the root cause, fix from git truth, and record the incident as a rule in the relevant review file. When the owner asks "能不能换掉你" — the answer that served well: give the honest structural argument, then defer; the review-file discipline, not any particular model, is the project's memory
