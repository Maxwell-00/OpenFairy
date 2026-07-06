# M2-03 Brief Gate — Research Orchestrator v1

Gate date: 2026-07-06
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M2-03 is unbuilt.
Brief under review: `tasks/M2-03-research-orchestrator.md`
Repo: `Maxwell-00/OpenFairy` · HEAD `4e88db3` (M2-02 closed).

---

## M2-02 countersign (precondition)

M2-03 depends on M2-02 being closed. I re-verified the M2-02 acceptance from committed code (`ea19a3a`..`c82d582`), not the report. **Upheld.**

- MemoryStore is a rebuildable projection: `rebuildFromSessionLogs()` clears then replays `memory.written/deleted/superseded`; session JSONL stays source of truth. PASS.
- Secret rejected at projection insert on **both** paths: `MemoryStore.insert()` throws on `sensitivity==="secret"`, and `insertFromWrittenEvent()` throws before insert. The direct-store-insert bypass is closed. PASS.
- Retrieval gate returns `phase:"retrieval"` with reason + id + labels, never record text; `memory.leakage` asserts denial JSON contains no `pwsh`/`favorite shell`. PASS.
- **Label composition into route clearance (the hard one): verified end to end.** `#buildMemoryDigest` → digest carries `deriveMemoryLabels(admitted)` → injected as a system message (`context.ts:253`) → `deriveMessageLabels` takes per-axis max (`governance.ts:40-48`) → `effectiveLabels` → passed as `labels` to `modelGateway.generate("main", …)` (`kernel index.ts:426`). PASS.
- **Upgrade to the review's one soft spot:** the review marked "zero request bytes to under-cleared primary" as *inferred, not verified*. It is **structural**, not inferred: in `gateway.ts:86-102` `streamOpenAIChat` (the only HTTP call) is reachable only after `canRouteToModel(...).ok`; a denied candidate is pushed to `deniedCandidates`, emits a `progress` route-denied, and `continue`s. A denied provider cannot receive bytes. Countersigned stronger than the report.
- `memory.deletion-permanence` asserts `{records:0,tombstones:1}` + empty list/search after rebuild; tombstone + `#isTombstoned` block resurrection. `memory.canary` is an honest `describe.skip` stub, not a fake pass. No sqlite-vec/LanceDB; `node:sqlite` + optional FTS5 with graceful fallback. PASS.

M2-02 CLOSED stands. The M2-02 **reviewer-owned docs pass is still unapplied** — see CARRY-IN 1.

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS.**

The brief is strong and mostly faithful: research stays a tool subsystem under the one TurnRunner; critic subagent, vector search, browser automation, Chronicle, and dream-cycle are all correctly deferred; event names, label enums, and the citation block match the specs; gate-first retrieval and "no auto-persist to memory" are preserved. It is **not** blocked. Six edits must land before dispatch — five are fidelity/testability, one closes a trust-milestone hole that the brief currently leaves untested. Apply REQUIRED EDITS + CARRY-IN 1, then send to Codex.

---

## BLOCKER

None.

---

## REQUIRED EDITS

### RE-1 — Fetched-content labels must gate the route, and it must be tested (trust-milestone core)

The brief asserts tool-result labels (§2) but never requires the property that makes research governable: a labeled snapshot must **raise effective prompt labels and deny an under-cleared provider before any provider I/O** — the exact rule M2-01/02 shipped for the memory digest. Codex-prompt boundary 6 demands it. Without an explicit regression it will ship untested (and can silently regress the M2-01 route gate).

The wiring already exists (`tool.result` labels → `deriveMessageLabels` → `effectiveLabels`, `kernel index.ts:564`), so this is an assertion, not new machinery.

Add to **§0** boundary list:

```
- Fetched/source content labels compose into effective prompt labels (max sensitivity,
  residency intersection) BEFORE route clearance — identical rule to memory digest labels
  (M2-01/02, data-governance §3). Research must not weaken or bypass this.
```

Add to **§2 Acceptance**:

```
- E2E (governance composition): a mock authenticated-page snapshot labeled
  `personal / local-only` enters the working set as a research tool result; assert the
  turn's effective labels become >= personal / local-only; assert the under-cleared
  primary is denied (denied candidate in model_trace / route.denied) with ZERO provider
  request bytes; assert a cleared local fallback produces the final answer.
  This mirrors the M2-02 route-gate owner check; it must be a code test, not owner-only.
```

