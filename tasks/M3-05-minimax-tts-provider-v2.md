# M3-05 — MiniMax T2A v2 non-streaming TTS worker + governed audio artifacts

**Status:** DRAFT FOR FABLE/OPUS BRIEF GATE  
**Baseline:** committed GitHub state `bce1d65`  
**Milestone:** M3 — Voice I/O  
**Primary suite:** `voice.tts-provider-v0`  
**Owner live check:** required for final provider close; never part of CI  
**Official MiniMax contract checked:** 2026-07-10

---

## 1. Objective

Implement the first real speech-provider slice as a **TTS-only**, non-streaming MiniMax T2A v2 HTTP path.

This task must prove that a real cloud speech provider can be added without bypassing Fairy's existing governance, replay, process-supervision, and event boundaries.

The accepted path is:

```text
mock/loopback ASR final
  -> existing #submitVoiceFinalTranscript
  -> existing #acceptTurnInput
  -> one existing TurnRunner
  -> visible turn.final text only
  -> TTS provider route/clearance/egress checks
  -> supervised Python TTS worker
  -> MiniMax-compatible HTTP response
  -> gateway-owned local audio artifact
  -> canonical speech.tts.chunk with audio_ref
```

M3-05 deliberately does **not** implement real ASR, microphone capture, streaming playback, VAD, endpointing, two-lane response generation, acknowledgement banking, barge-in, or latency/quality benchmarks.

The owner has confirmed that the current MiniMax Token Plan includes speech. This removes entitlement uncertainty from planning, but the real call remains owner-only evidence and CI stays keyless.

---

## 2. Why TTS first

The authoritative M3 plan still requires real ASR/TTS, VAD/endpointing, Lane A/B, acknowledgement banking, chunked TTS, barge-in, a desktop client, and benchmarks.

The smallest independently closable real-provider slice is cloud TTS after the already-governed visible final response:

- it exercises real speech-provider configuration and routing;
- it proves cloud audio-data clearance and zero-byte denial;
- it proves secret delivery and diagnostic redaction;
- it proves Python worker compatibility and real HTTP behavior;
- it produces real audio without requiring a microphone, VAD, ASR quality corpus, playback device, or streaming client;
- it keeps the existing single TurnRunner and voice-to-turn path unchanged.

VAD, real ASR, streaming framing, Lane A/B, acknowledgement generation, sentence chunking, and barge-in remain subsequent tasks.

---

## 3. Read first

Codex must read the committed versions of:

- `ROADMAP.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `REVIEWER-HANDBOOK.md`
- `docs/specs/voice-pipeline.md`
- `docs/specs/protocol.md`
- `docs/specs/data-governance.md`
- `docs/specs/model-gateway.md`
- `docs/specs/evals.md`
- `docs/specs/config.md`
- `tasks/M3-04-speech-worker-process.md`
- `tasks/M3-04-review.md`
- `tasks/M3-04-work.md`
- `workers/speech/README.md`
- `workers/speech/mock_worker.py`
- `apps/gateway/src/speech-worker-process.ts`
- `apps/gateway/src/index.ts`
- `packages/config/src/schema.ts`
- `packages/perception/src/index.ts`
- existing artifact/replay implementations and registered schemas

Also read the current official MiniMax documentation for:

- model overview;
- synchronous T2A v2 HTTP;
- system voice IDs;
- Token Plan coverage and key rules;
- rate limits;
- common error codes.

Do not rely on an SDK example as the implementation contract. The official HTTP contract is authoritative.

### 3.1 Official MiniMax facts fixed for this brief

The gate must preserve the following currently documented facts:

- primary CN endpoint: `https://api.minimaxi.com/v1/t2a_v2`;
- documented backup CN endpoint: `https://api-bj.minimaxi.com/v1/t2a_v2`;
- authentication: `Authorization: Bearer <credential>`;
- request media type: `application/json`;
- current recommended speech models: `speech-2.8-turbo` and `speech-2.8-hd`;
- synchronous request text must be shorter than 10,000 characters;
- MiniMax recommends streaming when text is longer than 3,000 characters;
- non-streaming `output_format` supports `hex` and `url`; M3-05 supports only `hex`;
- a successful non-streaming response has:
  - `base_resp.status_code == 0`;
  - non-null `data`;
  - `data.status == 2`;
  - `data.audio` containing hex-encoded audio;
  - `extra_info` with audio metadata;
- Token Plan currently covers speech resources and the owner has confirmed that the available Token Plan includes speech;
- Token Plan subscription keys and pay-as-you-go API keys are separate credential classes, but both remain opaque Bearer credentials to Fairy.

### 3.2 M3-05 supported MiniMax subset

M3-05 deliberately supports a narrower contract than the complete MiniMax API:

- models: `speech-2.8-turbo` and `speech-2.8-hd`;
- default model: `speech-2.8-turbo`;
- non-streaming only;
- hex output only;
- system voice ID only;
- `language_boost`: `auto`, `Chinese`, or `English`;
- MP3, 32 kHz, 128 kbps, mono by default;
- plain visible assistant text;
- no subtitles, voice cloning, voice design, timbre mixing, sound effects, pronunciation dictionary, affect-to-emotion mapping, or watermark control.

The adapter may reject features that MiniMax supports but this slice does not. The deterministic fake must distinguish:

1. provider-invalid input, which mirrors MiniMax rejection; and
2. adapter-unsupported input, which Fairy rejects before provider I/O.

