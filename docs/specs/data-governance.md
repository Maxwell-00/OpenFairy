# Spec: Data Governance — Labels, Residency, Routing

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-15a, NFR-4, NFR-5 |
| Components | label engine (`packages/protocol` types + kernel enforcement) · router/egress/memory/telemetry integration |

Once Fairy mixes a local main brain, overseas research models, third-party vision, and cloud speech, the question stops being "can we call this provider" and becomes **"may *this content* go to this provider."** External review called this the missing dimension in the role router; adopted. Kept deliberately small: two orthogonal label axes and five enforcement points — not an ABAC engine.

## 1. Label model

Every artifact, memory record, attachment, tool result, and turn input carries:

- **Sensitivity:** `public < internal < personal < secret`
- **Residency:** `local-only | region-restricted | global-ok` — a **hard constraint**, closed enum, nothing else is a residency value. The region *set* is not part of the label: `region-restricted` resolves against `governance.home_regions` config at enforcement time (§4). (Wire value confirmed by protocol schemas.)

**Routing hints are not labels.** Preferences like "use the local model when you can" live in a separate, non-gating field:

```yaml
labels: { sensitivity: internal, residency: global-ok }
routing_hints: { prefer_local: true }    # reorders candidates; never blocks, never permits
```

The router treats hints as candidate *ordering* (a hinted request tries cleared local models first, degrades to cleared cloud when unavailable); constraints as candidate *filtering*. An earlier draft used `local-preferred` as a residency value — that was a type error (external review round 2, correct catch): it would have made routing behavior untestable. Constraint vs. preference is now structural.

**Derivation rule:** outputs inherit the **max** sensitivity and **intersection** of residency of their inputs (a summary of a `personal` note is `personal`); `prefer_local` hints propagate as OR. Downgrades only via explicit user **declassification**, which is itself an event (`label.declassified`, audited).

**Semantic escalation (one-way, table-driven):** the memory extractor and perception service may *raise* labels based on content category. Escalation is **deterministic given a category match** — the classifier (rule lists: keywords/regex/domains, optional small-model assist) is the only probabilistic part, and it is what gets evaluated. "Escalate by model feel" is banned: no category match, no escalation. Nothing automatic ever lowers a label.

| Category | Escalates to | Note |
|---|---|---|
| credentials / OTP / API keys | `secret / local-only` | And never persisted as memory (secret tier); overlaps egress-guard patterns by design |
| health / medical | `personal / local-only` | |
| finance / banking / tax | `personal / local-only` | Same lists drive computer-use observation defaults |
| relationship / family / private identity | `personal` (residency unchanged) | |
| workplace / client confidential | `internal` floor + workspace residency policy | |
| legal | `personal / local-only` | |

Categories and their rule lists live in config (`governance.categories`, user-extendable); targets above are profile-independent. Eval: seeded content per category must escalate; near-miss corpus must not (specs/evals.md).

### 1a. Default profiles

A single default table can't serve both "daily usability" and "psychological safety" — so defaults ship as **profiles** (one setting, chosen at onboarding, switchable anytime). Both axes are always explicit; hints in *italics*:

| Source | `balanced` (default) | `sovereign` | `cloud-friendly` |
|---|---|---|---|
| User input, trusted device | `internal / global-ok` *prefer_local* | `personal / local-only` | `personal / global-ok` |
| User voice audio (to ASR) | `personal / region-restricted(home)` *prefer_local* | `personal / local-only` | `personal / global-ok` |
| Web/search content | `public / global-ok` | `public / global-ok` | `public / global-ok` |
| Authenticated-page fetches & logged-in screenshots | `personal / region-restricted(home)` | `personal / local-only` | `personal / region-restricted(home)` |
| Finance/health category pages (list-based) | `personal / local-only` | `secret / local-only` | `personal / local-only` |
| Workspace files | `internal / workspace.residency_default`; unset → `global-ok` *prefer_local* | `internal / local-only` | `internal / global-ok` |
| Memory tiers | `general→internal`, `personal→personal`, `secret→secret` (never persisted) — all profiles | same | same |
| Unknown | `internal / global-ok` *prefer_local* | `internal / local-only` | `internal / global-ok` |

`region-restricted(home)` = the user's configured home-region set. Per-source overrides remain available under any profile; profiles only set defaults, they are not modes with special semantics.

## 2. Provider clearance

Model registry entries (model-gateway §2) gain:

```yaml
data_clearance: { max_sensitivity: personal, residency: [global-ok], regions: [us] }
# local vLLM:   { max_sensitivity: secret,  residency: [local-only, region-restricted, global-ok] }
# (local models need no regions declaration — they trivially satisfy any region set)
```

## 3. Enforcement points

| Point | Behavior |
|---|---|
| **Role router** | Before dispatch: max label of assembled context vs. target clearance (filter), then `routing_hints` reorder surviving candidates. Violation → try fallback chain member with clearance → else refuse with visible `route.denied` event ("this needs your local model; it's offline"). Never silent downgrade of content, never silent upgrade of provider. |
| **Memory retrieval (MemoryGate)** | Admission conditioned on labels × channel trust (memory spec §4a) |
| **Egress guard** | Outbound tool args scanned for `personal+` content and secret patterns (sandbox-security §4.4) |
| **Telemetry/logs** | `personal+` content never enters traces or error reports; label-aware redaction middleware |
| **Export/delivery** | Sending an artifact to a channel below its sensitivity (e.g., `personal` report → group chat) → approval.request |

## 4. Residency policy

Residency answers "which jurisdictions' providers may process this." `home` is **not a natural-language placeholder** — it resolves from config, and providers declare their processing regions, so clearance is a set check, not a judgment call:

```yaml
governance:
  home_regions: [cn]          # user-owned; the resolution of region-restricted(home)
models:
  - id: some-cloud-model
    data_clearance:
      max_sensitivity: personal
      residency: [global-ok, region-restricted]
      regions: [cn]           # declared processing regions; required if region-restricted claimed
```

**Semantics:** `region-restricted(home)` content may be dispatched only to providers with `regions ⊆ home_regions` (local models trivially qualify). A provider claiming `region-restricted` without declaring `regions` fails config validation. Vendor landscapes shift (regional API availability has changed repeatedly); residency is therefore config the user owns, not hardcoded geography. The router treats residency violations identically to sensitivity violations.

## 5. Retention & lifecycle

Labels ride through retention: `secret` never persists (existing rule); `personal` excluded from any opt-in telemetry and from cloud backups unless encrypted; snapshots and artifacts keep labels in their metadata sidecar; deletion tombstones record label class for audit without content.

## 6. UX principle

Labels are **invisible by default, inspectable always**: the user picks a profile (§1a), automatic derivation covers ~all cases; `/labels` on any artifact/memory shows classification and why; the only routine user-visible surface is the occasional route-denied message and declassification confirmations. Governance that nags gets disabled — friction budget is part of this spec's acceptance.

## 7. Tests (→ specs/evals.md)

Conformance: seeded `secret`/`personal` content provably never reaches a non-cleared provider across the full tool/subagent/workflow matrix (0 tolerance, PRD metric); derivation property tests (max/intersection laws; hints-never-gate; escalation one-way); redaction verification on traces; per-profile golden default tables (a profile change is a config diff, testable).

**Friction canary** (safe-but-unusable is also a failure): ≤ 1 governance interruption per 50 turns in soak, **and** route-denied recovery — after a `route.denied`, the task still completes (cleared fallback, local model, or one-step declassification) ≥ 95% of the time; dead-ended denials are logged and reviewed weekly. Measured continuously from M2 (nightly) and gating at M5 soak.
