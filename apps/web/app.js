// @ts-check

import { BrowserPttRecorder, reduceRecorderState } from "./recorder.js";

/** @typedef {{ sid?: string, transcript: string, assistant: string, audioRef?: string }} ReplayView */
/** @typedef {{ generation: number, sid: string }} SessionBinding */
/** @typedef {{ binding: SessionBinding, latestAudioRef: string | undefined }} ReplayBinding */
/** @typedef {{ generation: number, operation: SessionBinding | undefined, pendingCreateGeneration: number | undefined, replay: ReplayBinding | undefined, sid: string | undefined }} BrowserSessionState */

const operationStates = new Set(["recording", "uploading", "transcribing", "thinking", "synthesizing"]);
const sessionTransitionStates = new Set(["attaching", "creating"]);
/** @param {SessionBinding | undefined} left @param {SessionBinding | undefined} right */
const sameBinding = (left, right) => Boolean(left && right && left.generation === right.generation && left.sid === right.sid);
/** @param {unknown} value */
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** @returns {BrowserSessionState} */
export const createBrowserSessionState = () => ({
  generation: 0,
  operation: undefined,
  pendingCreateGeneration: undefined,
  replay: undefined,
  sid: undefined
});

/** @param {string} state */
export const canChangeSelectedSession = (state) => !operationStates.has(state) && !sessionTransitionStates.has(state);

/** @param {BrowserSessionState} state */
export const beginBrowserSessionCreate = (state) => {
  state.generation += 1;
  state.operation = undefined;
  state.replay = undefined;
  state.pendingCreateGeneration = state.generation;
  return state.generation;
};

/** @param {BrowserSessionState} state @param {string} sid */
export const acceptCreatedBrowserSession = (state, sid) => {
  if (state.pendingCreateGeneration !== state.generation) return undefined;
  state.sid = sid;
  state.pendingCreateGeneration = undefined;
  return { generation: state.generation, sid };
};

/** @param {BrowserSessionState} state @param {string} sid @param {boolean} [replay] */
export const selectBrowserSession = (state, sid, replay = true) => {
  state.generation += 1;
  const binding = { generation: state.generation, sid };
  state.sid = sid;
  state.operation = undefined;
  state.pendingCreateGeneration = undefined;
  state.replay = replay ? { binding, latestAudioRef: undefined } : undefined;
  return binding;
};

/** @param {BrowserSessionState} state */
export const currentBrowserSessionBinding = (state) => state.sid
  ? { generation: state.generation, sid: state.sid }
  : undefined;

/** @param {BrowserSessionState} state @param {SessionBinding | undefined} binding */
export const isCurrentBrowserSessionBinding = (state, binding) => Boolean(
  binding && state.sid === binding.sid && state.generation === binding.generation
);

/** @param {BrowserSessionState} state @param {SessionBinding} binding @param {string} artifactId @param {(frame: { audio_ref: string, op: "voice.asr", sid: string }) => void} send */
export const submitBrowserAsrForUpload = (state, binding, artifactId, send) => {
  if (!isCurrentBrowserSessionBinding(state, binding)) return false;
  send({ audio_ref: artifactId, op: "voice.asr", sid: binding.sid });
  return true;
};

/** @param {BrowserSessionState} state @param {SessionBinding} binding @param {string} url @param {(url: string) => void} replace */
export const replaceBrowserPlaybackForBinding = (state, binding, url, replace) => {
  if (!isCurrentBrowserSessionBinding(state, binding)) return false;
  replace(url);
  return true;
};

/** @param {BrowserSessionState} state */
export const beginBrowserSessionOperation = (state) => {
  const binding = currentBrowserSessionBinding(state);
  if (!binding || state.operation) return undefined;
  state.operation = binding;
  return binding;
};

/** @param {BrowserSessionState} state @param {SessionBinding | undefined} binding */
export const finishBrowserSessionOperation = (state, binding) => {
  if (sameBinding(state.operation, binding)) state.operation = undefined;
};

/** @param {BrowserSessionState} state */
export const invalidateBrowserSessionOperation = (state) => {
  state.generation += 1;
  state.operation = undefined;
  state.pendingCreateGeneration = undefined;
  state.replay = undefined;
  return currentBrowserSessionBinding(state);
};

/** @param {BrowserSessionState} state @param {unknown} value */
export const projectedFrameMatchesBrowserSession = (state, value) => {
  if (state.pendingCreateGeneration !== undefined || !isRecord(value)) return false;
  const frame = /** @type {Record<string, unknown>} */ (value);
  return typeof frame.sid === "string" && frame.sid === state.sid;
};