Do not read or recreate `docs-zh/`.

## 4. Normative baseline

The following project rules remain binding.

### 4.1 Runtime architecture

- One TurnRunner.
- Modes are policies, not alternate loops.
- Event-sourced JSONL sessions remain the source of truth.
- M5-before packaging remains source-first TypeScript.
- No `dist` exports or tests depending on sibling package builds.
- Gateway/CLI subprocesses remain in the same TypeScript execution world:
  - `tsx`, or
  - `node --import tsx`.
- Do not run TypeScript through plain `node`.
- Do not add provider special cases to the kernel.

### 4.2 Provider boundary

- Use raw HTTP.
- No MiniMax SDK, OpenAI SDK, or other vendor SDK in the worker, gateway, kernel, or runtime.
- Provider-specific request/response quirks stay at the speech-provider adapter and fixture boundary.
- The deterministic fake must reject inputs that the real endpoint would reject.
- CI must never use a real API key or real provider network.
- Real provider evidence is an owner check, separate from CI.

### 4.3 Voice and governance

- Registered `speech.*` schemas remain authoritative.
- Transport/worker wire messages are not canonical events.
- Raw audio, hex audio, and base64 audio never enter JSONL.
- TTS receives only visible final assistant text.
- TTS must never receive hidden reasoning, tool traces, audit internals, provider diagnostics, raw denied secrets, or suppressed output.
- Provider clearance is checked before provider I/O.
- An under-cleared provider receives zero request bytes.
- Labels may be raised but never lowered.
- Existing MemoryGate, egress guard, replay, and corrupt-tail behavior remain in force.
- Do not create a second voice-to-turn construction path.
- Do not add `speech.worker.*`, `voice.worker.*`, or vendor-specific canonical event types.

### 4.4 M3-04 worker rules

All M3-04 close requirements remain normative:

- supervisor remains gateway-side;
- `packages/voice` does not own `node:child_process`;
- stdio NDJSON is the v0 wire for a supervised local child;
- authenticated loopback WebSocket remains reserved for future decoupled/remote workers;
- `asr.script` and `tts.script` remain mock-conformance-only;
- Python is launched with `-u -B`;
- `shell:false`;
- worker cwd is repository-external;
- Python writes protocol lines through `sys.stdout.buffer.write(... + b"\n")` and flushes each message;
- TypeScript removes one trailing `\r`;
- stdout and stderr are drained concurrently from spawn and remain bounded;
- stdout lines, queues, pending requests, stderr capture, response bodies, artifacts, and deadlines are bounded;
- child processes and temporary files are cleaned after success, cancellation, crash, timeout, malformed output, and shutdown;
- `FAIRY_TEST_PYTHON` remains literal, test-only `argv[0]`.

---

## 5. Scope

M3-05 implements only the following.

### 5.1 Speech-provider configuration

Add a closed, validated speech-provider registry and TTS role sufficient for this slice.

Proposed shape:

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
        speed: 1.0
        volume: 1.0
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

The gate may adjust field names, but the implementation must preserve these semantics:

- providers are identified by stable IDs;
- stage is closed to `tts` in this task;
- transport is closed to `minimax-t2a-v2-http` in this task;
- role routing is independent of model roles;
- primary plus ordered fallback is deterministic;
- provider clearance reuses the existing governance types and semantics;
- a provider claiming `region-restricted` must declare `regions`;
- the owner declares processing regions; Fairy does not infer jurisdiction from a hostname;
- models are closed to `speech-2.8-turbo` and `speech-2.8-hd` for M3-05;
- `speech-2.8-turbo` is the default for interactive-agent latency;
- system voice ID, voice controls, language boost, audio settings, limits, clearance, and secret reference are configuration;
- API keys and Token Plan keys are never accepted inline;
- `max_text_chars` defaults to 3000 and may not exceed 3000 in this non-streaming slice;
- `max_response_bytes` and `max_audio_bytes` are bounded and validated;
- the sample limits above are normative defaults unless the gate selects stricter values.

Production endpoints are transport-owned profiles, not arbitrary URLs:

```text
cn-primary -> https://api.minimaxi.com/v1/t2a_v2
cn-backup  -> https://api-bj.minimaxi.com/v1/t2a_v2
```

Requirements:

- production config may select only a closed endpoint profile;
- no raw production endpoint URL is accepted from YAML, CLI, worker wire, or environment;
- the backup endpoint is represented explicitly as a separate configured candidate or endpoint profile, not as an invisible network retry;
- deterministic tests may inject only `http://127.0.0.1:<ephemeral-port>` through a code-enforced test-only seam;
- the test endpoint seam is not reachable from production config or CLI.

Do not add ASR provider configuration in this task.

### 5.2 Provider route and clearance

After a normal TurnRunner produces visible final text:

1. derive the effective TTS text and labels from the canonical visible final only;
2. reject an empty payload or text longer than the configured M3-05 limit before provider I/O;
3. identify the configured `speech.roles.tts` candidates;
4. apply the speech-provider egress check;
5. evaluate provider clearance before worker/provider I/O;
6. skip denied candidates without opening a connection or sending request bytes;
7. choose the first cleared candidate;
8. synthesize once for that candidate;
9. optionally advance to the next configured candidate only under the brief's explicit fallback classification;
10. preserve the successful text turn on all TTS denials and failures.

