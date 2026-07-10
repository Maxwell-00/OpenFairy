# M3-04 Owner Manual Checks

**Target commit:** `e3e8089f996f810f6722537225eca0d411391646`  
**CI run:** `29071874462`  
**Platform:** Windows 11 / PowerShell 7  
**Repository root:** `E:\Claude_Projects\Projects\Fairy\OpenFairy`  
**Evidence directory:** `tasks/owner-checks/M3-04`

## 1. Purpose and boundaries

These checks validate the committed M3-04 worker-process scaffold independently of Codex's work report.

They do **not** require:

- a real ASR provider;
- a real TTS provider;
- microphone or speaker access;
- a cloud speech API;
- pip packages;
- a real model API key for the required checks.

The optional CLI smoke must only be run when a deterministic local/mock text-model configuration is already available. Do not spend a real provider call solely to close M3-04.

Python `3.13.9` in the Codex report was the interpreter found on that workstation. It is not pinned. This checklist captures production discovery and adds an optional/recommended Python 3.11 compatibility run.

## 2. Rules before starting

- Run from the committed target state.
- Do not modify `docs-zh/`.
- Do not add real API keys to the repository or evidence files.
- Keep CI evidence and owner/manual evidence separate.
- Stop immediately on a required command failure and preserve its output.
- Run all commands from PowerShell 7.

## 3. Initialize the evidence directory

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$TargetCommit = 'e3e8089f996f810f6722537225eca0d411391646'
$EvidenceDir = 'tasks/owner-checks/M3-04'

New-Item -ItemType Directory -Force $EvidenceDir | Out-Null

git status --short
$Head = (git rev-parse HEAD).Trim()

if ($Head -ne $TargetCommit) {
    throw "Wrong HEAD. Expected $TargetCommit, got $Head"
}

@(
    "checked_at=$(Get-Date -Format o)"
    "head=$Head"
    "branch=$((git branch --show-current).Trim())"
    "node=$((node --version).Trim())"
    "pnpm=$((pnpm --version).Trim())"
    "powershell=$($PSVersionTable.PSVersion)"
    "os=$([System.Environment]::OSVersion.VersionString)"
    "ci_run=29071874462"
) | Set-Content -Encoding utf8 "$EvidenceDir/environment.txt"
```

Expected:

- `HEAD` equals the full target commit.
- The initial working tree is clean, apart from evidence created during this checklist.

## 4. Record available Python interpreters

```powershell
@(
    '=== Get-Command python3 ==='
    (Get-Command python3 -ErrorAction SilentlyContinue | Format-List Name,Source,Version | Out-String)
    '=== Get-Command python ==='
    (Get-Command python -ErrorAction SilentlyContinue | Format-List Name,Source,Version | Out-String)
    '=== Get-Command py ==='
    (Get-Command py -ErrorAction SilentlyContinue | Format-List Name,Source,Version | Out-String)
    '=== py launcher inventory ==='
    (& py -0p 2>&1 | Out-String)
    '=== direct versions ==='
    (& python3 --version 2>&1 | Out-String)
    (& python --version 2>&1 | Out-String)
    (& py -3 --version 2>&1 | Out-String)
) | Set-Content -Encoding utf8 "$EvidenceDir/python-inventory.txt"
```

Some commands may report “not found”; that is acceptable as long as production discovery finds one fixed candidate.

Do not set `FAIRY_TEST_PYTHON` for the production-discovery check.

```powershell
Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
```

## 5. Capture actual production-discovery evidence

This runs the gateway-owned supervisor directly through `tsx`, starts the repository-controlled Python worker, prints ready/interpreter evidence, and shuts the worker down.

```powershell
$SupervisorProbe = @'
import { SpeechWorkerProcess } from "./apps/gateway/src/speech-worker-process.ts";

