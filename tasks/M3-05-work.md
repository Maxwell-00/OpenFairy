# M3-05 Work Report — MiniMax T2A v2 non-streaming TTS worker

> Implementation report only. This report does **not** claim M3-05 closed. A real owner-only MiniMax check, owner commit/push, green GitHub Actions, and reviewer countersign remain required.

## 1. Baseline and implementation commit

- Required baseline: `1fc2f98a8440bfdbab27a05076ec3d9fdf35b68e`.
- Baseline was verified clean before implementation.
- Final implementation commit: **PENDING OWNER COMMIT**. Repository policy leaves implementation changes uncommitted for owner review and commit.
- CI run URL: **PENDING OWNER COMMIT/PUSH**. No URL is fabricated in this report.
- Owner-live evidence commit: **PENDING; live check was deliberately not run by Codex**.

## 2. Changed-file inventory

### New

- `apps/gateway/src/speech-artifact.ts`
- `apps/gateway/src/speech-provider.ts`
- `packages/artifacts/package.json`
- `packages/artifacts/src/index.ts`
- `packages/artifacts/test/index.test.ts`
- `packages/artifacts/tsconfig.json`
- `packages/testing/test/voice.tts-provider.test.ts`
- `workers/speech/fixtures/minimax-error-codes.json`
- `workers/speech/fixtures/minimax-success-envelope.json`
- `workers/speech/minimax_tts_worker.py`
- `tasks/M3-05-work.md`

### Modified

- `.github/workflows/ci.yml`
- `apps/cli/src/voice.ts`
- `apps/cli/test/voice.test.ts`
- `apps/gateway/package.json`
- `apps/gateway/src/config.ts`
- `apps/gateway/src/index.ts`
- `apps/gateway/src/server.ts`
- `apps/gateway/src/speech-worker-process.ts`
- `packages/config/src/schema.ts`
- `packages/model-gateway/src/governance.ts`
- `packages/model-gateway/src/index.ts`
- `packages/perception/package.json`
- `packages/perception/src/index.ts`
- `packages/testing/package.json`
- `pnpm-lock.yaml`

### Explicitly unchanged protected surfaces

- `workers/speech/mock_worker.py` — SHA-256 remains `03767b90259b4a02eaf3f3810916ee55fd09c867ef3abd220c788ad59482f135`.
- `packages/testing/test/voice.worker-process.test.ts` — SHA-256 remains `e7c1b4b5e2ffa749c05ff6fbed5f765c12efb550daa68f43061faccb25706096`.
- `packages/perception/test/index.test.ts` — SHA-256 remains `47832dcd7c5a4cca9b2dc4f914b2d53274869f90ecbaba5a771038ea387e25db`.
- `packages/protocol/schemas/registry.v1.json` — SHA-256 remains `88dbf2e6db4fe9e068cde9ede7ca06ef78e4d7cdbda47352e9a54eeef0dee0b4`.
- No file under `packages/protocol/`, `docs/`, or `docs-zh/` changed.
- `packages/voice/src/index.ts` remains free of `node:child_process`.

## 3. Speech provider/role configuration

The closed configuration is:

```yaml
speech:
  providers:
    - id: minimax-cn-tts
      stage: tts
      transport: minimax-t2a-v2-http
      endpoint_profile: cn-primary
      model: speech-2.8-turbo
      voice:
        voice_id: male-qn-qingse
        speed: 1
        volume: 1
        pitch: 0
      api_key_ref: secret://minimax_token_plan
      language_boost: auto
      audio:
        format: mp3
        sample_rate: 32000
        bitrate: 128000
        channel: 1
      limits:
        max_text_chars: 3000
        max_response_bytes: 67108864
        max_audio_bytes: 33554432
      data_clearance:
        max_sensitivity: personal
        residency: [region-restricted, global-ok]
        regions: [cn]
  roles:
    tts:
      primary: minimax-cn-tts
      fallback: []
```

Validation decisions:

- `speech`, provider entries, voice/audio/limits, and `speech.roles.tts` are closed objects.
- Provider IDs are stable, bounded identifiers and must be unique.
- `stage` is exactly `tts`.
- `transport` is exactly `minimax-t2a-v2-http`.
- `endpoint_profile` is exactly `cn-primary` or `cn-backup`; there is no URL field.
- `model` defaults to `speech-2.8-turbo`; optional `speech-2.8-hd` is the only other model.
- `language_boost` is `auto`, `Chinese`, or `English`.
- System `voice_id` is required. Closed numeric bounds are speed `0.5..2`, volume `0..10`, and integer pitch `-12..12`.
- Audio is closed in this slice to MP3 / 32000 Hz / 128000 bps / mono.
- Credentials must match `secret://...`; inline values fail schema/runtime composition.
- `max_text_chars` is `1..3000`, `max_response_bytes` is `1..67108864`, and `max_audio_bytes` is `1..33554432`.
- `region-restricted` clearance requires a non-empty `regions` array.
- TTS primary plus fallback IDs are unique, deterministic, and must resolve to known speech providers.
- Model roles and speech roles remain separate.
- No ASR provider configuration was added.

## 4. Endpoint-profile mapping

| Profile | Exact transport-owned endpoint |
|---|---|
| `cn-primary` | `https://api.minimaxi.com/v1/t2a_v2` |
| `cn-backup` | `https://api-bj.minimaxi.com/v1/t2a_v2` |