Requirements:

- TTS labels inherit max sensitivity and residency intersection from the visible final's provenance; synthesis never declassifies;
- an under-cleared primary receives zero connections and zero request bytes;
- a cleared fallback may be selected;
- no eligible provider means no worker/provider request, no artifact, and no `speech.tts.chunk`;
- empty or over-limit text means no provider I/O and a bounded existing-event diagnostic;
- each provider candidate is attempted at most once per synthesis request;
- auth, quota, balance, invalid-parameter, voice-ID, and content-safety failures are not retried against the same credential;
- no hidden automatic failover from `cn-primary` to `cn-backup`;
- TTS failure must not retroactively fail or duplicate the text TurnRunner result;
- do not silently downgrade labels;
- do not use `prefer_local` as a gate;
- only existing canonical event types may be used, including bounded `progress.update` stage strings where needed;
- no provider trace, credential, raw response, absolute path, or audio bytes may be placed in canonical payloads.

### 5.3 Real provider worker

Add a repository-owned Python worker implementation, for example:

```text
workers/speech/minimax_tts_worker.py
```

Requirements:

- Python standard library only;
- no pip dependencies;
- ASCII-only source;
- raw HTTPS/HTTP implementation using standard-library facilities;
- default certificate and hostname verification remain enabled;
- no vendor SDK;
- no shell;
- no microphone, speaker, subprocess, browser, or playback access;
- no arbitrary filesystem paths from config, CLI, environment, or worker requests;
- no access to repository files except the repository-controlled worker source at spawn;
- provider request has explicit connect, read, and total deadlines;
- redirects fail closed;
- response body is streamed/read under the configured strict maximum;
- content is decoded only after a structurally valid provider envelope;
- provider error payloads are untrusted diagnostics;
- provider trace IDs may be retained only as bounded/redacted support diagnostics, never as authorization or canonical truth.

Production endpoint rules:

- `cn-primary` maps exactly to `https://api.minimaxi.com/v1/t2a_v2`;
- `cn-backup` maps exactly to `https://api-bj.minimaxi.com/v1/t2a_v2`;
- production endpoint host, scheme, port, and path are adapter-owned;
- no redirect, host substitution, proxy override, or arbitrary URL is accepted;
- deterministic tests may use only a code-enforced `http://127.0.0.1:<ephemeral-port>` override;
- test-loopback HTTP is allowed only behind the existing test/CI gate;
- arbitrary non-loopback HTTP is rejected;
- proxy-related inherited environment variables must not silently reroute the worker unless the gate explicitly approves and tests that behavior.

### 5.4 Secret delivery

Resolve `api_key_ref` at the gateway composition boundary.

For the owner's live path, the reference points to the confirmed MiniMax Token Plan subscription key. Fairy remains credential-class agnostic at runtime: a Token Plan key or pay-as-you-go API key is an opaque Bearer credential, and Fairy does not convert or mix the two classes.

The selected provider credential must:

- never appear in argv;
- never appear in the NDJSON request;
- never appear in JSONL;
- never appear in stdout;
- never appear in CLI JSON;
- never appear in thrown public errors;
- never appear in committed fixtures;
- never be copied into a broad inherited `FAIRY_SECRET_*` environment set.

Pass only the selected credential through one repository-owned child variable, proposed:

```text
FAIRY_MINIMAX_T2A_TOKEN
```

The child environment must be deliberately constructed, not blindly inherited. Preserve only the minimal OS variables required to launch Python and validate TLS.

Redact:

- exact credential values;
- `Authorization` header values;
- bearer-token variants;
- provider error echoes;
- stderr fragments;
- malformed response snippets;
- URL query strings if any unexpected query is observed.

Tests must seed a recognizable fake credential and prove its absence from every output and persistence surface.

### 5.5 Real-provider worker wire

Do not redefine `tts.script`; it remains mock-conformance-only.

Reuse the existing provider-neutral M3-02 frame kind:

```text
tts.request
```

M3-05 defines its stdio-worker mapping and real-provider payload semantics. It must not introduce a second synonymous request kind.

Gateway to worker:

- wire version;
- request ID;
- visible spoken text;
- provider transport ID;
- closed endpoint profile;
- model;
- system voice settings;
- language boost;
- audio settings;
- response/audio limits;
- no credential;
- no arbitrary endpoint URL;
- no arbitrary output path.

Worker to gateway:

- existing `tts.chunk` / completion semantics as reconciled with the stdio wire;
- opaque repository-defined temporary artifact token or safe relative output name;
- format;
- MIME type;
- byte count;
- SHA-256;
- bounded provider diagnostic category where needed;
- no raw audio, hex audio, base64 audio, absolute filesystem path, credential, Authorization header, or full provider response.

The worker must not emit a canonical event directly.

Include an explicit table in `tasks/M3-05-work.md` covering:

1. `tts.request` frame -> stdio request;
2. MiniMax HTTP request/response -> worker result;
3. worker result -> artifact registration;
4. artifact registration -> canonical `speech.tts.chunk`;
5. worker/provider errors -> existing bounded canonical visibility.

### 5.6 MiniMax T2A v2 HTTP adapter

Implement the current synchronous non-streaming MiniMax T2A v2 HTTP contract.

#### Supported request subset

For M3-05:

