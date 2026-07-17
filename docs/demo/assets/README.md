# R0.9-05′ screenshot owner evidence

Owner capture is complete. The countersigned canonical evidence consists of exactly:

```text
docs/demo/assets/01-doctor-pass.png
docs/demo/assets/02-web-voice-roundtrip.png
docs/demo/assets/03-replay-governance.png
```

Committed SHA-256 hashes:

```text
01-doctor-pass.png          d4a789dd8eea29078d8f3b0cf6846bbea4fe047172876ea8a6a54c7d98afe438
02-web-voice-roundtrip.png 87a22ce56e5ff2017e7b4d80177dc175e18261bfcbcc5f65d562b415fa324c4c
03-replay-governance.png   7f504e2623b6699941ef638cb5d5dd8ff4981794b58f55095c86b7336d2666e8
```

These PNGs are archival owner evidence and remain byte-identical after R0.9-06′.

Recorded frames:

1. doctor text report with required PASS checks and honest optional warnings;
2. transcript + visible final + MP3 control after the normal synthetic bilingual turn;
3. canonical replay/governance evidence without hidden reasoning or private content.

## Accepted path-line deviation

Screenshot 2 is clean. Screenshots 1 and 3 contain a PowerShell prompt line with the repository absolute path. They contain no username, credential, personal data, token, provider request ID, or microphone device label. R0.9-05′ accepted this as the bounded `DEV-R09-05-SCREENSHOT-PATH` deviation, so the canonical owner-evidence PNGs are not edited or recropped.

Any public derivative should crop the PowerShell prompt/path line from screenshots 1 and 3 while leaving the canonical files unchanged. Do not commit audio, live config, session JSONL, artifact registry, or a derivative over the canonical evidence paths.
