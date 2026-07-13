# M3-06 — faster-whisper local ASR worker + offline model environment

**Status:** GATED — edits RE-1..RE-4 applied in place 2026-07-13 by the reviewer (Claude Fable 5); gate record + answers to all 20 §23 questions in `tasks/M3-06-brief-review.md`  
**Baseline:** committed GitHub state `e9e88ec`  
**Milestone:** M3 — Voice I/O  
**Primary suite:** `voice.asr-local-v0`  
**Real local owner check:** required for final close; never part of normal CI  
**External project facts checked:** 2026-07-13

---

## 1. Objective

Implement the first real **local ASR** provider as an artifact-backed, non-streaming `faster-whisper` worker.

M3-06 must prove that Fairy can:

- install and lock a non-stdlib speech-worker environment reproducibly;
- prefetch and verify a pinned local model outside the repository;
- route a labeled local audio artifact to a cleared ASR provider;
- run real local transcription without cloud egress;
- emit one canonical `speech.asr.final`;
- enter the existing voice-to-turn path exactly once;
- preserve `audio_ref`, labels, replay, cancellation, and process cleanup;
- keep CI deterministic without downloading a model or running real inference.

The accepted path is:

```text
local input audio file
  -> owner/test import into packages/artifacts as kind=input
  -> stable audio_ref
  -> gateway voice ASR op
  -> gateway-owned SpeechProviderCoordinator
  -> derive effective voice/audio labels
  -> speech.asr role + provider clearance
  -> gateway validates and stages artifact into a private temp root
  -> supervised faster-whisper Python worker
  -> local model inference, network disabled
  -> provider-neutral asr.final worker result
  -> canonical speech.asr.final
  -> existing #submitVoiceFinalTranscript
  -> existing #acceptTurnInput
  -> one existing TurnRunner
```

M3-06 does **not** implement microphone capture, client audio streaming, VAD, endpointing, real ASR partials, compact channel-ID framing, cloud ASR, CUDA/GPU support, benchmark-based provider defaults, or barge-in.

---

## 2. Provider selection

M3-06 selects:

```text
runtime: faster-whisper
package version: 1.2.1
model: multilingual Whisper small, CTranslate2 format
device: CPU only
compute type: int8
mode: offline artifact transcription
```

Proposed committed model profile:

```text
profile id: fw-small-multilingual-v1
repository: Systran/faster-whisper-small
revision: gate must replace with the exact full Hugging Face commit
current short revision observed during drafting: 536b066
```

The full immutable model revision is a **brief-gate requirement**. Do not dispatch to Codex while the profile points to `main`, an alias, or only a model-size string.

### 2.1 Why faster-whisper first

It is the smallest independently closable local ASR slice:

- direct Python API;
- CPU `int8` execution;
- multilingual Whisper model suitable for initial Chinese/English checks;
- PyAV bundles FFmpeg libraries, avoiding a separate system FFmpeg installation;
- model may be loaded from a local directory;
- dependency and model download can be cleanly separated from runtime inference;
- it leaves FunASR/SenseVoice for the later comparative benchmark instead of prematurely importing VAD, streaming, speaker, emotion, and larger PyTorch/ModelScope surfaces.

### 2.2 Why not FunASR/SenseVoice in this slice

FunASR and SenseVoice remain valid later candidates, particularly for Chinese and streaming ASR. They are not rejected architecturally.

They are deferred because the first local worker should not simultaneously introduce:

- a second ASR adapter;
- PyTorch/ModelScope runtime policy;
- `trust_remote_code`;
- VAD;
- streaming chunk/cache semantics;
- diarization, punctuation, emotion, or audio-event output;
- provider-quality comparison.

Those belong to M3-07/M3-09/M3-13 as appropriate.

### 2.3 CPU/GPU boundary

M3-06 supports **CPU only**:

```text
device=cpu
compute_type=int8
```

The config schema must reject `cuda`, `auto`, `float16`, and `int8_float16` in this slice.

GPU execution is explicitly deferred because current faster-whisper GPU execution requires an NVIDIA CUDA/cuBLAS/cuDNN compatibility decision and OS-specific native-library handling. That decision belongs to the later benchmark/default-selection task, not the first local worker.

---

## 3. Read first

Codex must read the committed versions of:

- `docs/ROADMAP.md`
- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `REVIEWER-HANDBOOK.md`
- `docs/specs/voice-pipeline.md`
- `docs/specs/protocol.md`
- `docs/specs/data-governance.md`
- `docs/specs/model-gateway.md`
- `docs/specs/evals.md`
- `tasks/M3-04-speech-worker-process.md`
- `tasks/M3-04-review.md`
- `tasks/M3-04-work.md`
- `tasks/M3-05-minimax-tts-provider-v2.md`
- `tasks/M3-05-brief-review.md`
- `tasks/M3-05-work.md`
- `tasks/M3-05-review.md`
- `workers/speech/README.md`
- `workers/speech/mock_worker.py`
- `workers/speech/minimax_tts_worker.py`
- `apps/gateway/src/server.ts`
- `apps/gateway/src/speech-worker-process.ts`
- `apps/gateway/src/speech-provider.ts`
- `apps/gateway/src/speech-artifact.ts`
- `packages/artifacts/src/index.ts`
- `packages/config/src/schema.ts`
- `packages/voice/src/index.ts`
- current voice CLI and replay paths

Also read current official primary sources for:

- faster-whisper installation, CPU/GPU requirements, local model loading, transcription, timestamps, VAD filter, and model download;
- faster-whisper `WhisperModel` and `download_model` signatures;
- the `Systran/faster-whisper-small` model card and exact revision history;
- uv projects, `uv.lock`, `uv sync --locked`, external `UV_PROJECT_ENVIRONMENT`, Python selection, cache behavior, and GitHub Actions setup.

Do not rely on community wrappers, OpenAI-compatible ASR servers, or SDK examples as the implementation contract.

