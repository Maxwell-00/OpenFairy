"""MiniMax T2A v2 non-streaming TTS worker for M3-05."""

import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request


PROTOCOL = "fairy.speech-worker.v0"
WORKER_ID = "speech-minimax-t2a-v2"
CAPABILITIES = ["tts.request", "cancel", "shutdown"]
TRANSPORT = "minimax-t2a-v2-http"
ENDPOINTS = {
    "cn-primary": "https://api.minimaxi.com/v1/t2a_v2",
    "cn-backup": "https://api-bj.minimaxi.com/v1/t2a_v2",
}
MODELS = {"speech-2.8-turbo", "speech-2.8-hd"}
LANGUAGES = {"auto", "Chinese", "English"}
OUTPUT_NAME = "tts-output.mp3"
PARTIAL_NAME = "tts-output.mp3.partial"
HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")
TEST_MODES = {"crash", "malformed", "partial", "timeout", "version-mismatch"}
ERROR_CATEGORIES = {
    1001: ("provider_timeout", True),
    1002: ("rate_limit", False),
    1004: ("unauthorized", False),
    1008: ("insufficient_balance", False),
    1024: ("provider_internal", True),
    1026: ("content_safety", False),
    1027: ("content_safety", False),
    1033: ("provider_downstream", True),
    1042: ("invalid_character_ratio", False),
    2013: ("invalid_parameter", False),
    2042: ("invalid_voice", False),
    2049: ("invalid_api_key", False),
    2056: ("token_plan_resource_limit", False),
    20132: ("invalid_voice", False),
}