/** @param {BrowserSessionState} state @param {SessionBinding} binding @param {string} audioRef */
export const noteBrowserReplayAudio = (state, binding, audioRef) => {
  if (state.replay && sameBinding(state.replay.binding, binding) && isCurrentBrowserSessionBinding(state, binding)) {
    state.replay.latestAudioRef = audioRef;
  }
};

/** @param {BrowserSessionState} state @param {SessionBinding} binding */
export const completeBrowserReplay = (state, binding) => {
  if (!state.replay || !sameBinding(state.replay.binding, binding) || !isCurrentBrowserSessionBinding(state, binding)) {
    return undefined;
  }
  const audioRef = state.replay.latestAudioRef;
  state.replay = undefined;
  return audioRef;
};

/** @param {string} hash */
export const parseSessionHash = (hash) => {
  const match = hash.match(/^#\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})$/);
  return match?.[1];
};

/** @param {string} sid */
export const sessionHash = (sid) => `#/sessions/${sid}`;

/** @param {EventTarget | null} target */
export const shouldHandleSpace = (target) => {
  if (typeof Element === "undefined" || !(target instanceof Element)) return true;
  return !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) && !target.closest("[contenteditable='true']");
};

/** @param {ReplayView} view @param {unknown} value @param {string} [expectedSid] */
export const consumeProjectedEvent = (view, value, expectedSid) => {
  if (!isRecord(value)) return view;
  const event = /** @type {Record<string, unknown>} */ (value);
  if (expectedSid && event.sid !== expectedSid) return view;
  if (view.sid && typeof event.sid === "string" && event.sid !== view.sid) return view;
  const payload = isRecord(event.payload) ? /** @type {Record<string, unknown>} */ (event.payload) : {};
  const next = { ...view };
  if (!next.sid && typeof event.sid === "string") next.sid = event.sid;
  if (event.type === "speech.asr.final" && typeof payload.text === "string") next.transcript = payload.text;
  if (event.type === "turn.final" && typeof payload.text === "string") next.assistant = payload.text;
  if (event.type === "speech.tts.chunk" && typeof payload.audio_ref === "string") next.audioRef = payload.audio_ref;
  return next;
};

/** @param {unknown} value */
export const voiceAckFailureMessage = (value) => {
  if (!isRecord(value)) return undefined;
  const frame = /** @type {Record<string, unknown>} */ (value);
  if (frame.kind !== "ack" || frame.op !== "voice.asr") return undefined;
  if (frame.cancelled === true || frame.error_status === "asr_cancelled" || frame.error_category === "cancelled") {
    return "Voice processing was cancelled.";
  }
  if (frame.error_status === "asr_route_denied") return "Voice routing is unavailable for this recording.";
  if (frame.error_status === "asr_input_invalid") return "The recording could not be processed.";
  if (frame.error_status === "request_failed") {
    return typeof frame.assistant_final_text === "string" && frame.assistant_final_text.length > 0
      ? "The text answer is ready, but speech playback failed."
      : "The request could not be completed.";
  }
  if (frame.error_status !== "none") return "The request could not be completed.";
  return frame.asr_final_count === 1 && frame.turn_input_count === 1 && frame.model_request_count === 1
    ? undefined
    : "The request could not be completed.";
};

/** @param {unknown} value */
export const projectedEventFailureMessage = (value) => {
  if (!isRecord(value)) return undefined;
  const frame = /** @type {Record<string, unknown>} */ (value);
  if (frame.type === "error" || frame.type === "route.denied") return "The request could not be completed.";
  if (frame.type !== "progress.update" || !isRecord(frame.payload)) return undefined;
  const payload = /** @type {Record<string, unknown>} */ (frame.payload);
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  if (payload.error_code === undefined && !/(failed|denied)$/u.test(stage)) return undefined;
  return stage.includes("tts")
    ? "The text answer is ready, but speech playback failed."
    : "The request could not be completed.";
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
    cleanup() { this.stop(); }
  };
};