Do not read, recreate, or edit `docs-zh/`.

---

## 4. Normative baseline

### 4.1 Runtime architecture

- One TurnRunner.
- Modes remain policies, not alternate loops.
- Event-sourced JSONL remains the session source of truth.
- M5-before packaging remains source-first TypeScript.
- No `dist` exports or tests depending on sibling builds.
- Gateway and CLI TypeScript remain in one `tsx` execution world.
- No provider special cases in kernel.
- No second speech-provider execution world.

### 4.2 Voice path

- The only voice-to-turn construction path remains:
  - `#submitVoiceFinalTranscript`
  - `#acceptTurnInput`
- Voice-originated `turn.input` remains:
  - `provenance: "user"`
  - `payload.channel: "voice"`
  - `payload.speech: { utterance_id, audio_ref }`
- `speech.*` registered schemas remain authoritative.
- Worker/frame messages remain non-canonical.
- Raw audio never enters JSONL.
- Audio labels and frame/request labels may raise, never lower, the profile voice floor.
- `prefer_local` remains advisory only.
- MemoryGate, route clearance, egress, replay, corrupt-tail tolerance, and one TurnRunner remain inherited.

### 4.3 Worker process rules

All M3-04/M3-05 worker rules remain binding:

- gateway-owned supervision;
- `python -u -B`;
- `shell:false`;
- repository-external cwd;
- stdout/stderr drained concurrently from spawn;
- binary-safe flushed NDJSON output;
- trailing `\r` stripped before parse;
- bounded line, queue, pending request, stderr, artifact, and deadline surfaces;
- worker path and interpreter path are repository/installer derived, never CLI/config supplied;
- `FAIRY_TEST_PYTHON` remains a test-only literal `argv[0]`;
- mock-worker scan remains unchanged;
- MiniMax worker scan remains unchanged;
- provider-worker scans are per-worker;
- no new `speech.worker.*`, `voice.worker.*`, or vendor-specific canonical event family.

### 4.4 Clearance and artifacts

- All provider consumers use the shared `canRouteToClearance`; do not copy the law.
- A denied provider receives zero provider bytes.
- For local ASR this additionally means:
  - no worker spawn;
  - no input staging;
  - zero audio bytes copied into a worker temp root.
- `packages/artifacts` remains the neutral content-addressed store.
- Audio artifacts never declassify.
- ASR transcript labels derive from the audio artifact and voice floor.
- M3-05 TTS behavior and perception artifact behavior must remain unchanged.

### 4.5 Python floor

The project speech-worker floor is already settled:

```text
Python >= 3.11
```

M3-06 must preserve probe and handshake enforcement. It must not reopen or weaken the floor.

---

## 5. Mandatory coordinator extraction

M3-05 closed with a named carry-in: `server.ts` must not absorb another full speech-provider path without an explicit extraction decision.

M3-06 resolves that carry-in by requiring a **gateway-owned speech coordinator extraction**.

### 5.1 Required shape

Create a focused module, proposed:

```text
apps/gateway/src/speech-provider-coordinator.ts
```

The exact filename is gate-adjustable.

It owns:

- speech role candidate resolution;
- shared provider clearance calls;
- local input artifact validation/staging;
- supervised ASR worker acquisition and invocation;
- existing TTS provider orchestration extracted from `server.ts`;
- per-provider worker reuse;
- bounded provider result/failure structures;
- worker and temporary-root cleanup.

It does **not** own:

- TurnRunner;
- session numbering;
- WebSocket listener/auth;
- gateway op dispatch;
- `#submitVoiceFinalTranscript`;
- `#acceptTurnInput`;
- canonical model turn execution;
- a second queue/agent loop.

`server.ts` remains the composition root. It calls the coordinator and routes a successful ASR final through the existing single voice-to-turn method.

### 5.2 Extraction conditions

- Move the M3-05 TTS orchestration without changing its semantics.
- Existing `voice.tts-provider-v0` tests remain green and are not weakened.
- `server.ts` must have a net line-count reduction from baseline `e9e88ec`.
- Do not place `faster-whisper` or model-download logic in `server.ts`.
- Do not add a generic plugin framework.
- Do not make the coordinator a second event loop.
- Report before/after line counts and a responsibility table in the work report.

### 5.3 Worker-process file pressure

Generic child lifecycle remains in the existing supervisor.

New ASR-specific request/result validation should live in a focused worker-wire/provider module rather than adding a large provider branch directly to `speech-worker-process.ts`.

If `speech-worker-process.ts` grows materially, the work report must explain why and show that process lifecycle was not duplicated.

---

## 6. Python dependency environment

M3-06 is the first speech worker with third-party Python dependencies.

### 6.1 Tooling decision

Use:

```text
uv project + pyproject.toml + committed uv.lock
```

Current proposed uv version for implementation/CI:

```text
uv 0.11.28
```

The brief gate may update that exact version before dispatch, but Codex must not silently use an unpinned moving version.

Do not use:

- ad hoc `pip install`;
- Conda environment files as the project contract;
- Poetry/PDM;
- requirements.txt as a second lock source;
- `uvx` ephemeral latest environments;
- runtime installation by the gateway.

### 6.2 Proposed project layout

```text
workers/speech/faster-whisper/
  pyproject.toml
  uv.lock
  worker.py
  setup_model.py
  model-profiles.json
  README.md
```

`pyproject.toml` should represent an application environment, not a distributable package:

```toml
[project]
name = "fairy-faster-whisper-worker"
version = "0.0.0"
requires-python = ">=3.11"
dependencies = [
  "faster-whisper==1.2.1",
]

[tool.uv]
package = false
```

The committed `uv.lock` is authoritative for all transitive dependency versions and hashes.

Do not add unpinned Git dependencies.

### 6.3 External environment

No `.venv`, wheel cache, package tree, or model file may be created in the repository.