The mapping is closed in both TypeScript and Python. Production YAML, CLI, environment, argv, and NDJSON accept no endpoint URL, host, scheme, port, path, query, redirect target, or proxy override.

The deterministic test seam accepts only a numeric ephemeral port through a code-only `MinimalGateway` test option. The worker constructs `http://127.0.0.1:<port>/v1/t2a_v2`; it never accepts a URL. The seam requires `NODE_ENV=test` or `CI=true`. Tests/CI also fail closed if a configured speech provider has no code-injected loopback port, so CI cannot fall through to public MiniMax.

Production network execution additionally requires explicit owner-live mode:

```text
FAIRY_OWNER_LIVE_TTS=1
```

That switch enables execution only; it cannot alter an endpoint. CI denial is evaluated first, so the owner-live switch cannot enable public provider network in CI.

## 5. Route, clearance, egress, and fallback matrix

The route starts only after the existing voice final reaches the existing `#submitVoiceFinalTranscript -> #acceptTurnInput -> TurnRunner` path and a canonical visible `turn.final` exists.

| Condition | Worker/provider I/O | Fallback | Canonical result |
|---|---:|---|---|
| Empty text or over primary configured text limit | 0 | no | Completed text turn; bounded `progress.update`; no artifact/chunk |
| Speech egress denial | 0 | no | Completed text turn; `voice.tts.egress-denied`; no artifact/chunk |
| Candidate under-cleared | 0 for that candidate | next configured candidate | `voice.tts.route-denied`; labels unchanged |
| Every candidate under-cleared | 0 total | exhausted without attempt | Completed text turn; no artifact/chunk |
| Cleared candidate succeeds | exactly 1 | stop | One speech artifact and one `speech.tts.chunk` |
| `1001`, `1024`, `1033`, transport failure, or HTTP 5xx | at most 1 for candidate | next candidate at most once | Bounded failure event; success only if fallback succeeds |
| `1002`, `1004`, `1008`, `1026`, `1027`, `1042`, `2013`, `20132`, `2042`, `2049`, `2056` | at most 1 for candidate | no | Completed text turn; no artifact/chunk |
| Malformed/invalid provider success envelope | at most 1 | no | Completed text turn; cleanup; no artifact/chunk |
| Worker crash/malformed/timeout/cancel/shutdown failure | 0 or 1 depending failure point | only an explicitly retryable provider error may advance | Completed text turn; cleanup; no artifact/chunk |

`prefer_local` is passed only as a hint to the shared clearance function and never overrides a denial. The provider clearance implementation is the existing model-gateway clearance law extracted as the neutral `canRouteToClearance`; `canRouteToModel` delegates to it, preserving model behavior.

## 6. Credentials and child environment

- `api_key_ref` is resolved lazily at the gateway composition boundary, after text/egress/clearance selection and before the selected worker starts.
- Token Plan subscription keys and pay-as-you-go API keys remain opaque Bearer credentials. Fairy does not inspect, convert, combine, or relabel the credential class.
- Only the selected candidate's credential is placed in the child environment.
- The only credential-bearing child key is `FAIRY_MINIMAX_T2A_TOKEN`.
- The name intentionally does not use `FAIRY_SECRET_*`, preventing accidental broad secret-set inheritance.
- The temporary root uses the separate repository-owned `FAIRY_SPEECH_WORKER_OUTPUT_ROOT` key.
- The child environment is built from scratch with `PYTHONDONTWRITEBYTECODE`, `PYTHONIOENCODING`, minimal launch/TLS variables (`HOME`, `LANG`, `LOCALAPPDATA`, `PATH`/`Path`, `PATHEXT`, `SSL_CERT_DIR`, `SSL_CERT_FILE`, `SYSTEMROOT`/`SystemRoot`, `TEMP`, `TMP`, `USERPROFILE`, `WINDIR`), the selected credential, the exact temp root, and the boolean test gate when applicable.
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and every case variant are absent because no proxy key is copied.
- The Python opener independently uses `urllib.request.ProxyHandler({})`.
- The credential is never placed in argv, the `tts.request` NDJSON message, stdout, stderr, CLI JSON, canonical JSONL, artifact metadata, fixtures, snapshots, endpoint URLs, or public errors.
- Exact-credential replacement is applied again in supervisor diagnostics as defense in depth.

## 7. Exact MiniMax request, response, and error mapping

### Outbound HTTP

```json
{
  "aigc_watermark": false,
  "audio_setting": {
    "bitrate": 128000,
    "channel": 1,
    "format": "mp3",
    "sample_rate": 32000
  },
  "language_boost": "auto",
  "model": "speech-2.8-turbo",
  "output_format": "hex",
  "stream": false,
  "subtitle_enable": false,
  "text": "<visible final only>",
  "voice_setting": {
    "pitch": 0,
    "speed": 1,
    "voice_id": "male-qn-qingse",
    "vol": 1
  }
}
```

- Method is `POST`; path is exactly `/v1/t2a_v2`.
- Headers are `Authorization: Bearer <selected credential>` and `Content-Type: application/json`.
- Provider-neutral `volume` maps only at the adapter boundary to MiniMax `vol`.
- No optional MiniMax feature outside the gated subset is serialized.
- Redirects fail closed through a custom no-redirect handler.
- Default certificate and hostname checks use `ssl.create_default_context()`.