(async () => {
  const worker = new SpeechWorkerProcess();
  try {
    const ready = await worker.start();
    console.log(JSON.stringify({ ready }));
  } finally {
    await worker.shutdown("owner interpreter probe").catch(() => undefined);
    console.log(JSON.stringify({ alive: worker.isAlive() }));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@

pnpm exec tsx -e $SupervisorProbe 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/interpreter-discovery.jsonl"

if ($LASTEXITCODE -ne 0) {
    throw "Production interpreter discovery probe failed"
}
```

Expected:

- one JSON object contains `argv0`, `args`, `source: "discovered"`, Python version, worker ID, and PID;
- the final object is `{"alive":false}`;
- no worker path or command is supplied by the owner;
- the version may be 3.11, 3.12, 3.13, or another compatible Python 3 version found by the fixed candidate list.

## 6. Required full testing evidence

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/testing-voice-worker.txt"

if ($LASTEXITCODE -ne 0) {
    throw "@fairy/testing failed"
}
```

Confirm the named suites appear:

```powershell
$RequiredSuites = @(
    'voice.worker-process-v0'
    'voice.websocket-transport-v0'
    'voice.duplex-transport-v0'
    'voice.protocol-loopback-v0'
    'memory.leakage'
    'memory.deletion-permanence'
    'research.citation-precision'
    'research.zh-en-parity'
    'injection.research-v0'
    'label.conformance'
    'governance.friction-canary'
    'persona.consistency'
    'substance.invariance'
    'perception.quarantine-v0'
    'context.compaction-regression'
    'chronicle.workspace-v0'
    'dream-cycle.consolidation-v0'
)

$FullLog = Get-Content -Raw "$EvidenceDir/testing-voice-worker.txt"

foreach ($Suite in $RequiredSuites) {
    if ($FullLog -notmatch [regex]::Escape($Suite)) {
        throw "Required suite missing from output: $Suite"
    }
}

if ($FullLog -notmatch 'memory\.canary') {
    throw 'Deferred memory.canary is not visible in the output'
}
```

Expected:

- all required named suites pass;
- `memory.canary` remains visibly skipped/deferred;
- latency, ASR quality, real speech provider, and barge-in benchmarks are not reported as passing implementations.

Do not hard-code total test counts as the sole acceptance check; unrelated tests can legitimately increase the count.

## 7. Required focused worker-process suite

First capture worker PIDs before the suite:

```powershell
$WorkerPattern = 'workers[\\/]+speech[\\/]+mock_worker\.py'

Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match '^python(?:w)?\.exe$' -and
        $_.CommandLine -match $WorkerPattern
    } |
    Select-Object ProcessId,Name,CommandLine |
    Format-List |
    Set-Content -Encoding utf8 "$EvidenceDir/processes-before-focused.txt"
```

Run the focused suite:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t 'voice.worker-process-v0' 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/voice-worker-focused.txt"

if ($LASTEXITCODE -ne 0) {
    throw 'voice.worker-process-v0 failed'
}
```

Expected:

- four focused tests pass;
- coverage includes:
  - wire validation, CRLF, raw-audio rejection, handshake, ASR, TTS, cancel, shutdown, stderr redaction;
  - normal one-TurnRunner path and replay;
  - cancel/crash/malformed/timeout before final with no turn/model/orphan;
  - route clearance, MemoryGate, egress guard, and visible-only TTS.

Check for orphan workers after the suite:

```powershell
Start-Sleep -Milliseconds 500

$RemainingWorkers = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -match '^python(?:w)?\.exe$' -and
            $_.CommandLine -match $WorkerPattern
        } |
        Select-Object ProcessId,Name,CommandLine
)

$RemainingWorkers |
    Format-List |
    Set-Content -Encoding utf8 "$EvidenceDir/processes-after-focused.txt"

if ($RemainingWorkers.Count -ne 0) {
    throw "Dangling speech worker process detected"
}
```

## 8. Recommended compatibility smoke at Python 3.11

This check addresses the Python-version concern. It does not change production discovery and does not pin OpenFairy to one patch release.

First locate an exact Python 3.11 executable:

```powershell
$Python311 = $null

try {
    $Python311 = (& py -3.11 -c 'import sys; print(sys.executable)' 2>$null).Trim()
} catch {
    $Python311 = $null
}

if ($Python311) {
    & $Python311 --version
    "python311=$Python311" | Set-Content -Encoding utf8 "$EvidenceDir/python-311-path.txt"
} else {
    'NOT RUN: Python 3.11 is not installed on this workstation.' |
        Set-Content -Encoding utf8 "$EvidenceDir/python-311-compatibility.txt"
}
```

When Python 3.11 is available, run the focused suite with the exact executable used only as `argv[0]`:

```powershell
if ($Python311) {
    $PreviousNodeEnv = $env:NODE_ENV
    $PreviousOverride = $env:FAIRY_TEST_PYTHON

    try {
        $env:NODE_ENV = 'test'
        $env:FAIRY_TEST_PYTHON = $Python311

        pnpm --filter @fairy/testing test -- --reporter=verbose -t 'voice.worker-process-v0' 2>&1 |
            Tee-Object -FilePath "$EvidenceDir/python-311-compatibility.txt"

        if ($LASTEXITCODE -ne 0) {
            throw 'Python 3.11 compatibility run failed'
        }
    } finally {
        if ($null -eq $PreviousNodeEnv) {
            Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
        } else {
            $env:NODE_ENV = $PreviousNodeEnv
        }

        if ($null -eq $PreviousOverride) {
            Remove-Item Env:FAIRY_TEST_PYTHON -ErrorAction SilentlyContinue
        } else {
            $env:FAIRY_TEST_PYTHON = $PreviousOverride
        }
    }
}
```

Expected when run:

- focused suite passes;
- interpreter evidence reports `source: "test-override"`;
- the exact executable path is used as a single `argv[0]`;
- no `py -3.11` shell string is placed into `FAIRY_TEST_PYTHON`.

If Python 3.11 is unavailable, record `NOT RUN`; this remains a carry-in because the gated M3-04 brief did not define a version floor.

## 9. Required voice and CLI package tests

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/voice-package.txt"

if ($LASTEXITCODE -ne 0) {
    throw '@fairy/voice failed'
}

pnpm --filter @fairy/cli test -- --reporter=verbose 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/cli-voice-worker.txt"

if ($LASTEXITCODE -ne 0) {
    throw '@fairy/cli failed'
}
```

Expected:

- existing loopback, duplex, and authenticated WebSocket behavior remains green;
- the `packages/voice` source guard remains green;
- CLI worker JSON is parseable in tests;
- arbitrary `--python`, `--worker-command`, or `--worker-path` input is rejected;
- replay/corrupt-tail coverage remains green.

## 10. Required static worker and boundary checks

### 10.1 ASCII-only Python

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('workers/speech/mock_worker.py');if([...b].some(x=>x>0x7f)){console.error('non-ASCII byte found');process.exit(1)}console.log('ASCII-only PASS')" 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/python-ascii.txt"

if ($LASTEXITCODE -ne 0) {
    throw 'Python ASCII guard failed'
}
```

### 10.2 Import inventory and forbidden capabilities

```powershell
Select-String -Path 'workers/speech/mock_worker.py' -Pattern '^(?:from|import)\s+' |
    ForEach-Object Line |
    Set-Content -Encoding utf8 "$EvidenceDir/python-imports.txt"

node -e "const fs=require('fs');const s=fs.readFileSync('workers/speech/mock_worker.py','utf8');const bad=[/^\s*(?:from|import)\s+(?:socket|subprocess|requests|urllib|pyaudio|sounddevice)\b/m,/\bopen\s*\(/,/\b(?:microphone|speaker|pip\s+install|deepgram|elevenlabs|openai)\b/i];const hit=bad.find(r=>r.test(s));if(hit){console.error('forbidden capability matched: '+hit);process.exit(1)}console.log('stdlib/mock-only capability guard PASS')" 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/python-capability-guard.txt"

if ($LASTEXITCODE -ne 0) {
    throw 'Forbidden Python capability found'
}
```

Expected import inventory:

- `json`
- `os`
- `re`
- `sys`
- `time`

No pip/vendor/device/network import should appear.

### 10.3 stdio and spawn evidence

```powershell
Select-String `
    -Path 'workers/speech/mock_worker.py','apps/gateway/src/speech-worker-process.ts' `
    -Pattern @(
        'sys\.stdout\.buffer\.write'
        'sys\.stdout\.buffer\.flush'
        '"-u"'
        'line\.endsWith\("\\r"\)'
        'shell:\s*false'
        'child\.stdout\.on'
        'child\.stderr\.on'
        'FAIRY_TEST_PYTHON'
    ) |
    ForEach-Object {
        '{0}:{1}: {2}' -f $_.Path,$_.LineNumber,$_.Line.Trim()
    } |
    Set-Content -Encoding utf8 "$EvidenceDir/stdio-spawn-evidence.txt"
```

Manually confirm:

- binary stdout write + newline;
- per-message flush;
- `-u`;
- trailing CR removal;
- stdout and stderr listeners;
- `shell:false`;
- one narrow test override read.

### 10.4 Gateway placement and unchanged protected boundary

```powershell
$VoiceIndex = Get-Content -Raw 'packages/voice/src/index.ts'

if ($VoiceIndex -match 'node:child_process') {
    throw 'node:child_process leaked into packages/voice/src/index.ts'
}

@(
    '=== changed protected files from brief baseline ==='
    (git diff --name-only db0556f..e3e8089 -- packages/voice/src/index.ts packages/protocol | Out-String)
    '=== child_process locations ==='
    (Get-ChildItem apps,packages -Recurse -File -Include *.ts |
        Select-String -Pattern 'node:child_process' |
        ForEach-Object { '{0}:{1}' -f $_.Path,$_.LineNumber } |
        Out-String)
) | Set-Content -Encoding utf8 "$EvidenceDir/supervisor-placement.txt"
```

Expected:

- `packages/voice/src/index.ts` is not changed by M3-04;
- no protocol registry/schema file is changed to add worker lifecycle events;
- M3-04 child-process ownership is gateway-side.

### 10.5 Docs boundary

```powershell
git diff --name-only db0556f..e3e8089 -- docs docs-zh |
    Set-Content -Encoding utf8 "$EvidenceDir/docs-diff.txt"

if ((Get-Content -Raw "$EvidenceDir/docs-diff.txt").Trim().Length -ne 0) {
    throw 'Codex changed docs or docs-zh despite proposal-only boundary'
}
```

Expected: empty file.

## 11. Optional local CLI smoke

Run this only when the normal authenticated loopback gateway is configured with a deterministic local/mock text provider. This is not a real speech-provider check.

### Terminal A — start gateway

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

pnpm --filter @fairy/gateway start 2>&1 |
    Tee-Object -FilePath 'tasks/owner-checks/M3-04/gateway-cli-smoke.txt'
```

Wait for the loopback listening message.

### Terminal B — invoke worker path

```powershell
Set-Location 'E:\Claude_Projects\Projects\Fairy\OpenFairy'

$CliOutput = pnpm --silent fairy voice worker `
    --script workers/speech/fixtures/voice-worker-script.json `
    --json 2>&1

$CliOutput | Set-Content -Encoding utf8 'tasks/owner-checks/M3-04/voice-worker-cli.txt'

if ($LASTEXITCODE -ne 0) {
    throw 'voice worker CLI smoke failed'
}

$JsonLine = $CliOutput |
    Where-Object { $_.TrimStart().StartsWith('{') } |
    Select-Object -Last 1

if (-not $JsonLine) {
    throw 'No JSON object found in CLI output'
}

$JsonLine | Set-Content -Encoding utf8 'tasks/owner-checks/M3-04/voice-worker-cli.json'
$Result = $JsonLine | ConvertFrom-Json

$Result |
    Select-Object `
        sid,
        worker_id,
        worker_process_id,
        python_version,
        interpreter,
        request_ids,
        event_counts,
        model_request_count,
        transcript_text,
        tts_chunk_count,
        cancelled,
        error_status,
        log_path,
        replay_command |
    Format-List
```

Required assertions:

```powershell
if ($Result.worker_id -ne 'speech-mock-v0') {
    throw 'Unexpected worker_id'
}

if (-not $Result.python_version -or -not $Result.interpreter) {
    throw 'Interpreter/version evidence missing'
}

if ($Result.model_request_count -ne 1) {
    throw 'Expected exactly one model request'
}

if ($Result.tts_chunk_count -lt 1) {
    throw 'Expected at least one TTS chunk'
}

if ($Result.cancelled) {
    throw 'Normal CLI smoke unexpectedly cancelled'
}

if ($Result.error_status -ne 'none') {
    throw "Unexpected error_status: $($Result.error_status)"
}

if (Get-Process -Id $Result.worker_process_id -ErrorAction SilentlyContinue) {
    throw 'Worker PID still exists after CLI ack'
}

$Serialized = $Result | ConvertTo-Json -Depth 20

if ($Serialized -match 'data:audio/' -or $Serialized -match '[A-Za-z0-9+/]{120,}={0,2}') {
    throw 'Possible raw audio/base64 found in CLI JSON'
}
```

If no deterministic local/mock model configuration is available, create:

```powershell
'NOT RUN: no stable local/mock text-provider CLI environment; deterministic E2E tests are authoritative.' |
    Set-Content -Encoding utf8 'tasks/owner-checks/M3-04/voice-worker-cli-NOT-RUN.txt'
```

## 12. Optional replay smoke from CLI result

Run only when section 11 succeeded.

```powershell
$DataDir = Split-Path `
    (Split-Path `
        (Split-Path $Result.log_path -Parent) `
        -Parent) `
    -Parent

pnpm fairy replay $Result.sid --data-dir $DataDir 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/voice-worker-replay.txt"

if ($LASTEXITCODE -ne 0) {
    throw 'Text replay failed'
}

pnpm fairy replay $Result.sid --data-dir $DataDir --json 2>&1 |
    Tee-Object -FilePath "$EvidenceDir/voice-worker-replay.json"

if ($LASTEXITCODE -ne 0) {
    throw 'JSON replay failed'
}
```

Inspect the log and replay evidence:

```powershell
$RawLog = Get-Content -Raw $Result.log_path

$ForbiddenLogPatterns = @(
    '"type":"speech.worker.'
    '"type":"voice.worker.'
    '"kind":"asr.script"'
    '"kind":"tts.script"'
    'data:audio/'
)

foreach ($Pattern in $ForbiddenLogPatterns) {
    if ($RawLog.Contains($Pattern)) {
        throw "Forbidden worker-wire/raw-audio content in JSONL: $Pattern"
    }
}
```

Expected:

- one normal `turn.input`;
- canonical speech and turn events replay;
- no wire kinds in JSONL;
- no raw audio/base64;
- no hidden reasoning in replay/TTS.

## 13. Final evidence inventory

```powershell
Get-ChildItem $EvidenceDir -File |
    Sort-Object Name |
    Select-Object Name,Length,LastWriteTime |
    Format-Table -AutoSize |
    Out-String |
    Set-Content -Encoding utf8 "$EvidenceDir/evidence-inventory.txt"

Get-Content "$EvidenceDir/evidence-inventory.txt"
```

Required evidence files:

- `environment.txt`
- `python-inventory.txt`
- `interpreter-discovery.jsonl`
- `testing-voice-worker.txt`
- `voice-worker-focused.txt`
- `processes-before-focused.txt`
- `processes-after-focused.txt`
- `python-311-compatibility.txt` or an explicit NOT RUN record
- `voice-package.txt`
- `cli-voice-worker.txt`
- `python-ascii.txt`
- `python-imports.txt`
- `python-capability-guard.txt`
- `stdio-spawn-evidence.txt`
- `supervisor-placement.txt`
- `docs-diff.txt`
- `evidence-inventory.txt`

Optional evidence:

- `gateway-cli-smoke.txt`
- `voice-worker-cli.txt`
- `voice-worker-cli.json`
- `voice-worker-replay.txt`
- `voice-worker-replay.json`

## 14. Owner summary template

Create `tasks/owner-checks/M3-04/M3-04-owner-checks.md` with:

```markdown
# M3-04 Owner Checks

- Commit: e3e8089f996f810f6722537225eca0d411391646
- Actions run: 29071874462
- Owner platform: Windows 11 / PowerShell 7
- Date:
- Overall result: PASS / FAIL

## CI evidence

- Ubuntu job: PASS / FAIL
- Windows job: PASS / FAIL
- Run URL recorded separately: yes

## Required owner evidence

| Check | Result | Evidence |
|---|---|---|
| Production interpreter discovery and shutdown | PASS/FAIL | interpreter-discovery.jsonl |
| Full named suites | PASS/FAIL | testing-voice-worker.txt |
| Focused voice.worker-process-v0 | PASS/FAIL | voice-worker-focused.txt |
| No orphan worker after focused suite | PASS/FAIL | processes-after-focused.txt |
| Python 3.11 compatibility | PASS/NOT RUN/FAIL | python-311-compatibility.txt |
| @fairy/voice tests | PASS/FAIL | voice-package.txt |
| @fairy/cli tests | PASS/FAIL | cli-voice-worker.txt |
| ASCII/std-lib/mock-only static checks | PASS/FAIL | python-*.txt |
| Windows stdio/spawn hygiene | PASS/FAIL | stdio-spawn-evidence.txt |
| Gateway supervisor placement | PASS/FAIL | supervisor-placement.txt |
| No docs/docs-zh implementation edits | PASS/FAIL | docs-diff.txt |

## Optional CLI/replay evidence

- CLI smoke: PASS / NOT RUN / FAIL
- Replay smoke: PASS / NOT RUN / FAIL
- Reason when not run:

## Python version note

- Production discovery selected:
- Python 3.11 compatibility result:
- The selected workstation version is evidence only and is not a pinned project requirement.

## Deviations or failures

- None / describe exactly.
```

## 15. Commit owner evidence

After every required check passes or an allowed optional check is explicitly marked NOT RUN:

```powershell
git status --short
git add tasks/owner-checks/M3-04
git commit -m "Add M3-04 owner checks"
git push
```

Do not edit `tasks/M3-04-review.md` yourself unless the reviewer asks for a specific evidence pointer update. The reviewer performs the final primary close after reading the committed evidence.