The setup command must derive an external environment path from the Fairy user-data root, keyed by the lock digest, for example:

```text
<fairy-data>/workers/faster-whisper/envs/<uv-lock-sha256>/
```

Use `UV_PROJECT_ENVIRONMENT` with an absolute path.

The gateway must derive this path from repository-owned rules. It must not accept a Python executable, venv path, or environment root from YAML, CLI, worker wire, or a general environment variable.

### 6.4 Explicit setup only

Add an explicit owner/developer setup command, proposed:

```text
pnpm fairy speech setup faster-whisper
```

It may:

- verify the pinned uv version;
- require/select Python 3.11;
- run `uv sync --locked`;
- install binary wheels into the external environment;
- perform dependency import/version checks;
- prefetch the pinned model;
- write bounded installation manifests.

It must not:

- run automatically at gateway startup;
- run automatically on the first ASR request;
- mutate a running environment;
- install into system Python or the active Conda environment;
- inherit `FAIRY_SECRET_*`;
- accept custom package indexes, Git sources, arbitrary requirements, model IDs, revisions, or output paths.

Gateway runtime must fail with a named setup-required error when the environment is absent or stale.

### 6.5 Binary-wheel policy

Supported M3-06 owner/CI platforms are:

```text
Windows x86_64
Ubuntu x86_64
Python 3.11
CPU
```

Setup must require compatible binary wheels for the locked dependencies.

Do not compile C/C++/Rust native dependencies from source during owner setup or CI. A missing wheel is a named unsupported-environment result, not permission to invoke an arbitrary compiler toolchain.

### 6.6 Installation manifest

After setup, write an external bounded manifest containing:

- uv version;
- Python executable/version;
- `uv.lock` SHA-256;
- faster-whisper version;
- CTranslate2 version;
- PyAV version;
- tokenizers/huggingface-hub versions as resolved;
- platform/architecture;
- install timestamp;
- environment root ID, not a committed absolute path;
- model profile/revision/digests.

The gateway validates the manifest before spawn.

Do not persist package-index credentials or local absolute paths into committed evidence.

---

## 7. Model profile, download, and cache

### 7.1 Closed model profile

Register exactly one model profile in M3-06:

```json
{
  "id": "fw-small-multilingual-v1",
  "provider": "faster-whisper",
  "repository": "Systran/faster-whisper-small",
  "revision": "536b0662742c02347bc0e980a01041f333bce120",
  "task": "transcribe",
  "multilingual": true
}
```

No config/CLI/wire field may supply:

- arbitrary repository ID;
- arbitrary revision;
- arbitrary local model path;
- model-size aliases such as `small`;
- Hugging Face token;
- remote-code flag;
- mirror URL.

### 7.2 Setup-only network

Model download occurs only through the explicit setup command.

The setup command may contact the public model host for the one pinned repository/revision. Runtime worker and gateway may not.

The setup downloader must:

- use the exact immutable revision;
- use a temporary directory;
- download only required model files;
- compute SHA-256 for every retained file;
- validate file count and total size bounds;
- reject symlinks and path escapes;
- write a generated manifest;
- atomically rename the completed model directory into the external cache;
- remove partial downloads on failure.

No model is committed to Git.

### 7.3 Runtime offline enforcement

The runtime worker loads only the verified local directory.

Runtime environment must include:

```text
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
HF_HUB_DISABLE_TELEMETRY=1
DO_NOT_TRACK=1
```

Proxy variables and Hugging Face tokens are excluded from the child environment.

The runtime worker source must not import:

- `urllib`;
- `http`;
- `requests`;
- `aiohttp`;
- `websockets`;
- `huggingface_hub`;
- provider SDKs.

The worker must pass the local model path and local-only/offline behavior explicitly. It must never call `WhisperModel("small")` or another alias that can trigger automatic download.

### 7.4 Cache integrity

Before ready:

- verify the generated model manifest matches the committed profile;
- verify the full revision;
- verify required files;
- verify file sizes and SHA-256 values;
- reject unexpected symlinks/non-regular files;
- reject modified or partial model state.

The ready handshake exposes only bounded evidence:

- model profile ID;
- repository ID;
- revision;
- manifest digest;
- faster-whisper/CTranslate2/PyAV versions;
- device/compute type;
- warm status.

Do not emit absolute cache paths.

---

## 8. Speech ASR configuration

Extend the closed speech provider registry to support ASR.

Proposed shape:

```yaml
speech:
  providers:
    - id: local-fw-small
      stage: asr
      transport: faster-whisper-local
      model_profile: fw-small-multilingual-v1
      device: cpu
      compute_type: int8
      language: auto
      task: transcribe
      beam_size: 5
      condition_on_previous_text: false
      word_timestamps: false
      vad_filter: false
      cpu_threads: 4
      limits:
        max_input_bytes: 33554432
        max_audio_seconds: 60
        max_transcript_chars: 20000
      data_clearance:
        max_sensitivity: secret
        residency: [local-only, region-restricted, global-ok]
        regions: [cn]

  roles:
    asr:
      primary: local-fw-small
      fallback: []
```

The gate may adjust field names but not the semantics.

### 8.1 Closed values

M3-06 supports only:

- `stage: asr`;
- `transport: faster-whisper-local`;
- `model_profile: fw-small-multilingual-v1`;
- `device: cpu`;
- `compute_type: int8`;
- `task: transcribe`;
- `language: auto | zh | en`;
- `beam_size: 1..5`;
- `condition_on_previous_text: false`;
- `word_timestamps: false`;
- `vad_filter: false`;
- bounded CPU threads and input/transcript limits.

`vad_filter` is fixed false. faster-whisper's integrated Silero VAD must not be enabled implicitly or explicitly in M3-06.

### 8.2 Role and fallback