### Success checks (HTTP 200 alone is insufficient)

1. HTTP policy accepts only status 200 without redirect.
2. Response bytes are streamed under `max_response_bytes` before UTF-8/JSON/hex decoding.
3. JSON root and `base_resp` are objects and `base_resp.status_code` is an integer equal to `0`.
4. `data` is a non-null object and integer `data.status` equals `2`.
5. `data.audio` is non-empty, even-length, and matches only hexadecimal characters.
6. Decoded bytes are non-empty and at most `max_audio_bytes`.
7. `extra_info.audio_format`, integer channel, and integer sample rate exactly match the request.
8. Integer bitrate and integer audio size match when present.
9. Bytes have an ID3 header or MPEG frame sync, preventing metadata-only format claims.
10. Worker size/SHA-256 and gateway file size/SHA-256 match before registration.

### Provider code mapping

| Code | Internal bounded category | Retry next candidate? |
|---:|---|---:|
| 1001 | `provider_timeout` | yes |
| 1002 | `rate_limit` | no |
| 1004 | `unauthorized` | no |
| 1008 | `insufficient_balance` | no |
| 1024 | `provider_internal` | yes |
| 1026, 1027 | `content_safety` | no |
| 1033 | `provider_downstream` | yes |
| 1042 | `invalid_character_ratio` | no |
| 2013 | `invalid_parameter` | no |
| 20132, 2042 | `invalid_voice` | no |
| 2049 | `invalid_api_key` | no |
| 2056 | `token_plan_resource_limit` | no |

Raw `status_msg`, trace ID, provider body, and response snippets are not propagated or persisted.

## 8. Provider-invalid versus adapter-unsupported matrix

| Class | Examples | Boundary | Fake/provider request count |
|---|---|---|---:|
| Provider-invalid | invalid-character ratio, documented parameter error, invalid/inaccessible voice, content safety, auth/key, balance/quota/Token Plan limit | MiniMax-shaped fake response and worker category mapping | 1 per fixture |
| Provider-invalid success envelope | null data, incomplete status, empty/odd/non-hex audio, metadata/size mismatch | Worker after bounded response read | 1 per fixture |
| Adapter-unsupported | unsupported model, non-MP3/32k/128k/mono, invalid voice controls, text >3000, empty text | Config/supervisor/worker wire before HTTP | 0 |
| Adapter-unsupported optional features | streaming, URL output, subtitles, voice modify, timbre, pronunciation dictionary, arbitrary fields | Closed config/wire and fixed serializer | 0 |
| Endpoint override | raw URL, host, path, scheme, query, proxy, environment/CLI endpoint flag | Closed schema/CLI/wire | 0 |

The fake does not claim MiniMax rejects every optional feature; it validates only that Fairy emits its own closed subset and returns documented MiniMax-shaped provider errors.

## 9. Provider-neutral frame to stdio mapping

`tts.script` remains byte-compatible, mock-conformance-only behavior in `mock_worker.py`. M3-05 reuses `tts.request`; no synonymous wire kind was added.

| Provider-neutral `tts.request` concept | Provider stdio field |
|---|---|
| visible text | `text` |
| effective visible-text labels | `labels` |
| utterance correlation | `utterance_id`, `request_id` |
| transport | fixed `provider_transport: minimax-t2a-v2-http` |
| route endpoint | closed `endpoint_profile` |
| model | `speech-2.8-turbo` or `speech-2.8-hd` |
| voice | `voice_setting.voice_id/speed/volume/pitch` |
| language | `language_boost` |
| audio | `audio_setting.format/sample_rate/bitrate/channel` |
| bounds | `limits.max_text_chars/max_response_bytes/max_audio_bytes` |
| HTTP deadlines | `deadlines_ms.connect/read/total` |
| deterministic test seam | optional integer `test_loopback_port`, accepted only under the test gate |
| credential | **not on wire**; narrow child environment only |
| output path | **not on wire**; worker-owned fixed relative name only |

The worker returns one `tts.chunk` metadata message plus `tts.done`. `tts.chunk` contains visible text, correlation, fixed relative token, `mp3`, `audio/mpeg`, byte count, and `sha256:<hex>`. It contains no audio, hex/base64, absolute path, credential, header, provider body, or canonical event.

## 10. Worker/artifact/frame/canonical mapping

| Stage | Input | Output | Persistent/canonical effect |
|---|---|---|---|
| Voice path | mock ASR `asr.final` | existing `#submitVoiceFinalTranscript` | one normal `turn.input` and one TurnRunner |
| TurnRunner | canonical visible final | provider-neutral `tts.request` composition | hidden reasoning/tool/audit data excluded |
| Worker adapter | `tts.request` metadata + credential env | MiniMax POST | no canonical worker event |
| MiniMax response | bounded JSON + hex | decoded temporary MP3 | audio never crosses NDJSON |
| Worker result | relative token + hash/size/format | gateway validation | no canonical worker event |
| Artifact import | validated bytes + effective labels | `art_<sha256-prefix>` record under `artifacts/speech/` | content-addressed persistent MP3 |
| Canonical output | artifact ID + visible text | existing `speech.tts.chunk` | stable `audio_ref`, no vendor fields |
| Failure/denial | bounded code/category | existing `progress.update` stage | completed text turn remains replayable |

