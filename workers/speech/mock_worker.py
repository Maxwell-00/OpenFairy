"""Deterministic stdio speech worker used by M3-04 conformance tests."""

import json
import os
import re
import sys
import time


PROTOCOL = "fairy.speech-worker.v0"
WORKER_ID = "speech-mock-v0"
CAPABILITIES = ["asr.script", "tts.script", "cancel", "shutdown"]
BASE64_RE = re.compile(r"^[A-Za-z0-9+/]{120,}={0,2}$")
API_KEY_RE = re.compile(r"\bsk_test_[A-Za-z0-9]{16,}\b")
TEST_MODES = {
    "malformed-startup",
    "startup-timeout",
    "stderr-secret",
}


def send(message):
    encoded_message = json.dumps(
        message,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    sys.stdout.buffer.write(encoded_message + b"\n")
    sys.stdout.buffer.flush()


def send_malformed():
    sys.stdout.buffer.write(b"{malformed-worker-output\n")
    sys.stdout.buffer.flush()


def write_diagnostic(message):
    safe_message = API_KEY_RE.sub("[REDACTED:api_key]", message)
    sys.stderr.buffer.write((safe_message + "\n").encode("utf-8"))
    sys.stderr.buffer.flush()


def safe_error(request_id, code, message):
    payload = {
        "code": code,
        "kind": "error",
        "message": message,
        "retryable": False,
    }
    if isinstance(request_id, str) and request_id:
        payload["request_id"] = request_id
    send(payload)


def is_nonempty_string(value):
    return isinstance(value, str) and len(value) > 0


def contains_raw_audio(value):
    if isinstance(value, str):
        return value.lower().startswith("data:audio/") or bool(BASE64_RE.fullmatch(value))
    if isinstance(value, list):
        return any(contains_raw_audio(item) for item in value)
    if isinstance(value, dict):
        return any(contains_raw_audio(item) for item in value.values())
    return False


def require_fields(message, fields):
    return all(is_nonempty_string(message.get(field)) for field in fields)


def python_version():
    info = sys.version_info
    return "%d.%d.%d" % (info.major, info.minor, info.micro)


def chunk_text(text, chunk_chars):
    size = max(1, chunk_chars)
    return [text[index:index + size] for index in range(0, len(text), size)]


def parse_test_mode(argv):
    if len(argv) == 1:
        return None
    if len(argv) == 3 and argv[1] == "--test-mode" and argv[2] in TEST_MODES:
        return argv[2]
    return "invalid"


def main():
    test_mode = parse_test_mode(sys.argv)
    if test_mode == "invalid":
        write_diagnostic("invalid speech worker test mode")
        return 2

    ready = False
    pending_asr = {}

    for raw_line in sys.stdin.buffer:
        try:
            line = raw_line.decode("utf-8")
            message = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError):
            safe_error(None, "malformed_json", "invalid speech worker message")
            return 2

        if not isinstance(message, dict) or not is_nonempty_string(message.get("kind")):
            safe_error(None, "invalid_message", "invalid speech worker message")
            return 2

        request_id = message.get("request_id")
        if contains_raw_audio(message):
            safe_error(None, "raw_audio_rejected", "raw audio is not accepted on the control wire")
            continue

        kind = message["kind"]
        if not ready:
            if kind != "hello" or message.get("protocol") != PROTOCOL:
                safe_error(request_id, "handshake_required", "valid hello is required")
                return 2
            if test_mode == "startup-timeout":
                time.sleep(60)
                return 3
            if test_mode == "malformed-startup":
                send_malformed()
                time.sleep(60)
                return 3
            if test_mode == "stderr-secret":
                write_diagnostic("worker diagnostic " + "sk_test_" + "1234567890abcdef")
            ready = True
            send({
                "capabilities": CAPABILITIES,
                "kind": "ready",
                "protocol": PROTOCOL,
                "python_version": python_version(),
                "worker_id": WORKER_ID,
            })
            continue

        if kind == "asr.script":
            if not require_fields(message, ["request_id", "utterance_id", "audio_ref", "final"]):
                safe_error(request_id, "invalid_asr_script", "invalid asr script")
                continue
            partials = message.get("partials")
            if not isinstance(partials, list) or not all(isinstance(item, str) for item in partials):
                safe_error(request_id, "invalid_asr_script", "invalid asr script")
                continue
            behavior = message.get("mock_behavior", "normal")
            if behavior not in {"normal", "wait", "crash", "malformed"}:
                safe_error(request_id, "invalid_asr_script", "invalid asr script")
                continue
            for partial in partials:
                send({
                    "kind": "asr.partial",
                    "request_id": request_id,
                    "text": partial,
                    "utterance_id": message["utterance_id"],
                })
            if behavior == "crash":
                os._exit(17)
            if behavior == "malformed":
                send_malformed()
                continue
            if behavior == "wait":
                pending_asr[request_id] = message
                continue
            send({
                "audio_ref": message["audio_ref"],
                "kind": "asr.final",
                "request_id": request_id,
                "text": message["final"],
                "utterance_id": message["utterance_id"],
            })
            continue

        if kind == "tts.script":
            if not require_fields(message, ["request_id", "utterance_id", "text"]):
                safe_error(request_id, "invalid_tts_script", "invalid tts script")
                continue
            chunk_chars = message.get("chunk_chars", 80)
            if not isinstance(chunk_chars, int) or isinstance(chunk_chars, bool) or chunk_chars < 1 or chunk_chars > 4096:
                safe_error(request_id, "invalid_tts_script", "invalid tts script")
                continue
            chunks = chunk_text(message["text"], chunk_chars)
            for index, text in enumerate(chunks, start=1):
                chunk_id = "%s:tts:%03d" % (message["utterance_id"], index)
                send({
                    "audio_ref": "worker://tts/%s" % chunk_id,
                    "chunk_id": chunk_id,
                    "kind": "tts.chunk",
                    "request_id": request_id,
                    "text": text,
                })
            send({
                "chunk_count": len(chunks),
                "kind": "tts.done",
                "request_id": request_id,
                "utterance_id": message["utterance_id"],
            })
            continue

        if kind == "cancel":
            if not require_fields(message, ["request_id", "target_request_id", "target"]):
                safe_error(request_id, "invalid_cancel", "invalid cancel request")
                continue
            target = message["target"]
            if target not in {"asr", "tts", "all"}:
                safe_error(request_id, "invalid_cancel", "invalid cancel request")
                continue
            target_request_id = message["target_request_id"]
            pending_asr.pop(target_request_id, None)
            send({
                "kind": "cancelled",
                "request_id": request_id,
                "target": target,
                "target_request_id": target_request_id,
            })
            continue

        if kind == "shutdown":
            send({"kind": "bye", "reason": "shutdown"})
            return 0

        safe_error(request_id, "unknown_kind", "unsupported speech worker message")

    return 0 if ready else 2


if __name__ == "__main__":
    sys.exit(main())