let gatewayToken = "";
/** @type {WebSocket | undefined} */
let socket;
/** @type {BrowserPttRecorder | undefined} */
let recorder;
let uiState = "disconnected";
let holdActive = false;
const browserSession = createBrowserSessionState();

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = () => byId("status");
const recordButton = () => /** @type {HTMLButtonElement} */ (byId("record"));
const newSessionButton = () => /** @type {HTMLButtonElement} */ (byId("new-session"));
const sessionSelect = () => /** @type {HTMLSelectElement} */ (byId("sessions"));
const resetButton = () => /** @type {HTMLButtonElement} */ (byId("reset"));
const replayLink = () => /** @type {HTMLAnchorElement} */ (byId("replay-link"));
const audio = () => /** @type {HTMLAudioElement} */ (byId("audio"));
/** @type {ReturnType<typeof createPlaybackController> | undefined} */
let playback;
/** @type {ReplayView} */
let replayView = { assistant: "", transcript: "" };

/** @param {string} state @param {string} [message] */
const renderState = (state, message) => {
  uiState = state;
  status().textContent = message ?? state.replaceAll("-", " ");
  recordButton().disabled = !browserSession.sid || !["ready", "playback-ready"].includes(state);
  recordButton().setAttribute("aria-pressed", String(state === "recording"));
  const sessionLocked = !canChangeSelectedSession(state);
  newSessionButton().disabled = sessionLocked;
  sessionSelect().disabled = sessionLocked;
  resetButton().hidden = state !== "failed";
};

const renderReplay = () => {
  byId("transcript").textContent = replayView.transcript || "—";
  byId("assistant").textContent = replayView.assistant || "—";
};

const clearPlayback = () => {
  playback?.stop();
  byId("play").hidden = true;
  byId("stop").hidden = true;
};

/** @param {SessionBinding} binding */
const renderSelectedSession = (binding) => {
  location.hash = sessionHash(binding.sid);
  byId("session").textContent = binding.sid;
  sessionSelect().value = binding.sid;
  replayLink().href = `/web/${sessionHash(binding.sid)}`;
  replayLink().hidden = false;
};

/** @param {SessionBinding} binding @param {string} message */
const failBoundOperation = (binding, message) => {
  if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
  finishBrowserSessionOperation(browserSession, binding);
  renderState("failed", message);
};

/** @param {SessionBinding} binding @param {string} artifactId */
const loadSpeech = async (binding, artifactId) => {
  if (!gatewayToken || !isCurrentBrowserSessionBinding(browserSession, binding)) return;
  renderState("synthesizing");
  try {
    const response = await fetch(`/web/api/sessions/${binding.sid}/speech/${artifactId}`, {
      headers: { Authorization: `Bearer ${gatewayToken}` }
    });
    if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
    if (!response.ok) {
      failBoundOperation(binding, "Speech playback is unavailable.");
      return;
    }
    const blob = await response.blob();
    if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
    const url = URL.createObjectURL(blob);
    if (!replaceBrowserPlaybackForBinding(browserSession, binding, url, (currentUrl) => playback?.replace(currentUrl))) {
      URL.revokeObjectURL(url);
      return;
    }
    byId("stop").hidden = false;
    byId("play").hidden = true;
    try {
      await audio().play();
      if (isCurrentBrowserSessionBinding(browserSession, binding)) renderState("playing");
    } catch {
      if (isCurrentBrowserSessionBinding(browserSession, binding)) {
        byId("play").hidden = false;
        renderState("playback-ready", "Audio is ready");
      }
    }
  } catch {
    failBoundOperation(binding, "Speech playback is unavailable.");
  }
};

/** @param {SessionBinding} binding */
const activateCreatedSession = (binding) => {
  clearPlayback();
  replayView = { assistant: "", sid: binding.sid, transcript: "" };
  renderReplay();
  renderSelectedSession(binding);
  renderState("ready");
};

/** @param {string} sid */
const selectSession = (sid) => {
  if (!canChangeSelectedSession(uiState)) {
    sessionSelect().value = browserSession.sid ?? "";
    return false;
  }
  const binding = selectBrowserSession(browserSession, sid, true);
  clearPlayback();
  replayView = { assistant: "", sid, transcript: "" };
  renderReplay();
  renderSelectedSession(binding);
  renderState("attaching", "Loading canonical session…");
  socket?.send(JSON.stringify({ op: "session.attach", sid }));
  return true;
};