No `artifact.created` event is emitted in this slice. That event is optional, and avoiding it keeps the canonical session free of the registry's absolute persistent path. The artifact registry holds the persistent path; `speech.tts.chunk.audio_ref` holds only the stable artifact ID.

## 11. Artifact extraction and compatibility proof

- The existing registry implementation was moved source-for-source into source-first `@fairy/artifacts`.
- Perception imports/re-exports the neutral primitives and retains only its fixture/structured-output wrapper methods.
- Existing perception tests were not edited and all 5 pass.
- Additions to the moved logic are only:
  - `speech` in the TypeScript artifact-kind union;
  - `audio/mpeg` / `.mp3` MIME-extension detection;
  - the `speech/` storage directory branch.
- No canonical artifact schema changed. `artifact.created` already allows additive fields and does not constrain `kind`.
- `packages/protocol` has no dependency on `packages/artifacts`; dependency-cruiser passes.
- A lower-labeled or wrong-kind pre-existing hash collision is rejected before a canonical TTS reference is emitted. A compatible duplicate may reuse its content-addressed artifact.
- Deterministic fixture artifact:
  - ID: `art_09132b3cec14f9406513`
  - SHA-256: `sha256:09132b3cec14f9406513b7a9a0102dba02518eb15dda91bf938b40e6a5570b51`
  - bytes: `30`
  - kind/MIME: `speech` / `audio/mpeg`
  - labels: `personal / region-restricted`, inherited from the effective visible final and never reset to public.

## 12. Temporary and persistent artifact lifecycle

1. After text/length/egress/clearance gates, the gateway creates `fairy-minimax-tts-*` with `mkdtemp(os.tmpdir())`.
2. The exact absolute root is passed only through `FAIRY_SPEECH_WORKER_OUTPUT_ROOT`.
3. The worker accepts no path and uses fixed `tts-output.mp3.partial` and `tts-output.mp3` names.
4. It creates the partial file exclusively, writes/flushes/fsyncs, and atomically `os.replace`s the final file.
5. It reports only `tts-output.mp3` plus format/MIME/size/SHA-256.
6. Gateway accepts only that token and rejects `..`, POSIX/Windows absolute, UNC, drive-relative, colon/ADS, nested, or alternative names.
7. `lstat` rejects symlinks and non-regular files; `realpath` and containment reject escapes.
8. Before/after stat plus byte length rejects missing, changing, partial, or size-mismatched files.
9. MIME/extension contract, MP3 magic, maximum size, and SHA-256 are checked.
10. The provider worker must shut down cleanly before persistent registration.
11. The gateway removes the entire temporary root on every path.
12. Only then are validated bytes registered content-addressably and referenced by canonical `speech.tts.chunk`.

Crash, malformed output, timeout, partial write, invalid response, cancellation, and forced gateway shutdown tests all leave zero newly persistent artifacts and zero `fairy-minimax-tts-*` residue.

## 13. Limits and deadlines

| Limit/deadline | Value |
|---|---:|
| Provider count | 16 max |
| Fallback count | 15 max |
| Text | configured `1..3000`, default/max 3000 characters |
| Response body | configured up to 67,108,864 bytes; enforced before JSON/hex decode |
| Decoded audio | configured up to 33,554,432 bytes; enforced after hex decode and again at gateway file validation |
| Supervisor stdout line | 262,144 bytes |
| Supervisor queued stdout messages | 64 |
| Supervisor pending requests | 16 |
| Captured stderr | 8,192 bytes |
| Discovery | 5,000 ms total, divided over fixed candidates with 250 ms minimum each |
| Process startup | 3,000 ms |
| Ready handshake | 5,000 ms |
| Mock request | 10,000 ms |
| Provider supervisor request | 35,000 ms |
| Worker HTTP connect | 5,000 ms |
| Worker HTTP read | 5,000 ms |
| Worker HTTP total | 30,000 ms |
| Cancellation | 2,000 ms production default |
| Shutdown | 3,000 ms |

HTTP total is below the supervisor request deadline. Python's standard-library opener receives the stricter minimum of the explicit connect/read bounds (both are 5 seconds), which applies to blocking connect/read operations without direct socket access; elapsed-total checks independently enforce 30 seconds. Test-only shorter supervisor deadlines are code-gated and bounded.

## 14. Failure, retryability, and cleanup matrix

| Failure | Retryable | Temp cleanup | Persistent artifact | Text turn/replay |
|---|---:|---:|---:|---:|
| Clearance/egress/text rejection | no | n/a | no | preserved |
| Connect/TLS/transport | next candidate once | yes | no | preserved |
| Worker/provider timeout | next candidate once | yes | no | preserved |
| Provider 1024/1033 or HTTP 5xx | next candidate once | yes | no | preserved |
| Rate/auth/balance/quota/Token Plan/safety/parameter/voice | no | yes | no | preserved |
| Malformed/oversized/invalid provider success | no | yes | no | preserved |
| Invalid relative token, symlink, non-file, partial, hash/size/format mismatch | no | yes | no new artifact | preserved |
| Worker crash/malformed/uncorrelated/overflow | no unless explicitly classified provider error | yes | no | preserved |
| Cancel or forced shutdown | no | yes | no | preserved |

Every configured candidate is visited at most once. There is no invisible `cn-primary -> cn-backup` retry; backup must be an explicit candidate.

