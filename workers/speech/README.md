# Speech worker scaffold

`mock_worker.py` is the deterministic M3-04 conformance worker. It uses only
the Python standard library and exchanges UTF-8 NDJSON over stdin/stdout.

The gateway owns process discovery, spawn, deadlines, cancellation, shutdown,
and cleanup. The worker has no socket, subprocess, device, provider, or file
write access. `asr.script` and `tts.script` are mock-conformance-only messages;
they are not the future real ASR/TTS provider contract.

Protocol output is always written through `sys.stdout.buffer` and flushed once
per message. Start the worker only through the gateway supervisor, which invokes
Python in unbuffered mode (`-u`).
