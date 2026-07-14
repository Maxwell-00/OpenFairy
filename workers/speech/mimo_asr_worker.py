"""Xiaomi MiMo-V2.5-ASR non-streaming file worker for R0.9-01."""

import base64
import hashlib
import json
import os
import re
import ssl
import stat
import sys
import time
import urllib.error
import urllib.request


PROTOCOL = "fairy.speech-worker.v0"
WORKER_ID = "speech-mimo-v2.5-asr"
CAPABILITIES = ["asr.request", "mimo-v2.5-asr", "provider-http", "wav", "mp3", "cancel", "shutdown"]
TRANSPORT = "mimo-v2.5-asr-chat-http"
ENDPOINT_PROFILE = "mimo-paygo-cn"
ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions"
MODEL = "mimo-v2.5-asr"
INPUT_NAME = "asr-input.bin"
MIMES = {"audio/wav", "audio/mpeg"}
LANGUAGES = {"auto", "zh", "en"}
MAX_INPUT_BYTES = 7000000
MAX_ENCODED_REQUEST_BYTES = 10000000
MAX_RESPONSE_BYTES = 1048576
MAX_TRANSCRIPT_CHARS = 20000
TEST_MODES = {"crash", "malformed", "timeout", "version-mismatch"}
SHA_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
SK_RE = re.compile(r"^sk-[A-Za-z0-9._-]+$")


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
        "message": "ASR provider request failed",
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


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


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
        "audio_ref",
        "deadlines_ms",
        "endpoint_profile",
        "input_token",
        "kind",
        "language",
        "limits",
        "mime",
        "model",
        "provider_transport",
        "request_id",
        "sha256",
        "size_bytes",
        "test_loopback_port",
        "utterance_id",
    }
    if not isinstance(message, dict) or set(message.keys()) - allowed:
        raise WorkerFailure("invalid_request")
    for key in ("request_id", "utterance_id", "audio_ref", "input_token", "provider_transport", "endpoint_profile", "model", "language", "mime", "sha256"):
        if not is_nonempty_string(message.get(key)):
            raise WorkerFailure("invalid_request")
    if message["input_token"] != INPUT_NAME:
        raise WorkerFailure("invalid_request")
    if message["provider_transport"] != TRANSPORT:
        raise WorkerFailure("invalid_request")
    if message["endpoint_profile"] != ENDPOINT_PROFILE:
        raise WorkerFailure("invalid_request")
    if message["model"] != MODEL:
        raise WorkerFailure("invalid_request")
    if message["language"] not in LANGUAGES or message["mime"] not in MIMES:
        raise WorkerFailure("invalid_request")
    if SHA_RE.fullmatch(message["sha256"]) is None:
        raise WorkerFailure("invalid_request")
    if not is_integer(message.get("size_bytes")) or message["size_bytes"] < 1 or message["size_bytes"] > MAX_INPUT_BYTES:
        raise WorkerFailure("invalid_request")
    limits = message.get("limits")
    if not require_exact_keys(limits, {"max_input_bytes", "max_encoded_request_bytes", "max_response_bytes", "max_transcript_chars"}):
        raise WorkerFailure("invalid_request")
    if not is_integer(limits["max_input_bytes"]) or limits["max_input_bytes"] < 1 or limits["max_input_bytes"] > MAX_INPUT_BYTES:
        raise WorkerFailure("invalid_request")
    if limits["max_encoded_request_bytes"] != MAX_ENCODED_REQUEST_BYTES:
        raise WorkerFailure("invalid_request")
    if not is_integer(limits["max_response_bytes"]) or limits["max_response_bytes"] < 1 or limits["max_response_bytes"] > MAX_RESPONSE_BYTES:
        raise WorkerFailure("invalid_request")
    if not is_integer(limits["max_transcript_chars"]) or limits["max_transcript_chars"] < 1 or limits["max_transcript_chars"] > MAX_TRANSCRIPT_CHARS:
        raise WorkerFailure("invalid_request")
    if message["size_bytes"] > limits["max_input_bytes"]:
        raise WorkerFailure("invalid_request")
    deadlines = message.get("deadlines_ms")
    if not require_exact_keys(deadlines, {"connect", "read", "total"}):
        raise WorkerFailure("invalid_request")
    for key in ("connect", "read", "total"):
        if not is_integer(deadlines[key]) or deadlines[key] < 100 or deadlines[key] > 120000:
            raise WorkerFailure("invalid_request")
    if deadlines["total"] < deadlines["connect"] or deadlines["total"] < deadlines["read"]:
        raise WorkerFailure("invalid_request")
    port = message.get("test_loopback_port")
    if port is not None:
        if os.environ.get("FAIRY_PROVIDER_TEST_MODE") != "1":
            raise WorkerFailure("invalid_request")
        if not is_integer(port) or port < 1 or port > 65535:
            raise WorkerFailure("invalid_request")
    return message


