# Scenario 1 — normal bilingual Web voice

Purpose: demonstrate one complete, non-sensitive browser voice turn without claiming an accuracy benchmark.

1. Run `pnpm fairy doctor`; required checks should PASS and any optional warning must be described honestly. Doctor remains provider-zero.
2. Explicitly activate process-scoped owner consent for real speech-provider execution, then launch dev:

   ```powershell
   $env:FAIRY_OWNER_LIVE_ASR = '1'
   $env:FAIRY_OWNER_LIVE_TTS = '1'
   pnpm fairy dev
   ```

   Setting the flags alone makes no provider request; a request occurs only after a valid governed voice submission. Do not store the flags in YAML or committed configuration.
3. Confirm `Gateway: STARTED` or `Gateway: REUSED` and open the printed `/web/` URL.
4. Enter the configured gateway token. Never put it in the URL or on screen during capture.
5. Record one short phrase: “请用一句话 summarize today's demo.”
6. Confirm one final transcript, one visible assistant final, and an MP3 playback control.
7. If autoplay is blocked, press Play. **Stop is local-only playback control, not barge-in.**
8. Reload the session link and confirm the canonical transcript/final/playback reference reappears.
9. Press Ctrl+C, then remove the process-scoped consent flags from the shell:

   ```powershell
   Remove-Item Env:FAIRY_OWNER_LIVE_ASR -ErrorAction SilentlyContinue
   Remove-Item Env:FAIRY_OWNER_LIVE_TTS -ErrorAction SilentlyContinue
   ```

Expected evidence: a non-empty transcript (minor recognition imperfections are acceptable), a visible answer, authenticated MP3 playback, and replay. Do not show DevTools, device labels, credentials, provider bodies, or personal content.