- method/path: `POST /v1/t2a_v2`;
- primary host: `api.minimaxi.com`;
- backup host: `api-bj.minimaxi.com`;
- `Authorization: Bearer <resolved-credential>`;
- `Content-Type: application/json`;
- model is `speech-2.8-turbo` or `speech-2.8-hd`;
- default model is `speech-2.8-turbo`;
- text is non-empty and at most 3000 characters for this slice;
- `stream` is exactly `false`;
- `output_format` is exactly `hex`;
- `voice_setting` contains the configured:
  - `voice_id`;
  - `speed`;
  - provider field `vol`, mapped from provider-neutral `volume`;
  - `pitch`;
- `audio_setting` contains:
  - `sample_rate`;
  - `bitrate`;
  - `format`;
  - `channel`;
- `language_boost` is `auto`, `Chinese`, or `English`;
- `subtitle_enable` is exactly `false`;
- `aigc_watermark` is exactly `false`.

The initial recommended owner configuration is:

```text
model: speech-2.8-turbo
voice_id: male-qn-qingse
speed: 1
vol: 1
pitch: 0
language_boost: auto
format: mp3
sample_rate: 32000
bitrate: 128000
channel: 1
```

M3-05 does not send or expose:

- `stream_options`;
- `pronunciation_dict`;
- `timbre_weights`;
- `voice_modify`;
- `subtitle_type`;
- cloned/designed voice operations;
- provider emotion controls;
- affect-to-emotion mapping;
- provider URL output.

The provider's absolute synchronous hard limit remains `< 10000` characters, but Fairy's M3-05 adapter limit is `<= 3000` because the official documentation recommends streaming above 3000. Longer output remains a later streaming/chunking task.

#### Successful response contract

Accept success only when all required conditions hold:

- HTTP response is accepted under the adapter's success policy;
- body is valid JSON and within `max_response_bytes`;
- `base_resp.status_code == 0`;
- `data` is non-null;
- `data.status == 2`;
- `data.audio` is a non-empty, even-length, valid hexadecimal string;
- decoded audio is within `max_audio_bytes`;
- `extra_info.audio_format` matches the requested format;
- `extra_info.audio_channel` matches the requested channel;
- `extra_info.audio_sample_rate` matches the requested sample rate;
- `extra_info.bitrate` matches the requested bitrate where present;
- `extra_info.audio_size` equals the decoded byte count where present;
- computed SHA-256 and file size match the worker result.

Reject missing, mismatched, malformed, empty, truncated, or oversized output.

#### Error classification

Map provider failures into bounded internal categories without persisting raw provider messages.

At minimum, fixtures cover:

- timeout: `1001`;
- rate limit: `1002`;
- unauthorized/token mismatch: `1004`;
- insufficient balance: `1008`;
- internal/downstream error: `1024`, `1033`;
- input/output safety: `1026`, `1027`;
- invalid-character ratio: `1042`;
- parameter error: `2013`;
- invalid or inaccessible voice ID: `20132`, `2042`;
- invalid API key: `2049`;
- Token Plan resource limit: `2056`.

No provider error code authorizes routing, declassification, retry, or canonical event creation.

#### Deterministic fake boundary

The fake MiniMax endpoint must:

- accept exactly the adapter-supported outbound shape;
- validate the expected bearer credential;
- return MiniMax-shaped success and error envelopes;
- reject provider-invalid input in the same class as the documented provider;
- separately let gateway/adapter tests prove that unsupported Fairy features are rejected before provider I/O;
- never imply that MiniMax rejects all optional fields merely because M3-05 does not support them.

Do not implement:

- WebSocket T2A;
- provider streaming;
- URL output;
- async long-text TTS;
- voice cloning;
- voice design;
- subtitles;
- pronunciation-dictionary UI;
- custom timbre mixing;
- sound effects;
- audio playback.

Provider quirks belong in this adapter and its fixtures, not in TurnRunner or kernel code.

### 5.7 Audio artifact lifecycle

Real audio must not cross stdio as audio bytes.

The existing content-addressed artifact implementation currently lives in `packages/perception` and its artifact kind is perception-specific. M3-05 must not make `packages/voice` depend on `packages/perception` and must not duplicate the registry logic.

Preferred implementation:

- extract the neutral content-addressed storage/registry primitives into a small source-first package such as `packages/artifacts`;
- keep perception behavior and existing artifact/replay tests unchanged;
- have perception consume or re-export the neutral primitives as needed;
- add only the speech/audio capability required by M3-05;
- support `audio/mpeg` / `.mp3` for the initial MiniMax path;
- do not broaden the extraction into a generic blob platform or public plugin API.

If the existing registered artifact schema cannot represent a speech artifact without an incompatible change, Codex must stop and report the conflict in `tasks/M3-05-work.md`; it must not silently mutate a canonical schema. The brief gate may approve either:

1. a compatible additive artifact-kind extension; or
2. a speech-owned content-addressed store referenced only by `speech.tts.chunk.audio_ref`.

Whichever design the gate selects must preserve stable replay resolution and avoid duplicate registries with conflicting IDs.

Use a gateway-owned, repository-external per-worker temporary output directory:

1. gateway creates the directory;
2. gateway passes the exact root through a narrow internal environment variable;
3. worker creates only a repository-defined relative file under that root;
4. worker writes decoded audio to a temporary file and atomically finalizes it;
5. worker reports only an opaque token/relative name plus metadata/hash;
6. supervisor resolves the token under the exact root;
7. supervisor rejects absolute paths, traversal, symlinks, non-regular files, hash mismatch, extension/format mismatch, and oversized files;
8. gateway imports the bytes into the selected content-addressed persistent store;
9. gateway emits only compatible existing canonical representations and `speech.tts.chunk` with a stable `audio_ref`;
10. temporary worker output is deleted.

Requirements:

- no worker-controlled persistent destination;
- no `..`, absolute, UNC, drive-relative, alternate-data-stream, or symlink escape;
- content-addressed persistent naming;
- no raw audio in JSONL;
- replay uses `audio_ref`, not embedded audio;
- duplicate content may safely reuse an existing artifact;
- partial files are never registered;
- cancellation/crash/timeout/malformed response leaves no persistent artifact and no temporary file;
- persistence labels derive from the synthesized visible text labels;
- do not broaden this task into an artifact-system rewrite.

### 5.8 Canonical output

On successful synthesis:

- emit the existing registered `speech.tts.chunk` schema exactly;
- `payload.text` is visible final text or the exact supported chunk text;
- `payload.audio_ref` points to the persistent local artifact;
- use existing `speech.mark` vocabulary only if already applicable;
- do not add vendor fields to canonical speech events;
- do not persist provider request/response envelopes;
- do not persist temporary paths;
- do not persist audio hex/base64.

If an existing registered `artifact.created` event is used, preserve its schema exactly.

Do not create:

- `speech.tts.provider.*`;
- `speech.minimax.*`;
- `voice.provider.*`;
- `speech.worker.*`;
- any other new canonical event family.

### 5.9 Python support floor

Resolve the M3-04 named carry-in in this task.

The speech-worker contract becomes:

```text
Python >= 3.11
```

Required enforcement:

- document the floor in the worker-owned English source/readme location proposed for reviewer application;
- parse discovered interpreter major/minor;
- reject Python `< 3.11` before starting a real worker;
- preserve surfaced executable and version evidence;
- ready handshake must reject a version mismatch;
- keep `FAIRY_TEST_PYTHON` test-only and literal;
- add an explicit CI Python 3.11 floor lane;
- run the focused real-provider suite on Ubuntu and Windows with an explicitly provisioned Python 3.11 interpreter;
- retain normal discovery coverage independently;
- do not pin a patch version such as `3.11.15`.

The existing M3-04 mock worker and focused suite must remain compatible.

### 5.10 CLI/developer path

Add a deterministic developer/owner path that uses the normal gateway integration and emits machine-readable evidence.

The exact command name is gate-adjustable. It must:

- run mock/fixture speech input through the existing TurnRunner;
- use a deterministic local/mock text-model provider;
- synthesize the visible final through the configured TTS provider;
- never require a real LLM key;
- support a local fake MiniMax endpoint for CI;
- support real MiniMax only in an explicit owner-live mode;
- reject user-controlled Python executable, worker script, provider executable, output directory, and persistent artifact path;
- output JSON containing only bounded evidence such as:
  - session ID;
  - provider ID;
  - provider transport;
  - worker ID/PID;
  - Python executable/version/source;
  - request ID;
  - selected/fallback route;
  - model and voice ID;
  - audio format;
  - artifact ID/ref;
  - byte count and SHA-256;
  - canonical event counts;
  - provider request count;
  - replay command;
  - redacted error status.

Do not print:

- API key;
- Authorization header;
- input/output audio;
- audio hex/base64;
- raw provider envelope;
- absolute temporary path;
- hidden reasoning;
- audit internals.

---

## 6. Compact channel-ID framing decision

M3-05 makes the following explicit decision:

> This is an artifact-backed, non-streaming TTS slice. Real provider audio flows from the provider worker into a gateway-owned temporary file and then into a local content-addressed artifact. It does not flow over the client/gateway binary streaming channel.

Therefore:

- the voice-pipeline §2 compact `4-byte channel_id + payload` binary frame is **not activated or modified in M3-05**;
- no audio bytes travel over worker NDJSON;
- no audio bytes travel over client WebSocket;
- no playback channel exists;
- the existing §2 compact framing remains binding for the first task that streams real microphone or TTS audio between client and gateway;
- that later task must decide stream IDs, codec negotiation, backpressure, chunk timing, and cancellation semantics before implementation.

Do not silently invent an interim binary frame in this task.

---

## 7. Failure semantics

For all failures, diagnostics must be bounded and redacted.

### 7.1 Route denied / no eligible provider

- zero request bytes to denied providers;
- no worker/provider call for an ineligible route;
- no `speech.tts.chunk`;
- no artifact;
- successful text turn remains complete and replayable;
- existing `progress.update` may expose a stable stage and redacted reason.

### 7.2 Provider HTTP error

Includes:

- DNS/connect failure;
- TLS failure;
- deadline;
- HTTP non-success;
- provider `base_resp.status_code != 0`;
- null/missing data;
- incomplete status;
- malformed JSON;
- oversized response;
- invalid/mismatched audio metadata;
- invalid hex;
- decoded artifact over limit.

Result:

- no canonical TTS chunk;
- no persistent artifact;
- no temporary residue;
- text turn remains replayable;
- no secret/provider body leak.

### 7.3 Worker failure

Includes:

- startup failure;
- handshake mismatch;
- crash;
- malformed NDJSON;
- uncorrelated response;
- line/queue/pending overflow;
- timeout;
- cancellation;
- shutdown failure.