- `speech.roles.asr` is independent from `speech.roles.tts` and model roles.
- Primary plus fallback references are deterministic and validated.
- M3-06 implements one provider family, but role/fallback law is provider-neutral.
- A candidate is attempted at most once.
- A crash/timeout/decode failure does not retry the same audio automatically in this slice.
- No cloud ASR fallback is added.

### 8.3 Provisional settings

The beam/thread/model settings are **not** the final product default.

M3-13 chooses provider/model defaults by measured zh/en/mixed quality and latency. M3-06 only establishes a reproducible initial local profile.

---

## 9. Input audio artifact boundary

### 9.1 Accepted artifacts

M3-06 transcribes an existing `packages/artifacts` record.

Accepted kinds:

```text
input
```

Accepted MIME types for this slice:

```text
audio/wav
audio/x-wav
audio/mpeg
```

Add only the minimal WAV MIME/extension support needed by the neutral artifact store. Preserve M3-05 MP3 behavior and all perception behavior.

Reject:

- `kind: speech` TTS output unless the owner/test import explicitly creates a new `kind: input` record;
- perception artifacts;
- unknown MIME;
- directories/symlinks/non-regular files;
- missing or modified content;
- size/hash mismatch;
- artifact ID/path escape;
- files over configured limits.

### 9.2 Effective labels

Before worker I/O, derive effective ASR labels from:

- the input artifact labels;
- the profile voice floor;
- any advisory request/frame labels.

Rules:

- sensitivity is raise-only maximum;
- residency is the existing hard composition/intersection;
- regions follow existing governance law;
- no request may lower the audio artifact label;
- provider clearance uses the shared `canRouteToClearance`;
- denied candidate means no worker spawn and zero staged bytes.

A successful:

- `speech.asr.final`;
- `turn.input`;
- downstream model request

inherits the effective labels. `audio_ref` remains unchanged in canonical turn input.

### 9.3 Private input staging

Audio bytes must not cross NDJSON.

For each request:

1. gateway resolves and validates `audio_ref`;
2. clearance is decided;
3. gateway creates a repository-external private temp root;
4. gateway copies the verified artifact to one fixed relative input name;
5. gateway records expected size/SHA/MIME in memory;
6. worker receives only metadata and a fixed opaque token;
7. worker reads only from the gateway-provided input root;
8. gateway removes the complete root after success/failure/cancel.

Proposed narrow environment key:

```text
FAIRY_SPEECH_WORKER_INPUT_ROOT
```

The worker wire must not contain an absolute path.

Reject:

- `..`;
- absolute POSIX/Windows/UNC paths;
- drive-relative paths;
- ADS/colon paths;
- nested names;
- alternate filenames;
- symlinks/hard-link surprises where detectable;
- changed size/mtime/inode/file ID during staging;
- hash mismatch.

---

## 10. Real ASR worker

Add the repository-owned worker:

```text
workers/speech/faster-whisper/worker.py
```

### 10.1 Source and import policy

- Python source is ASCII-only.
- No shell or subprocess.
- No microphone/speaker/device access.
- No network client imports.
- No cloud/vendor SDK.
- No `trust_remote_code`.
- No model download.
- No arbitrary filesystem input.
- No repository writes.
- Only fixed external environment/model/input roots derived by the gateway/setup contract.

The dedicated scan may allow:

- `faster_whisper`;
- `ctranslate2`;
- `av`;
- Python standard library modules needed for NDJSON, hashing, paths, threading, and timing.

It must forbid at least:

- `socket` direct use;
- `subprocess`;
- `urllib`;
- `http`;
- `requests`;
- `aiohttp`;
- `websockets`;
- `huggingface_hub`;
- `torch`;
- `funasr`;
- `modelscope`;
- `sounddevice`;
- `pyaudio`;
- microphone/speaker APIs;
- cloud ASR SDK names.

The M3-04 mock-worker scan and M3-05 MiniMax-worker scan remain unchanged.

### 10.2 Warm model

The worker loads and validates the local model before sending `ready`.

`ready` means:

- dependency versions accepted;
- model manifest accepted;
- model loaded;
- CPU/int8 backend initialized;
- no download attempted;
- worker ready for requests.

Do not lazy-load the model on the first transcription request.

M3-06 may start the worker lazily when the first ASR operation is requested, but the process is cached and reused after it becomes ready. Gateway-start prewarming is deferred to the streaming/latency slice and must be stated explicitly in the work report.

### 10.3 Worker reuse

The coordinator maintains at most one warm worker per configured local faster-whisper provider.

Requirements:

- sequential requests reuse the same PID/model load;
- queue/pending work is bounded;
- no concurrent inference in the same worker in M3-06;
- overflow fails closed;
- crash removes the worker from the cache;
- the failed utterance is not automatically retried;
- the next independent utterance may start a new worker;
- gateway shutdown terminates the cached worker.

### 10.4 Transcription settings

Production backend calls faster-whisper with the closed settings.

Requirements:

- iterate the returned segments generator to completion;
- reject NaN/negative/reversed timestamps;
- normalize/join segment text deterministically;
- preserve Unicode;
- reject empty/whitespace-only final output;
- enforce transcript length;
- do not translate;
- do not add punctuation with a second model;
- do not enable VAD;
- do not emit word timestamps;
- do not expose raw model tokens/logits/probabilities.

Bounded support diagnostics may include:

- detected language;
- bounded language probability;
- audio duration;
- segment count;
- inference duration;
- model profile/version.

They are non-canonical unless already represented by an existing schema.

---

## 11. Worker wire

### 11.1 Request kind decision

M3-06 proposes one provider-neutral non-canonical request kind:

```text
asr.request
```

This is the offline artifact-backed analogue of `tts.request`.

It must be registered in the internal worker-plane frame contract and fixtures. It is not a canonical event and not the M3-07 streaming binary protocol.

