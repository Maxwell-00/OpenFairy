# M3-05 Owner Manual Checks

**Task:** M3-05 — MiniMax T2A v2 non-streaming TTS worker + governed audio artifacts  
**Target commit:** `a2d7f6e380918a16db0c3b2a480675e3a036ba6e`  
**Green CI run:** `29198783063`  
**CI URL:** `https://github.com/Maxwell-00/OpenFairy/actions/runs/29198783063`  
**Platform:** Windows 11 / PowerShell 7  
**Repository root:** `E:\Claude_Projects\Projects\Fairy\OpenFairy`  
**Evidence directory:** `tasks/owner-checks/M3-05`  
**Owner-live status:** Authorized to run

---

## 1. Purpose

This checklist validates the first real MiniMax TTS provider path against the committed M3-05 contract.

It proves:

- one real MiniMax Token Plan request;
- closed `cn-primary` endpoint routing;
- `base_resp.status_code == 0`;
- `data.status == 2`;
- exactly one local speech artifact;
- valid non-empty MP3 bytes;
- byte-count and SHA-256 agreement;
- canonical `speech.tts.chunk.audio_ref`;
- replay preservation;
- no credential, Authorization header, provider envelope, audio hex, or base64 in public/persistent surfaces;
- no speech-worker process or temporary output residue.

This is an owner-only live check. It must never run in CI.

---

## 2. Safety rules

Before starting:

- Use the exact committed target.
- Start with a clean worktree.
- Confirm the MiniMax Token Plan currently has speech resources.
- Use only a short, non-sensitive test sentence.
- Make exactly one live synthesis request.
- Do not paste the Token Plan key into a command line, YAML, file, ChatGPT, GitHub, or committed evidence.
- Do not commit the generated MP3, raw artifact registry, temporary config, raw MiniMax response, Authorization header, or live data directory.
- Stop if any preflight check fails.
- If MiniMax returns code `2056`, record `token_plan_resource_limit`; do not claim PASS.

---

## 3. Terminal layout

Use three PowerShell terminals:

| Terminal | Role |
|---|---|
| Terminal A | Deterministic local text-model server |
| Terminal B | Secret entry and normal Fairy gateway |
| Terminal C | One CLI invocation, validation, replay, evidence |

Keep Terminals A and B running until Terminal C completes.

---

## 4. Initialize the owner run — Terminal C

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$TargetCommit = 'a2d7f6e380918a16db0c3b2a480675e3a036ba6e'
$CiRunUrl = 'https://github.com/Maxwell-00/OpenFairy/actions/runs/29198783063'
$EvidenceDir = 'tasks/owner-checks/M3-05'
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'

$LiveData = Join-Path $env:LOCALAPPDATA "fairy-m3-05-owner-live-$RunId"
$LiveConfig = Join-Path $env:TEMP "fairy-m3-05-owner-live-$RunId.yaml"
$LiveScript = Join-Path $env:TEMP "fairy-m3-05-owner-live-input-$RunId.json"
$MockProgram = Join-Path (Get-Location) "tmp\m3-05-owner-mock-model-$RunId.ts"

New-Item -ItemType Directory -Force $EvidenceDir | Out-Null
New-Item -ItemType Directory -Force (Split-Path $MockProgram -Parent) | Out-Null

$Head = (git rev-parse HEAD).Trim()

if ($Head -ne $TargetCommit) {
    throw "Wrong HEAD. Expected $TargetCommit, got $Head"
}

if ((git status --short).Trim().Length -ne 0) {
    throw 'Owner check must start from a clean worktree'
}
```

Choose an unused loopback gateway port:

```powershell
$PortProbe = [Net.Sockets.TcpListener]::new(
    [Net.IPAddress]::Loopback,
    0
)

$PortProbe.Start()
$GatewayPort = ([Net.IPEndPoint]$PortProbe.LocalEndpoint).Port
$PortProbe.Stop()