Result:

- all pending TTS work rejects deterministically;
- child PID disappears;
- temporary output root is removed;
- no artifact or canonical TTS chunk;
- text turn remains complete/replayable;
- existing canonical event types only.

---

## 8. Deterministic test suite

Register:

```text
voice.tts-provider-v0
```

The suite is PR-tier and must use:

- loopback-only `127.0.0.1`;
- ephemeral ports;
- explicit deadlines;
- deterministic MiniMax-shaped local HTTP server;
- no public network;
- no real key;
- no sleeps as the primary synchronization mechanism;
- no arbitrary workstation paths.

Minimum cases follow.

### Case A — config, official endpoint profiles, and Python floor

Prove:

- valid TTS provider/role config parses;
- duplicate IDs reject;
- unknown provider references reject;
- stage/transport enums are closed;
- inline credentials reject;
- clearance claiming `region-restricted` without `regions` rejects;
- models outside `speech-2.8-turbo` / `speech-2.8-hd` reject;
- default model is `speech-2.8-turbo`;
- `max_text_chars > 3000` rejects;
- raw production endpoint URLs reject;
- `cn-primary` and `cn-backup` map to the exact official HTTPS endpoints;
- only code-enforced test loopback HTTP is accepted;
- discovery rejects Python `< 3.11`;
- exact Python 3.11 passes on Ubuntu and Windows floor lanes;
- ready reports executable/version/source;
- `FAIRY_TEST_PYTHON` remains test-only.

### Case B — exact provider request and credential hygiene

Fake server verifies:

- one request;
- expected method and `/v1/t2a_v2` path;
- `Content-Type: application/json`;
- correct bearer header;
- exact M3-05 supported JSON subset;
- model `speech-2.8-turbo` or `speech-2.8-hd`;
- `stream:false`;
- `output_format:"hex"`;
- `subtitle_enable:false`;
- `aigc_watermark:false`;
- configured `voice_setting`;
- configured `audio_setting`;
- allowed `language_boost`;
- visible final text only.

Negative assertions:

- credential absent from argv, NDJSON, JSONL, CLI JSON, stderr/public error, artifact metadata, and snapshots;
- Authorization header absent from diagnostics;
- hidden reasoning/tool/audit text absent from provider request;
- no raw endpoint override reaches the worker;
- unsupported adapter features are rejected before provider I/O;
- no optional MiniMax field escapes the adapter's closed supported subset.

### Case C — clearance and fallback

Use two deterministic provider endpoints.

Prove:

- under-cleared primary receives zero connections/request bytes;
- cleared fallback receives exactly one request;
- no cleared candidate yields zero requests total;
- route decisions are visible through existing bounded events;
- labels are not downgraded;
- `prefer_local` does not override clearance.

### Case D — successful MiniMax-shaped artifact-backed TTS

Fake provider returns a valid deterministic MiniMax envelope containing small MP3 fixture bytes as hex:

- `base_resp.status_code: 0`;
- `data.status: 2`;
- matching `extra_info` metadata.

Prove:

- worker validates and decodes it;
- `audio_size` matches decoded bytes;
- temp file remains inside the gateway-created root;
- supervisor validates path/hash/size/format;
- persistent audio is content-addressed;
- selected artifact/store representation is schema-compatible;
- exactly one canonical `speech.tts.chunk` references the artifact;
- TTS artifact labels inherit the synthesized visible text labels;
- JSONL contains no audio bytes/hex/base64/temp path/provider envelope;
- replay resolves/preserves the TTS reference;
- worker and temp directory are gone after shutdown.

### Case E — provider and adapter conformance rejection

Provider-shaped fake responses cover at least:

- missing/wrong authorization (`1004` or `2049`);
- rate limit (`1002`);
- timeout (`1001`);
- Token Plan resource limit (`2056`);
- insufficient balance (`1008`);
- content safety (`1026`, `1027`);
- invalid-character ratio (`1042`);
- parameter error (`2013`);
- invalid/inaccessible voice (`20132`, `2042`);
- internal/downstream failure (`1024`, `1033`);
- malformed JSON;
- nonzero `base_resp.status_code`;
- null data;
- `data.status != 2`;
- empty, odd-length, or non-hex audio;
- audio metadata mismatch;
- `audio_size` mismatch;
- oversized response/audio.

Adapter-side pre-I/O rejection covers at least:

- empty text;
- text longer than 3000 characters;
- unsupported model;
- invalid voice/audio settings;
- `stream != false`;
- `output_format != "hex"`;
- subtitle, URL output, voice-modify, timbre, pronunciation-dictionary, and other unsupported fields;
- arbitrary endpoint URL.

The fake must mirror documented MiniMax envelope/error classes while preserving a separate closed Fairy adapter subset.

### Case F — failure cleanup and replay

For timeout, crash, malformed worker output, invalid provider response, cancel, and forced shutdown:

- no `speech.tts.chunk`;
- no persistent artifact;
- no temporary residue;
- no dangling process;
- no duplicate final turn;
- successful text result remains in JSONL;
- session replays;
- errors are redacted;
- no new canonical event type.

### Case G — output-only TTS

Seed:

- hidden reasoning;
- tool trace;
- audit detail;
- denied fake secret;
- redacted final output;
- ordinary visible final output.

Prove provider receives only the allowed visible final text after egress checks.