## 15. Python >=3.11 enforcement and evidence

- Probe output is parsed as `major.minor.patch` and rejected below 3.11 with `SPEECH_WORKER_PYTHON_UNSUPPORTED`.
- Discovery continues across fixed candidates so an older first candidate does not block a later supported candidate; if no supported candidate exists, the named floor error is retained.
- Ready-handshake version is independently floor-checked and must exactly match probe evidence.
- A provider-worker `version-mismatch` fixture reports supported-but-different `3.99.0`; handshake rejects with `SPEECH_WORKER_VERSION_MISMATCH` and kills the child.
- `FAIRY_TEST_PYTHON` remains read once at construction, only under `NODE_ENV=test`/`CI=true`, and is used as literal `argv[0]` without splitting or shell use.
- Normal local discovery passed with Python `3.13.9`.
- Explicit local floor run passed with `D:\miniconda3\envs\fairy-py311\python.exe`, Python `3.11.15`: `voice.tts-provider-v0` 13 passed.
- `.github/workflows/ci.yml` adds `Python 3.11 speech floor (ubuntu-latest)` and `(windows-latest)` jobs via `actions/setup-python@v6`, with its `python-path` passed as the exact test-only override.
- The ordinary Ubuntu/Windows `verify` jobs retain normal fixed-candidate discovery independently.
- GitHub lane result: **PENDING OWNER PUSH/CI**; workflow definition is present but no green run is claimed locally.

## 16. JSONL, artifact, replay, and no-residue proof

The deterministic suite asserts:

- exactly one canonical `speech.tts.chunk` on success;
- `audio_ref` is `art_<20 hex>` and resolves through `ArtifactRegistry.get`;
- replay `--json` preserves the artifact reference and visible text;
- canonical JSONL contains no worker kinds, credential, Authorization header, temp name/root, provider trace, `base_resp`, provider envelope, audio hex, base64, or bytes;
- artifact metadata is only `{ "audio_format": "mp3" }` and contains no provider or credential;
- hidden reasoning, actual tool trace, audit marker, and seeded denied secret are absent from the fake provider body;
- all provider/mock PIDs disappear;
- all per-worker temporary roots disappear;
- corrupt-tail/replay residual tests remain green in the full suite.

No raw audio, hex audio, or base64 audio crosses NDJSON or enters canonical JSONL. The persistent MP3 exists only in the content-addressed artifact store.

## 17. Deterministic request-count and denial evidence

| Scenario | Primary connections/requests | Fallback connections/requests | Request bytes to denied target |
|---|---:|---:|---:|
| Exact success/output-only/artifact | 1 / 1 | n/a | n/a |
| Under-cleared primary + cleared fallback | 0 / 0 | 1 / 1 | 0 |
| Two under-cleared candidates | 0 / 0 | 0 / 0 | 0 total |
| Speech egress denial with otherwise secret-cleared provider | 0 / 0 | n/a | 0 |
| Auth, Token Plan quota, safety (three turns) | 3 / 3 | 0 / 0 | 0 to fallback |
| Transient 1024 + explicit fallback | 1 / 1 | 1 / 1 | n/a |
| Adapter-side empty/over-limit/model/voice/audio rejection | 0 / 0 | n/a | 0 |
| Crash/malformed/timeout/partial test modes | 0 fake-provider requests each | n/a | 0 |
| Invalid provider response | 1 / 1 | n/a | n/a |
| Proxy seed/direct-connection proof | 1 / 1 | n/a | n/a |
| CLI provider evidence | 1 / 1 | n/a | n/a |

The direct provider-conformance table makes 26 single requests: all required MiniMax codes plus malformed/null/incomplete/hex/metadata/size/response/audio/redirect/HTTP rejection cases. Each candidate/request ID is used once.

## 18. Command and suite evidence

Local environment: Windows, Node workspace, normal Python 3.13.9 plus explicit Python 3.11.15 floor override.

| Command/suite | Result |
|---|---|
| `pnpm install` | PASS; 16 workspace projects; lockfile policy passed; no downloads required |
| `pnpm lint` | PASS; encoding guard scanned 241 files; ESLint 0 errors |
| `pnpm -r typecheck` | PASS; 15 of 16 workspace projects |
| `pnpm -r test` | PASS; all runnable workspace packages green; `@fairy/testing` 96 passed / 1 intentionally skipped; CLI 20 passed; voice 22 passed; protocol 108 passed |
| `pnpm dep-check` | PASS; 112 modules / 407 dependencies; 0 violations |
| `pnpm conformance` | PASS; all 18 mock provider cases |
| `pnpm --filter @fairy/testing test -- --reporter=verbose -t 'voice.tts-provider-v0'` | PASS; 13 passed, 84 skipped by filter (normal discovery run) |
| same focused suite with Python 3.11.15 literal override | PASS; 13 passed |
| `pnpm --filter @fairy/testing test -- --reporter=verbose` | PASS; 96 passed, 1 intentionally skipped (`memory.canary`) |
| `pnpm --filter @fairy/voice test -- --reporter=verbose` | PASS; 22 passed |
| `pnpm --filter @fairy/cli test -- --reporter=verbose` | PASS; 20 passed, including provider CLI JSON evidence |
| `@fairy/artifacts` | PASS; 1 passed |
| unchanged `@fairy/perception` | PASS; 5 passed |
| shared `@fairy/model-gateway` | PASS; 20 passed |
| `@fairy/config` | PASS; 15 passed |
| `git diff --check` | PASS (final acceptance run) |

