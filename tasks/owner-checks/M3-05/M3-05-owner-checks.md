# M3-05 Owner Checks

- Implementation/repair commit: a2d7f6e380918a16db0c3b2a480675e3a036ba6e
- Green CI run: 29198783063
- Owner platform: Windows 11 / PowerShell 7
- Credential class: MiniMax Token Plan
- Overall result: PASS

## CI evidence

| Job                              | Result |
| -------------------------------- | ------ |
| Ubuntu normal discovery          | PASS   |
| Windows normal discovery         | PASS   |
| Ubuntu Python 3.11 speech floor  | PASS   |
| Windows Python 3.11 speech floor | PASS   |

## Local deterministic preflight

| Check                   | Result | Evidence            |
| ----------------------- | ------ | ------------------- |
| `voice.tts-provider-v0` | PASS   | local-preflight.txt |

## Live MiniMax evidence

| Check                                      | Result | Evidence            |
| ------------------------------------------ | ------ | ------------------- |
| Exactly one provider request               | PASS   | live-result.json    |
| No hidden retry/fallback                   | PASS   | live-result.json    |
| Endpoint profile `cn-primary`              | PASS   | live-result.json    |
| Model `speech-2.8-turbo`                   | PASS   | live-result.json    |
| `base_resp.status_code == 0`               | PASS   | live-result.json    |
| `data.status == 2`                         | PASS   | live-result.json    |
| Exactly one `speech.tts.chunk`             | PASS   | live-result.json    |
| Speech artifact exists                     | PASS   | artifact-check.json |
| MP3 header/frame valid                     | PASS   | artifact-check.json |
| MP3 non-empty and intelligible             | PASS   | owner confirmation  |
| Byte count and SHA-256 agree               | PASS   | artifact-check.json |
| Credential/header/provider envelope absent | PASS   | leak-scan.txt       |
| Audio hex/base64 absent from JSONL         | PASS   | leak-scan.txt       |
| No speech-worker process remains           | PASS   | cleanup.txt         |
| No temporary worker root remains           | PASS   | cleanup.txt         |
| Replay preserves `audio_ref`               | PASS   | replay.json         |

## Notes

- One real MiniMax synthesis request was made.
- Generated MP3 was not committed.
- Artifact registry and absolute local path were not committed.
- Raw provider response was not committed.
- Token Plan credential was not committed.
- MiniMax `2056` is `TOKEN_PLAN_RESOURCE_LIMIT`, not PASS.