### Case H — residual conformance

The following remain green:

- `voice.worker-process-v0`;
- `voice.websocket-transport-v0`;
- `voice.duplex-transport-v0`;
- `voice.protocol-loopback-v0`;
- governance suites;
- memory leakage/deletion suites;
- replay/corrupt-tail tests;
- CLI voice tests;
- source scans.

No latency, real-time streaming, ASR quality, endpointing, barge-in, or desktop-client benchmark may be newly reported as PASS.

---

## 9. CI requirements

CI must remain deterministic and keyless.

Required:

- existing Ubuntu/Windows jobs remain green;
- add explicit Python 3.11 floor coverage for the focused speech-worker/provider suite on Ubuntu and Windows;
- use a deterministic local MiniMax-shaped HTTP server;
- use ephemeral loopback ports;
- forbid public provider network;
- never read owner secrets;
- never emit bearer tokens;
- preserve source-first execution;
- preserve dependency/source-scan guards.

CI evidence and owner live evidence must be reported separately.

---

## 10. Owner live check

A real MiniMax TTS call is required before final provider close, but it is never required for Codex CI.

Owner environment facts:

- the owner has confirmed that the current MiniMax Token Plan includes speech;
- the owner live path therefore uses the Token Plan subscription key through a Fairy secret reference;
- the Token Plan key must not be confused with or converted into a pay-as-you-go API key.

The owner check must:

- use a dedicated Fairy secret reference pointing to the Token Plan key;
- record credential class as `token-plan` without recording the key;
- confirm remaining Token Plan availability before the call;
- use `cn-primary` unless the owner intentionally tests the documented backup as a separately configured candidate;
- use:
  - `speech-2.8-turbo`;
  - an official system voice such as `male-qn-qingse`;
  - `language_boost:auto`;
  - MP3 / 32000 Hz / 128000 bps / mono;
- use one short, non-sensitive Chinese/English fixture no longer than 200 characters;
- make exactly one synthesis request;
- disable automatic provider retries;
- record UTC time, endpoint profile, provider/model/voice, Python executable/version, request count, audio format, byte count, SHA-256, artifact ref, and redacted provider category/status;
- confirm a playable non-empty local MP3 artifact;
- confirm `base_resp.status_code == 0` and `data.status == 2` without committing the raw provider envelope;
- confirm no key, Authorization header, audio hex, or base64 in JSONL or CLI output;
- confirm worker PID and temp directory are gone;
- replay the session;
- store evidence under `tasks/owner-checks/M3-05/`.

Do not commit:

- Token Plan key or pay-as-you-go key;
- Authorization headers;
- raw provider responses;
- generated audio unless the owner explicitly decides that a public, non-sensitive fixture belongs in the repository.

If the call returns `2056`, record `token_plan_resource_limit` and leave final provider close pending until quota resets. Do not claim live-provider PASS from the fake endpoint.

## 11. Deliverables

Expected implementation areas include, but are not limited to:

- `workers/speech/`:
  - real MiniMax TTS worker;
  - provider fixtures;
  - updated worker source/readme metadata as appropriate;
- `apps/gateway/`:
  - speech provider config composition;
  - provider routing/clearance;
  - real TTS worker supervision;
  - bounded temp-output import;
  - artifact registration;
  - canonical TTS integration;
- `packages/config/`:
  - closed speech provider/role schema;
- neutral artifact storage area approved by the gate, preferably `packages/artifacts/`:
  - minimal extraction of content-addressed storage;
  - compatible perception reuse;
  - speech MP3 artifact support;
- `apps/cli/`:
  - deterministic developer/owner command path;
- `packages/testing/`:
  - `voice.tts-provider-v0`;
  - fake MiniMax server;
  - negative conformance and governance cases;
- CI workflow:
  - explicit Python 3.11 floor lanes;
- `tasks/M3-05-work.md`:
  - implementation report and proposed docs edits.

Exact file layout may vary, but boundaries may not.

---

## 12. Boundaries — do not

Do not implement or introduce:

- real ASR;
- microphone or speaker access;
- OS audio capture/playback;
- MiniMax or vendor SDKs;
- arbitrary production endpoint URLs or redirect following;
- provider emotion/affect mapping;
- pip dependencies;
- WebSocket T2A;
- streaming provider audio;
- client/gateway binary audio flow;
- compact channel-ID frame changes;
- Opus encoding/decoding;
- VAD or endpointing;
- Lane A/Lane B;
- acknowledgement bank;
- sentence segmentation/chunk scheduler;
- barge-in;
- latency benchmark;
- ASR quality benchmark;
- desktop tray client;
- voice cloning or voice design;
- M4 scheduler/workflow;
- second TurnRunner;
- provider logic in kernel;
- child-process ownership in `packages/voice`;
- source-scan guard relaxation;
- raw audio/hex/base64 in JSONL;
- inline API keys;
- real API calls in CI;
- `docs-zh/`;
- direct English docs edits by Codex.

Do not silently broaden M3-05 to “complete real voice.”

---

## 13. Acceptance commands

