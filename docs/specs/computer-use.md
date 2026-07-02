# Spec: Computer Use (Reserved ABI)

| | |
|---|---|
| Status | **Design-reserved** — interfaces locked now, implementation post-v1 (ADR-018) |
| Requirements | supports FR-11 "代行" ambitions beyond files/shell/web |

Without a browser/computer-use layer, Fairy is strong at code, files, terminals, and fetching — but cannot *operate* real online services ("帮我把这个月的电费交了"). Full implementation is deliberately post-v1 (it is a large, risky surface). What we do **now** is reserve the ABI: tool names, event types, permission classes, and label defaults — so protocol fixtures, the permission matrix, and workflow definitions never need breaking changes when it lands. This document is that reservation.

## 1. Model: tools under the TurnRunner, not a separate runtime

Computer use is an observe–decide–act loop expressed as ordinary tools (ADR-012 holds):

| Tool (reserved) | Contract |
|---|---|
| `computer.observe(surface, mode)` | Returns observation artifact: screenshot (→ perception service for text-only brains) + DOM/a11y-tree extract where available; labels applied (§4) |
| `computer.act(surface, action)` | `action ∈ {click, type, scroll, navigate, select, key}` targeting a11y/DOM node ids from the last observation (coordinates only as fallback) |
| `computer.session(surface, op)` | open/close/handoff/resume a controlled surface (browser profile, later: desktop) |

Surfaces v1-post: managed browser (Playwright-driven, dedicated profile). Desktop control: explicitly later.

Events (registered in protocol §2 now as reserved): `computer.observation`, `computer.action` — every action logs pre/post observation artifact refs, making sessions **replayable as a filmstrip** for audit.

## 2. Approval boundaries (permission classes reserved)

- `computer.act` is born `ask`; domain allowlists can promote to session-allow per site.
- **Irreversibility classifier:** actions matching payment/submit/delete/send patterns → always `approval.request` with a human-readable intent summary ("about to click 'Pay ¥142'"), regardless of prior grants.
- **Credential wall:** Fairy never types, reads, or stores passwords/OTP. Login pages trigger **human takeover**: pause → user completes auth (locally or via remote view) → `computer.session(resume)` re-observes. Cookie jars stay in the managed profile, encrypted at rest, `local-only` residency.
- Rate limits per site; global kill switch (`/computer stop`).

## 3. Human takeover protocol

`takeover.requested → user drives → takeover.returned` — on return the agent MUST re-observe before acting (state changed under it). Takeover segments are marked in the log; observations during takeover are not captured (privacy) unless the user opts in.

## 4. Governance defaults

Observations of authenticated/logged-in pages: `personal / region-restricted(home)` under the default profile (`personal / local-only` under `sovereign` — data-governance §1a; both axes always explicit). Sites on the finance/health category lists escalate to `local-only` residency in every profile — i.e., a local main brain + local perception, or explicit user declassification. Injection posture: page content is maximally untrusted; while a computer-use surface is open, capability narrowing (sandbox-security §4.3) runs at its strictest tier — cross-origin actions and any egress carrying page-derived content require approval.

## 5. Why not now (recorded reasoning)

Voice + memory + research + orchestration are Fairy's identity; computer use is an amplifier with the worst risk/effort ratio of the set. Shipping it early would tax the permission model before the permission model has soak time. Post-v1 criteria to start: M5 security suites green two consecutive releases + injection corpus stable + an owner-reviewed threat model addendum for the browser surface.
