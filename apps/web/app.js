// @ts-check

import { BrowserPttRecorder, reduceRecorderState } from "./recorder.js";

/** @typedef {{ sid?: string, transcript: string, assistant: string, audioRef?: string }} ReplayView */

let gatewayToken = "";
/** @type {WebSocket | undefined} */
let socket;
/** @type {BrowserPttRecorder | undefined} */
let recorder;
/** @type {string | undefined} */
let selectedSession;
let uiState = "disconnected";
let holdActive = false;

/** @param {string} hash */
export const parseSessionHash = (hash) => {
  const match = hash.match(/^#\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})$/);
  return match?.[1];
};

/** @param {string} sid */
export const sessionHash = (sid) => `#/sessions/${sid}`;

/** @param {EventTarget | null} target */
export const shouldHandleSpace = (target) => {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return true;
  }
  return !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) && !target.closest("[contenteditable='true']");
};

/** @param {ReplayView} view @param {unknown} value */
export const consumeProjectedEvent = (view, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return view;
  }
  const event = /** @type {Record<string, unknown>} */ (value);
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? /** @type {Record<string, unknown>} */ (event.payload) : {};
  const next = { ...view };
  if (typeof event.sid === "string") next.sid = event.sid;
  if (event.type === "speech.asr.final" && typeof payload.text === "string") next.transcript = payload.text;
  if (event.type === "turn.final" && typeof payload.text === "string") next.assistant = payload.text;
  if (event.type === "speech.tts.chunk" && typeof payload.audio_ref === "string") next.audioRef = payload.audio_ref;
  return next;
};

/** @param {HTMLAudioElement} audio @param {(url: string) => void} revoke */
export const createPlaybackController = (audio, revoke = URL.revokeObjectURL.bind(URL)) => {
  /** @type {string | undefined} */
  let objectUrl;
  return {
    /** @param {string} url */
    replace(url) {
      if (objectUrl) revoke(objectUrl);
      objectUrl = url;
      audio.src = url;
    },
    stop() {
      audio.pause();
      audio.currentTime = 0;
      if (objectUrl) revoke(objectUrl);
      objectUrl = undefined;
      audio.removeAttribute("src");
    },
    cleanup() {
      this.stop();
    }
  };
};

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = () => byId("status");
const recordButton = () => /** @type {HTMLButtonElement} */ (byId("record"));
const audio = () => /** @type {HTMLAudioElement} */ (byId("audio"));
/** @type {ReturnType<typeof createPlaybackController> | undefined} */
let playback;
/** @type {ReplayView} */
let replayView = { assistant: "", transcript: "" };

/** @param {string} state @param {string} [message] */
const renderState = (state, message) => {
  uiState = state;
  status().textContent = message ?? state.replaceAll("-", " ");
  recordButton().disabled = !selectedSession || !["ready", "playback-ready"].includes(state);
  recordButton().setAttribute("aria-pressed", String(state === "recording"));
};

const renderReplay = () => {
  byId("transcript").textContent = replayView.transcript || "—";
  byId("assistant").textContent = replayView.assistant || "—";
};

/** @param {string} artifactId */
const loadSpeech = async (artifactId) => {
  if (!selectedSession || !gatewayToken) return;
  renderState("synthesizing");
  const response = await fetch(`/web/api/sessions/${selectedSession}/speech/${artifactId}`, {
    headers: { Authorization: `Bearer ${gatewayToken}` }
  });
  if (!response.ok) {
    renderState("ready", "Speech playback is unavailable");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  playback?.replace(url);
  byId("stop").hidden = false;
  try {
    await audio().play();
    renderState("playing");
  } catch {
    byId("play").hidden = false;
    renderState("playback-ready", "Audio is ready");
  }
};

/** @param {unknown} value */
const receive = (value) => {
  const beforeAudio = replayView.audioRef;
  replayView = consumeProjectedEvent(replayView, value);
  renderReplay();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const frame = /** @type {Record<string, unknown>} */ (value);
    if (frame.type === "session.created" && typeof frame.sid === "string") selectSession(frame.sid);
    if (frame.type === "speech.asr.final") renderState("thinking");
    if (frame.type === "turn.final") renderState("synthesizing");
    if (frame.kind === "ack" && frame.op === "voice.asr" && !frame.tts_audio_ref) renderState("ready");
    if (frame.kind === "op-error") renderState("error", "The request could not be completed");
  }
  if (replayView.audioRef && replayView.audioRef !== beforeAudio) void loadSpeech(replayView.audioRef);
};

/** @param {string} sid */
const selectSession = (sid) => {
  selectedSession = sid;
  location.hash = sessionHash(sid);
  byId("session").textContent = sid;
  recordButton().disabled = false;
};

const fetchSessions = async () => {
  const response = await fetch("/sessions", { headers: { Authorization: `Bearer ${gatewayToken}` } });
  if (!response.ok) throw new Error("Session list unavailable");
  const body = await response.json();
  const select = /** @type {HTMLSelectElement} */ (byId("sessions"));
  select.replaceChildren(new Option("Choose a session", ""));
  for (const item of Array.isArray(body.sessions) ? body.sessions : []) {
    if (item && typeof item.id === "string") select.add(new Option(String(item.title ?? item.id), item.id));
  }
};