$GatewayPort
```

After manually confirming Token Plan speech availability:

```powershell
@{
    checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    implementation_commit = $TargetCommit
    ci_run_url = $CiRunUrl
    ci_status = 'pass'
    ci_jobs = @{
        ubuntu_normal_discovery = 'pass'
        windows_normal_discovery = 'pass'
        ubuntu_python_311_speech_floor = 'pass'
        windows_python_311_speech_floor = 'pass'
    }
    credential_class = 'token-plan'
    speech_resource_available_before_call = $true
    node = (node --version).Trim()
    pnpm = (pnpm --version).Trim()
    powershell = "$($PSVersionTable.PSVersion)"
    os = [Environment]::OSVersion.VersionString
    gateway_port = $GatewayPort
} |
    ConvertTo-Json -Depth 10 |
    Set-Content -Encoding utf8 "$EvidenceDir/prerequisites.json"
```

---

## 5. Deterministic local preflight — Terminal C

```powershell
Remove-Item Env:CI -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_OWNER_LIVE_TTS -ErrorAction SilentlyContinue

pnpm --filter @fairy/testing test:voice-tts-provider 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/local-preflight.txt"

if ($LASTEXITCODE -ne 0) {
    throw 'Local voice.tts-provider-v0 preflight failed'
}
```

Expected:

```text
1 test file passed
13 tests passed
```

This uses only the deterministic loopback fake and no real credential.

---

## 6. Create and start the deterministic text-model server

In Terminal C, create the temporary launcher:

```powershell
@'
import { MockOpenAIChatServer } from "../packages/testing/src/mock-openai.ts";

async function main(): Promise<void> {
  const server = await MockOpenAIChatServer.start({
    text: ["你好，this is the visible M3-05 owner TTS check."],
  });

  console.log(`MOCK_MODEL_URL=${server.url}`);

  const stop = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  await new Promise(() => undefined);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
'@ | Set-Content -Encoding utf8 $MockProgram
```

In **Terminal A**:

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$RunId = '<SAME_RUN_ID_FROM_TERMINAL_C>'
$MockProgram = Join-Path (Get-Location) "tmp\m3-05-owner-mock-model-$RunId.ts"

pnpm exec tsx $MockProgram
```

Expected:

```text
MOCK_MODEL_URL=http://127.0.0.1:<ephemeral-port>
```

Copy the complete URL. Keep Terminal A open.

---

## 7. Load the Token Plan credential — Terminal B

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$SecureToken = Read-Host 'MiniMax Token Plan subscription key' -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)

try {
    $env:minimax_token_plan =
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}

$env:FAIRY_OWNER_LIVE_TTS = '1'

Remove-Item Env:CI -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
```

Do not print `$env:minimax_token_plan`.

Set the values copied from Terminal C/A:

```powershell
$RunId = '<SAME_RUN_ID_FROM_TERMINAL_C>'
$GatewayPort = <GATEWAY_PORT_FROM_TERMINAL_C>
$MockModelUrl = '<MOCK_MODEL_URL_FROM_TERMINAL_A>'

$LiveData = Join-Path $env:LOCALAPPDATA "fairy-m3-05-owner-live-$RunId"
$LiveConfig = Join-Path $env:TEMP "fairy-m3-05-owner-live-$RunId.yaml"
$LiveScript = Join-Path $env:TEMP "fairy-m3-05-owner-live-input-$RunId.json"
```

---

## 8. Create temporary live config and input — Terminal B

```powershell
@'
models:
  - id: owner-mock-main
    transport: openai-chat
    base_url: __MOCK_MODEL_URL__
    model: deterministic-owner-mock
    data_clearance:
      max_sensitivity: personal
      residency: [region-restricted]
      regions: [cn]

roles:
  main:
    model: owner-mock-main