Named residual suites visible and green in the full `@fairy/testing` run include `voice.worker-process-v0`, `voice.websocket-transport-v0`, `voice.duplex-transport-v0`, `voice.protocol-loopback-v0`, `label.conformance`, `governance.friction-canary`, `memory.leakage`, `memory.deletion-permanence`, `research.citation-precision`, `research.zh-en-parity`, `injection.research-v0`, `persona.consistency`, `substance.invariance`, `perception.quarantine-v0`, `context.compaction-regression`, `chronicle.workspace-v0`, and `dream-cycle.consolidation-v0`. `memory.canary` remains visibly skipped/deferred.

## 19. CI evidence versus owner-live evidence

### Deterministic CI/local evidence

- Loopback-only fake MiniMax, ephemeral ports, fake recognizable credential, no public speech network.
- No real provider key or real MiniMax call was used.
- All local deterministic commands in the acceptance matrix are green.
- GitHub Actions adds explicit Python 3.11 Ubuntu and Windows lanes.
- Actual GitHub run URL/status remains pending owner commit/push.

### Owner-live evidence

- Not run by Codex.
- Token Plan speech availability was owner-confirmed in the gated brief.
- A real owner call remains mandatory before provider close.
- `2056` must be recorded as `token_plan_resource_limit`; it is not a live PASS.

## 20. Known limitations and deliberately deferred work

- This is synchronous MiniMax T2A v2 TTS only.
- `speech-2.8-turbo` is the interactive default; `speech-2.8-hd` is optional.
- The supported subset is intentionally narrower than the complete MiniMax API.
- `tts.script` remains mock-only; real provider work reuses `tts.request`.
- Audio is one artifact-backed MP3; there is no playback or client audio streaming.
- Compact four-byte channel-ID framing remains deferred unchanged.
- No ASR, microphone/speaker access, VAD, endpointing, WebSocket TTS, Opus, sentence chunking, Lane A/B, acknowledgement bank, barge-in, latency benchmark, tray client, or M4 work was implemented.
- Provider-specific logic stays in gateway composition/supervision and `workers/speech/minimax_tts_worker.py`; kernel and TurnRunner have no MiniMax branch.
- A real owner call and CI run remain outstanding external evidence, so M3-05 is not closed.

## 21. Spec ambiguities resolved during implementation

1. The brief fixed recommended voice values but not numeric bounds. The closed adapter uses speed `0.5..2`, volume `0..10`, and integer pitch `-12..12`; tests reject values outside those bounds before provider I/O.
2. The brief named failures that must not retry but did not enumerate every positive fallback class. Only transport/timeout, `1024`, `1033`, and HTTP 5xx may advance to the next explicit candidate. Rate/auth/balance/quota/Token Plan/safety/parameter/voice and malformed success responses do not.
3. The test seam must cross the Python boundary without a forbidden URL override. The implementation passes only a code-gated integer port and constructs the fixed loopback URL in the worker.
4. The optional canonical `artifact.created` event would expose the existing registry's absolute persistent path. M3-05 therefore registers in the neutral artifact registry and emits only `speech.tts.chunk` with the stable artifact ID.
5. To make “real only in explicit owner-live mode” enforceable, production public-network execution requires `FAIRY_OWNER_LIVE_TTS=1`. It is an execution gate, not an endpoint override, and CI denial takes precedence.

## 22. Proposed reviewer-owned English documentation edits

No English documentation was edited. Proposed reviewer pass:

- `docs/ROADMAP.md`: record M3-05 implementation/evidence status without marking the slice closed before live countersign.
- `docs/PRD.md`: note non-streaming artifact-backed MiniMax TTS as the first real speech-provider slice.
- `docs/ARCHITECTURE.md`: record gateway-supervised Python provider I/O, narrow secret env, no-proxy rule, temp-to-content-addressed lifecycle, and one-TurnRunner path.
- `docs/specs/voice-pipeline.md`: register `speech.providers`/`speech.roles.tts`, Python >=3.11, exact endpoint profiles, `tts.request` stdio mapping, synchronous artifact output, explicit owner-live gate, and retained remote-WS distinction.
- `docs/specs/protocol.md`: clarify that provider stdio messages remain non-canonical and `speech.tts.chunk.audio_ref` may resolve to a local MP3 artifact ID.
- `docs/specs/data-governance.md`: add speech egress plus provider clearance ordering, zero-connection/zero-byte denial, visible-final label inheritance, and diagnostics-as-untrusted rules.
- `docs/specs/model-gateway.md`: record the separate speech-provider registry/role and shared neutral clearance law; no speech vendor branch in model routing/kernel.
- `docs/specs/evals.md`: register `voice.tts-provider-v0`, Case A-H scope, deterministic/keyless loopback fake, and explicit Python 3.11 lanes.
- `workers/speech/README.md`: document `minimax_tts_worker.py`, allowed stdlib HTTP/TLS imports, fixed endpoint profiles, proxy disablement, credential/output-root env keys, and mock-vs-provider scan split.

Do not edit or recreate `docs-zh/`.

## 23. Exact owner live-check procedure