class WorkerFailure(Exception):
    def __init__(self, category, retryable=False):
        super().__init__(category)
        self.category = category
        self.retryable = retryable


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(message):
    encoded = json.dumps(
        message,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


def send_malformed():
    sys.stdout.buffer.write(b"{malformed-worker-output\n")
    sys.stdout.buffer.flush()


def safe_error(request_id, category, retryable=False):
    payload = {
        "code": category,
        "kind": "error",
        "message": "TTS provider request failed",
        "retryable": bool(retryable),
    }
    if isinstance(request_id, str) and request_id:
        payload["request_id"] = request_id
    send(payload)


def write_diagnostic(message):
    sys.stderr.buffer.write((message + "\n").encode("ascii", "strict"))
    sys.stderr.buffer.flush()


def python_version():
    info = sys.version_info
    return "%d.%d.%d" % (info.major, info.minor, info.micro)


def is_nonempty_string(value):
    return isinstance(value, str) and len(value) > 0


def is_integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def require_exact_keys(value, keys):
    return isinstance(value, dict) and set(value.keys()) == set(keys)


def parse_test_mode(argv):
    if len(argv) == 1:
        return None
    if len(argv) == 3 and argv[1] == "--test-mode" and argv[2] in TEST_MODES:
        return argv[2]
    return "invalid"


def validate_request(message):
    allowed = {
        "audio_setting",
        "deadlines_ms",
        "endpoint_profile",
        "kind",
        "labels",
        "language_boost",
        "limits",
        "model",
        "provider_transport",
        "request_id",
        "test_loopback_port",
        "text",
        "utterance_id",
        "voice_setting",
    }
    if not isinstance(message, dict) or set(message.keys()) - allowed:
        raise WorkerFailure("adapter_invalid_request")
    for key in ("request_id", "utterance_id", "text", "endpoint_profile", "model", "provider_transport"):
        if not is_nonempty_string(message.get(key)):
            raise WorkerFailure("adapter_invalid_request")
    if message["provider_transport"] != TRANSPORT:
        raise WorkerFailure("adapter_unsupported_transport")
    if message["endpoint_profile"] not in ENDPOINTS:
        raise WorkerFailure("adapter_unsupported_endpoint")
    if message["model"] not in MODELS:
        raise WorkerFailure("adapter_unsupported_model")
    if message.get("language_boost") not in LANGUAGES:
        raise WorkerFailure("adapter_unsupported_language")
    labels = message.get("labels")
    if not require_exact_keys(labels, {"sensitivity", "residency"}):
        raise WorkerFailure("adapter_invalid_labels")
    if labels["sensitivity"] not in {"public", "internal", "personal", "secret"}:
        raise WorkerFailure("adapter_invalid_labels")
    if labels["residency"] not in {"local-only", "region-restricted", "global-ok"}:
        raise WorkerFailure("adapter_invalid_labels")
    voice = message.get("voice_setting")
    if not require_exact_keys(voice, {"voice_id", "speed", "volume", "pitch"}):
        raise WorkerFailure("adapter_invalid_voice")
    if not is_nonempty_string(voice["voice_id"]):
        raise WorkerFailure("adapter_invalid_voice")
    speed = voice["speed"]
    volume = voice["volume"]
    pitch = voice["pitch"]
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or speed < 0.5 or speed > 2:
        raise WorkerFailure("adapter_invalid_voice")
    if isinstance(volume, bool) or not isinstance(volume, (int, float)) or volume < 0 or volume > 10:
        raise WorkerFailure("adapter_invalid_voice")
    if not is_integer(pitch) or pitch < -12 or pitch > 12:
        raise WorkerFailure("adapter_invalid_voice")
    audio = message.get("audio_setting")
    if not require_exact_keys(audio, {"format", "sample_rate", "bitrate", "channel"}):
        raise WorkerFailure("adapter_invalid_audio")
    if audio != {"format": "mp3", "sample_rate": 32000, "bitrate": 128000, "channel": 1}:
        raise WorkerFailure("adapter_unsupported_audio")
    limits = message.get("limits")
    if not require_exact_keys(limits, {"max_text_chars", "max_response_bytes", "max_audio_bytes"}):
        raise WorkerFailure("adapter_invalid_limits")
    max_text = limits["max_text_chars"]
    max_response = limits["max_response_bytes"]
    max_audio = limits["max_audio_bytes"]
    if not is_integer(max_text) or max_text < 1 or max_text > 3000:
        raise WorkerFailure("adapter_invalid_limits")
    if not is_integer(max_response) or max_response < 1 or max_response > 67108864:
        raise WorkerFailure("adapter_invalid_limits")
    if not is_integer(max_audio) or max_audio < 1 or max_audio > 33554432:
        raise WorkerFailure("adapter_invalid_limits")
    if len(message["text"]) < 1 or len(message["text"]) > max_text:
        raise WorkerFailure("adapter_invalid_text")
    deadlines = message.get("deadlines_ms")
    if not require_exact_keys(deadlines, {"connect", "read", "total"}):
        raise WorkerFailure("adapter_invalid_deadlines")
    for key in ("connect", "read", "total"):
        value = deadlines[key]
        if not is_integer(value) or value < 100 or value > 120000:
            raise WorkerFailure("adapter_invalid_deadlines")
    if deadlines["total"] < deadlines["connect"] or deadlines["total"] < deadlines["read"]:
        raise WorkerFailure("adapter_invalid_deadlines")
    port = message.get("test_loopback_port")
    if port is not None:
        if os.environ.get("FAIRY_PROVIDER_TEST_MODE") != "1":
            raise WorkerFailure("adapter_test_endpoint_forbidden")
        if not is_integer(port) or port < 1 or port > 65535:
            raise WorkerFailure("adapter_invalid_test_port")
    return message


def endpoint_for(message):
    port = message.get("test_loopback_port")
    if port is not None:
        return "http://127.0.0.1:%d/v1/t2a_v2" % port
    return ENDPOINTS[message["endpoint_profile"]]


def provider_payload(message):
    voice = message["voice_setting"]
    audio = message["audio_setting"]
    return {
        "aigc_watermark": False,
        "audio_setting": {
            "bitrate": audio["bitrate"],
            "channel": audio["channel"],
            "format": audio["format"],
            "sample_rate": audio["sample_rate"],
        },
        "language_boost": message["language_boost"],
        "model": message["model"],
        "output_format": "hex",
        "stream": False,
        "subtitle_enable": False,
        "text": message["text"],
        "voice_setting": {
            "pitch": voice["pitch"],
            "speed": voice["speed"],
            "voice_id": voice["voice_id"],
            "vol": voice["volume"],
        },
    }


def read_bounded(response, maximum, started, total_seconds):
    chunks = []
    size = 0
    while True:
        if time.monotonic() - started > total_seconds:
            raise WorkerFailure("total_timeout", True)
        chunk = response.read(min(65536, maximum + 1 - size))
        if not chunk:
            break
        size += len(chunk)
        if size > maximum:
            raise WorkerFailure("response_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def parse_envelope(body):
    try:
        decoded = body.decode("utf-8", "strict")
        value = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise WorkerFailure("malformed_provider_json")
    if not isinstance(value, dict):
        raise WorkerFailure("invalid_provider_envelope")
    return value


def provider_error(value):
    base = value.get("base_resp")
    if not isinstance(base, dict):
        return None
    code = base.get("status_code")
    if not is_integer(code) or code == 0:
        return None
    return ERROR_CATEGORIES.get(code, ("provider_error", False))


def validate_success(value, message):
    failure = provider_error(value)
    if failure is not None:
        raise WorkerFailure(failure[0], failure[1])
    base = value.get("base_resp")
    if not isinstance(base, dict) or not is_integer(base.get("status_code")) or base.get("status_code") != 0:
        raise WorkerFailure("invalid_provider_status")
    data = value.get("data")
    if not isinstance(data, dict):
        raise WorkerFailure("provider_data_missing")
    if not is_integer(data.get("status")) or data.get("status") != 2:
        raise WorkerFailure("provider_incomplete")
    audio_hex = data.get("audio")
    if not isinstance(audio_hex, str) or not audio_hex or len(audio_hex) % 2 != 0 or HEX_RE.fullmatch(audio_hex) is None:
        raise WorkerFailure("invalid_audio_hex")
    try:
        audio = bytes.fromhex(audio_hex)
    except ValueError:
        raise WorkerFailure("invalid_audio_hex")
    if not audio or len(audio) > message["limits"]["max_audio_bytes"]:
        raise WorkerFailure("audio_too_large" if audio else "empty_audio")
    extra = value.get("extra_info")
    if not isinstance(extra, dict):
        raise WorkerFailure("audio_metadata_missing")
    requested = message["audio_setting"]
    if extra.get("audio_format") != requested["format"]:
        raise WorkerFailure("audio_metadata_mismatch")
    if not is_integer(extra.get("audio_channel")) or extra.get("audio_channel") != requested["channel"]:
        raise WorkerFailure("audio_metadata_mismatch")
    if not is_integer(extra.get("audio_sample_rate")) or extra.get("audio_sample_rate") != requested["sample_rate"]:
        raise WorkerFailure("audio_metadata_mismatch")
    if "bitrate" in extra and (not is_integer(extra.get("bitrate")) or extra.get("bitrate") != requested["bitrate"]):
        raise WorkerFailure("audio_metadata_mismatch")
    if "audio_size" in extra and (not is_integer(extra.get("audio_size")) or extra.get("audio_size") != len(audio)):
        raise WorkerFailure("audio_size_mismatch")
    if not (audio.startswith(b"ID3") or (len(audio) >= 2 and audio[0] == 255 and audio[1] & 224 == 224)):
        raise WorkerFailure("audio_format_mismatch")
    return audio


def open_provider(message, credential):
    payload = json.dumps(
        provider_payload(message),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint_for(message),
        data=payload,
        headers={
            "Authorization": "Bearer " + credential,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    context = ssl.create_default_context()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        NoRedirectHandler(),
        urllib.request.HTTPSHandler(context=context),
    )
    deadlines = message["deadlines_ms"]
    started = time.monotonic()
    try:
        blocking_timeout = min(deadlines["connect"], deadlines["read"]) / 1000.0
        response = opener.open(request, timeout=blocking_timeout)
        with response:
            if response.getcode() != 200:
                raise WorkerFailure("provider_http_error", response.getcode() >= 500)
            body = read_bounded(
                response,
                message["limits"]["max_response_bytes"],
                started,
                deadlines["total"] / 1000.0,
            )
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise WorkerFailure("redirect_rejected")
        if error.code == 401 or error.code == 403:
            raise WorkerFailure("unauthorized")
        if error.code == 429:
            raise WorkerFailure("rate_limit")
        raise WorkerFailure("provider_http_error", error.code >= 500)
    except urllib.error.URLError:
        raise WorkerFailure("transport_error", True)
    except TimeoutError:
        raise WorkerFailure("provider_timeout", True)
    return validate_success(parse_envelope(body), message)


def output_root():
    root = os.environ.get("FAIRY_SPEECH_WORKER_OUTPUT_ROOT")
    if not is_nonempty_string(root) or not os.path.isabs(root) or not os.path.isdir(root):
        raise WorkerFailure("output_root_invalid")
    return root


def remove_if_present(path):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def write_audio(root, audio):
    partial = os.path.join(root, PARTIAL_NAME)
    final = os.path.join(root, OUTPUT_NAME)
    remove_if_present(partial)
    remove_if_present(final)
    try:
        with open(partial, "xb") as handle:
            handle.write(audio)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(partial, final)
    except Exception:
        remove_if_present(partial)
        remove_if_present(final)
        raise WorkerFailure("output_write_failed")
    return "sha256:" + hashlib.sha256(audio).hexdigest()


def handle_tts(message, test_mode):
    request_id = message.get("request_id") if isinstance(message, dict) else None
    try:
        message = validate_request(message)
        root = output_root()
        if test_mode == "crash":
            os._exit(17)
        if test_mode == "malformed":
            send_malformed()
            return
        if test_mode == "timeout":
            time.sleep(60)
            return
        if test_mode == "partial":
            with open(os.path.join(root, PARTIAL_NAME), "wb") as handle:
                handle.write(b"ID3partial")
            raise WorkerFailure("scripted_partial_failure")
        credential = os.environ.get("FAIRY_MINIMAX_T2A_TOKEN")
        if not is_nonempty_string(credential):
            raise WorkerFailure("credential_missing")
        audio = open_provider(message, credential)
        digest = write_audio(root, audio)
        send({
            "audio_format": "mp3",
            "audio_ref": OUTPUT_NAME,
            "chunk_id": message["utterance_id"] + ":tts:001",
            "kind": "tts.chunk",
            "mime": "audio/mpeg",
            "request_id": message["request_id"],
            "sha256": digest,
            "size_bytes": len(audio),
            "text": message["text"],
        })
        send({
            "chunk_count": 1,
            "kind": "tts.done",
            "request_id": message["request_id"],
            "utterance_id": message["utterance_id"],
        })
    except WorkerFailure as error:
        safe_error(request_id, error.category, error.retryable)


def main():
    test_mode = parse_test_mode(sys.argv)
    if test_mode == "invalid":
        write_diagnostic("invalid provider worker test mode")
        return 2
    ready = False
    for raw_line in sys.stdin.buffer:
        try:
            message = json.loads(raw_line.decode("utf-8", "strict"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            safe_error(None, "malformed_json")
            return 2
        if not isinstance(message, dict) or not is_nonempty_string(message.get("kind")):
            safe_error(None, "invalid_message")
            return 2
        kind = message["kind"]
        if not ready:
            if set(message.keys()) != {"kind", "protocol"} or kind != "hello" or message.get("protocol") != PROTOCOL:
                safe_error(message.get("request_id"), "handshake_required")
                return 2
            ready = True
            send({
                "capabilities": CAPABILITIES,
                "kind": "ready",
                "protocol": PROTOCOL,
                "python_version": "3.99.0" if test_mode == "version-mismatch" else python_version(),
                "worker_id": WORKER_ID,
            })
            continue
        if kind == "tts.request":
            handle_tts(message, test_mode)
            continue
        if kind == "cancel":
            if not is_nonempty_string(message.get("request_id")) or not is_nonempty_string(message.get("target_request_id")):
                safe_error(message.get("request_id"), "invalid_cancel")
                continue
            send({
                "kind": "cancelled",
                "request_id": message["request_id"],
                "target": "tts",
                "target_request_id": message["target_request_id"],
            })
            continue
        if kind == "shutdown":
            send({"kind": "bye", "reason": "shutdown"})
            return 0
        safe_error(message.get("request_id"), "unknown_kind")
    return 0 if ready else 2


if __name__ == "__main__":
    sys.exit(main())