**(gate RE-2 — APPROVED)** `asr.request` is approved as a new durable worker-plane wire kind: no existing kind fits (`asr.script` is mock-only; `utterance.start` + audio frames is the streaming path reserved for M3-07). Conditions: it is registered with golden valid/invalid fixtures; the docs proposal updates the wire↔frame mapping table marking `asr.request` as the durable **non-streaming, artifact-backed** request kind alongside `tts.request`; and no synonymous kind is ever added.

Do not redefine:

- `asr.script` — remains mock-only;
- `utterance.start` — remains the streaming/session lifecycle frame;
- compact binary audio framing — remains M3-07.

### 11.2 Gateway to worker

`asr.request` / stdio mapping carries:

- wire version;
- request ID;
- utterance ID;
- provider transport ID;
- model profile ID;
- language/task/beam/CPU settings;
- input token;
- MIME;
- byte count;
- SHA-256;
- audio/transcript limits;
- no raw audio;
- no base64/hex audio;
- no absolute path;
- no arbitrary model path;
- no labels needed by the model;
- no credentials.

### 11.3 Worker to gateway

The worker may emit:

- bounded progress internal to the wire;
- one `asr.final`;
- one completion message;
- bounded error;
- cancel/shutdown acknowledgements.

On success, `asr.final` includes:

- request/utterance correlation;
- final text;
- detected language;
- bounded language probability;
- audio duration;
- segment count;
- model profile;
- no audio bytes;
- no absolute path;
- no model cache path;
- no raw segment/token dump.

The worker never emits canonical events directly.

### 11.4 Canonical mapping

Gateway maps one accepted worker final to:

1. one canonical `speech.asr.final`;
2. one call to the existing `#submitVoiceFinalTranscript`;
3. one existing `turn.input`;
4. at most one downstream model turn.

Include a full wire → canonical mapping table in `tasks/M3-06-work.md`.

---

## 12. Deterministic test backend

Normal CI must not install a model or run real ASR inference.

Use a code-enforced deterministic backend for the real worker contract.

Allowed shape:

- production `worker.py` selects a repository-owned deterministic backend only when a narrow supervisor-set test flag is present;
- the flag is available only under `NODE_ENV=test` or `CI=true`;
- config/CLI/wire cannot enable it;
- ready identifies `backend: deterministic-test`;
- production identifies `backend: faster-whisper`.

The deterministic backend must:

- require and validate the staged audio file;
- validate size/hash/token/MIME/limits;
- emit deterministic final/language/duration;
- support wait/crash/malformed/empty/overlong fixtures;
- never access network or model cache.

Do not make CI PASS by bypassing gateway artifact/clearance/staging/supervisor logic.

---

## 13. Cancellation and failure semantics

### 13.1 Cancel before final

On cancel before accepted ASR final:

- no canonical `speech.asr.final`;
- no `turn.input`;
- no model request;
- no dangling worker;
- no temp input root;
- session remains replayable.

Because CTranslate2 inference may not be synchronously interruptible, the supervisor may terminate the worker after the cancellation deadline. The current utterance is never retried automatically. A later utterance may start a replacement worker.

This is process cancellation, not M3-11 barge-in.

### 13.2 Setup/model failures

Named failures include:

- uv executable/version mismatch;
- worker environment missing;
- `uv.lock` digest mismatch;
- Python floor mismatch;
- dependency import/version mismatch;
- model missing;
- model profile/revision mismatch;
- model manifest/hash mismatch;
- unsupported platform/device.

These failures:

- do not download/install automatically;
- do not produce a final transcript;
- do not produce `turn.input`;
- do not make a model request;
- preserve text-only gateway availability;
- surface a bounded existing-event/CLI diagnostic.

### 13.3 Artifact/decode/inference failures

Includes:

- missing/unknown artifact;
- wrong kind/MIME;
- under-cleared provider;
- path/symlink/hash/size mutation;
- decode error;
- duration/size limit;
- worker crash;
- timeout;
- malformed/un correlated output;
- empty/overlong transcript;
- invalid timestamps;
- queue overflow.

Result:

- no accepted ASR final;
- no turn/model request;
- worker/temp cleanup;
- replayable session;
- existing canonical event types only.

Use existing `progress.update` stage strings for bounded visibility. Do not create a new canonical failure family.

---

## 14. Deterministic suite

Register:

```text
voice.asr-local-v0
```

The suite is PR-tier, keyless, model-free, and runs on Ubuntu and Windows.

### Case A — coordinator extraction and standing architecture

Prove:

- `server.ts` is smaller than baseline `e9e88ec`;
- existing TTS orchestration is extracted without behavior change;
- one TurnRunner;
- single `#submitVoiceFinalTranscript` → `#acceptTurnInput`;
- no provider-specific ASR logic in kernel;
- no second provider execution world;
- no `node:child_process` in `packages/voice`;
- existing M3-05 suite remains green.

### Case B — uv project and install contract

Prove:

- exact pinned uv version in workflow/setup contract;
- committed `pyproject.toml` and `uv.lock`;
- faster-whisper direct dependency exactly `1.2.1`;
- no Git/unpinned/custom-index dependency;
- no requirements/Conda duplicate lock contract;
- external env path is derived and repo-external;
- gateway never invokes uv;
- missing/stale env yields named setup-required failure;
- lock digest and dependency versions are checked.

### Case C — model profile/cache contract

Prove:

- exact closed profile/repository/full revision;
- aliases/`main`/arbitrary repo/revision/path reject;
- runtime local-only;
- worker cannot enable download;
- missing/partial/hash-mismatched model rejects before ready;
- setup cache finalization is atomic;
- no model/cache file enters repo or JSONL;
- ready exposes bounded profile/revision/digest only.

### Case D — ASR config and clearance

Prove:

- valid ASR provider/role config parses;
- unknown/duplicate provider references reject;
- only CPU/int8/fixed model profile supported;
- GPU/VAD/word timestamps/translate reject;
- `region-restricted` without regions rejects;
- under-cleared provider gets:
  - zero worker spawn;
  - zero staged bytes;
  - no ASR final/turn/model request;