/** @param {unknown} value */
const receive = (value) => {
  if (!isRecord(value)) return;
  const frame = /** @type {Record<string, unknown>} */ (value);
  if (frame.type === "session.created" && typeof frame.sid === "string") {
    const created = acceptCreatedBrowserSession(browserSession, frame.sid);
    if (created) {
      activateCreatedSession(created);
      return;
    }
  }
  if (frame.kind === "op-error") {
    if (typeof frame.sid === "string" && frame.sid !== browserSession.sid) return;
    const relevant = (frame.op === "session.create" && browserSession.pendingCreateGeneration !== undefined)
      || (frame.op === "session.attach" && browserSession.replay !== undefined)
      || (frame.op === "voice.asr" && browserSession.operation !== undefined);
    if (relevant) {
      const binding = currentBrowserSessionBinding(browserSession);
      if (binding) failBoundOperation(binding, "The request could not be completed.");
      else renderState("failed", "The request could not be completed.");
    }
    return;
  }
  if (!projectedFrameMatchesBrowserSession(browserSession, frame)) return;
  const binding = currentBrowserSessionBinding(browserSession);
  if (!binding) return;
  const beforeAudio = replayView.audioRef;
  replayView = consumeProjectedEvent(replayView, frame, binding.sid);
  renderReplay();

  if (browserSession.replay) {
    if (frame.type === "speech.tts.chunk" && replayView.audioRef) {
      noteBrowserReplayAudio(browserSession, binding, replayView.audioRef);
    }
    if (frame.type === "session.resumed") {
      const replayAudioRef = completeBrowserReplay(browserSession, binding);
      renderState("ready");
      if (replayAudioRef) void loadSpeech(binding, replayAudioRef);
    }
    return;
  }

  const eventFailure = projectedEventFailureMessage(frame);
  if (eventFailure) {
    failBoundOperation(binding, eventFailure);
    return;
  }
  if (frame.type === "speech.asr.final") renderState("thinking");
  if (frame.type === "turn.final") renderState("synthesizing");
  if (frame.type === "speech.tts.chunk" && replayView.audioRef && replayView.audioRef !== beforeAudio) {
    void loadSpeech(binding, replayView.audioRef);
  }
  if (frame.kind === "ack" && frame.op === "voice.asr") {
    const operation = browserSession.operation;
    if (!sameBinding(operation, binding)) return;
    const failure = voiceAckFailureMessage(frame);
    finishBrowserSessionOperation(browserSession, binding);
    if (failure) renderState("failed", failure);
    else if (typeof frame.tts_audio_ref !== "string") renderState("ready");
  }
};

const fetchSessions = async () => {
  const response = await fetch("/sessions", { headers: { Authorization: `Bearer ${gatewayToken}` } });
  if (!response.ok) throw new Error("Session list unavailable");
  const body = await response.json();
  const select = sessionSelect();
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
    try {
      await fetchSessions();
    } catch {
      renderState("failed", "Session list is unavailable.");
      return;
    }
    const sid = parseSessionHash(location.hash);
    if (sid) selectSession(sid);
  });
  socket.addEventListener("message", (event) => {
    try { receive(JSON.parse(String(event.data))); }
    catch { renderState("failed", "Gateway response was invalid."); }
  });
  socket.addEventListener("close", () => {
    gatewayToken = "";
    holdActive = false;
    invalidateBrowserSessionOperation(browserSession);
    const activeRecorder = recorder;
    recorder = undefined;
    void activeRecorder?.discard();
    clearPlayback();
    renderState("disconnected");
    byId("connect-panel").hidden = false;
    byId("session-panel").hidden = true;
  });
};

/** @param {Uint8Array} wav @param {SessionBinding} binding */
const upload = async (wav, binding) => {
  if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
  renderState("uploading");
  try {
    const response = await fetch(`/web/api/sessions/${binding.sid}/input-audio`, {
      body: /** @type {BodyInit} */ (wav),
      headers: { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "audio/wav" },
      method: "POST"
    });
    if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
    if (!response.ok) {
      failBoundOperation(binding, "Recording was not accepted.");
      return;
    }
    const result = await response.json();
    if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
    if (!isRecord(result) || typeof result.artifact_id !== "string") {
      failBoundOperation(binding, "Recording response was invalid.");
      return;
    }
    renderState("transcribing");
    submitBrowserAsrForUpload(browserSession, binding, result.artifact_id, (frame) => socket?.send(JSON.stringify(frame)));
  } catch {
    failBoundOperation(binding, "Recording was not accepted.");
  }
};

