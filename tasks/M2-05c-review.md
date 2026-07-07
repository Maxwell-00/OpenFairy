# M2-05c Review — Source encoding hygiene + OTP pattern stabilization

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-05c-encoding-hygiene.md`  
Delivery commit: `89e335d`  
CI: GitHub Actions `M2-05c #58`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-05c successfully removes the known mojibake OTP regex alternative, converts the enumerated runtime CJK regex anchors to ASCII-safe `\uXXXX` escapes, wires an encoding guard into `pnpm lint`, and preserves OTP/persona/research pattern behavior through regression tests.

## Evidence base

- Commit `89e335d` / `M2-05c`.
- Work report: `tasks/M2-05c-work.md`.
- Owner/check evidence:
  - `tasks/owner-checks/M2-05c/otp-check.txt`
  - `tasks/owner-checks/M2-05c/lint.txt`
  - `tasks/owner-checks/M2-05c/kernel-tests.txt`
- GitHub Actions run `28844951288`: success, matrix `verify`, 2 jobs completed.

## Acceptance review

### 1. Known mojibake removal + ASCII-safe regexes

**PASS.**

`packages/kernel/src/governance.ts` no longer contains the damaged OTP alternative. The OTP anchors now use ASCII `\uXXXX` escapes for simplified/traditional verification-code terms:

```ts
\u9a8c\u8bc1\u7801
\u9a57\u8b49\u78bc
```

The health/finance/legal category regex CJK alternatives were converted to `\uXXXX` escapes with ASCII-only explanatory comments.

`packages/kernel/src/persona.ts` and `packages/research/src/index.ts` were also converted for the enumerated runtime regex anchors. Research fixture/page data strings were left readable as raw CJK, per task boundary.

### 2. Encoding guard

**PASS.**

`scripts/check-encoding.mjs` was added and wired into the root `lint` script:

```json
"lint": "node scripts/check-encoding.mjs && eslint . --max-warnings=0"
```

The guard scans only `packages/**/src/**/*.ts`, `packages/**/test/**/*.ts`, `apps/**/src/**/*.ts`, `apps/**/test/**/*.ts`, and protocol schemas/fixtures JSON. It does not scan `docs/`, `docs-zh/`, `tasks/`, or owner-check evidence.

It fails on:

- U+FFFD replacement character;
- NUL bytes / NUL characters;
- known mojibake fragments encoded in the script as Unicode escapes.

Work report records a temporary negative fixture demonstration where `pnpm lint` failed on a blocklisted mojibake fragment, then passed after removal.

### 3. OTP + pattern regression tests

**PASS.**

Targeted kernel tests passed: 4 files, 31 tests. The evidence includes OTP/persona regression coverage, including:

- simplified verification-code anchor + digits triggers;
- traditional verification-code anchor + digits triggers;
- English OTP/code examples trigger;
- bare digits and near-miss port/amount strings do not trigger;
- persona thanks/distress/banned-corpus converted patterns still match;
- neutral strings do not match;
- research planner CJK heuristic still classifies as expected.

### 4. Scope / boundary compliance

**PASS.**

Commit `89e335d` changes 12 files:

- `package.json`
- `scripts/check-encoding.mjs`
- enumerated runtime files in `packages/kernel/src` and `packages/research/src`
- targeted tests
- work report
- owner-check evidence

No `docs/` or `docs-zh/` changes were included. No event types, suites, tools, config keys, vendor SDKs, or workflow files were added.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply the work report's proposed one-line docs notes to:
   - `docs/specs/sandbox-security.md`
   - `docs/specs/persona-affect.md`
   - `docs/specs/research.md`

2. **Work report formatting remains poor.**  
   `M2-05c-work.md` is compressed into very long lines. This does not affect correctness, but it makes review line-citation and diff reading harder. Codex should preserve normal Markdown line breaks in future reports.

3. **Potential future guard expansion.**  
   Current guard is intentionally narrow and correct for this task. If future mojibake appears in non-scanned paths, expand the guard deliberately; do not scan `docs-zh/` or owner evidence.

## NIT

- `tasks/owner-checks/M2-05c/otp-check.txt` may have raw-output encoding issues when fetched via some tools. The work report records the exact PASS output, and `pnpm lint` / kernel tests provide redundant evidence.

## Final decision

M2-05c is closed. Proceed to M2-06 perception after applying or deferring the reviewer-owned docs pass.

---

## Countersignature — Claude (Fable 5), 2026-07-07

Verified at code level at `89e335d` (all reads via `git show`). Confirms the verdict, with one substantive annotation the primary review missed and one process note.

**Annotation — this was not a pure no-op conversion, and that is a good thing.** Codex restructured the OTP alternation, moving the two CJK anchors outside the `\b(...)\b` group (`governance.ts:22-23,193-194`). Under the OLD pattern, the trailing `\b` after a CJK alternative required a word-character transition, which JavaScript never produces between a CJK char and a space — so space-separated forms (CJK anchor + ` 123456`, exactly the brief's D3 required case) previously did NOT match. The old CJK anchoring was latently broken; the egress guard could not catch a space-separated Chinese OTP until this commit. The brief's "semantic invariance" and its D3 acceptance were therefore in tension; Codex resolved it in the right direction (boundary placement only — English anchors keep `\b`, CJK anchors are bare explicit-context anchors; near-miss guards still hold) and disclosed it precisely in the work report's Spec Ambiguities. That disclosure is exactly the norm we cultivate — this is a model work report. The primary review's "preserves OTP behavior" wording is imprecise: detection *widened* (secure direction) for space-separated CJK OTP; recorded here so the trail is honest.

Verified in full: mojibake gone (fail-closed check PASS 4/4 at the delivery tree); `governance.ts` and `persona.ts` now contain zero raw CJK (sweep); persona/banned-corpus/planner conversions are alternative-for-alternative with ASCII-only gloss comments; research fixture data left readable per brief; guard script is pure ASCII, blocklist `\u`-escaped and even includes the two mangled search strings from the original M2-05 incident; scope = 12 files, no docs, no workflow edits, `lint` wiring as specified; disclosed known-remaining raw CJK punctuation splitter in `governance.ts` is outside the enumerated scope and legal under the guard.

**Process note (for future reviewers, added to handbook SS3.5):** the fail-closed check is shell-sensitive. Under bash double quotes, `\\u` collapses and node decodes the target to raw CJK, yielding a spurious FAIL (this reviewer hit it; re-ran with correct quoting => PASS). Under PowerShell the command works as written. Crucially the failure mode is FAIL, never false PASS — the fail-closed design held. Run it in PowerShell as written, or single-quote the node program in bash.

**Countersigned: M2-05c ACCEPTED WITH NOTES / CLOSED.** Docs pass applied (sandbox-security, persona-affect, research one-liners per work report SS5). Next: M2-06 perception, rebased onto `89e335d`.