def input_root():
    root = os.environ.get("FAIRY_SPEECH_WORKER_INPUT_ROOT")
    if not is_nonempty_string(root) or not os.path.isabs(root) or not os.path.isdir(root):
        raise WorkerFailure("invalid_request")
    return os.path.realpath(root)


def is_magic(content, mime):
    if mime == "audio/wav":
        return len(content) >= 12 and content[0:4] == b"RIFF" and content[8:12] == b"WAVE"
    return content.startswith(b"ID3") or (len(content) >= 2 and content[0] == 255 and content[1] & 224 == 224)


def read_input(message):
    root = input_root()
    target = os.path.join(root, INPUT_NAME)
    resolved = os.path.realpath(target)
    try:
        if os.path.commonpath([root, resolved]) != root:
            raise WorkerFailure("invalid_request")
    except ValueError:
        raise WorkerFailure("invalid_request")
    try:
        before = os.lstat(target)
    except OSError:
        raise WorkerFailure("invalid_request")
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise WorkerFailure("invalid_request")
    if before.st_size != message["size_bytes"] or before.st_size < 1 or before.st_size > message["limits"]["max_input_bytes"]:
        raise WorkerFailure("invalid_request")
    try:
        with open(target, "rb") as handle:
            content = handle.read(message["limits"]["max_input_bytes"] + 1)
        after = os.stat(target)
    except OSError:
        raise WorkerFailure("invalid_request")
    if len(content) != message["size_bytes"] or len(content) > message["limits"]["max_input_bytes"]:
        raise WorkerFailure("invalid_request")
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns or before.st_ino != after.st_ino:
        raise WorkerFailure("invalid_request")
    actual = "sha256:" + hashlib.sha256(content).hexdigest()
    if actual != message["sha256"] or not is_magic(content, message["mime"]):
        raise WorkerFailure("invalid_request")
    return content


def endpoint_for(message):
    port = message.get("test_loopback_port")
    if port is not None:
        return "http://127.0.0.1:%d/v1/chat/completions" % port
    return ENDPOINT


def provider_payload(message, audio):
    encoded = base64.b64encode(audio).decode("ascii")
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:%s;base64,%s" % (message["mime"], encoded),
                        },
                    }
                ],
            }
        ],
        "asr_options": {"language": message["language"]},
    }