Run only after the owner commits this implementation and its GitHub Actions run is green. Use PowerShell 7 from the repository root. Do not paste the key into a command transcript or evidence file.

### 23.1 Initialize evidence and verify the target

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$TargetCommit = '<OWNER_IMPLEMENTATION_COMMIT>'
$CiRunUrl = '<GREEN_GITHUB_ACTIONS_RUN_URL>'
$EvidenceDir = 'tasks/owner-checks/M3-05'
$LiveData = Join-Path $env:LOCALAPPDATA 'fairy-m3-05-owner-live'
$LiveConfig = Join-Path $env:TEMP 'fairy-m3-05-owner-live.yaml'
$LiveScript = Join-Path $env:TEMP 'fairy-m3-05-owner-live-input.json'

New-Item -ItemType Directory -Force $EvidenceDir | Out-Null
if ((git rev-parse HEAD).Trim() -ne $TargetCommit) { throw 'Wrong implementation commit' }
if ((git status --short).Trim().Length -ne 0) { throw 'Owner live check must start from a clean tree' }
```

Confirm remaining Token Plan speech availability in the MiniMax owner console. Record only the boolean/time, never the key:

```powershell
@{
  checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  credential_class = 'token-plan'
  speech_resource_available_before_call = $true
  ci_run_url = $CiRunUrl
  implementation_commit = $TargetCommit
} | ConvertTo-Json | Set-Content -Encoding utf8 "$EvidenceDir/prerequisites.json"
```

### 23.2 Start the deterministic local text-model provider (Terminal A)

```powershell
$MockModelProgram = @'
import { MockOpenAIChatServer } from "./packages/testing/src/mock-openai.ts";
(async () => {
  const server = await MockOpenAIChatServer.start({ text: ["你好，this is the visible M3-05 owner TTS check."] });
  console.log(`MOCK_MODEL_URL=${server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await server.stop(); process.exit(0); });
  await new Promise(() => undefined);
})().catch((error) => { console.error(error); process.exit(1); });
'@

pnpm exec tsx -e $MockModelProgram
```

Copy the printed loopback `MOCK_MODEL_URL`; call it `<MOCK_MODEL_URL>` below. This server uses no real LLM key.

### 23.3 Load the Token Plan key without printing it (Terminal B)

```powershell
$SecureToken = Read-Host 'MiniMax Token Plan subscription key' -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
  $env:minimax_token_plan = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}

$env:FAIRY_OWNER_LIVE_TTS = '1'
$MockModelUrl = '<PASTE_MOCK_MODEL_URL_FROM_TERMINAL_A>'
Remove-Item Env:CI -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
```

Create an uncommitted temporary config (replace `<MOCK_MODEL_URL>` only):

```powershell
@'
models:
  - id: owner-mock-main
    transport: openai-chat
    base_url: <MOCK_MODEL_URL>
    model: deterministic-owner-mock
    data_clearance:
      max_sensitivity: personal
      residency: [region-restricted]
      regions: [cn]
roles:
  main:
    model: owner-mock-main
gateway:
  port: 8787
  watchdog_s: 5
  data_dir: __LIVE_DATA__
  auth:
    token: owner-live-local-token
governance:
  profile: balanced
  home_regions: [cn]
persona:
  enabled: false
affect:
  enabled: false
speech:
  providers:
    - id: minimax-owner-live
      stage: tts
      transport: minimax-t2a-v2-http
      endpoint_profile: cn-primary
      model: speech-2.8-turbo
      voice:
        voice_id: male-qn-qingse
        speed: 1
        volume: 1
        pitch: 0
      api_key_ref: secret://minimax_token_plan
      language_boost: auto
      audio:
        format: mp3
        sample_rate: 32000
        bitrate: 128000
        channel: 1
      limits:
        max_text_chars: 3000
        max_response_bytes: 67108864
        max_audio_bytes: 33554432
      data_clearance:
        max_sensitivity: personal
        residency: [region-restricted, global-ok]
        regions: [cn]
  roles:
    tts:
      primary: minimax-owner-live
      fallback: []
'@.Replace('<MOCK_MODEL_URL>', $MockModelUrl).Replace('__LIVE_DATA__', $LiveData.Replace('\','/')) |
  Set-Content -Encoding utf8 $LiveConfig

@{
  partials = @('owner live check')
  text = 'Please answer the short owner live-check fixture.'
  utterance_id = 'utt_m305_owner_live'
} | ConvertTo-Json | Set-Content -Encoding utf8 $LiveScript
```

Start the normal gateway in Terminal B:

```powershell
pnpm exec tsx apps/gateway/src/bin/gateway.ts --config $LiveConfig
```

### 23.4 Make exactly one synthesis call (Terminal C)

Capture the temporary-root baseline, then run the existing CLI path once:

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'
$TempBefore = @(Get-ChildItem $env:TEMP -Directory -Filter 'fairy-minimax-tts-*' | Select-Object -ExpandProperty FullName)

$CliLines = pnpm --silent fairy voice worker `
  --gateway ws://127.0.0.1:8787 `
  --token owner-live-local-token `
  --script $LiveScript `
  --json

if ($LASTEXITCODE -ne 0) { throw 'Owner live CLI failed' }
$CliJson = $CliLines | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
$Result = $CliJson | ConvertFrom-Json

if ($Result.provider_request_count -ne 1) { throw 'Expected exactly one provider request' }
if ($Result.provider_route.Count -ne 1) { throw 'Unexpected fallback/retry route' }

if ($Result.error_status -eq 'SPEECH_WORKER_TOKEN_PLAN_RESOURCE_LIMIT') {
  @{
    checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    status = 'token_plan_resource_limit'
    provider_request_count = $Result.provider_request_count
  } | ConvertTo-Json | Set-Content -Encoding utf8 "$EvidenceDir/live-result.json"
  throw 'Token Plan resource limit (2056): leave provider close pending until quota resets'
}

if ($Result.error_status -ne 'none' -or $Result.tts_chunk_count -ne 1) { throw "Live TTS failed: $($Result.error_status)" }
if (-not $Result.tts_provider.success_checks.base_resp_status_zero) { throw 'base_resp.status_code == 0 was not confirmed' }
if (-not $Result.tts_provider.success_checks.data_status_complete) { throw 'data.status == 2 was not confirmed' }
```

### 23.5 Validate artifact, secrecy, cleanup, and replay

```powershell
$ArtifactLine = Get-Content (Join-Path $LiveData 'artifacts/artifacts.jsonl') |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object artifact_id -eq $Result.tts_provider.artifact_ref |
  Select-Object -Last 1

if (-not $ArtifactLine) { throw 'Artifact record missing' }
if ($ArtifactLine.kind -ne 'speech' -or $ArtifactLine.mime -ne 'audio/mpeg') { throw 'Artifact kind/MIME mismatch' }
if (-not (Test-Path -LiteralPath $ArtifactLine.path -PathType Leaf)) { throw 'MP3 artifact missing' }
$Bytes = [IO.File]::ReadAllBytes($ArtifactLine.path)
if ($Bytes.Length -ne $Result.tts_provider.byte_count -or $Bytes.Length -le 0) { throw 'Artifact size mismatch' }
$Digest = 'sha256:' + ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes))).ToLowerInvariant()
if ($Digest -ne $Result.tts_provider.sha256) { throw 'Artifact SHA-256 mismatch' }