Codex must report exact commands and tails. At minimum:

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
pnpm --filter @fairy/testing test -- --reporter=verbose -t 'voice.tts-provider-v0'
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm --filter @fairy/voice test -- --reporter=verbose
pnpm --filter @fairy/cli test -- --reporter=verbose
git diff --check
```

Also report:

- explicit Python 3.11 focused-suite commands on Windows and Ubuntu CI;
- normal production discovery evidence;
- all fake-provider request counts;
- zero-byte denied-provider evidence;
- no-orphan/temp-residue evidence;
- source scan proving Python ASCII-only and no forbidden imports/SDKs;
- source scan proving no `node:child_process` ownership moved into `packages/voice`;
- source scan proving no `docs-zh/` recreation/edit;
- canonical-event registry diff, expected to contain no new worker/vendor event family.

Do not use total test count as the only acceptance signal. Name every required suite.

---

## 14. Work report

Create:

```text
tasks/M3-05-work.md
```

It must include:

1. baseline and final commit;
2. changed-file inventory;
3. exact speech provider/role config and validation decisions;
4. official endpoint-profile mapping;
5. provider route/clearance/fallback matrix;
6. Token Plan/pay-as-you-go credential handling and child-environment design;
7. exact MiniMax request/response/error-code mapping;
8. provider-invalid vs adapter-unsupported conformance table;
9. provider wire mapping table;
10. provider wire to artifact/frame/canonical-event mapping table;
11. artifact extraction/compatibility decision;
12. temporary-file and persistent-artifact lifecycle;
13. every text/body/audio/line/queue/deadline limit;
14. failure, retryability, and cleanup matrix;
15. Python `>=3.11` enforcement and CI evidence;
16. JSONL/replay proof;
17. CI evidence separated from owner-live evidence;
18. known limitations;
19. spec ambiguities encountered;
20. proposed English docs edits;
21. owner live-check instructions.

The report must explicitly state:

- `tts.script` remains mock-only;
- M3-05 reuses `tts.request`;
- M3-05 uses artifact-backed non-streaming TTS;
- the supported MiniMax subset is narrower than the complete provider API;
- `speech-2.8-turbo` is the interactive default and `speech-2.8-hd` is optional;
- Token Plan speech availability was owner-confirmed, while credentials remain opaque Bearer secrets;
- §2 compact channel-ID framing is deferred unchanged;
- no real ASR/VAD/playback/streaming was implemented;
- no real provider key was used by CI.

Codex must not edit English docs. The reviewer applies approved proposals after countersign.

## 15. Proposed reviewer-owned docs pass

Codex may propose changes for:

- `docs/specs/voice-pipeline.md`
  - M3-05 non-streaming artifact-backed TTS status;
  - real-provider boundary;
  - compact framing remains deferred;
- `docs/specs/protocol.md`
  - provider-neutral real TTS worker request mapping;
  - audio artifact reference rules;
- `docs/specs/data-governance.md`
  - speech provider clearance and audio egress;
  - zero-byte denied-provider rule;
  - provider diagnostics as untrusted;
- `docs/specs/model-gateway.md`
  - speech-provider registry/role separation from model providers;
- `docs/specs/evals.md`
  - `voice.tts-provider-v0`;
- `docs/specs/config.md`
  - speech provider and role config;
- `workers/speech/README.md`
  - Python `>=3.11`, real worker boundary, supported transport;
- `REVIEWER-HANDBOOK.md`
  - only if the gate/countersign establishes a reusable invariant.

Do not recreate or edit `docs-zh/`.

---

## 16. Gate questions for Fable/Opus

The brief gate must explicitly decide:

1. Is TTS-only the correct first real-provider slice after M3-04?
2. Is the Python speech-worker boundary retained for MiniMax HTTP rather than adding a gateway-direct provider path?
3. Is the supported MiniMax subset correctly limited to `speech-2.8-turbo` / `speech-2.8-hd`, non-streaming hex, system voice, and MP3 defaults?
4. Is `<= 3000` the correct M3-05 text ceiling given the official streaming recommendation above 3000?
5. Are `cn-primary` / `cn-backup` closed endpoint profiles preferable to arbitrary production URLs?
6. Is the provider clearance example valid with `residency: [region-restricted, global-ok]` and `regions: [cn]`?
7. Is non-streaming hex response -> worker temp file -> gateway artifact the accepted flow?
8. Is deferring §2 compact channel-ID binary framing valid because no client/gateway stream exists yet?
9. Should M3-05 extract neutral artifact primitives into `packages/artifacts`, or use a speech-owned store because the current artifact schema is not additively extensible?
10. Is a real owner Token Plan call mandatory for final close?
11. Are Python 3.11 floor lanes required on both Ubuntu and Windows?
12. Are MiniMax error codes classified correctly without adding new canonical event types?
13. Should any provider response metadata beyond bounded trace ID/category be retained?
14. Are the proposed 64 MiB response and 32 MiB decoded-audio defaults acceptable?

If any answer changes scope materially, revise this brief before dispatching to Codex.

## 17. Report back

Codex must report:

- final implementation commit;
- CI run URL;
- all acceptance commands and named suite results;
- Python floor evidence;
- exact official endpoint profile/model/voice used;
- exact fake-provider request counts;
- zero-byte clearance evidence;
- artifact/replay/no-residue evidence;
- deviations from the gated brief;
- unresolved ambiguities;
- proposed docs edits;
- owner live-check prerequisites and exact command.

Do not claim M3-05 closed. Closure requires:

1. committed implementation;
2. green CI;
3. primary implementation review;
4. committed owner evidence, including the real provider check;
5. final primary close;
6. Fable/Opus code-level countersign;
7. reviewer-owned English docs pass.
