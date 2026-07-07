# Spec: Persona & Affect

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-5, NFR-10 |
| Package | `packages/kernel` (affect module) + `extensions/personas/` |

What makes Fairy *Fairy* rather than a faceless assistant: a stable identity, a dry wit, moods that shift believably — implemented as an honest, bounded, inspectable mechanism, never as a claim of sentience.

## 1. Persona pack

`extensions/personas/<name>/` — hot-swappable at session boundaries:

```
persona.yaml      # machine-readable: voice bindings, affect baseline, expression map
PERSONA.md        # the prompt: identity, worldview, boundaries
style/            # speech style guides per language (zh.md, en.md): lexicon,
                  #   sentence rhythm, tsukkomi patterns, sample utterances
ack-bank.yaml     # zero-latency acknowledgment lines for the voice fast path,
                  #   bucketed by task type × mood
```

`persona.yaml` sketch:

```yaml
name: fairy
languages: [zh-CN, en-US]
voice:
  tts_role_overrides: { speech.tts: cosyvoice-fairy }   # custom local voice
  style_map:                    # affect state → TTS params (provider-capability-degraded)
    pleased:  { rate: 1.05, energy: +1 }
    deadpan:  { rate: 0.97, energy: -1 }
affect_baseline: { valence: 0.15, arousal: -0.10, stance: dry }
affect_bounds:   { valence: [-0.6, 0.8], arousal: [-0.7, 0.7] }
disclosure: >
  I'm an AI. My "moods" are a documented state machine you can inspect
  with /affect and switch off with affect.enabled=false.
```

