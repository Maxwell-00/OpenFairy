# Speech workers

**Python floor: `>= 3.11`** (enforced at interpreter probe and again at the ready handshake; CI runs explicit 3.11 floor lanes on Ubuntu and Windows; no patch version is pinned). `FAIRY_TEST_PYTHON` is a code-enforced test-only literal `argv[0]` override.

## `mock_worker.py` (M3-04)

The deterministic conformance worker. It uses only the Python standard library and exchanges UTF-8 NDJSON over stdin/stdout.

The gateway owns process discovery, spawn, deadlines, cancellation, shutdown, and cleanup. The mock worker has no socket, subprocess, device, provider, or file write access — its no-network source scan is enforced and must never be weakened to accommodate provider workers. `asr.script` and `tts.script` are mock-conformance-only messages; they are not the real ASR/TTS provider contract.

## `minimax_tts_worker.py` (M3-05)

The first real provider worker: MiniMax T2A v2 synchronous non-streaming TTS over raw HTTPS (stdlib only — `urllib`/`http`/`ssl`; no pip dependencies, no vendor SDK). It has its own source scan: stdlib HTTPS client modules are allowed; direct `socket`, `subprocess`, audio/device modules, and vendor imports remain forbidden.

Hard rules:

- Endpoints are adapter-owned closed profiles only (`cn-primary` → `api.minimaxi.com`, `cn-backup` → `api-bj.minimaxi.com`); no raw URL from config/CLI/wire/env; the loopback test seam is code-enforced (`FAIRY_PROVIDER_TEST_MODE` + supervisor test/CI gate).
- Proxies are disabled **in code** (`urllib.request.ProxyHandler({})`) and proxy env vars are excluded from the child environment; redirects fail closed (`NoRedirectHandler`).
- TLS uses `ssl.create_default_context()` (certificate + hostname verification on); `SSL_CERT_DIR`/`SSL_CERT_FILE` are allowlisted through for trust-store discovery.
- The provider credential arrives only via `FAIRY_MINIMAX_T2A_TOKEN` (single narrow env key, deliberately outside the broad `FAIRY_SECRET_*` set); it never appears in argv, NDJSON, JSONL, stdout, diagnostics, or fixtures.
- Decoded audio is written atomically to the fixed relative name `tts-output.mp3` under the gateway-created output root (`FAIRY_SPEECH_WORKER_OUTPUT_ROOT`); the worker reports metadata + SHA-256 only — audio bytes never cross stdio.
- Success is validated field-by-field (`base_resp.status_code == 0`, `data.status == 2`, hex validity, `audio_size`/metadata echo, bounded response/audio sizes); HTTP 200 alone is never success.
- Provider errors map to bounded internal categories; auth/quota/balance/safety/parameter/voice classes are never retried.

## `mimo_asr_worker.py` (R0.9-01)

The first real ASR worker: Xiaomi MiMo-V2.5-ASR pay-as-you-go, synchronous non-streaming file recognition over raw HTTPS (stdlib only; own source scan allows `urllib`/`http`/`ssl`, forbids `socket`/`subprocess`/audio/vendor imports).

Hard rules (in addition to the shared rules above and the MiniMax worker's regime, which all apply):

- Endpoint is the closed profile `mimo-paygo-cn` → `https://api.xiaomimimo.com/v1/chat/completions`; the Token Plan domain and `tp-*` keys are rejected with named errors; auth is the `api-key` header with an `sk-*` pay-as-you-go key delivered only via `FAIRY_MIMO_ASR_API_KEY` (preflight validates the kind without ever printing key material).
- Audio arrives as a staged file token (`asr-input.bin`) under the gateway-created input root; **base64 encoding happens only here, at the provider-HTTP boundary** — never in the wire, JSONL, or logs. Raw cap 7,000,000 B; the whole predicted JSON body is capped at 10,000,000 B (shared constant, checked gateway-side pre-I/O and re-checked here).
- The provider envelope is Chat-Completions-shaped — a recorded speech-provider dialect exception confined to this adapter and its fixtures (protocol.md note).
- Success requires exactly one choice with `finish_reason: stop`, no `tool_calls`, no audio output; the transcript comes from the assistant message content only, bounded by `max_transcript_chars`. `429` is classified retryable evidence but never retried in this slice.

Protocol output is always written through `sys.stdout.buffer` and flushed once per message. Start workers only through the gateway supervisor, which invokes Python in unbuffered mode (`-u -B`, `shell: false`, repo-external cwd).