const connect = async () => {
  const input = /** @type {HTMLInputElement} */ (byId("token"));
  gatewayToken = input.value;
  input.value = "";
  if (!gatewayToken) return;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${scheme}//${location.host}/`);
  url.searchParams.set("token", gatewayToken);
  url.searchParams.set("surface", "web-v0");
  socket = new WebSocket(url);
  socket.addEventListener("open", async () => {
    byId("connect-panel").hidden = true;
    byId("session-panel").hidden = false;
    renderState("ready");
    try { await fetchSessions(); } catch { renderState("error", "Session list is unavailable"); }
    const sid = parseSessionHash(location.hash);
    if (sid) {
      replayView = { assistant: "", sid, transcript: "" };
      selectSession(sid);
      socket?.send(JSON.stringify({ op: "session.attach", sid }));
    }
  });
  socket.addEventListener("message", (event) => {
    try { receive(JSON.parse(String(event.data))); } catch { renderState("error", "Gateway response was invalid"); }
  });
  socket.addEventListener("close", () => {
    gatewayToken = "";
    holdActive = false;
    const activeRecorder = recorder;
    recorder = undefined;
    void activeRecorder?.discard();
    playback?.cleanup();
    renderState("disconnected");
    byId("connect-panel").hidden = false;
    byId("session-panel").hidden = true;
  });
};

/** @param {Uint8Array} wav */
const upload = async (wav) => {
  if (!selectedSession) return;
  renderState("uploading");
  const response = await fetch(`/web/api/sessions/${selectedSession}/input-audio`, {
    body: /** @type {BodyInit} */ (wav),
    headers: { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "audio/wav" },
    method: "POST"
  });
  if (!response.ok) {
    renderState("error", "Recording was not accepted");
    return;
  }
  const result = await response.json();
  if (typeof result.artifact_id !== "string") {
    renderState("error", "Recording response was invalid");
    return;
  }
  renderState("transcribing");
  socket?.send(JSON.stringify({ audio_ref: result.artifact_id, op: "voice.asr", sid: selectedSession }));
};

const startRecording = async () => {
  if (!selectedSession || !["ready", "playback-ready"].includes(uiState) || recorder) return;
  playback?.stop();
  const activeRecorder = new BrowserPttRecorder({
    onDiscard: () => { recorder = undefined; renderState("ready"); },
    onFinalize: async (wav) => {
      recorder = undefined;
      await upload(wav);
    },
    onTick: (tick) => {
      byId("timer").textContent = `${tick.elapsedSeconds.toFixed(1)} s · ${tick.remainingSeconds.toFixed(1)} s remaining`;
      byId("warning").textContent = tick.countdown
        ? `${Math.ceil(tick.remainingSeconds)} seconds remaining`
        : tick.warning ? "Recording will stop in 10 seconds" : "";
    }
  });
  recorder = activeRecorder;
  try {
    await activeRecorder.start();
    if (recorder !== activeRecorder) {
      await activeRecorder.discard();
      return;
    }
    renderState(reduceRecorderState(uiState, "start"));
    if (!holdActive) finishRecording();
  } catch {
    if (recorder !== activeRecorder) return;
    recorder = undefined;
    holdActive = false;
    renderState("error", "Microphone access failed");
  }
};

const finishRecording = () => {
  if (uiState !== "recording" || !recorder) return;
  renderState(reduceRecorderState(uiState, "finalize"));
  void recorder.finalizeAndSend();
};

const cancelRecording = () => {
  holdActive = false;
  const activeRecorder = recorder;
  recorder = undefined;
  void activeRecorder?.discard();
  renderState("ready");
};

const initialize = () => {
  playback = createPlaybackController(audio());
  byId("connect").addEventListener("click", () => { void connect(); });
  byId("new-session").addEventListener("click", () => socket?.send(JSON.stringify({ op: "session.create", title: "Web voice session" })));
  byId("sessions").addEventListener("change", (event) => {
    const sid = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
    if (sid) { replayView = { assistant: "", sid, transcript: "" }; selectSession(sid); socket?.send(JSON.stringify({ op: "session.attach", sid })); }
  });
  recordButton().addEventListener("pointerdown", (event) => { holdActive = true; recordButton().setPointerCapture(event.pointerId); void startRecording(); });
  recordButton().addEventListener("pointerup", () => { holdActive = false; finishRecording(); });
  recordButton().addEventListener("pointercancel", cancelRecording);
  recordButton().addEventListener("lostpointercapture", () => { if (holdActive) cancelRecording(); });
  document.addEventListener("keydown", (event) => { if (event.code === "Space" && !event.repeat && shouldHandleSpace(event.target)) { event.preventDefault(); holdActive = true; void startRecording(); } });
  document.addEventListener("keyup", (event) => { if (event.code === "Space" && shouldHandleSpace(event.target)) { event.preventDefault(); holdActive = false; finishRecording(); } });
  byId("play").addEventListener("click", () => { void audio().play().then(() => renderState("playing")); });
  byId("stop").addEventListener("click", () => { playback?.stop(); byId("stop").hidden = true; byId("play").hidden = true; renderState("playback-ready"); });
  audio().addEventListener("ended", () => renderState("playback-ready"));
  window.addEventListener("pagehide", () => {
    gatewayToken = "";
    holdActive = false;
    const activeRecorder = recorder;
    recorder = undefined;
    void activeRecorder?.discard();
    playback?.cleanup();
    socket?.close();
  });
};

if (typeof document !== "undefined") initialize();