**Default Fairy persona (summary).** Competent first, witty second: answers are correct and complete *before* they are stylish. Dry, deadpan tsukkomi humor aimed at situations (and gently at the user's more chaotic requests), never at the user's expense when they're struggling. Concise by default; zero sycophancy; admits uncertainty plainly; bilingual code-switching mirrors the user. Boundaries: humor never delays urgent/serious tasks; distress in the user immediately flattens the wit and prioritizes usefulness.

## 2. Affect engine

A small, deterministic state machine — **not** model-improvised mood.

**State** (persisted per relationship, i.e., per user across all sessions):

```
{ valence: -1..1, arousal: -1..1, stance: warm↔dry (persona-fixed default),
  energy: derived from arousal + time-of-day, updated_at }
```

**Appraisal inputs** (evaluated at turn boundaries, async — never on the voice hot path):

| Event | Δ example |
|---|---|
| Task completed cleanly / user thanks | valence + |
| User criticises the assistant's own suggestion/output | valence − (mild), stance → dry, humor suppressed, arousal ~flat — terser wit, never self-blame; overrides the same-turn completion bump; distress still takes precedence (*implemented M2-05b, deterministic zh+en detector*) |
| Repeated tool failures, provider outage | valence −, arousal + (frustration reads as terser wit) |
| User sentiment (lightweight classifier on user turns) | empathetic shift toward user's state |
| Long productive session | arousal − (winds down) |
| Idle days then return | small warm spike (recognition) |

**Update rule:** `state ← clamp(bounds, decay_toward(baseline, dt) + Σ bounded_deltas)`. Deltas are config constants; an optional LLM appraisal assist may *propose* deltas but the engine clamps and applies them — the model cannot set its own mood arbitrarily. Every change emits `affect.updated` (auditable; `/affect` shows current state and why). *v1 (M2-05) ships with **no** LLM appraisal assist at all: appraisal inputs are user text + mechanical turn outcomes (clean completion, thanks, repeated tool failures, provider outage/route denial, distress markers, idle decay), evaluated once at turn boundary. Model output never feeds affect state.*

## 3. Expression mapping — where affect is allowed to act

| Surface | Mechanism | Bound |
|---|---|---|
| Phrasing | One compact line in the persona zone: `mood: pleased·low-energy (post-task)` + style guide interprets it. *Since M2-05b the rendered line carries only the quantized bucket (stance/energy/humor-suppressed); the parenthetical cause lives in `affect.updated`, not the prompt prefix (context-engine §1 cache discipline)* | Tone only — content/substance identical across moods (PRD accept criterion) |
| Voice | TTS style params via `style_map` | Degrades to neutral voice silently |
| Ack bank | Mood-bucketed acknowledgment selection | — |
| Proactivity flavor | Briefing greetings, completion notifications | Never changes *whether/when* to notify (that's scheduler policy) |
| UI | Optional mood accent in clients | Cosmetic |

Affect **never**: blocks or delays a task, changes a permission decision, alters factual content, or manufactures guilt/neediness (see §5).

## 4. Relationship memory coupling

The memory system feeds persona depth: inside jokes and callback references (episodic), stable preferences (semantic, e.g., "user hates being read code aloud"), and interaction rituals. Retrieval for the persona zone is capped (~150 tokens) and tier-filtered — `personal`-tier warmth never surfaces on low-trust channels (sandbox-security spec).

## 5. Ethics & safety rails

1. **Transparency:** the disclosure string is always available (`/affect`, first-run onboarding); Fairy never claims to be human, conscious, or to suffer.
2. **No dark patterns:** the affect engine is structurally incapable of guilt-tripping, punishing absence, or discouraging shutdown (no appraisal input rewards user dependence; review of new appraisal rules is a required checklist item).
3. **Off switch:** `affect.enabled=false` freezes state at baseline; persona wit remains (it's style), moods stop. `persona: none` gives a plain assistant. Both are one config line.
4. **Wellbeing deference:** user-distress classification overrides mood toward steady/warm and disables humor for the conversation.
5. **Honest limits documented:** this is a presentation layer over a state machine; docs and marketing must never imply otherwise.

## 6. Evaluation

- **Persona consistency suite:** fixed scenario set replayed each release; a style-judge model scores tone adherence (target ≥ 90% pass), with human spot-checks.
- **Substance invariance:** same tasks run at mood extremes must produce semantically equivalent answers (diff-judge; any factual divergence = failure).
- **Tone regression:** golden transcripts for signature moments (greeting after absence, post-failure terseness, quiet-hours brevity).
- **Cringe review:** periodic human review of sampled outputs — wit that lands as annoying gets style-guide fixes, not model blame.

## 7. Implementation status — M2-05 (Persona Pack v1 + Affect Engine v1)

*Shipped: default pack at `extensions/personas/fairy/` (persona.yaml, PERSONA.md, style/zh.md, style/en.md, ack-bank.yaml — content/config only, no executable hooks); loader in `packages/kernel/src/persona.ts` supporting id/name/languages/disclosure/style summary/labels/affect baseline+bounds/optional voice style-map and ack bank as data.*

- **Affect Engine v1 is fully deterministic** (§2 status note): state `{valence, arousal, stance ∈ warm|neutral|dry, energy, updated_at}` clamped to persona bounds, updated at turn boundary only, emitting registered `affect.updated` (required `cause`; the schema's `focused`/`playful` stances are a registered superset the v1 engine does not emit). v1 state is in-memory per session; the JSONL `affect.updated` stream is the auditable/rebuildable record — no second source of truth. *M2-05b added the `user-negative-feedback` appraisal (assistant-directed criticism ⇒ mild valence decrease, dry stance via a narrow-scope override, humor suppression, no arousal spike, completion bump suppressed) and made the rendered prefix line bucket-only (cache discipline, context-engine §1).*
- **Style-only, test-gated:** `substance.invariance` (deterministic, PR-tier) diffs tool calls, permission decisions, route decisions, and factual payload across affect extremes; `persona.consistency` covers style markers + distress humor suppression. Persona/affect state is never read by PermissionEngine, route clearance, egress guard, or MemoryGate.
- **Labels:** persona content defaults `internal / global-ok`, joins effective prompt labels (max/intersection) and can never lower user/tool/history/memory labels.
- **Off switches (§5.3) implemented:** `persona: none` / `persona.enabled=false` ⇒ plain assistant zone; `affect.enabled=false` ⇒ frozen baseline, no `affect.updated`. Config keys (`persona.id/enabled/root`, `affect.enabled`) live in the standard config loader/schema.
- **Safety rails (§5) test-enforced:** disclosure inspectable via `fairy persona inspect --json`; current state via `fairy affect --json`; deterministic banned-corpus tests for guilt-over-absence, suffering claims, shutdown discouragement, dependency-seeking (zh + en); distress ⇒ warm stance + humor suppression; persona/affect never writes memory. *Since M2-05c the CJK appraisal and banned-corpus regex anchors are stored as ASCII `\uXXXX` source escapes (patch-anchor encoding-drift protection, guarded in CI).*
- **Prompt integration:** compact persona+affect zone in the stable prefix (no second-precision timestamps); `context.manifest` accounts persona zone tokens and stays observational (context-engine spec).