- cleared local provider is selected once;
- `prefer_local` does not override clearance law.

### Case E — successful artifact-backed final

Using a deterministic WAV/MP3 input artifact:

- artifact is verified and privately staged;
- no audio crosses NDJSON;
- worker returns exactly one final;
- exactly one canonical `speech.asr.final`;
- exactly one `turn.input`;
- exactly one model request;
- provenance/channel/audio_ref are correct;
- labels are `max(audio artifact, voice floor, advisory)` and never lowered;
- transcript reaches the normal TurnRunner;
- session replays;
- input temp root is removed.

### Case F — warm reuse and backpressure

Prove:

- two sequential requests reuse one worker PID;
- ready/model load occurs once;
- requests remain correlated;
- concurrent inference is not performed;
- bounded queue overflow fails closed;
- after crash, the failed request is not retried;
- the next independent request starts a new PID;
- gateway shutdown leaves no worker.

### Case G — cancel/crash/timeout/malformed before final

For each:

- no canonical ASR final;
- no `turn.input`;
- no model request;
- no orphan process;
- no temp root;
- session replayable;
- bounded redacted error;
- no new event type.

### Case H — output validation

Reject:

- empty final;
- whitespace-only final;
- transcript over limit;
- invalid language probability;
- negative/reversed/NaN timestamps;
- mismatched request/utterance ID;
- duplicate finals;
- final after cancel;
- raw tokens/segments beyond bounded contract.

Exactly one accepted final is possible.

### Case I — runtime network prohibition

Prove:

- runtime worker source contains no network client imports;
- child env excludes proxy/HF token variables;
- offline flags are present;
- production worker loads a local path;
- deterministic test mode cannot be enabled from config/CLI/wire;
- setup downloader and runtime worker have separate source scans/capability rules.

### Case J — residual conformance

Remain green:

- `voice.tts-provider-v0`;
- `voice.worker-process-v0`;
- `voice.websocket-transport-v0`;
- `voice.duplex-transport-v0`;
- `voice.protocol-loopback-v0`;
- artifact/perception suites;
- governance/label/egress suites;
- memory leakage/deletion;
- replay/corrupt-tail;
- CLI tests;
- source-first/dep-cruiser checks.

No VAD, endpointing, real partial, cloud ASR, streaming, latency, WER/CER, barge-in, or desktop-client suite may be reported as PASS.

---

## 15. CI requirements

CI remains deterministic and does not download a speech model.

Required job classes:

### 15.1 Existing verification

- Ubuntu normal verification;
- Windows normal verification;
- existing Python 3.11 speech floor lanes;
- all existing suites.

### 15.2 ASR dependency smoke — Ubuntu and Windows

Use:

- pinned uv version;
- Python 3.11;
- external runner-temp environment;
- `uv sync --locked`;
- binary wheels only;
- no model download;
- no inference;
- `HF_HUB_OFFLINE=1`.

Run at least:

```text
import faster_whisper
import ctranslate2
import av
print exact versions
```

Optionally run a worker dependency-probe mode that does not load a model.

This lane proves installability, not ASR quality.

### 15.3 Focused deterministic suite

Run:

```text
voice.asr-local-v0
```

with the repository-owned deterministic backend.

CI must not:

- download from Hugging Face;
- store model weights;
- run real CTranslate2 transcription;
- use a microphone;
- require CUDA;
- use real provider credentials.

Separate dependency-install evidence from model-free conformance evidence in the work report.

---

## 16. CLI/developer paths

Add bounded commands or equivalent paths for:

### 16.1 Setup

```text
fairy speech setup faster-whisper
fairy speech doctor faster-whisper
```

Setup may mutate only the derived external worker/model roots.

Doctor is read-only and reports:

- setup status;
- Python version;
- lock digest match;
- dependency versions;
- model profile/revision/manifest status;
- device/compute type;
- no absolute paths in JSON unless an explicit local-only verbose mode is used.

### 16.2 ASR invocation

Proposed:

```text
fairy voice asr --audio-ref <artifact-id> --json
```

Requirements:

- accepts an artifact ID, not a file/model/worker path;
- rejects executable, venv, model path, cache root, provider URL, and arbitrary backend flags;
- uses the configured `speech.roles.asr`;
- returns bounded evidence:
  - session ID;
  - audio_ref;
  - provider/transport/model profile;
  - worker ID/PID;
  - Python/dependency versions;
  - model revision/manifest digest;
  - request count/route;
  - final transcript;
  - detected language/duration;
  - event counts;
  - model request count;
  - replay command;
  - error category.

Do not print:

- absolute env/model/temp/artifact paths;
- raw audio;
- model files;
- raw segments/tokens/logits;
- hidden reasoning/audit data.

### 16.3 Owner input import helper

Provide a narrow repository-owned owner/test helper to register a local WAV/MP3 as:

```text
kind: input
```

It may accept a local file path because it is an explicit owner-side import tool, not a gateway worker/provider path.

Requirements:

- runs outside the gateway;
- validates size, MIME, magic, regular-file status, and SHA-256;
- writes to `packages/artifacts`;
- applies owner-supplied labels but clamps them to at least the voice floor;
- returns a bounded artifact ID;
- never places raw audio in JSONL;
- is not exposed as an arbitrary gateway filesystem-read operation.

The gate may choose whether this is a CLI subcommand or an owner-check helper script.

---

## 17. Owner real local-ASR check

A real local faster-whisper inference is mandatory before final close.

It is not a cloud provider check and uses no credential.

### 17.1 Setup evidence

Owner must:

1. use the committed setup command;
2. create the external uv environment;
3. prefetch the pinned model;
4. record:
   - uv version;
   - Python version;
   - uv.lock digest;
   - dependency versions;
   - model profile/repository/full revision;
   - model manifest digest;
   - setup/cache status;