gateway:
  port: __GATEWAY_PORT__
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
'@.
    Replace('__MOCK_MODEL_URL__', $MockModelUrl).
    Replace('__GATEWAY_PORT__', "$GatewayPort").
    Replace('__LIVE_DATA__', $LiveData.Replace('\', '/')) |
    Set-Content -Encoding utf8 $LiveConfig

@{
    partials = @('owner live check')
    text = 'Please answer the short owner live-check fixture.'
    utterance_id = 'utt_m305_owner_live'
} |
    ConvertTo-Json |
    Set-Content -Encoding utf8 $LiveScript
```

Verify the config contains only a secret reference:

```powershell
$ConfigText = Get-Content -Raw $LiveConfig

if (-not $ConfigText.Contains('secret://minimax_token_plan')) {
    throw 'Expected secret reference is missing'
}

if ($ConfigText.Contains($env:minimax_token_plan)) {
    throw 'The raw credential entered the temporary YAML'
}
```

---

## 9. Start the normal Fairy gateway — Terminal B

```powershell
pnpm exec tsx apps/gateway/src/bin/gateway.ts --config $LiveConfig
```

Wait until the gateway listens on `127.0.0.1:<GatewayPort>`.

Do not run the CLI more than once.

---

## 10. Make exactly one real synthesis request — Terminal C

Restore the variables:

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$EvidenceDir = 'tasks/owner-checks/M3-05'
$RunId = '<SAME_RUN_ID>'
$GatewayPort = <SAME_GATEWAY_PORT>

$LiveData = Join-Path $env:LOCALAPPDATA "fairy-m3-05-owner-live-$RunId"
$LiveScript = Join-Path $env:TEMP "fairy-m3-05-owner-live-input-$RunId.json"
```

Capture existing temporary roots:

```powershell
$TempBefore = @(
    Get-ChildItem $env:TEMP -Directory -Filter 'fairy-minimax-tts-*' |
        Select-Object -ExpandProperty FullName
)
```

Run exactly once:

```powershell
$CliLines = pnpm --silent fairy voice worker `
    --gateway "ws://127.0.0.1:$GatewayPort" `
    --token owner-live-local-token `
    --script $LiveScript `
    --json 2>&1

$CliExit = $LASTEXITCODE

$CliLines |
    Set-Content -Encoding utf8 "$EvidenceDir/cli-raw.txt"

if ($CliExit -ne 0) {
    throw "Owner live CLI failed with exit code $CliExit"
}

$CliJson = $CliLines |
    ForEach-Object { [string]$_ } |
    Where-Object { $_.TrimStart().StartsWith('{') } |
    Select-Object -Last 1

if (-not $CliJson) {
    throw 'No JSON ACK found in CLI output'
}

$Result = $CliJson | ConvertFrom-Json
```

Do not rerun the provider call if a later validation fails.

---

## 11. Validate request count, failures, and success ACK

```powershell
if ($Result.provider_request_count -ne 1) {
    throw "Expected exactly one provider request, got $($Result.provider_request_count)"
}

if (@($Result.provider_route).Count -ne 1) {
    throw "Expected one provider route entry, got $(@($Result.provider_route).Count)"
}
```

Handle failure before success checks:

```powershell
if ($Result.error_status -ne 'none') {
    @{
        checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        status = $Result.error_status
        provider_request_count = $Result.provider_request_count
        provider_route = @($Result.provider_route)
    } |
        ConvertTo-Json -Depth 10 |
        Set-Content -Encoding utf8 "$EvidenceDir/live-result.json"

    if ($Result.error_status -eq 'SPEECH_WORKER_TOKEN_PLAN_RESOURCE_LIMIT') {
        throw 'MiniMax returned 2056 token_plan_resource_limit; leave final close pending'
    }

    throw "Live MiniMax TTS failed: $($Result.error_status)"
}
```

Validate success:

```powershell
if ($Result.tts_chunk_count -ne 1) {
    throw "Expected one TTS chunk, got $($Result.tts_chunk_count)"
}

if (-not $Result.tts_provider) {
    throw 'tts_provider success evidence is missing'
}

if ($Result.tts_provider.success_checks.base_resp_status_zero -ne $true) {
    throw 'base_resp.status_code == 0 was not confirmed'
}

if ($Result.tts_provider.success_checks.data_status_complete -ne $true) {
    throw 'data.status == 2 was not confirmed'
}

if ($Result.tts_provider.provider_id -ne 'minimax-owner-live') {
    throw "Unexpected provider: $($Result.tts_provider.provider_id)"
}

if ($Result.tts_provider.endpoint_profile -ne 'cn-primary') {
    throw "Unexpected endpoint profile: $($Result.tts_provider.endpoint_profile)"
}

if ($Result.tts_provider.transport -ne 'minimax-t2a-v2-http') {
    throw "Unexpected transport: $($Result.tts_provider.transport)"
}

if ($Result.tts_provider.model -ne 'speech-2.8-turbo') {
    throw "Unexpected model: $($Result.tts_provider.model)"
}

if ($Result.tts_provider.audio_format -ne 'mp3') {
    throw "Unexpected audio format: $($Result.tts_provider.audio_format)"
}
```

---

## 12. Validate the persistent speech artifact

```powershell
$RegistryPath = Join-Path $LiveData 'artifacts/artifacts.jsonl'

if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) {
    throw 'Artifact registry is missing'
}

$ArtifactLine = Get-Content $RegistryPath |
    ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object artifact_id -eq $Result.tts_provider.artifact_ref |
    Select-Object -Last 1

if (-not $ArtifactLine) {
    throw 'Speech artifact registry record is missing'
}

if ($ArtifactLine.kind -ne 'speech') {
    throw "Unexpected artifact kind: $($ArtifactLine.kind)"
}

if ($ArtifactLine.mime -ne 'audio/mpeg') {
    throw "Unexpected artifact MIME: $($ArtifactLine.mime)"
}

if (-not (Test-Path -LiteralPath $ArtifactLine.path -PathType Leaf)) {
    throw 'Persistent MP3 file is missing'
}

$Bytes = [IO.File]::ReadAllBytes($ArtifactLine.path)

if ($Bytes.Length -le 0) {
    throw 'Persistent MP3 is empty'
}

if ($Bytes.Length -ne $Result.tts_provider.byte_count) {
    throw 'Persistent MP3 byte count does not match ACK'
}

$Digest = 'sha256:' + (
    [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData($Bytes)
    )
).ToLowerInvariant()

if ($Digest -ne $Result.tts_provider.sha256) {
    throw 'Persistent MP3 SHA-256 does not match ACK'
}
```

Validate MP3 framing:

```powershell
$Mp3HeaderValid =
    ($Bytes.Length -ge 3 -and
        $Bytes[0] -eq 0x49 -and
        $Bytes[1] -eq 0x44 -and
        $Bytes[2] -eq 0x33) -or
    ($Bytes.Length -ge 2 -and
        $Bytes[0] -eq 0xFF -and
        (($Bytes[1] -band 0xE0) -eq 0xE0))

if (-not $Mp3HeaderValid) {
    throw 'Persistent artifact does not contain an MP3 header/frame sync'
}
```

Write bounded artifact evidence without the absolute path:

```powershell
@{
    artifact_ref = $Result.tts_provider.artifact_ref
    kind = $ArtifactLine.kind
    mime = $ArtifactLine.mime
    audio_format = $Result.tts_provider.audio_format
    byte_count = $Bytes.Length
    sha256 = $Digest
    mp3_header_valid = $true
} |
    ConvertTo-Json -Depth 5 |
    Set-Content -Encoding utf8 "$EvidenceDir/artifact-check.json"
```

Do not copy `$ArtifactLine.path` into committed evidence.

---

## 13. Listen to the generated MP3

Open the persistent MP3 using your normal local media player.

Confirm:

- it opens;
- it is non-empty;
- speech is intelligible;
- it says the visible bilingual response.

OpenFairy playback is out of scope. Do not commit the MP3.

---

## 14. Save bounded CLI JSON — Terminal C

```powershell
$CliJson |
    Set-Content -Encoding utf8 "$EvidenceDir/cli.json"
```

Copy the canonical log path for the secret scan in Terminal B:

```powershell
$Result.log_path
```

---

## 15. Verify credential and raw-audio non-persistence — Terminal B

Set paths:

```powershell
$EvidenceDir = 'tasks/owner-checks/M3-05'
$RegistryPath = Join-Path $LiveData 'artifacts/artifacts.jsonl'
$CanonicalLogPath = '<RESULT.LOG_PATH_FROM_TERMINAL_C>'

$RawLog = Get-Content -Raw $CanonicalLogPath
$RegistryRaw = Get-Content -Raw $RegistryPath
$CliRaw = Get-Content -Raw "$EvidenceDir/cli-raw.txt"
$CliJsonRaw = Get-Content -Raw "$EvidenceDir/cli.json"
```

Scan public and persistent surfaces:

```powershell
$PublicSurfaces = @(
    $RawLog
    $RegistryRaw
    $CliRaw
    $CliJsonRaw
)

foreach ($Surface in $PublicSurfaces) {
    foreach ($Forbidden in @(
        $env:minimax_token_plan
        'Authorization:'
        'Bearer '
        'base_resp'
        'tts-output.mp3'
        'fairy-minimax-tts-'
    )) {
        if ($Forbidden -and $Surface.Contains($Forbidden)) {
            throw 'Forbidden credential/provider/temp content found'
        }
    }
}

if ($RawLog -match '[0-9A-Fa-f]{200,}') {
    throw 'Possible audio hex in canonical JSONL'
}

if ($RawLog -match '[A-Za-z0-9+/]{200,}={0,2}') {
    throw 'Possible audio base64 in canonical JSONL'
}
```

Record only the result:

```powershell
@(
    "checked_at=$(Get-Date -Format o)"
    'result=PASS'
    'credential_in_public_surfaces=0'
    'authorization_header_in_public_surfaces=0'
    'provider_envelope_in_jsonl=0'
    'audio_hex_in_jsonl=0'
    'audio_base64_in_jsonl=0'
    'temporary_worker_token_in_jsonl=0'
) |
    Set-Content -Encoding utf8 "$EvidenceDir/leak-scan.txt"
```

Do not store the secret or a secret prefix.

---

## 16. Verify process and temporary-root cleanup — Terminal C

```powershell
foreach ($Pid in @(
    $Result.worker_process_id
    $Result.tts_provider.worker.processId
)) {
    if ($Pid -and (Get-Process -Id $Pid -ErrorAction SilentlyContinue)) {
        throw "Speech worker PID remains alive: $Pid"
    }
}

Start-Sleep -Milliseconds 500

$TempAfter = @(
    Get-ChildItem $env:TEMP -Directory -Filter 'fairy-minimax-tts-*' |
        Select-Object -ExpandProperty FullName
)

$NewTempRoots = @(
    Compare-Object $TempBefore $TempAfter |
        Where-Object SideIndicator -eq '=>' |
        Select-Object -ExpandProperty InputObject
)

if ($NewTempRoots.Count -ne 0) {
    $NewTempRoots |
        Set-Content -Encoding utf8 "$EvidenceDir/temp-residue.txt"

    throw 'Temporary MiniMax speech-worker residue detected'
}

@(
    "checked_at=$(Get-Date -Format o)"
    'result=PASS'
    'new_temp_roots=0'
    'speech_worker_processes_alive=0'
) |
    Set-Content -Encoding utf8 "$EvidenceDir/cleanup.txt"
```

---

## 17. Verify replay — Terminal C

```powershell
pnpm --silent fairy replay $Result.sid `
    --data-dir $LiveData `
    --json 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/replay.json"

if ($LASTEXITCODE -ne 0) {
    throw 'Replay failed'
}

$ReplayRaw = Get-Content -Raw "$EvidenceDir/replay.json"

if (-not $ReplayRaw.Contains($Result.tts_provider.artifact_ref)) {
    throw 'Replay does not preserve the TTS audio_ref'
}

if ($ReplayRaw.Contains('tts-output.mp3')) {
    throw 'Temporary worker output token leaked into replay'
}

if ($ReplayRaw.Contains('base_resp')) {
    throw 'Provider response envelope leaked into replay'
}
```

In Terminal B, scan replay for the exact credential:

```powershell
$ReplayRaw = Get-Content -Raw "$EvidenceDir/replay.json"

if ($ReplayRaw.Contains($env:minimax_token_plan)) {
    throw 'Token Plan credential leaked into replay'
}
```

---

## 18. Write bounded live evidence — Terminal C

```powershell
@{
    checked_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    status = 'pass'
    credential_class = 'token-plan'
    endpoint_profile = $Result.tts_provider.endpoint_profile
    provider_id = $Result.tts_provider.provider_id
    transport = $Result.tts_provider.transport
    model = $Result.tts_provider.model
    voice_id = $Result.tts_provider.voice_id
    python = $Result.tts_provider.worker.interpreter
    python_version = $Result.tts_provider.worker.pythonVersion
    provider_request_count = $Result.provider_request_count
    provider_route = @($Result.provider_route)
    tts_chunk_count = $Result.tts_chunk_count
    audio_format = $Result.tts_provider.audio_format
    byte_count = $Result.tts_provider.byte_count
    sha256 = $Result.tts_provider.sha256
    artifact_ref = $Result.tts_provider.artifact_ref
    base_resp_status_zero =
        $Result.tts_provider.success_checks.base_resp_status_zero
    data_status_complete =
        $Result.tts_provider.success_checks.data_status_complete
    playable_mp3_confirmed = $true
    speech_worker_processes_alive = 0
    temp_residue = 0
} |
    ConvertTo-Json -Depth 10 |
    Set-Content -Encoding utf8 "$EvidenceDir/live-result.json"
```

---

## 19. Create the owner summary

Create:

```text
tasks/owner-checks/M3-05/M3-05-owner-checks.md
```

Use:

```markdown
# M3-05 Owner Checks

- Implementation/repair commit: a2d7f6e380918a16db0c3b2a480675e3a036ba6e
- Green CI run: 29198783063
- Owner platform: Windows 11 / PowerShell 7
- Credential class: MiniMax Token Plan
- Overall result: PASS / FAIL / TOKEN_PLAN_RESOURCE_LIMIT

## CI evidence

| Job | Result |
|---|---|
| Ubuntu normal discovery | PASS |
| Windows normal discovery | PASS |
| Ubuntu Python 3.11 speech floor | PASS |
| Windows Python 3.11 speech floor | PASS |

## Local deterministic preflight

| Check | Result | Evidence |
|---|---|---|
| `voice.tts-provider-v0` | PASS/FAIL | local-preflight.txt |

## Live MiniMax evidence

| Check | Result | Evidence |
|---|---|---|
| Exactly one provider request | PASS/FAIL | live-result.json |
| No hidden retry/fallback | PASS/FAIL | live-result.json |
| Endpoint profile `cn-primary` | PASS/FAIL | live-result.json |
| Model `speech-2.8-turbo` | PASS/FAIL | live-result.json |
| `base_resp.status_code == 0` | PASS/FAIL | live-result.json |
| `data.status == 2` | PASS/FAIL | live-result.json |
| Exactly one `speech.tts.chunk` | PASS/FAIL | live-result.json |
| Speech artifact exists | PASS/FAIL | artifact-check.json |
| MP3 header/frame valid | PASS/FAIL | artifact-check.json |
| MP3 non-empty and intelligible | PASS/FAIL | owner confirmation |
| Byte count and SHA-256 agree | PASS/FAIL | artifact-check.json |
| Credential/header/provider envelope absent | PASS/FAIL | leak-scan.txt |
| Audio hex/base64 absent from JSONL | PASS/FAIL | leak-scan.txt |
| No speech-worker process remains | PASS/FAIL | cleanup.txt |
| No temporary worker root remains | PASS/FAIL | cleanup.txt |
| Replay preserves `audio_ref` | PASS/FAIL | replay.json |

## Notes

- One real MiniMax synthesis request was made.
- Generated MP3 was not committed.
- Artifact registry and absolute local path were not committed.
- Raw provider response was not committed.
- Token Plan credential was not committed.
- MiniMax `2056` is `TOKEN_PLAN_RESOURCE_LIMIT`, not PASS.
```

Replace every `PASS/FAIL` with the actual result.

---

## 20. Stop services and clear secrets

Stop the gateway in Terminal B and the mock model in Terminal A with `Ctrl+C`.

In Terminal B:

```powershell
Remove-Item Env:minimax_token_plan -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_OWNER_LIVE_TTS -ErrorAction SilentlyContinue
Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
Remove-Item Env:CI -ErrorAction SilentlyContinue

Remove-Item -LiteralPath $LiveConfig -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LiveScript -Force -ErrorAction SilentlyContinue
```

In Terminal C:

```powershell
Remove-Item -LiteralPath $MockProgram -Force -ErrorAction SilentlyContinue
```

Do not delete `$LiveData` until evidence review is complete, but do not stage it.

---

## 21. Inspect evidence before staging

```powershell
Get-ChildItem $EvidenceDir -File |
    Sort-Object Name |
    Select-Object Name,Length,LastWriteTime |
    Format-Table -AutoSize
```

Expected bounded files:

- `prerequisites.json`
- `local-preflight.txt`
- `cli-raw.txt`
- `cli.json`
- `artifact-check.json`
- `leak-scan.txt`
- `cleanup.txt`
- `replay.json`
- `live-result.json`
- `M3-05-owner-checks.md`

Search for forbidden content:

```powershell
$EvidenceRaw = (
    Get-ChildItem $EvidenceDir -File |
        ForEach-Object { Get-Content -Raw $_.FullName }
) -join "`n"

foreach ($Forbidden in @(
    'Authorization:'
    'Bearer '
    'base_resp'
    'tts-output.mp3'
    'fairy-minimax-tts-'
)) {
    if ($EvidenceRaw.Contains($Forbidden)) {
        throw "Forbidden text found in evidence: $Forbidden"
    }
}

if ($EvidenceRaw -match '[0-9A-Fa-f]{200,}') {
    throw 'Possible long audio hex found in evidence'
}

if ($EvidenceRaw -match '[A-Za-z0-9+/]{200,}={0,2}') {
    throw 'Possible long audio base64 found in evidence'
}
```

Review `cli-raw.txt`. If it contains unnecessary warnings or local paths, do not commit it; `cli.json` is authoritative.

---

## 22. Stage bounded evidence only

```powershell
git status --short
```

Do not stage:

- `$LiveData`;
- generated MP3;
- artifact registry;
- temporary config/input;
- mock-model launcher;
- raw gateway log;
- raw provider response.

Stage:

```powershell
git add `
    tasks/owner-checks/M3-05/prerequisites.json `
    tasks/owner-checks/M3-05/local-preflight.txt `
    tasks/owner-checks/M3-05/cli.json `
    tasks/owner-checks/M3-05/artifact-check.json `
    tasks/owner-checks/M3-05/leak-scan.txt `
    tasks/owner-checks/M3-05/cleanup.txt `
    tasks/owner-checks/M3-05/replay.json `
    tasks/owner-checks/M3-05/live-result.json `
    tasks/owner-checks/M3-05/M3-05-owner-checks.md
```

Commit `cli-raw.txt` only after manual review.

Validate:

```powershell
git diff --cached --check
git diff --cached --stat
git diff --cached
```

---

## 23. Commit and push

```powershell
git commit -m "Add M3-05 owner live evidence"
git push
```

After push:

1. wait for the evidence commit Actions run;
2. record the commit and run URL;
3. provide committed evidence to the primary reviewer;
4. do not claim M3-05 closed until final primary close and Fable/Opus countersign.

---

## 24. Failure handling

### Token Plan resource limit

For `SPEECH_WORKER_TOKEN_PLAN_RESOURCE_LIMIT`:

```text
Overall result: TOKEN_PLAN_RESOURCE_LIMIT
```

Do not retry automatically. Leave M3-05 open until resources reset.

### Authentication or invalid key

Do not rerun immediately. Clear the environment, verify the key in MiniMax, then begin a new run with a new `$RunId`.

### Provider success but local validation failure

Do not call the provider again. Preserve the first CLI result, artifact metadata, cleanup state, and exact failing assertion for review.

### Credential leak

Immediately:

1. stop gateway and mock server;
2. clear the environment variable;
3. do not commit evidence;
4. rotate/revoke the exposed credential;
5. preserve only a redacted incident description;
6. treat M3-05 as BLOCKED.