$RawLog = Get-Content -Raw $Result.log_path
foreach ($Forbidden in @($env:minimax_token_plan, 'Authorization:', 'base_resp', 'tts-output.mp3')) {
  if ($Forbidden -and $RawLog.Contains($Forbidden)) { throw "Forbidden content in JSONL: $Forbidden" }
  if ($Forbidden -and $CliJson.Contains($Forbidden)) { throw "Forbidden content in CLI JSON: $Forbidden" }
}
if ($RawLog -match '[0-9A-Fa-f]{200,}' -or $RawLog -match '[A-Za-z0-9+/]{200,}={0,2}') { throw 'Possible audio hex/base64 in JSONL' }

foreach ($Pid in @($Result.worker_process_id, $Result.tts_provider.worker.processId)) {
  if (Get-Process -Id $Pid -ErrorAction SilentlyContinue) { throw "Worker PID remains: $Pid" }
}
$TempAfter = @(Get-ChildItem $env:TEMP -Directory -Filter 'fairy-minimax-tts-*' | Select-Object -ExpandProperty FullName)
if (@(Compare-Object $TempBefore $TempAfter).Count -ne 0) { throw 'Temporary worker residue detected' }

pnpm fairy replay $Result.sid --data-dir $LiveData --json |
  Set-Content -Encoding utf8 "$EvidenceDir/replay.json"
if ($LASTEXITCODE -ne 0) { throw 'Replay failed' }
```

Open the generated MP3 with the owner's normal local player and confirm it is non-empty and intelligible. This is manual evidence only; OpenFairy implements no playback in M3-05.

Write bounded evidence, excluding the key, header, response envelope, and audio:

```powershell
@{
  checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  credential_class = 'token-plan'
  endpoint_profile = $Result.tts_provider.endpoint_profile
  provider_id = $Result.tts_provider.provider_id
  transport = $Result.tts_provider.transport
  model = $Result.tts_provider.model
  voice_id = $Result.tts_provider.voice_id
  python = $Result.tts_provider.worker.interpreter
  python_version = $Result.tts_provider.worker.pythonVersion
  provider_request_count = $Result.provider_request_count
  provider_route = $Result.provider_route
  audio_format = $Result.tts_provider.audio_format
  byte_count = $Result.tts_provider.byte_count
  sha256 = $Result.tts_provider.sha256
  artifact_ref = $Result.tts_provider.artifact_ref
  base_resp_status_zero = $Result.tts_provider.success_checks.base_resp_status_zero
  data_status_complete = $Result.tts_provider.success_checks.data_status_complete
  status = 'pass'
  playable_mp3_confirmed = $true
  temp_residue = 0
} | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 "$EvidenceDir/live-result.json"

$CliJson | Set-Content -Encoding utf8 "$EvidenceDir/cli.json"
```

Finally stop gateway/mock model and clear secrets from all terminals:

```powershell
Remove-Item Env:minimax_token_plan -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_OWNER_LIVE_TTS -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LiveConfig,$LiveScript -Force -ErrorAction SilentlyContinue
```

Commit only bounded evidence under `tasks/owner-checks/M3-05/`; do not commit the Token Plan key, Authorization header, raw response, temporary config, or generated MP3. If the outcome is `2056`, record `token_plan_resource_limit` and leave final provider close pending.
