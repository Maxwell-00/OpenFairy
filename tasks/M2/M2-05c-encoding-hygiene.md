# Task M2-05c — Source encoding hygiene + OTP pattern stabilization

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M2-01 through M2-05b closed. Run this BEFORE M2-06 perception (it owns the mojibake cleanup that M2-06 Deliverable 0 previously carried; M2-06's brief has been amended to point here).
>
> Why now: during M2-06b/M2-05b, patches near CJK-bearing source lines repeatedly collided with terminal/tool encoding (patch context encoding collisions, in the owner's words), and the M2-05 mojibake incident showed such damage can survive two green reviews. This task removes the known damage, converts the collision-prone anchors to ASCII-safe form, and adds a CI guard so the failure class is detected mechanically instead of by reviewer luck.
>
> Scope is tiny and mechanical. Semantics must not change: every pattern must match exactly what it matched before (minus the mojibake garbage alternative).

## Context — read first

1. `REVIEWER-HANDBOOK.md` §3.5 — the encoding landmine and the fail-closed verification rule.
2. `tasks/M2-05-review.md` countersignature — the original mojibake incident (invalid `rg` check → false "handled").
3. Known raw-CJK inventory in runtime src at HEAD (reviewer-enumerated; verify with the guard you build):
   - `packages/kernel/src/governance.ts` — OTP anchor regexes ×4 (lines ~22-23, ~193-194, each containing the mojibake alternative after the traditional-Chinese term) + health/finance/legal category regexes (~34, 39, 44).
   - `packages/kernel/src/persona.ts` — `thanksPattern` (~265), `distressPattern` (~266), three banned-corpus regexes (~408-410). (`negativeFeedbackPattern` already uses `\uXXXX` — that is the target style.)
   - `packages/research/src/index.ts` — planner heuristic regexes (~134, 137, 155, 158). The Chinese *fixture data strings* and generated subquery templates in this file are DATA, not patch anchors — leave them as readable raw CJK.

## Deliverables

### 1. Remove the known mojibake + convert runtime regex literals to `\uXXXX`

- In `packages/kernel/src/governance.ts`: rewrite the four OTP regexes so the anchor alternation contains exactly the semantic alternatives (`otp`, `one[-\s]?time`, `verification`, `verify`, `code`, simplified yanzhengma as `\u9a8c\u8bc1\u7801`, traditional as `\u9a57\u8b49\u78bc` (codepoints given in ASCII on purpose — do not retype CJK from this brief)) — the mojibake fourth alternative is gone. Convert the health/finance/legal category regexes' CJK alternatives to `\uXXXX` escapes with a trailing ASCII-safe comment — English gloss or transliteration, e.g. `// zh: diagnosis/doctor/medical-record terms (escapes above)` — NEVER raw CJK in comments either (a raw-CJK comment next to a converted regex would recreate the exact patch-anchor hazard this task removes; readable Chinese belongs in the work report / docs proposal, not runtime src).
- In `packages/kernel/src/persona.ts`: convert `thanksPattern`, `distressPattern`, and the three CJK banned-corpus regexes to `\uXXXX` escapes, same ASCII-safe comment convention.
- In `packages/research/src/index.ts`: convert the four planner heuristic regexes to `\uXXXX`; do NOT touch the fixture body/title data strings or subquery template strings.
- Semantic invariance is mandatory: for each converted pattern, the new literal must be character-for-character equivalent to the old (minus mojibake). No new alternatives, no dropped alternatives, no flag changes.

Acceptance:

- Fail-closed OTP alternation check (ASCII-only; post-conversion the anchor appears in source as the literal escape text `\u9a57\u8b49\u78bc`):

```powershell
node -e "const s=require('fs').readFileSync('packages/kernel/src/governance.ts','utf8');const tw='\\u9a57\\u8b49\\u78bc';const closed=(s.split(tw+')').length-1);const open=s.includes(tw+'|');if(closed!==4||open){console.error('FAIL: OTP alternation not clean; closed='+closed+', trailing-pipe='+open);process.exit(1)}console.log('PASS: OTP anchor alternation clean (4/4)')"
```

  Paste the exact command + output into the work report. If your conversion legitimately changes the count (it should not), STOP and explain rather than adjusting the check.
- Semantic-equivalence tests (Deliverable 3) green before and after conversion.

### 2. Encoding guard in CI

Add a small ASCII-only guard script (e.g. `scripts/check-encoding.mjs`) that scans `packages/**/src/**/*.ts`, `packages/**/test/**/*.ts`, `apps/**/src/**/*.ts`, `apps/**/test/**/*.ts`, and `packages/protocol/schemas|fixtures/**/*.json` and FAILS on:

- any `U+FFFD` replacement character;
- any NUL byte;
- any fragment from a small blocklist of known mojibake sequences (the GBK/UTF-8 double-encoding artifacts seen in this repo) — the blocklist entries themselves MUST be written as `\uXXXX` escapes in the script source, never raw.

Constraints:

- Do NOT scan `docs-zh/`, `docs/`, `tasks/`, or owner-check evidence.
- Raw CJK is NOT banned — the guard targets damage markers, not Chinese. Research fixture data and test strings stay legal.
- Wire it into an existing gate so CI runs it without workflow-file edits (e.g. append to the root `lint` script). Document the wiring in the work report Decisions.
- The script itself is pure ASCII and dependency-free (node builtins only).

Acceptance:

- `pnpm lint` (or the documented existing gate) fails when a file containing a blocklisted fragment / U+FFFD / NUL is present — demonstrate with a temporary fixture, then remove it (describe in work report; do not commit the violation).
- Guard passes on the cleaned tree, both CI OSes.

### 3. OTP + pattern regression tests

- OTP: the simplified anchor (`\u9a8c\u8bc1\u7801`) followed by ` 123456` triggers; the traditional anchor (`\u9a57\u8b49\u78bc`) followed by ` 123456` triggers; build these test strings FROM THE ESCAPES in code (e.g. `const zh = '\u9a8c\u8bc1\u7801' + ' 123456'` — JS decodes at runtime), never by pasting CJK; `otp 4821` / `verification code 55555` trigger; near-miss strings — port-zh (`\u7aef\u53e3`) + ` 123456`, amount-zh (`\u91d1\u989d`) + ` 123456`, and bare `123456` — do NOT trigger. For all new regression tests in this task, build zh test strings from `\uXXXX` escapes in code; do not paste new raw CJK strings into test files. Existing raw CJK fixture/data strings outside the touched regex/test lines may remain unchanged.
- Persona: one thanks string (thanks-zh, codepoints `\u8c22\u8c22`), one distress string (`\u5d29\u6e83`), one banned-corpus string (`\u4f60\u79bb\u4e0d\u5f00\u6211`) still match their converted patterns; a neutral string matches none. Build all zh test strings from escapes in code, never pasted CJK.
- Research planner: one zh intent containing the research and memory terms (codepoints `\u8c03\u7814` and `\u8bb0\u5fc6`) still classifies as before conversion (locale fan-out unchanged).
- Existing OTP/egress/persona/research unit tests unchanged and green — if any existing test fails after conversion, the conversion is wrong; fix the conversion, never the test.

### 4. Docs proposals only

No `docs/` or `docs-zh/` edits. In `tasks/M2-05c-work.md`, propose: `docs/specs/sandbox-security.md` one-line note that secret-pattern sources are ASCII-escape-encoded with a CI encoding guard; anything else you touched.

## Boundaries — do NOT

- Do not change any pattern's semantics, flags, or match set (beyond deleting the mojibake alternative).
- Do not re-encode, reformat, or "normalize" any file wholesale; touch only the enumerated lines + the new script + tests.
- Do not convert data strings, test strings, or anything in `docs-zh/`; do not delete Chinese from the repo.
- Do not widen OTP detection (no bare-digit matching — the context-anchor rule from M2-04 stands).
- Do not scan `docs-zh/` in the guard.
- Do not edit CI workflow files; hook an existing script gate.
- Do not touch `packages/kernel/src/index.ts`, `context.ts`, or anything M2-06 will rebase onto beyond the three enumerated files.
- No new event types, suites, tools, config keys; no vendor SDKs.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions green on ubuntu + windows.

## Manual owner checks

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05c
```

1. Run the (adjusted) fail-closed OTP alternation check → PASS; save output to `tasks/owner-checks/M2-05c/otp-check.txt`.
2. `pnpm lint` on clean tree → green (guard included); save tail to `tasks/owner-checks/M2-05c/lint.txt`.
3. `pnpm --filter @fairy/kernel test -- --reporter=verbose` → OTP/persona regression tests visible and green; save to `tasks/owner-checks/M2-05c/kernel-tests.txt`.

## Report back

Established format: file tree delta; verification tails; Decisions (escape conventions, guard wiring, blocklist contents as `\uXXXX`); spec ambiguities (non-empty — at minimum: how you adjusted the fail-closed check for the escape form); proposed docs edits; owner checklist.
