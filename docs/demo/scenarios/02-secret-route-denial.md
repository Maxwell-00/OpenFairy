# Scenario 2 — synthetic secret route denial

Purpose: demonstrate the existing zero-everything denial path with a **synthetic secret fixture, never owner personal data**.

Prepare a tiny local WAV containing only a generated/non-personal test tone or synthetic phrase. Do not commit it. With the gateway token held only in `FAIRY_GATEWAY_TOKEN`:

```powershell
$Import = pnpm fairy voice import-audio --file .\synthetic-secret.wav --sensitivity secret --residency local-only --json | ConvertFrom-Json
pnpm fairy voice asr --audio-ref $Import.artifact_id --json
```

The import creates the governed input artifact; the ASR request must then be denied before speech staging or worker/provider I/O. Use the existing bounded CLI/canonical evidence to confirm:

```text
worker spawn             0
staged provider bytes    0
provider connections     0
provider requests        0
speech.asr.final         0
turn.input               0
model requests           0
replayable denial        yes
```

Do not invent a new test endpoint or enable owner-live flags for this scenario. Do not display the WAV bytes/base64, token, credentials, environment, provider response, request IDs, or absolute paths. The claim is route enforcement and zero provider I/O, not transcription.