const startRecording = async () => {
  if (!["ready", "playback-ready"].includes(uiState) || recorder) return;
  const binding = beginBrowserSessionOperation(browserSession);
  if (!binding) return;
  clearPlayback();
  renderState(reduceRecorderState(uiState, "start"));
  const activeRecorder = new BrowserPttRecorder({
    onDiscard: () => {
      if (recorder === activeRecorder) recorder = undefined;
      if (isCurrentBrowserSessionBinding(browserSession, binding)) {
        finishBrowserSessionOperation(browserSession, binding);
        renderState("ready");
      }
    },
    onFinalize: async (wav) => {
      if (recorder === activeRecorder) recorder = undefined;
      await upload(wav, binding);
    },
    onTick: (tick) => {
      if (!isCurrentBrowserSessionBinding(browserSession, binding)) return;
      byId("timer").textContent = `${tick.elapsedSeconds.toFixed(1)} s · ${tick.remainingSeconds.toFixed(1)} s remaining`;
      byId("warning").textContent = tick.countdown
        ? `${Math.ceil(tick.remainingSeconds)} seconds remaining`
        : tick.warning ? "Recording will stop in 10 seconds" : "";
    }
  });
  recorder = activeRecorder;
  try {
    await activeRecorder.start();
    if (recorder !== activeRecorder || !isCurrentBrowserSessionBinding(browserSession, binding)) {
      await activeRecorder.discard();
      return;
    }
    if (!holdActive) finishRecording();
  } catch {
    if (recorder !== activeRecorder) return;
    recorder = undefined;
    holdActive = false;
    failBoundOperation(binding, "Microphone access failed.");
  }
};

const finishRecording = () => {
  if (uiState !== "recording" || !recorder) return;
  renderState(reduceRecorderState(uiState, "finalize"));
  void recorder.finalizeAndSend();
};

const cancelRecording = () => {
  holdActive = false;
  const binding = browserSession.operation;
  const activeRecorder = recorder;
  recorder = undefined;
  void activeRecorder?.discard();
  finishBrowserSessionOperation(browserSession, binding);
  if (binding && isCurrentBrowserSessionBinding(browserSession, binding)) renderState("ready");
};

const resetLocalFailure = () => {
  holdActive = false;
  const activeRecorder = recorder;
  recorder = undefined;
  void activeRecorder?.discard();
  invalidateBrowserSessionOperation(browserSession);
  clearPlayback();
  byId("warning").textContent = "";
  byId("timer").textContent = "0.0 s · 60.0 s remaining";
  renderState("ready");
};

const beginSessionCreate = () => {
  if (!canChangeSelectedSession(uiState)) return;
  beginBrowserSessionCreate(browserSession);
  clearPlayback();
  replayView = { assistant: "", transcript: "" };
  renderReplay();
  byId("session").textContent = "Creating…";
  renderState("creating", "Creating session…");
  socket?.send(JSON.stringify({ op: "session.create", title: "Web voice session" }));
};

const initialize = () => {
  playback = createPlaybackController(audio());
  byId("connect").addEventListener("click", () => { void connect(); });
  newSessionButton().addEventListener("click", beginSessionCreate);
  sessionSelect().addEventListener("change", (event) => {
    const sid = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
    if (sid) selectSession(sid);
  });
  replayLink().addEventListener("click", (event) => {
    if (!browserSession.sid) return;
    event.preventDefault();
    location.hash = sessionHash(browserSession.sid);
    location.reload();
  });
  resetButton().addEventListener("click", resetLocalFailure);
  recordButton().addEventListener("pointerdown", (event) => {
    holdActive = true;
    recordButton().setPointerCapture(event.pointerId);
    void startRecording();
  });
  recordButton().addEventListener("pointerup", () => { holdActive = false; finishRecording(); });
  recordButton().addEventListener("pointercancel", cancelRecording);
  recordButton().addEventListener("lostpointercapture", () => { if (holdActive) cancelRecording(); });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat && shouldHandleSpace(event.target)) {
      event.preventDefault();
      holdActive = true;
      void startRecording();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space" && shouldHandleSpace(event.target)) {
      event.preventDefault();
      holdActive = false;
      finishRecording();
    }
  });
  byId("play").addEventListener("click", () => {
    void audio().play().then(() => renderState("playing")).catch(() => renderState("failed", "Speech playback is unavailable."));
  });
  byId("stop").addEventListener("click", () => {
    clearPlayback();
    renderState("ready");
  });
  audio().addEventListener("ended", () => renderState("playback-ready"));
  window.addEventListener("pagehide", () => {
    gatewayToken = "";
    holdActive = false;
    invalidateBrowserSessionOperation(browserSession);
    const activeRecorder = recorder;
    recorder = undefined;
    void activeRecorder?.discard();
    clearPlayback();
    socket?.close();
  });
};

if (typeof document !== "undefined") initialize();