5. prove no environment/model files entered the repository.

### 17.2 Audio fixture

Preferred fixture:

- the local MP3 generated during the M3-05 MiniMax owner check;
- visible content: `你好，this is the visible M3-05 owner TTS check.`

Import it as a new `kind: input` artifact with:

```text
personal / region-restricted
regions: [cn]
```

Do not commit the audio or artifact registry absolute path.

If that MP3 no longer exists, use a short owner-recorded non-sensitive WAV/MP3 with a written reference transcript.

### 17.3 Live inference

Run one real local transcription through the normal gateway/CLI path.

Evidence must show:

- one local ASR provider route;
- one ASR request;
- no cloud/network provider;
- real backend, not deterministic-test;
- model warm and pinned revision;
- one canonical `speech.asr.final`;
- one `turn.input`;
- one deterministic local/mock text-model request;
- preserved audio_ref;
- inherited `personal / region-restricted` labels;
- replay;
- no worker/temp residue.

### 17.4 Transcript acceptance

This is conformance, not the final ASR benchmark.

For the preferred M3-05 bilingual fixture, normalized transcript must non-vacuously contain:

- Chinese `你好`;
- English keywords equivalent to:
  - `visible`;
  - `M3-05`;
  - `owner`;
  - `TTS`;
  - `check`.

Record the full bounded transcript and owner assessment. Do not compute or claim benchmark WER/CER in M3-06.

**(gate RE-3)** Keyword matching rules: normalize case and whitespace before containment checks, and tolerate benign ASR variants of `M3-05` (`M305`, `M3 05`, `m3-05`) — this is a conformance smoke, not orthography. Any scripted verification targeting `你好` MUST follow standing rule M2-05c: the check is written as a fully-ASCII `node -e` (or Python `-c`) script using `\uXXXX` codepoint escapes — never raw CJK pasted into a Windows terminal.

**(gate RE-4)** Canonical-schema decision (answers §23 Q20): M3-06 adds **no fields to canonical event payloads**. Detected language, language probability, duration, and segment count stay at the wire/ack/evidence level; the emitted `speech.asr.final` uses exactly the registered required fields (`utterance_id`, `text`, `audio_ref` — pointing at the input artifact). If a future slice needs ASR metadata in canon, it lands as additive-optional schema+fixture pairs through the normal docs process.

### 17.5 Local-only proof

During runtime inference:

- model cache already exists;
- runtime offline flags are set;
- no model download occurs;
- no cloud ASR request occurs;
- no provider key is present;
- worker process and temp input root are cleaned after gateway shutdown.

If environment/model setup or real inference fails, record exact bounded diagnostics and leave M3-06 open. Do not substitute deterministic CI for real local evidence.

---

## 18. Deliverables

Expected implementation areas include:

- gateway:
  - speech provider coordinator extraction;
  - local ASR orchestration;
  - provider/role config composition;
  - artifact staging;
  - worker reuse/shutdown;
- worker supervisor/wire:
  - `asr.request` mapping if gate-approved;
  - ASR result validation;
  - environment/model manifest checks;
- `workers/speech/faster-whisper/`:
  - uv project and lock;
  - runtime worker;
  - setup/model downloader;
  - closed model profile;
  - source scans;
- config:
  - `speech.providers` ASR variant;
  - `speech.roles.asr`;
- artifacts:
  - minimal WAV support;
  - no registry rewrite;
- CLI:
  - setup/doctor;
  - artifact-ref ASR invocation;
  - owner input import helper;
- testing:
  - `voice.asr-local-v0`;
  - deterministic backend;
  - fixtures and negative cases;
- CI:
  - uv dependency smoke on Ubuntu/Windows;
  - no model download;
- `tasks/M3-06-work.md`.

Exact file layout may vary, but the boundaries may not.

---

## 19. Boundaries — do not

Do not implement:

- FunASR, SenseVoice, Paraformer, Qwen ASR, or a second ASR adapter;
- cloud ASR;
- OpenAI audio SDK or any vendor SDK;
- microphone/speaker/device access;
- client audio streaming;
- WebSocket audio ingestion for real audio;
- compact 4-byte channel-ID framing;
- Opus;
- VAD or faster-whisper `vad_filter`;
- endpointing;
- real `speech.asr.partial`;
- semantic endpointing;
- translation;
- diarization;
- punctuation model;
- word timestamps;
- emotion/audio-event output;
- hotwords;
- CUDA/GPU;
- ASR latency benchmark;
- WER/CER benchmark;
- provider-default recommendation;
- TTS/chunker/playback changes;
- Lane A/B, ack bank, barge-in, tray client, or M4 work;
- runtime `pip`/uv install;
- runtime model download;
- arbitrary Python/model/env/cache path configuration;
- custom model repository/revision;
- `trust_remote_code`;
- model or venv files in the repo;
- source-scan weakening;
- new provider/worker canonical event families;
- English docs edits by Codex;
- `docs-zh/`.

Do not silently broaden this task into streaming voice or ASR benchmarking.

---

## 20. Acceptance commands

Codex must report exact commands and relevant tails.

