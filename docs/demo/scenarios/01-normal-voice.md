# Scenario 1 — normal bilingual Web voice

Purpose: demonstrate one complete, non-sensitive browser voice turn without claiming an accuracy benchmark.

1. Run `pnpm fairy doctor`; required checks should PASS and any optional warning must be described honestly.
2. Run `pnpm fairy dev`; confirm `Gateway: STARTED` or `Gateway: REUSED` and open the printed `/web/` URL.
3. Enter the configured gateway token. Never put it in the URL or on screen during capture.
4. Record one short phrase: “请用一句话 summarize today's demo.”
5. Confirm one final transcript, one visible assistant final, and an MP3 playback control.
6. If autoplay is blocked, press Play. **Stop is local-only playback control, not barge-in.**
7. Reload the session link and confirm the canonical transcript/final/playback reference reappears.

Expected evidence: a non-empty transcript (minor recognition imperfections are acceptable), a visible answer, authenticated MP3 playback, and replay. Do not show DevTools, device labels, credentials, provider bodies, or personal content.