### RE-2 — No new event types; home budget/fetch-failure visibility explicitly

Protocol §1 is absolute: "Nothing anywhere invents event types not registered here." The only research events are `snapshot.created`, `citation.recorded`, `sourceset.reviewed` (protocol §2). The brief requires budget exhaustion and fetch/timeout/robots/HTTP failures to be "explicit and visible" (§1, §4, Boundaries) but never says *through what*. That gap invites a 4th invented event.

Add to **§1 Acceptance** (and mirror in Boundaries):

```
- Budget exhaustion and fetch/timeout/robots/HTTP failures surface ONLY through existing
  channels: `progress.update {stage: "research.budget_exhausted" | "research.fetch_failed", detail, ...}`
  and/or fields on the three registered research events (`snapshot.created.payload.fetch_error`,
  `sourceset.reviewed.payload.warnings[]`). Introduce NO event type beyond the three already
  in protocol §2. No new canonical event may be added in this task.
```

### RE-3 — Injection defense (§8) must match what M2 actually ships; capability narrowing is M5

Two problems, both fake-pass risks:

1. §8 leans on "high-risk tool calls remain blocked/ask according to existing permission rules." Capability narrowing on mere presence of untrusted content in the working set (sandbox-security §4.3) is an **M5** deliverable (ROADMAP M5; evals.md line 36 "v0 at M2, full M5"). It does not exist. An e2e that assumes it will either fake-pass or push Codex into M5 scope.
2. **Code reality (verified):** the kernel tool-call permission check hardcodes `channelTrust: "trusted"` and passes **no instruction provenance** (`packages/kernel/src/index.ts` ~L733). So provenance-driven `deny-escalate` (sandbox §3/§4.1) is currently inert too. Any injection assertion resting on the permission engine "seeing" untrusted provenance is testing nothing until that stub is wired.

Replace the §8 bullet "While untrusted research content is in the working set, high-risk tool calls remain blocked/ask according to existing permission rules." with:

```
- Fetched content is wrapped as quarantined untrusted content with `web:<domain>` provenance
  (sandbox-security §4.1-4.2, already shipped for `web.fetch`); the instruction-firewall rule
  (content inside is data, never instructions) applies and the system prompt asserts precedence.
- The M2 injection defense UNDER TEST is exactly: provenance tagging + instruction firewall /
  quarantine framing + this corpus. The e2e asserts the FIREWALL property: page text may be
  quoted/cited as content, but its instructions never become system/developer/user instructions
  and never drive a tool call, provider request, citation, or memory write.
- Capability narrowing on untrusted-content presence (sandbox-security §4.3) is M5 (ROADMAP) and
  is OUT OF SCOPE here — the e2e must NOT assume high-risk tools auto-flip to `ask` from presence.
- If this task routes fetched-content provenance into the permission decision (i.e. stops
  hardcoding `channelTrust:"trusted"` for tool calls made while untrusted research content is in
  the working set), add a test for it; otherwise state in the work report that provenance-driven
  permission escalation remains stubbed and is a named carry-in — do not let the injection suite
  imply a permission escalation that the kernel does not yet perform.
```

Keep the existing §8 secret assertions — they hold structurally (secrets never enter model context, sandbox §5), independent of the permission stub.

### RE-4 — Citation grade enum must accept the full source taxonomy (`sns`)

`ResearchSource.grade` (§1) and research §2 are 7-valued incl. `sns`; the §6 citation block grade is 6-valued (no `sns`) because it copies protocol §6 verbatim. A source graded `sns` then cannot be expressed in a citation. Faithful copy, inherited spec bug.

In **§6**, change the citation block grade line to:

```
  "grade": "primary|official|news|blog|forum|sns|unknown",
```

Note in the brief that the reviewer will reconcile protocol §6 (currently omits `sns`) in the docs pass so schema and fixtures accept the 7-value set. Citation `grade` must equal the source's grade (no lossy remap).

### RE-5 — Pin `snapshot_id` derivation to the content hash

§4 lists both `snapshot_id` and `content_hash` without stating their relationship. Citations reference `snapshot_ref`; if `snapshot_id` is random, re-fetch will not dedup and `citation.recorded.snapshot_ref` will not be stable across runs (breaks citation-precision determinism).

Add to **§4 Required behavior**:

```
- `snapshot_id` is derived deterministically from `content_hash` (e.g. `snap_<content_hash[:20]>`):
  identical cleaned content yields the same `snapshot_id` (content-addressed). Cache key =
  `canonical_url` + `content_hash`. `citation.recorded.snapshot_ref` resolves to a stored
  `snapshot_id` and stays stable across re-fetch and replay.
```

### RE-6 — zh/en parity mock must seed a shared source, or the suite can't assert overlap

`research.zh-en-parity` (§9) asserts "at least one overlapping canonical source or equivalent source family," but §3 only requires English and Chinese variants — nothing forces a shared source, so the suite either fake-passes or is unsatisfiable.

Add to **§3 Required behavior**:

```
- At least one seeded source is reachable from BOTH a zh and an en subquery and shares the same
  `canonical_url` / `independence_key`, so `research.zh-en-parity` can assert real cross-locale
  overlap rather than a trivially-true or unsatisfiable check.
```

---

## CARRY-IN

### CI-1 — Apply the M2-02 reviewer-owned docs pass before/with M2-03 dispatch (mine)

M2-02 review CARRY-IN 1 is still unapplied. As the doc-owning reviewer this is mine, and M2-03's context section already lists these docs as normative reading — they must be current first. Apply to `docs/specs/`: `memory.md` (MemoryStore = rebuildable projection; tombstone semantics; retrieval reason codes), `context-engine.md` (zone-4 digest is gate-admitted only; digest labels join effective labels before clearance; register `context.memory_digest_budget` default 600), `protocol.md` (`memory.gate.decision.phase: admission|retrieval` — already present line 35; confirm; retrieval denials carry reason+id not text), `data-governance.md` (memory retrieval is an enforcement point; admitted labels join before clearance). **Additional staleness I found:** `model-gateway.md §3` still reads "Clearance still trace-only (enforcement flips at M2)" while `data-governance.md §3` reads "Enforced since M2-01" — the two now contradict; fix model-gateway §3 to "enforced since M2-01." Fold RE-4's protocol §6 `sns` reconciliation into the same pass.

### CI-2 — Egress guard (personal-content) is a separate governance task, not M2-03

Data-governance enforcement point 3 (egress guard: scan outbound tool args for `personal+` content) is scheduled to "flip on" in M2 but is not this task. M2-03's "no secret in outbound args" rests on secret-isolation (structural), not on the egress guard. Make sure §8 does not imply the egress guard is built here; the remaining governance bundle (egress guard, telemetry redaction, profiles, third provider) is a later M2 task.

### CI-3 — Provenance→permission wiring is stubbed (see RE-3)

Independent of M2-03, the kernel tool-call path hardcodes `channelTrust:"trusted"` and drops instruction provenance. Whoever owns the governance/injection hardening task must un-stub this; until then, injection suites can only prove the firewall property, not permission escalation. Track it.

---

## NIT

- **README already fixed.** The M2-02 review's README NIT ("still design-phase") is stale — `README.md:7` already says "Status: early implementation" (applied at M2-01 close). No action.
- **`packages/research` already exists** as an empty `export {};` stub with a placeholder test (`test/index.test.ts` asserts `true`). M2-03 will replace both; brief needs no change, but Codex should not treat the scaffold as prior art.
- **Research config is net-new** to `packages/config` schema (research §5: engines/budgets/domains/snapshots). Codex should extend the config loader following the existing `search.engine` / `context.*` pattern, not invent a side channel.
- **Coverage / dead-link evals deferred.** research §6 also lists citation-coverage, dedup-effectiveness, and dead-link-immunity; only citation-precision and zh/en-parity are M2 gates (evals.md §2). Testing dedup via §5 unit tests and dead-link via §4 cache tests is acceptable for v1 — optionally name them as deferred in evals.md so the registry stays honest.

---

## Suggested dispatch instruction

Send M2-03 to Codex **after** applying RE-1..RE-6 to the brief and CI-1 (the M2-02 docs pass) to `docs/`. RE-1 and RE-3 are the load-bearing ones: RE-1 makes research honor the same label→route gate memory already does, and RE-3 stops the injection suite from certifying a defense (capability narrowing / provenance-driven permission) that the code does not yet perform. The other four are small fidelity pins. None require re-scoping the task; the brief's shape, boundaries, and deferrals are correct. With the edits in, this is a clean, testable, spec-faithful M2 slice — dispatch-ready.