At minimum:

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm --filter @fairy/testing test:voice-asr-local
pnpm --filter @fairy/testing test:voice-tts-provider
pnpm --filter @fairy/voice test -- --reporter=verbose
pnpm --filter @fairy/cli test -- --reporter=verbose
pnpm --filter @fairy/artifacts test -- --reporter=verbose
pnpm --filter @fairy/perception test -- --reporter=verbose
git diff --check
```

Python/uv checks must include:

```text
uv --version
uv lock --check
uv sync --locked into an external temp environment
dependency import/version smoke
Python 3.11 floor evidence on Ubuntu and Windows
assert no model download/cache in CI
```

Also report:

- `server.ts` before/after line counts;
- coordinator responsibility map;
- source scans for all three worker families;
- mock/MiniMax scan hashes unchanged;
- no repo `.venv`/model/cache writes;
- exact model profile/revision;
- zero-spawn/zero-staged-byte denial evidence;
- warm reuse/PID evidence;
- cancel/crash/timeout cleanup evidence;
- canonical registry diff;
- one voice-to-turn construction path;
- CI and owner-live evidence separately.

The work report must not use total test count as the only acceptance signal. Name the required suites.

---

## 21. Work report

Create:

```text
tasks/M3-06-work.md
```

It must include:

1. baseline and final commit;
2. changed-file inventory;
3. provider selection and rejected alternatives;
4. coordinator extraction:
   - before/after line counts;
   - moved responsibilities;
   - one-TurnRunner proof;
5. exact ASR config schema;
6. uv version/project/lock/environment design;
7. complete dependency versions and hashes;
8. setup vs runtime capability matrix;
9. model profile, full revision, file manifest, cache lifecycle;
10. environment/model setup failure matrix;
11. input artifact validation/staging lifecycle;
12. effective-label derivation and clearance matrix;
13. worker wire and canonical mapping tables;
14. warm-worker reuse/backpressure design;
15. transcription settings and output normalization;
16. all limits/deadlines;
17. cancel/crash/timeout/restart matrix;
18. source scans and capability separation;
19. JSONL/replay/no-audio proof;
20. deterministic request/spawn/staged-byte counts;
21. CI dependency smoke vs deterministic suite separation;
22. known limitations/deferred work;
23. spec ambiguities;
24. proposed English docs edits;
25. exact owner setup/live-check procedure.

The report must explicitly state:

- faster-whisper `1.2.1`;
- CPU/int8 only;
- the exact model profile and full revision;
- no runtime network/model download;
- no VAD/endpointing/partials;
- `asr.script` remains mock-only;
- whether `asr.request` was gate-approved;
- compact framing remains deferred;
- no model or real inference in CI;
- provider defaults remain unselected until M3-13 benchmark.

Codex must not edit English docs.

---

## 22. Proposed reviewer-owned docs pass

Codex may propose changes for:

- `docs/specs/voice-pipeline.md`
  - M3-06 status;
  - `speech.providers` ASR variant;
  - `speech.roles.asr`;
  - offline artifact-backed ASR;
  - CPU/int8 profile;
  - no VAD/partial/streaming;
  - explicit setup/runtime split;
- `docs/specs/protocol.md`
  - `asr.request` worker-plane mapping if approved;
  - audio artifact → ASR final → turn mapping;
- `docs/specs/data-governance.md`
  - local ASR clearance;
  - zero-spawn/zero-staged-byte denial;
  - artifact/transcript label inheritance;
- `docs/specs/model-gateway.md`
  - continued shared clearance law;
- `docs/specs/evals.md`
  - `voice.asr-local-v0`;
  - model-free CI vs owner real inference;
- `workers/speech/README.md`
  - uv project/environment;
  - model setup/cache;
  - runtime offline rules;
  - per-worker scans;
- `REVIEWER-HANDBOOK.md`
  - coordinator extraction and Python dependency/model rules if countersigned.

Continue deferring milestone-level `ROADMAP.md` / `PRD.md` / `ARCHITECTURE.md` consolidation to the M3 exit task unless the gate finds a normative conflict.

Do not recreate or edit `docs-zh/`.

---

## 23. Gate questions for Fable/Opus

The brief gate must explicitly decide:

1. Is faster-whisper the correct first local ASR adapter?
2. Is version `1.2.1` accepted?
3. Is CPU/int8-only correct for M3-06, with CUDA deferred?
4. Is multilingual Whisper small the accepted initial profile?
5. What is the exact full immutable Hugging Face revision replacing short `536b066`?
6. Is the committed profile + generated per-file SHA manifest sufficient supply-chain control?
7. Is uv `0.11.28` accepted and should CI pin it exactly?
8. Is `uv project + uv.lock + external UV_PROJECT_ENVIRONMENT` the accepted dependency contract?
9. Should CI perform real dependency installation/import smoke on both OSes while still avoiding model download/inference?
10. Is the mandatory SpeechProviderCoordinator extraction shaped correctly?
11. Must `server.ts` net-decrease be a hard acceptance condition?
12. Is `asr.request` the correct new worker-plane kind for offline artifact transcription?
13. Are `input` artifacts with WAV/MP3 MIME the correct M3-06 boundary?
14. Is private gateway staging preferable to passing an artifact path directly?
15. Is lazy first-use warm-up + worker reuse acceptable until M3-07 prewarming/latency work?
16. Is forced worker termination on cancel acceptable where CTranslate2 inference cannot interrupt?
17. Are the proposed limits and bounded diagnostics sufficient?
18. Is reuse of the M3-05 local MP3 the preferred owner conformance fixture?
19. Should owner transcript acceptance use keyword containment rather than WER/CER?
20. Are any existing protocol schemas incompatible with this mapping?

Material changes must be applied before dispatch.

---

## 24. Report back

Codex must report:

- implementation commit;
- CI run URL;
- changed-file inventory;
- exact uv/dependency/model versions;
- exact model full revision and manifest digest;
- coordinator extraction evidence;
- `server.ts` before/after line counts;
- all named suite results;
- Ubuntu/Windows dependency-smoke results;
- no-model-download CI proof;
- zero-spawn/zero-staged-byte denial proof;
- warm reuse/new-PID-after-crash proof;
- artifact/label/replay proof;
- deviations and unresolved conflicts;
- proposed docs edits;
- exact owner setup and real local-ASR check.

Do not claim M3-06 closed.

Closure requires:

1. committed implementation;
2. green CI;
3. primary implementation review;
4. explicit owner dependency/model setup;
5. one real local faster-whisper inference;
6. committed bounded owner evidence;
7. final primary close;
8. Fable/Opus countersign;
9. reviewer-owned English docs pass.