def request_body(message, audio):
    body = json.dumps(
        provider_payload(message, audio),
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(body) > message["limits"]["max_encoded_request_bytes"]:
        raise WorkerFailure("invalid_request")
    return body


def read_bounded(response, maximum, started, total_seconds):
    chunks = []
    size = 0
    while True:
        if time.monotonic() - started > total_seconds:
            raise WorkerFailure("timeout", True)
        chunk = response.read(min(65536, maximum + 1 - size))
        if not chunk:
            break
        size += len(chunk)
        if size > maximum:
            raise WorkerFailure("provider_protocol")
        chunks.append(chunk)
    return b"".join(chunks)


def normalize_transcript(value):
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", normalized)


def parse_success(body, message):
    if body.lstrip().startswith(b"data:"):
        raise WorkerFailure("provider_protocol")
    try:
        value = json.loads(body.decode("utf-8", "strict"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise WorkerFailure("provider_protocol")
    if not isinstance(value, dict) or value.get("object") != "chat.completion":
        raise WorkerFailure("provider_protocol")
    if value.get("model") != MODEL or not is_nonempty_string(value.get("id")):
        raise WorkerFailure("provider_protocol")
    choices = value.get("choices")
    if not isinstance(choices, list) or len(choices) != 1:
        raise WorkerFailure("provider_protocol")
    choice = choices[0]
    if not isinstance(choice, dict) or choice.get("index") != 0 or choice.get("finish_reason") != "stop":
        raise WorkerFailure("provider_protocol")
    result = choice.get("message")
    if not isinstance(result, dict) or result.get("role") != "assistant":
        raise WorkerFailure("provider_protocol")
    if result.get("tool_calls") is not None or result.get("audio") is not None:
        raise WorkerFailure("provider_protocol")
    if not isinstance(result.get("content"), str):
        raise WorkerFailure("provider_protocol")
    transcript = normalize_transcript(result["content"])
    if not transcript or len(transcript) > message["limits"]["max_transcript_chars"]:
        raise WorkerFailure("provider_protocol")
    evidence = {
        "finish_reason": "stop",
        "provider_model": MODEL,
        "provider_request_id": value["id"],
    }
    usage = value.get("usage")
    if isinstance(usage, dict) and is_number(usage.get("audio_seconds")) and usage["audio_seconds"] >= 0:
        evidence["usage_seconds"] = usage["audio_seconds"]
    return transcript, evidence


def http_category(code):
    mapping = {
        400: ("invalid_request", False),
        401: ("unauthorized", False),
        402: ("balance_exhausted", False),
        403: ("access_denied", False),
        404: ("endpoint_or_model", False),
        421: ("safety_blocked", False),
        429: ("rate_limited", True),
        500: ("provider_transient", True),
        503: ("provider_unavailable", True),
    }
    return mapping.get(code, ("provider_protocol", False))


def open_provider(message, credential, audio):
    body = request_body(message, audio)
    request = urllib.request.Request(
        endpoint_for(message),
        data=body,
        headers={
            "api-key": credential,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        NoRedirectHandler(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    deadlines = message["deadlines_ms"]
    started = time.monotonic()
    try:
        response = opener.open(request, timeout=min(deadlines["connect"], deadlines["read"]) / 1000.0)
        with response:
            code = response.getcode()
            if code < 200 or code >= 300:
                category = http_category(code)
                raise WorkerFailure(category[0], category[1])
            if response.headers.get_content_type().lower() == "text/event-stream":
                raise WorkerFailure("provider_protocol")
            response_body = read_bounded(
                response,
                message["limits"]["max_response_bytes"],
                started,
                deadlines["total"] / 1000.0,
            )
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise WorkerFailure("provider_protocol")
        category = http_category(error.code)
        raise WorkerFailure(category[0], category[1])
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise WorkerFailure("timeout", True)
        raise WorkerFailure("transport_failure", True)
    except TimeoutError:
        raise WorkerFailure("timeout", True)
    return parse_success(response_body, message)


def handle_asr(message, test_mode):
    request_id = message.get("request_id") if isinstance(message, dict) else None
    try:
        message = validate_request(message)
        if test_mode == "crash":
            os._exit(17)
        if test_mode == "malformed":
            send_malformed()
            return
        if test_mode == "timeout":
            time.sleep(120)
            return
        audio = read_input(message)
        credential = os.environ.get("FAIRY_MIMO_ASR_API_KEY")
        if not is_nonempty_string(credential):
            raise WorkerFailure("unauthorized")
        if SK_RE.fullmatch(credential) is None:
            raise WorkerFailure("unauthorized")
        transcript, evidence = open_provider(message, credential, audio)
        send({
            "audio_ref": message["audio_ref"],
            "finish_reason": evidence["finish_reason"],
            "kind": "asr.final",
            "provider_model": evidence["provider_model"],
            "provider_request_id": evidence["provider_request_id"],
            "request_id": message["request_id"],
            "text": transcript,
            **({"usage_seconds": evidence["usage_seconds"]} if "usage_seconds" in evidence else {}),
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
            safe_error(None, "invalid_request")
            return 2
        if not isinstance(message, dict) or not is_nonempty_string(message.get("kind")):
            safe_error(None, "invalid_request")
            return 2
        kind = message["kind"]
        if not ready:
            if set(message.keys()) != {"kind", "protocol"} or kind != "hello" or message.get("protocol") != PROTOCOL:
                safe_error(message.get("request_id"), "invalid_request")
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
        if kind == "asr.request":
            handle_asr(message, test_mode)
            continue
        if kind == "cancel":
            if not is_nonempty_string(message.get("request_id")) or not is_nonempty_string(message.get("target_request_id")):
                safe_error(message.get("request_id"), "invalid_request")
                continue
            send({
                "kind": "cancelled",
                "request_id": message["request_id"],
                "target": "asr",
                "target_request_id": message["target_request_id"],
            })
            continue
        if kind == "shutdown":
            send({"kind": "bye", "reason": "shutdown"})
            return 0
        safe_error(message.get("request_id"), "invalid_request")
    return 0 if ready else 2


if __name__ == "__main__":
    sys.exit(main())
