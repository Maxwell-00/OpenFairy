# OpenFairy v0.9 Developer Preview — interview summary

## 30-second pitch

OpenFairy is a local-first AI companion runtime built around one governed gateway instead of a vendor SDK. It routes OpenAI-compatible models, memory, research, and non-streaming cloud speech through explicit labels and clearance checks, then records canonical JSONL for replay. The v0.9 Developer Preview includes an authenticated browser push-to-talk path and deterministic Windows/Ubuntu CI, while honestly deferring streaming voice and packaging.

## 90-second technical pitch

The design starts with one TurnRunner and append-only event canon. Browser audio is parsed into a bounded artifact, inherits the voice governance floor, and reaches a speech coordinator only after egress and provider clearance. MiMo ASR and MiniMax TTS execute in repository-owned, stdlib-only Python workers behind a gateway supervisor; raw or base64 audio never crosses NDJSON or enters JSONL. Under-cleared audio is rejected before staging, worker spawn, or provider bytes. The browser receives a whitelist projection, holds its token only in memory, and can play only session-owned speech artifacts. `fairy doctor` validates the same source-first path that `fairy dev` launches, without contacting any public provider. Cross-platform focused suites cover Python 3.11, ownership/reuse, cleanup, voice routing, Web auth, replay, and leakage boundaries. It remains a developer preview: no installer, streaming voice, VAD, barge-in, local ASR, or autonomous workflow runtime is claimed.

## Resume bullets

- Built a source-first TypeScript gateway with one canonical turn path and append-only JSONL replay.
- Enforced sensitivity/residency clearance before model and speech-provider I/O, including zero-byte denial tests.
- Integrated artifact-backed MiMo ASR and MiniMax TTS through ASCII, standard-library-only Python workers.
- Delivered an authenticated loopback browser push-to-talk UI with bounded WAV ingestion and session-owned playback.
- Established deterministic Ubuntu/Windows CI with explicit Python 3.11 floor lanes and leakage/residue assertions.

## Technology stack

TypeScript, Node.js, pnpm workspaces, tsx, Vitest, JSON Schema/Ajv, WebSocket, Web Audio, stdlib Python, JSONL, Mermaid, and GitHub Actions.

## Architecture differentiators

- Governance is a routing input: labels compose and can raise, while provider clearance never grants a downgrade.
- Speech stays behind the same gateway boundary as text; provider credentials and audio do not enter canonical transport.
- Replay is a product contract, not a debug dump: canonical events survive while hidden reasoning and raw provider envelopes do not.
- Source-first doctor/dev behavior avoids a second package-resolution or launcher world.

## Honest limitations

1. Voice is non-streaming and cloud-backed; ASR accuracy has not been benchmarked by this release task.
2. The preview has no installer/service/tray, local ASR, workflow scheduler, or completed 20-session S4 ledger.

## What I would build next

After completing the preview evidence and ledger, I would gate the full M3 local/streaming voice work—measured ASR selection, VAD/endpointing, and cancellation/barge-in—before considering deferred bounded workflows. Each would keep the same one-gateway, label-first, replayable architecture.
