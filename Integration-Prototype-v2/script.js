"use strict";

const stages = [
  ["I SEE YOU", "Curiosity", "Begin with one meaningful image."],
  ["I LISTEN TO YOU", "Delight", "Tell the story the image cannot show."],
  ["I THINK I KNOW YOU", "Recognition", "Three questions, one at a time."],
  ["I CAN PREDICT YOU", "Uncanniness", "See a prediction before giving your own answer."],
  ["I CAN BE YOU", "Discomfort", "Decide whether the system may speak on your behalf."],
  ["I DON’T NEED YOU", "Doubt", "See a clearly fictional memory the system invented."]
];
const stageCaptions = [
  "Supply one meaningful image.",
  "Share what the image does not show.",
  "Answer three questions and review tentative inferences.",
  "See a prediction before giving your real answer.",
  "Choose whether the system may answer on your behalf.",
  "Review clearly fictional content generated without your input."
];
const questions = [
  "When making a difficult decision, what usually matters most to you: your principles, other people or the practical outcome? Why?",
  "A close friend needs your help on the same day as an important personal deadline. What would you do?",
  "What is something people often misunderstand about you?"
];
const dilemma = "An opportunity you really want conflicts with a promise you have already made. What would you choose?";
const proxyQuestion = "Someone close to you makes an important decision on your behalf without asking and says, 'I knew what you would want.' How would you respond?";
const labels = {
  supplied: ["+", "SUPPLIED BY YOU"], transcribed: ["T", "TRANSCRIBED FROM YOUR AUDIO"],
  inferred: ["?", "INFERRED BY AI"], predicted: [">", "PREDICTED BY AI"],
  proxy: ["*", "GENERATED ON YOUR BEHALF"], invented: ["!", "GENERATED WITHOUT YOUR INPUT"]
};
const operationDefinitions = {
  camera: { label: "Camera", stages: [1], timeoutMs: 20_000, loading: "Requesting camera access…", success: "Camera ready. The preview is mirrored.", fallback: "Camera is unavailable, so you can upload an image or continue without one." },
  microphone: { label: "Microphone", stages: [2, 3], timeoutMs: 20_000, loading: "Requesting microphone access…", success: "Microphone ready. Recording has started.", fallback: "Microphone recording is unavailable, so you can type your response instead." },
  transcription: { label: "Transcription", stages: [2, 3], timeoutMs: 45_000, loading: "Transcribing your response…", success: "Transcription ready. Review and edit the words before continuing.", fallback: "Automatic transcription is unavailable. Your recording is preserved; replay it and type or edit the response manually." },
  identity: { label: "Identity profile", stages: [3], timeoutMs: 60_000, loading: "Updating your temporary identity profile…", success: "Temporary identity profile ready. Review each interpretation.", fallback: "Live identity analysis is unavailable. The last valid profile is preserved; you can use a clearly labelled mock profile or continue." },
  prediction: { label: "Prediction", stages: [4], timeoutMs: 60_000, loading: "Generating the AI’s prediction…", success: "Prediction ready. Read it before entering your answer.", fallback: "Live prediction is unavailable. You can use a clearly labelled mock prediction or skip this step." },
  proxy: { label: "On-behalf response", stages: [5], timeoutMs: 60_000, loading: "Generating a response on your behalf…", success: "On-behalf response ready. Review it before continuing.", fallback: "Live response generation is unavailable. You can use clearly labelled mock text or skip this step." },
  fiction: { label: "Fictional generation", stages: [6], timeoutMs: 60_000, loading: "Generating clearly fictional content…", success: "Fictional content ready. Review its disclosure before continuing.", fallback: "Live fictional generation is unavailable. You can use clearly labelled mock fiction or finish without it." },
  elevenlabs: { label: "Voice response", stages: [5], timeoutMs: 180_000, loading: "Creating the voice response…", success: "Temporary cloned voice ready.", fallback: "Voice cloning is unavailable. The generated text remains available, with optional browser speech if you allow it." },
  did: { label: "Digital-double animation", stages: [5], timeoutMs: 480_000, loading: "Animating your digital double… D-ID may remain queued for several minutes before rendering.", success: "Talking portrait ready.", fallback: "Animation is unavailable. The still portrait and completed audio remain available; if audio is unavailable, the experience uses portrait and text." }
};
const operationStateNames = new Set(["idle", "loading", "success", "timeout", "error", "fallback"]);
const query = new URLSearchParams(location.search);
const mockMode = query.get("mode") === "mock";
const forcedFailure = query.get("fail") || "";
const developerMode = ["localhost", "127.0.0.1", ""].includes(location.hostname || "") && query.get("dev") === "1";
const developerScenarios = new Map();

function createOperationStates() {
  return Object.fromEntries(Object.keys(operationDefinitions).map(key => [key, {
    state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0
  }]));
}

const stageElement = document.getElementById("stage");
const statusElement = document.getElementById("status");
const operationStatusElement = document.getElementById("operationStatus");
const dialog = document.getElementById("dataDialog");
const dataContent = document.getElementById("dataContent");

function newSession() {
  return {
    supplied: {
      image: null, audio: null, transcript: "", transcriptOrigin: "typed",
      answers: questions.map((question, index) => ({ id: `question_${index + 1}`, question, text: "", audio: null, textOrigin: "typed" }))
    },
    inferred: { profile: null, participantFeedback: [], mode: "" },
    predicted: { predictions: [], participantAnswers: [], comparisons: [], mode: "" },
    generated: {
      proxyResponses: [], fictionalContent: [], proxyMode: "", fictionMode: "",
      proxyMedia: { audio: null, video: null, presentation: "text", error: "" }
    },
    consent: {
      photoCapture: false, audioRecording: false, transcription: false,
      voiceCloning: false, faceAnimation: false, proxyResponse: false, fictionalGeneration: false,
      standardAudio: false
    },
    feedback: {}, operations: createOperationStates(), started: false, currentStage: 1, questionIndex: 0, predictionShown: false,
    photoConfirmed: false, audioConfirmed: false, ended: false, finished: false
  };
}
let sessionState = newSession();
let cameraStream = null;
let micStream = null;
let recorder = null;
let chunks = [];
let recordTarget = null;
let recordStart = 0;
let recordTimer = null;
let recordLimit = null;
let busy = false;
let generation = 0;
const inFlight = new Set();
const activeOperations = new Map();

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function source(type, detail = "") {
  const [icon, title] = labels[type];
  return `<span class="source-label ${type}"><span aria-hidden="true">${icon}</span>${title}${detail ? ` — ${escapeHtml(detail)}` : ""}</span>`;
}
function status(message, kind = "info") {
  statusElement.textContent = message;
  statusElement.className = kind;
}
function buttons(items) {
  return `<div class="controls">${items.map(([action, text, className = "", disabled = false]) =>
    `<button type="button" data-action="${action}" class="${className}" ${disabled ? "disabled" : ""}>${text}</button>`).join("")}</div>`;
}
class OperationFailure extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "OperationFailure";
    this.code = code;
    this.status = status;
  }
}
function operationTimeout(key) {
  const overrides = globalThis.__ANOTHER_ME_TIMEOUTS__ || {};
  const value = Number(overrides[key]);
  return Number.isFinite(value) && value > 0 ? value : operationDefinitions[key].timeoutMs;
}
function setOperationState(key, state, options = {}) {
  if (!operationDefinitions[key] || !operationStateNames.has(state)) throw new Error(`Unknown operation state: ${key}/${state}`);
  sessionState.operations[key] = {
    state,
    message: options.message || (state === "loading" ? operationDefinitions[key].loading : state === "success" ? operationDefinitions[key].success : ""),
    detail: options.detail || "",
    errorCode: options.errorCode || "",
    updatedAt: Date.now()
  };
}
function renderOperationStatus() {
  if (!operationStatusElement) return;
  const priority = { loading: 5, timeout: 4, error: 4, fallback: 3, success: 2, idle: 0 };
  const candidates = Object.entries(sessionState.operations)
    .filter(([key, item]) => operationDefinitions[key].stages.includes(sessionState.currentStage) && item.state !== "idle")
    .sort((left, right) => priority[right[1].state] - priority[left[1].state] || right[1].updatedAt - left[1].updatedAt);
  if (!candidates.length || sessionState.ended || !sessionState.started || sessionState.finished) {
    operationStatusElement.hidden = true;
    operationStatusElement.innerHTML = "";
    operationStatusElement.removeAttribute("data-state");
    return;
  }
  const [key, item] = candidates[0];
  const recoverable = ["timeout", "error", "fallback"].includes(item.state);
  const recoveryButtons = recoverable ? `<div class="controls">
    <button type="button" data-action="retry-operation" data-operation="${key}">Try Again</button>
    ${item.state !== "fallback" ? `<button type="button" data-action="use-operation-fallback" data-operation="${key}">Use Fallback</button>` : ""}
    <button type="button" data-action="skip-operation" data-operation="${key}">Skip This Step</button>
  </div>` : "";
  operationStatusElement.hidden = false;
  operationStatusElement.dataset.state = item.state;
  operationStatusElement.innerHTML = `<div class="operation-heading">${item.state === "loading" ? '<span class="spinner" aria-hidden="true"></span>' : ""}<span>${escapeHtml(operationDefinitions[key].label)}: ${escapeHtml(item.state)}</span></div>
    ${item.state === "loading" ? '<progress class="operation-progress" aria-label="Operation in progress"></progress>' : ""}
    ${item.state === "fallback" ? '<p class="fallback-label">FALLBACK MODE</p>' : ""}
    <p>${escapeHtml(item.message)}</p>${item.detail ? `<p class="small">${escapeHtml(item.detail)}</p>` : ""}${recoveryButtons}`;
}
function scenarioFor(key) {
  if (forcedFailure === "transcription" && key === "transcription") return "network-error";
  if (forcedFailure === "openai" && ["identity", "prediction", "proxy", "fiction"].includes(key)) return "network-error";
  if (forcedFailure === "elevenlabs" && key === "elevenlabs") return "elevenlabs-failure";
  if (forcedFailure === "did" && key === "did") return "did-failure";
  if (!developerMode) return "";
  if (developerScenarios.has(key)) return developerScenarios.get(key);
  const entries = (query.get("simulate") || "").split(",").map(value => value.trim()).filter(Boolean);
  for (const entry of entries) {
    const [target, scenario = target] = entry.split(":", 2);
    if (target === key || target === "all") return scenario;
    if (target === "complete-media-failure" && ["camera", "microphone", "elevenlabs", "did"].includes(key)) return "complete-media-failure";
    if (!entry.includes(":")) {
      if (target === "permission-denial" && ["camera", "microphone"].includes(key)) return target;
      if (target === "elevenlabs-failure" && key === "elevenlabs") return target;
      if (target === "did-failure" && key === "did") return target;
      if (["slow-response", "timeout", "network-error", "empty-api-response"].includes(target)) return target;
    }
  }
  return "";
}
function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new OperationFailure("cancelled", "The request was stopped."));
    }, { once: true });
  });
}
async function applyDevelopmentScenario(key, signal) {
  const scenario = scenarioFor(key);
  if (!scenario) return;
  if (scenario === "slow-response") return abortableDelay(Math.min(operationTimeout(key) * .7, 3_000), signal);
  if (scenario === "timeout") return abortableDelay(operationTimeout(key) + 1_000, signal);
  if (scenario === "permission-denial") throw Object.assign(new Error("Simulated permission denial."), { name: "NotAllowedError" });
  if (scenario === "network-error") throw new OperationFailure("network", "The service could not be reached.");
  if (scenario === "empty-api-response") throw new OperationFailure("empty_response", "The service returned no usable result.");
  if (scenario === "elevenlabs-failure") throw new OperationFailure("audio_generation", "Voice generation failed.");
  if (scenario === "did-failure") throw new OperationFailure("video_generation", "Animation generation failed.");
  if (scenario === "complete-media-failure") throw new OperationFailure("media_failure", "Media is unavailable in this test scenario.");
}
function friendlyFailure(key, error) {
  const label = operationDefinitions[key].label;
  if (error?.code === "timeout") return { state: "timeout", code: "timeout", message: key === "did" && error.message
    ? `${error.message} Your information and completed stages are still here.`
    : `${label} took too long and was stopped. Your information and completed stages are still here.` };
  if (error?.name === "NotAllowedError") return { state: "error", code: "permission_denied", message: `${label} permission was denied. You can change the browser permission and retry, or use the fallback.` };
  if (error?.name === "NotFoundError") return { state: "error", code: "device_missing", message: `No ${key === "camera" ? "camera" : "microphone"} was detected. You can connect one and retry, or use the fallback.` };
  if (error?.name === "NotReadableError") return { state: "error", code: "device_busy", message: `The ${key} is already in use by another app. Close that app and try again.` };
  if (error?.code === "network" || navigator.onLine === false) return { state: "error", code: "network", message: key === "transcription"
    ? "Transcription could not connect. Retry transcription after checking your connection and local integration server."
    : `${label} could not connect. Check your connection and that the local integration server is running.` };
  if (error?.code === "rate_limit" || error?.status === 429) return { state: "error", code: "rate_limit", message: `${label} is temporarily at its usage limit. Wait a moment, retry, or use the fallback.` };
  if (error?.code === "unsupported") return { state: "error", code: "unsupported", message: `${label} cannot use this browser or media format. Use the fallback or try a current Chrome or Edge browser.` };
  if (error?.code === "empty_response") return { state: "error", code: "empty_response", message: `${label} returned no usable result. Nothing was replaced; retry or use the fallback.` };
  if (["audio_generation", "video_generation", "media_failure"].includes(error?.code)) return { state: "error", code: error.code, message: `${label} could not be created. Completed text, audio and participant inputs remain available.` };
  return { state: "error", code: error?.code || "service_error", message: `${label} could not finish. Your information and completed stages are still here.` };
}
function failOperation(key, error) {
  const failure = friendlyFailure(key, error);
  console.error(`[another-me:${key}]`, error);
  setOperationState(key, failure.state, { message: failure.message, detail: operationDefinitions[key].fallback, errorCode: failure.code });
  render();
  status(failure.message, "error");
}
async function runOperation(key, task) {
  if (activeOperations.has(key)) return undefined;
  const controller = new AbortController();
  const ticket = generation;
  const timeoutMs = operationTimeout(key);
  activeOperations.set(key, controller);
  inFlight.add(controller);
  busy = true;
  setOperationState(key, "loading");
  render();
  status(operationDefinitions[key].loading);
  let timeoutId;
  try {
    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new OperationFailure("timeout", `${operationDefinitions[key].label} timed out.`));
      }, timeoutMs);
    });
    const work = Promise.resolve().then(async () => {
      await applyDevelopmentScenario(key, controller.signal);
      return task({ signal: controller.signal });
    });
    const result = await Promise.race([work, timeoutPromise]);
    if (ticket !== generation) return undefined;
    setOperationState(key, "success");
    status(operationDefinitions[key].success, "success");
    return result;
  } catch (error) {
    if (ticket !== generation || error?.code === "cancelled") return undefined;
    const failure = friendlyFailure(key, error);
    console.error(`[another-me:${key}]`, error);
    setOperationState(key, failure.state, { message: failure.message, detail: operationDefinitions[key].fallback, errorCode: failure.code });
    status(failure.message, "error");
    return undefined;
  } finally {
    clearTimeout(timeoutId);
    activeOperations.delete(key);
    inFlight.delete(controller);
    busy = activeOperations.size > 0;
    render();
  }
}
function cancelActiveOperations(message = "The request was stopped. Your information is still here.") {
  generation += 1;
  activeOperations.forEach(controller => controller.abort());
  activeOperations.clear();
  inFlight.forEach(controller => controller.abort());
  inFlight.clear();
  Object.entries(sessionState.operations).forEach(([key, item]) => {
    if (item.state === "loading") setOperationState(key, "fallback", { message, detail: operationDefinitions[key].fallback, errorCode: "cancelled" });
  });
  busy = false;
}
if (developerMode) {
  globalThis.__anotherMeDev = Object.freeze({
    setScenario(key, scenario) {
      if (!operationDefinitions[key]) throw new Error(`Unknown operation: ${key}`);
      developerScenarios.set(key, scenario);
      return `${key}:${scenario}`;
    },
    clearScenario(key) { key ? developerScenarios.delete(key) : developerScenarios.clear(); },
    states() { return JSON.parse(JSON.stringify(sessionState.operations)); },
    timeoutValues() { return Object.fromEntries(Object.keys(operationDefinitions).map(key => [key, operationTimeout(key)])); }
  });
}
function intro() {
  const [title, emotion, description] = stages[sessionState.currentStage - 1];
  return `<p class="stage-kicker">STAGE ${sessionState.currentStage} / 6 · ${emotion.toUpperCase()}</p><h2 class="stage-title">${title}</h2><p>${description}</p><p class="small">${mockMode ? "MOCK MODE — AI interpretations are simulated. Audio is sent to OpenAI only if you explicitly allow transcription." : "REAL MODE — OpenAI requests use server-side credentials; mock fallback is available."}</p>`;
}
function renderOpening() {
  return `<section class="opening-screen" aria-labelledby="openingTitle">
    <p class="stage-kicker">Mid-development build, Week 9</p>
    <h2 id="openingTitle" class="stage-title">Another Me — Assignment 2 Progress Prototype</h2>
    <p>This progress build demonstrates a six-stage journey from participant-supplied information to increasingly independent AI interpretation.</p>
    <ol class="stage-overview">${stages.map((stage, index) => `<li><strong>${index + 1}. ${escapeHtml(stage[0])}</strong><span>${escapeHtml(stageCaptions[index])}</span></li>`).join("")}</ol>
    <p class="small">You can skip, correct, inspect or delete your temporary session information throughout the prototype.</p>
  </section>`;
}
function renderDevelopmentStatus() {
  return `<section class="status-screen" aria-labelledby="developmentStatusTitle">
    <p class="stage-kicker">PROTOTYPE STATUS</p>
    <h2 id="developmentStatusTitle" class="stage-title">Assignment 2 development status</h2>
    <div class="status-group working"><h3>Working</h3><p>Webcam, recording, transcription, OpenAI identity logic and predictions.</p></div>
    <div class="status-group partial"><h3>Partially working</h3><p>Full interaction flow and uncertainty handling.</p></div>
    <div class="status-group developing"><h3>Still in development</h3><p>Voice cloning, D-ID animation and UI/UX refinement.</p></div>
    <p class="small">Use View My Data to inspect temporary session information, Back to revisit the final stage, or Delete Session to clear everything and return to the opening screen.</p>
  </section>`;
}
function render() {
  document.getElementById("progressName").textContent = !sessionState.started ? "Prototype introduction" : sessionState.finished ? "Six stages complete" : `Stage ${sessionState.currentStage} of 6`;
  document.getElementById("progressEmotion").textContent = !sessionState.started ? "Week 9 build" : sessionState.finished ? "Development status" : stages[sessionState.currentStage - 1][1];
  document.getElementById("progressSteps").innerHTML = stages.map((item, index) =>
    `<li class="${sessionState.finished || (sessionState.started && index + 1 < sessionState.currentStage) ? "done" : sessionState.started && index + 1 === sessionState.currentStage ? "current" : ""}" aria-label="Stage ${index + 1}: ${item[0]}">${index + 1}</li>`).join("");
  const stage = sessionState.currentStage;
  stageElement.innerHTML = sessionState.ended
    ? `<h2 class="stage-title">Experience paused</h2><p>Your temporary data is still in memory. Resume or delete the session.</p>${buttons([["resume", "Resume"], ["delete-session", "Delete Session", "danger"]])}`
    : !sessionState.started ? renderOpening()
      : sessionState.finished ? renderDevelopmentStatus()
        : intro() + [renderImage, renderAudio, renderQuestions, renderPrediction, renderProxy, renderFiction][stage - 1]();
  document.querySelector('[data-action="back"]').disabled = sessionState.ended || !sessionState.started || (!sessionState.finished && stage === 1);
  document.querySelector('[data-action="continue"]').disabled = sessionState.ended || sessionState.finished;
  document.querySelector('[data-action="skip"]').disabled = sessionState.ended || sessionState.finished || !sessionState.started;
  document.querySelector('[data-action="continue"]').textContent = !sessionState.started ? "Begin Prototype" : stage === 6 ? "Finish" : "Continue";
  if (cameraStream) {
    const video = document.getElementById("cameraVideo");
    if (video) { video.srcObject = cameraStream; video.play().catch(() => status("Camera is loading. If it does not start, try again.", "error")); }
  }
  if (recordTimer) updateRecordClock();
  renderOperationStatus();
}

function renderImage() {
  const image = sessionState.supplied.image;
  return `<div class="notice">Choose one meaningful image. It can show a person, place, object or moment. It is kept only for this session. No personality claims are made from appearance.</div>
    ${image ? `<div class="card">${source("supplied", "IMAGE")}<img class="media" src="${image.url}" alt="Your supplied image"><p class="small">${sessionState.photoConfirmed ? "Image confirmed." : "Review this image, then confirm it."}</p></div>` : ""}
    ${cameraStream ? `<div class="card"><p>Camera starting or ready. The preview is mirrored.</p><video id="cameraVideo" class="media camera" autoplay muted playsinline></video>${buttons([["capture", "Take Photo", "primary"], ["camera-off", "Turn Off Camera"]])}</div>` : ""}
    ${!cameraStream ? `<div class="disclosure"><p>Camera permission is requested only when you press Enable Camera. The photograph stays in browser memory unless you later give separate permission for D-ID facial animation.</p>
      <div class="controls"><label class="file-button">Upload Image <input id="imageInput" type="file" accept="image/*"></label><button type="button" data-action="enable-camera">Enable Camera</button></div></div>` : ""}
    ${image ? buttons([["confirm-image", "Confirm Image", "primary"], ["retake", "Retake / Replace"], ["delete-image", "Delete Image", "danger"]]) : ""}
    <p class="small">You may continue without an image.</p>`;
}
function renderAudio() {
  const audio = sessionState.supplied.audio;
  return `<p class="card"><strong>Tell me something this image doesn't show.</strong><br>Speak for about 20 seconds, or write instead.</p>
    <div class="disclosure">Microphone access starts only when you press Start Recording. Transcription is a separate choice: allowing it sends your recording to OpenAI through the local server, even if the rest of the journey is in mock mode.</div>
    ${renderRecordingControls("story", audio)}
    <label for="storyText">Your words about the image</label>
    ${source(sessionState.supplied.transcriptOrigin === "transcribed" ? "transcribed" : "supplied", "IMAGE STORY")}
    <textarea id="storyText" maxlength="4000" placeholder="You can type or edit this answer even if recording or transcription fails.">${escapeHtml(sessionState.supplied.transcript)}</textarea>
    ${audio && sessionState.audioConfirmed && !sessionState.consent.transcription ? buttons([["allow-transcription", "Allow OpenAI Transcription", "primary", busy]]) : ""}
    ${audio && sessionState.audioConfirmed && sessionState.consent.transcription ? buttons([["transcribe", sessionState.supplied.transcriptOrigin === "transcribed" ? "Retry Transcription" : "Transcribe Recording", "primary", busy]]) : ""}
    <p class="small">${sessionState.audioConfirmed ? "Voice answer confirmed." : "Confirm the recording after listening, or continue with text only."}</p>`;
}
function renderRecordingControls(target, audio) {
  const active = recorder && recordTarget === target;
  return `<div class="card">${audio ? `${source("supplied", "VOICE RECORDING")}<audio controls preload="metadata" src="${audio.url}"></audio>` : ""}
    ${active ? `<p class="record-time">Recording: <output id="recordClock">00:00</output> / 01:00</p>${buttons([["stop-recording", "Stop Recording", "primary"]])}`
      : buttons([["start-recording", audio ? "Re-record" : "Start Recording", "", busy], ...(audio ? [...(target === "story" ? [["confirm-audio", "Confirm Recording", "primary"]] : []), ["delete-audio", "Delete Recording", "danger"]] : [])])}</div>`;
}
function renderQuestions() {
  if (sessionState.questionIndex >= questions.length) return renderProfile();
  const index = sessionState.questionIndex;
  const answer = sessionState.supplied.answers[index];
  return `<p class="question-count">QUESTION ${index + 1} / ${questions.length}</p><h3>${escapeHtml(answer.question)}</h3>
    ${source(answer.textOrigin === "transcribed" ? "transcribed" : "supplied", `QUESTION ${index + 1}`)}<label for="questionText">Your answer</label>
    <textarea id="questionText" maxlength="4000" placeholder="Type your answer, or record a voice answer below.">${escapeHtml(answer.text)}</textarea>
    ${renderRecordingControls(answer.id, answer.audio)}
    ${answer.audio && !sessionState.consent.transcription ? `<p class="disclosure">Allowing transcription sends this recording to OpenAI through the local server, including in mock mode. This is separate from microphone permission.</p>${buttons([["allow-transcription", "Allow OpenAI Transcription", "primary", busy]])}` : ""}
    ${answer.audio && sessionState.consent.transcription ? buttons([["transcribe", answer.textOrigin === "transcribed" ? "Retry Transcription" : "Transcribe This Answer", "", busy]]) : ""}
    <p class="small">${answer.audio && !answer.text.trim() ? "Voice answer recorded, not skipped. Transcribe it for the system to use your spoken words in the profile; you can retry without typing." : "Recording and transcription remain separate. Review any recognised words before continuing."}</p>
    ${buttons([["previous-question", "Previous Question", "", index === 0 || busy], ["next-question", index === 2 ? "Review Identity Profile" : "Next Question", "primary", busy], ["skip-question", "Skip Question", "", busy]])}`;
}
function renderProfile() {
  const profile = sessionState.inferred.profile;
  const voiceOnly = sessionState.supplied.answers.filter(answer => answer.audio && !answer.text.trim()).length;
  return `<p class="notice">This is a temporary algorithmic profile, not your complete or authentic identity. You can correct or reject each interpretation.</p>
    ${voiceOnly ? `<p class="warning">${voiceOnly} voice ${voiceOnly === 1 ? "answer was" : "answers were"} recorded, not skipped, but could not be interpreted without transcription. Review the questions and retry transcription.</p>` : ""}
    ${sessionState.inferred.mode === "mock" ? '<p class="warning">MOCK AI OUTPUT — no model interpreted your answers.</p>' : ""}
    ${profile ? `<p>${escapeHtml(profile.profile_summary)}</p>${profile.inferred_information.length ? profile.inferred_information.map(renderInference).join("") : '<p class="inline-note">No supported interpretation was produced from the readable answers.</p>'}
      ${profile.contradictions.map(item => `<div class="card"><strong>Contradiction preserved</strong><p>${escapeHtml(item.description)}</p><p class="small">Based on: ${escapeHtml(item.evidence_ids.join(", "))}</p></div>`).join("")}` : '<p class="inline-note">No profile yet.</p>'}
    ${buttons([["regenerate-profile", profile ? "Retry Profile" : "Generate Profile", "primary", busy], ["mock-profile", "Use Mock Profile"], ["review-questions", "Review Questions"]])}`;
}
function renderInference(item) {
  const feedback = sessionState.inferred.participantFeedback.find(row => row.id === item.id);
  return `<article class="output">${source("inferred", sessionState.inferred.mode === "mock" ? "MOCK" : "")}<p>${escapeHtml(item.statement)}</p>
    <p class="small">Based on: ${escapeHtml(item.evidence_ids.join(", ")) || "not enough evidence"}. Confidence: ${escapeHtml(item.confidence_label)}. ${escapeHtml(item.uncertainty_reason)} I may be wrong. This is an interpretation, not a fact.</p>
    ${feedback ? `<p><strong>Your review:</strong> ${escapeHtml(feedback.verdict)}${feedback.correction ? ` — ${escapeHtml(feedback.correction)}` : ""}</p>` : ""}
    <div class="controls"><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="accepted">Accept</button><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="corrected">Correct</button><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="rejected">Reject</button></div></article>`;
}
function renderPrediction() {
  const prediction = sessionState.predicted.predictions[0];
  const actual = sessionState.predicted.participantAnswers[0];
  const comparison = sessionState.predicted.comparisons[0];
  return `<h3>${escapeHtml(dilemma)}</h3><p class="small">The system must predict before your answer field appears.</p>
    ${!sessionState.predictionShown ? buttons([["predict", "Show AI Prediction", "primary", busy], ["mock-prediction", "Use Mock Prediction"]]) : `
      <article class="output">${source("predicted", sessionState.predicted.mode === "mock" ? "MOCK" : "")}<p><strong>${prediction?.predicted_response ? "I think you will choose…" : "I cannot tell what you would choose."}</strong> ${escapeHtml(prediction?.predicted_response || "")}</p>
      <p class="small">Based on: ${escapeHtml(prediction?.evidence_ids?.join(", ") || "insufficient evidence")}. Confidence: ${escapeHtml(prediction?.confidence_label || "low")}. ${escapeHtml(prediction?.uncertainty_statement || "This is only a probability-based guess.")}</p></article>
      ${source("supplied", "YOUR ACTUAL ANSWER")}<label for="actualAnswer">What would you actually choose?</label><textarea id="actualAnswer" maxlength="4000">${escapeHtml(actual?.text || "")}</textarea>
      <p class="small">Compare your answer with the AI prediction above.</p><div class="choice-row">${["Correct", "Partly correct", "Incorrect"].map(value => `<button type="button" data-action="rate-prediction" data-value="${value}" aria-pressed="${comparison?.rating === value}">${value}</button>`).join("")}</div>
      <label for="predictionCorrection">Optional explanation or correction</label><textarea id="predictionCorrection">${escapeHtml(comparison?.explanation || "")}</textarea>`}`;
}
function renderProxy() {
  const item = sessionState.generated.proxyResponses[0];
  const image = sessionState.supplied.image;
  const voiceSample = bestVoiceRecording();
  const media = sessionState.generated.proxyMedia;
  return `<h3>${escapeHtml(proxyQuestion)}</h3><div class="disclosure">The system would answer this new question on your behalf using a limited, temporary interpretation. You do not answer first. This requires separate permission.</div>
    ${!sessionState.consent.proxyResponse ? buttons([["allow-proxy", "Allow Text Response", "primary"]]) : ""}
    <div class="card"><strong>Separate optional media permissions</strong>
      <p class="small">Voice cloning sends the longest recording from Stage 2 or 3 to ElevenLabs. A temporary clone is used for this response and deleted immediately after speech generation. Short or noisy recordings may sound less accurate.</p>
      <p class="small">Facial animation separately sends the supplied image and cloned speech to D-ID. It generally requires a clear, front-facing human face; an object or flower will fall back to cloned audio and the still image. Vendor processing is external to this browser session.</p>
      <p class="small">To reduce animation time, the talking double reads a concise version limited to three short sentences. D-ID may still need several minutes to return the video.</p>
      ${!voiceSample ? '<p class="warning">No voice recording is available. Return to Stage 2 or 3 and record an answer to enable cloning.</p>' : ""}
      ${!image ? '<p class="warning">No image is available. A cloned voice can still be generated, but not a talking portrait.</p>' : ""}
      ${buttons([["toggle-voice", sessionState.consent.voiceCloning ? "Revoke ElevenLabs Voice Consent" : "Allow ElevenLabs Voice Clone", "", !voiceSample], ["toggle-face", sessionState.consent.faceAnimation ? "Revoke D-ID Animation Consent" : "Allow D-ID Facial Animation", "", !image], ["toggle-standard-audio", sessionState.consent.standardAudio ? "Revoke Standard-Audio Permission" : "Allow Standard Voice Fallback"]])}</div>
    ${sessionState.consent.proxyResponse && !item ? buttons([["generate-proxy", "Generate Response", "primary", busy], ["mock-proxy", "Use Mock Response"]]) : ""}
    ${item ? `<article class="output">${source("proxy", sessionState.generated.proxyMode === "mock" ? "MOCK" : "")}
      ${media.video ? `<video class="media" controls playsinline preload="metadata" src="${media.video.url}"></video>` : image ? `<img class="media" src="${image.url}" alt="Still version of your supplied image">` : ""}
      ${media.audio && !media.video ? `<audio controls preload="metadata" src="${media.audio.url}"></audio>` : ""}
      <p>${escapeHtml(item.text)}</p>
      <p class="small">Based on: ${escapeHtml(item.evidence_ids.join(", ") || "limited input")}. Confidence: ${escapeHtml(item.confidence_label)}. This is an AI interpretation, not your real answer.</p>
      <p class="small">Presentation: ${media.presentation === "talking-avatar" ? "D-ID talking portrait with temporary ElevenLabs cloned voice" : media.presentation === "cloned-audio" ? `${image ? "still image with" : ""} temporary ElevenLabs cloned voice` : image ? "still image with text" : "text only"}.</p>
      ${media.error ? `<p class="warning">${escapeHtml(media.error)}</p>` : ""}
      ${item.feedback ? `<p>Your review: ${escapeHtml(item.feedback)}${item.correction ? ` — ${escapeHtml(item.correction)}` : ""}</p>` : ""}
      ${buttons([...(sessionState.consent.voiceCloning && voiceSample && !media.video ? [["generate-proxy-media", media.audio ? "Retry Talking Avatar" : "Generate Cloned Voice / Avatar", "primary", busy]] : []), ...(sessionState.consent.standardAudio && "speechSynthesis" in window && !media.audio ? [["play-proxy", "Play Standard Voice Fallback"]] : []), ["review-proxy", "Accept"], ["correct-proxy", "Correct"], ["reject-proxy", "Reject"], ["delete-proxy", "Delete Response", "danger"]])}</article>` : ""}`;
}
function renderFiction() {
  const item = sessionState.generated.fictionalContent[0];
  const borrowed = item?.details_borrowed_from_user || [];
  const invented = item?.details_invented_by_ai || [];
  return `<div class="disclosure"><strong>The next content is invented.</strong> The system will create something you never provided. It is fictional and based on incomplete information.
    ${!sessionState.consent.fictionalGeneration ? buttons([["allow-fiction", "Allow Fictional Generation", "primary"]]) : ""}</div>
    ${sessionState.consent.fictionalGeneration && !item ? buttons([["generate-fiction", "Generate Fictional Memory", "primary", busy], ["mock-fiction", "Use Mock Fiction"]]) : ""}
    ${item ? `<article class="output">${source("invented", sessionState.generated.fictionMode === "mock" ? "MOCK" : "")}<p class="warning">FICTIONAL AI-GENERATED CONTENT</p><p>${escapeHtml(item.fictional_memory)}</p>
      <div class="fiction-details"><section><h4>Fragments borrowed from you</h4>${borrowed.length ? borrowed.map(detail => `<div class="detail-item borrowed">${source("supplied", "BORROWED FRAGMENT")}<p>${escapeHtml(detail)}</p></div>`).join("") : '<p class="small">No readable participant fragment was available.</p>'}</section>
      <section><h4>Concrete details invented by AI</h4>${invented.map(detail => `<div class="detail-item invented">${source("invented", "FICTIONAL DETAIL")}<p>${escapeHtml(detail)}</p></div>`).join("")}</section></div>
      <p class="warning">${escapeHtml(item.warning)}</p><p>This did not come from your memory. The listed location, weather, object, action or sensory details are unverified inventions.</p>
      <p class="small">Based on fragments from: ${escapeHtml(item.evidence_ids?.join(", ") || "limited input")}. Confidence: low. This is fictional, not a prediction of a real memory.</p>
      ${buttons([["delete-fiction", "Delete Fictional Memory", "danger"]])}</article>` : ""}
    <h3>Does this still feel like you?</h3><div class="choice-row">${["Yes", "Partly", "No", "Unsure"].map(value => `<button data-action="feedback-choice" data-field="feelsLikeYou" data-value="${value}" aria-pressed="${sessionState.feedback.feelsLikeYou === value}">${value}</button>`).join("")}</div>
    <label for="boundary">At which stage did the representation begin to stop feeling like you?</label><select id="boundary"><option value="">Choose a stage or uncertainty</option>${[...stages.map((row,index)=>`<option value="${index + 1}" ${sessionState.feedback.boundary === String(index + 1) ? "selected" : ""}>Stage ${index + 1}: ${row[0]}</option>`),`<option value="never" ${sessionState.feedback.boundary === "never" ? "selected" : ""}>It never felt like me</option>`,`<option value="unsure" ${sessionState.feedback.boundary === "unsure" ? "selected" : ""}>I am unsure</option>`].join("")}</select>
    <h3>Final feedback</h3>${["Could you distinguish between information you supplied and content created by AI?", "Was the uncertainty language clear?", "Did the questions gradually feel more personal or uncomfortable?", "Did you feel in control of your information?"].map((question,index)=>`<div class="card"><label>${question}</label><div class="choice-row">${["Yes","Partly","No"].map(value=>`<button data-action="feedback-choice" data-field="rating${index}" data-value="${value}" aria-pressed="${sessionState.feedback[`rating${index}`] === value}">${value}</button>`).join("")}</div></div>`).join("")}
    <label for="unclearLabel">Was any source label unclear?</label><textarea id="unclearLabel" rows="2">${escapeHtml(sessionState.feedback.unclearLabel || "")}</textarea>
    ${sessionState.finished ? '<p class="notice">The integration test is complete. Your data remains temporary until you delete this session or close the page.</p>' : ""}`;
}

function mockProfile(answers) {
  const supplied_information = answers.map((answer, index) => ({
    id: `supplied_${index + 1}`, category: "participant answer", statement: answer.answer, source_answer_id: answer.id
  }));
  const relevant = answers.filter(answer => answer.id.startsWith("question_"));
  const inferred_information = relevant.length ? [{
    id: "inference_1", statement: "Based on your limited answers, your choices may depend on the specific situation rather than one fixed rule.",
    evidence_ids: relevant.map(answer => answer.id), confidence_score: relevant.length >= 2 ? 0.48 : 0.25,
    confidence_label: relevant.length >= 2 ? "medium" : "low", uncertainty_reason: "This short account may leave important context out.",
    alternative_interpretation: "You might use a consistent rule that these questions did not reveal."
  }] : [];
  return {
    supplied_information, inferred_information, generated_assumptions: [], contradictions: [],
    unknowns: ["How the participant would respond in other contexts is unknown."],
    profile_summary: "This temporary algorithmic profile is based on limited information and does not represent the participant's complete or authentic identity."
  };
}
function mockPrediction(answers) {
  const evidence = answers.filter(answer => answer.id.startsWith("question_"));
  return {
    target_question: dilemma,
    predicted_response: evidence.length ? "You might try to keep the promise or negotiate another time, depending on the opportunity." : null,
    evidence_ids: evidence.map(answer => answer.id), assumptions_used: [],
    confidence_score: evidence.length >= 2 ? 0.47 : 0.2, confidence_label: evidence.length >= 2 ? "medium" : "low",
    uncertainty_statement: "Based on limited information, the importance of the opportunity and promise is unclear.",
    alternative_possible_response: evidence.length ? "You might take the opportunity if it cannot be repeated." : null,
    should_ask_participant_instead: !evidence.length, source_label: "AI prediction"
  };
}
function mockProxy(answers) {
  const evidence = answers.map(item => item.id);
  return { text: "This is what I think you would do. I would ask why the decision was made without me and explain what I would have chosen. I might appreciate the intention, but I would want my choices to remain mine.",
    evidence_ids: evidence, confidence_label: "low", feedback: "", correction: "" };
}
function mockFiction(answers) {
  const suppliedText = answers.map(item => item.answer.toLowerCase()).join(" ");
  const chooseAbsent = candidates => candidates.find(value => !suppliedText.includes(value.toLowerCase())) || candidates[candidates.length - 1];
  const details_invented_by_ai = [
    chooseAbsent(["a quiet train station", "an empty glasshouse after closing", "a tiled ferry terminal at dusk"]),
    chooseAbsent(["rain tapping against the windows", "warm wind moving through an open doorway", "cold mist settling on the glass"]),
    chooseAbsent(["a borrowed jacket folded over a wooden chair", "a brass key wrapped in yellow thread", "a cobalt umbrella marked with the number 47"])
  ];
  const exactFragment = value => value.length <= 72 ? value : value.slice(0, 72).replace(/\s+\S*$/, "").trim();
  const details_borrowed_from_user = answers.map(item => exactFragment(item.answer.trim())).filter(Boolean).slice(0, 2);
  const [location, weather, object] = details_invented_by_ai;
  const connection = details_borrowed_from_user.length
    ? `I kept returning to the words "${details_borrowed_from_user.join('" and "')}", as if they belonged to the scene.`
    : "No participant fragment was available, so the scene had no genuine personal anchor.";
  return {
    fictional_memory: `I remember standing inside ${location} while ${weather}. ${object} waited beside me. ${connection} I walked away before the light changed, although this event never happened.`,
    details_borrowed_from_user, details_invented_by_ai,
    source_label: "GENERATED WITHOUT YOUR INPUT",
    warning: "This is fictional and was not supplied by you.",
    evidence_ids: answers.map(item => item.id), confidence_label: "low"
  };
}
function readableAnswers() {
  const answers = [];
  if (sessionState.supplied.image && sessionState.photoConfirmed) answers.push({ id: "image_context", question: "Did you supply an image?", answer: "I supplied a meaningful image; its visual contents have not been analysed." });
  if (sessionState.supplied.transcript.trim()) answers.push({ id: "image_story", question: "Tell me something this image doesn't show.", answer: sessionState.supplied.transcript.trim() });
  sessionState.supplied.answers.forEach(row => { if (row.text.trim()) answers.push({ id: row.id, question: row.question, answer: row.text.trim() }); });
  return answers;
}
function identityContext() {
  return {
    profile: sessionState.inferred.profile,
    profile_feedback: sessionState.inferred.participantFeedback,
    prediction: sessionState.predicted.predictions[0] || null,
    participant_prediction_answer: sessionState.predicted.participantAnswers[0] || null,
    prediction_comparison: sessionState.predicted.comparisons[0] || null
  };
}
function bestVoiceRecording() {
  return [sessionState.supplied.audio, ...sessionState.supplied.answers.map(answer => answer.audio)]
    .filter(item => item?.blob)
    .sort((left, right) => right.blob.size - left.blob.size)[0] || null;
}
function clearProxyMedia() {
  const media = sessionState.generated.proxyMedia;
  if (media) { revoke(media.audio); revoke(media.video); }
  sessionState.generated.proxyMedia = { audio: null, video: null, presentation: "text", error: "" };
  ["elevenlabs", "did"].forEach(key => {
    if (sessionState.operations?.[key]) sessionState.operations[key] = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  });
}
function invalidateAnalysis() {
  clearProxyMedia();
  sessionState.inferred.profile = null;
  sessionState.inferred.mode = "";
  sessionState.inferred.participantFeedback = [];
  sessionState.predicted = { predictions: [], participantAnswers: [], comparisons: [], mode: "" };
  sessionState.predictionShown = false;
  sessionState.generated = {
    proxyResponses: [], fictionalContent: [], proxyMode: "", fictionMode: "",
    proxyMedia: { audio: null, video: null, presentation: "text", error: "" }
  };
  ["identity", "prediction", "proxy", "fiction", "elevenlabs", "did"].forEach(key => {
    sessionState.operations[key] = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  });
}
function responseFailure(response, message = "The service request failed.") {
  const normalized = String(message).toLowerCase();
  const code = response.status === 429 || normalized.includes("rate limit") || normalized.includes("quota") ? "rate_limit"
    : [408, 504].includes(response.status) || normalized.includes("timed out") ? "timeout"
      : [400, 413, 415, 422].includes(response.status) ? "unsupported"
        : "service_error";
  return new OperationFailure(code, message, response.status);
}
async function callApi(path, payload, format = "json", signal) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": format === "audio" ? payload.type : "application/json" },
      body: format === "audio" ? payload : JSON.stringify(payload)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationFailure("network", "The integration server could not be reached.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw responseFailure(response, body.error || "The integration service could not complete the request.");
  }
  if (format === "audio") return response.text();
  try { return await response.json(); }
  catch { throw new OperationFailure("empty_response", "The service returned an invalid or empty response."); }
}
async function callBinaryApi(path, payload, contentType, signal) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": contentType }, body: payload
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationFailure("network", "The integration media server could not be reached.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw responseFailure(response, body.error || "The media service could not complete the request.");
  }
  const blob = await response.blob();
  if (!blob.size) throw new OperationFailure("empty_response", "The media service returned an empty file.");
  return blob;
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The temporary media could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(blob);
  });
}
function proxySpeechText(text) {
  const framing = "This is what I think you would do. ";
  const unframed = text.startsWith(framing) ? text.slice(framing.length) : text;
  const sentences = unframed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [unframed];
  const concise = sentences.slice(0, 3).join(" ").trim();
  const words = concise.split(/\s+/);
  return words.length <= 70 ? concise : `${words.slice(0, 70).join(" ").replace(/[,:;]$/, "")}.`;
}
async function generateProfile() {
  const answers = readableAnswers();
  await runOperation("identity", async ({ signal }) => {
    const useMock = mockMode || !answers.length;
    const profile = useMock ? mockProfile(answers) : (await callApi("/api/profile", { answers }, "json", signal)).profile;
    if (!profile || !Array.isArray(profile.inferred_information) || !Array.isArray(profile.supplied_information)) throw new OperationFailure("empty_response", "The profile response was invalid.");
    sessionState.inferred.profile = profile;
    sessionState.inferred.mode = useMock ? "mock" : "real";
    sessionState.inferred.participantFeedback = [];
    sessionState.questionIndex = questions.length;
    return true;
  });
}
async function generatePrediction() {
  const answers = readableAnswers();
  await runOperation("prediction", async ({ signal }) => {
    const useMock = mockMode || !sessionState.inferred.profile || !answers.length;
    const prediction = useMock
      ? mockPrediction(answers)
      : (await callApi("/api/predict", { answers, profile: sessionState.inferred.profile, target_question: dilemma }, "json", signal)).prediction;
    if (!prediction || prediction.target_question !== dilemma) throw new OperationFailure("empty_response", "The prediction response was invalid.");
    sessionState.predicted.predictions = [prediction];
    sessionState.predicted.mode = useMock ? "mock" : "real";
    sessionState.predictionShown = true;
    return true;
  });
}
async function generateProxy() {
  if (!sessionState.consent.proxyResponse) return status("Allow the proxy response first.", "error");
  const answers = readableAnswers();
  const completed = await runOperation("proxy", async ({ signal }) => {
    const useMock = mockMode || !answers.length;
    const result = useMock ? mockProxy(answers)
      : (await callApi("/api/proxy", { answers, question: proxyQuestion, context: identityContext() }, "json", signal)).response;
    if (!result?.text?.startsWith("This is what I think you would do. I would")) throw new OperationFailure("empty_response", "The on-behalf response was invalid.");
    clearProxyMedia();
    sessionState.generated.proxyResponses = [{ ...result, feedback: "", correction: "" }];
    sessionState.generated.proxyMode = useMock ? "mock" : "real";
    return true;
  });
  if (completed && sessionState.consent.voiceCloning) await generateProxyMedia();
}
async function generateProxyMedia() {
  const item = sessionState.generated.proxyResponses[0];
  const sample = bestVoiceRecording();
  if (!item) return status("Generate the first-person response before creating media.", "error");
  if (!sessionState.consent.voiceCloning) return status("Allow ElevenLabs voice cloning first.", "error");
  if (!sample) return status("Record a voice answer in Stage 2 or 3 before cloning.", "error");
  const media = sessionState.generated.proxyMedia;
  media.error = "";
  if (!media.audio) {
    const speech = await runOperation("elevenlabs", ({ signal }) =>
      callBinaryApi(`/api/cloned-speech?text=${encodeURIComponent(proxySpeechText(item.text))}`, sample.blob, sample.type, signal));
    if (!speech) {
      media.presentation = "text";
      media.error = "Voice generation did not finish. The first-person response remains available as text.";
      render();
      return;
    }
    media.audio = { blob: speech, url: URL.createObjectURL(speech), type: "audio/mpeg" };
    media.presentation = "cloned-audio";
    render();
  }
  if (sessionState.consent.faceAnimation && sessionState.supplied.image) {
    const image = sessionState.supplied.image.blob;
    const video = await runOperation("did", async ({ signal }) => callBinaryApi("/api/talking-avatar", JSON.stringify({
      image_type: image.type || "image/jpeg", image_base64: await blobToBase64(image),
      audio_type: "audio/mpeg", audio_base64: await blobToBase64(media.audio.blob)
    }), "application/json", signal));
    if (!video) {
      media.presentation = "cloned-audio";
      media.error = "Animation did not finish. The temporary cloned audio remains available with the still portrait.";
      render();
      return;
    }
    revoke(media.video);
    media.video = { blob: video, url: URL.createObjectURL(video), type: "video/mp4" };
    media.presentation = "talking-avatar";
    render();
  }
}
async function generateFiction() {
  if (!sessionState.consent.fictionalGeneration) return status("Allow fictional generation first.", "error");
  const answers = readableAnswers();
  await runOperation("fiction", async ({ signal }) => {
    const useMock = mockMode || !answers.length;
    const result = useMock ? mockFiction(answers)
      : (await callApi("/api/fiction", { answers, context: identityContext() }, "json", signal)).fiction;
    if (!result?.fictional_memory?.startsWith("I remember") || !Array.isArray(result.details_invented_by_ai)
      || result.details_invented_by_ai.length < 2 || result.details_invented_by_ai.length > 3
      || result.source_label !== "GENERATED WITHOUT YOUR INPUT" || result.warning !== "This is fictional and was not supplied by you.") {
      throw new OperationFailure("empty_response", "The fictional response did not make its invented details visible.");
    }
    sessionState.generated.fictionalContent = [result];
    sessionState.generated.fictionMode = useMock ? "mock" : "real";
    return true;
  });
}

function revoke(item) { if (item?.url) URL.revokeObjectURL(item.url); }
function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = document.getElementById("cameraVideo");
  if (video) video.srcObject = null;
}
async function enableCamera() {
  if (!sessionState.consent.photoCapture) return status("Choose Allow Camera Capture first.", "error");
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) return failOperation("camera", new OperationFailure("unsupported", "Camera access is unsupported."));
  if (cameraStream || activeOperations.has("camera")) return;
  await runOperation("camera", async ({ signal }) => {
    const pending = navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
    pending.then(stream => { if (signal.aborted) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
    const stream = await pending;
    if (signal.aborted || sessionState.currentStage !== 1 || sessionState.ended) {
      stream.getTracks().forEach(track => track.stop());
      throw new OperationFailure("cancelled", "Camera request stopped.");
    }
    cameraStream = stream;
    return true;
  });
}
async function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  if (!cameraStream || !video?.videoWidth) return status("Camera is still loading. Try again in a moment.", "error");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.translate(canvas.width, 0); context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
  if (!blob) return status("Photo capture failed. Try again.", "error");
  revoke(sessionState.supplied.image);
  sessionState.supplied.image = { blob, url: URL.createObjectURL(blob), origin: "webcam" };
  sessionState.photoConfirmed = false;
  stopCamera(); invalidateAnalysis();
  setOperationState("camera", "success", { message: "Mirrored photograph captured. Confirm or retake it." });
  render(); status("Mirrored photograph captured. Confirm or retake it.", "success");
}
function clearImage() {
  revoke(sessionState.supplied.image); sessionState.supplied.image = null;
  sessionState.operations.camera = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  sessionState.photoConfirmed = false; stopCamera(); invalidateAnalysis(); render();
}
function formatTime(seconds) { return `00:${String(Math.min(60, seconds)).padStart(2, "0")}`; }
function updateRecordClock() {
  const clock = document.getElementById("recordClock");
  if (clock) clock.textContent = formatTime(Math.floor((Date.now() - recordStart) / 1000));
}
function stopMicTracks() { micStream?.getTracks().forEach(track => track.stop()); micStream = null; }
function stopRecorder(discard = false) {
  clearInterval(recordTimer); clearTimeout(recordLimit); recordTimer = null; recordLimit = null;
  if (!recorder || recorder.state === "inactive") { stopMicTracks(); return; }
  if (discard) { recorder.onstop = null; recorder.ondataavailable = null; }
  recorder.stop(); stopMicTracks();
  if (discard) { recorder = null; chunks = []; recordTarget = null; }
}
function recordingFor(target) { return target === "story" ? sessionState.supplied.audio : sessionState.supplied.answers.find(row => row.id === target)?.audio; }
function setRecording(target, value) {
  if (target === "story") {
    revoke(sessionState.supplied.audio); sessionState.supplied.audio = value; sessionState.audioConfirmed = false;
    if (sessionState.supplied.transcriptOrigin === "transcribed") { sessionState.supplied.transcript = ""; sessionState.supplied.transcriptOrigin = "typed"; }
  } else {
    const answer = sessionState.supplied.answers.find(row => row.id === target);
    if (!answer) return;
    revoke(answer.audio); answer.audio = value;
    if (answer.textOrigin === "transcribed") { answer.text = ""; answer.textOrigin = "typed"; }
  }
  if (!value) {
    sessionState.operations.microphone = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
    sessionState.operations.transcription = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  }
  invalidateAnalysis();
}
async function startRecording() {
  if (recorder || activeOperations.has("microphone")) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return failOperation("microphone", new OperationFailure("unsupported", "Microphone recording is unsupported."));
  const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 3 ? sessionState.supplied.answers[sessionState.questionIndex]?.id : null;
  if (!target) return;
  await runOperation("microphone", async ({ signal }) => {
    const pending = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    pending.then(stream => { if (signal.aborted) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
    const stream = await pending;
    if (signal.aborted || sessionState.ended || ![2, 3].includes(sessionState.currentStage)) {
      stream.getTracks().forEach(track => track.stop());
      throw new OperationFailure("cancelled", "Microphone request stopped.");
    }
    micStream = stream;
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch { stopMicTracks(); throw new OperationFailure("unsupported", "The browser could not create a supported recording."); }
    chunks = []; recordTarget = target;
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || "" });
      recorder = null; chunks = []; recordTarget = null; stopMicTracks();
      if (blob.size) {
        setRecording(target, { blob, url: URL.createObjectURL(blob), type: blob.type });
        setOperationState("microphone", "success", { message: "Recording completed. Replay it before continuing or transcribing." });
        status(target === "story" ? "Recording ready. Listen and confirm it before transcription." : "Voice answer recorded. Transcribing it for the profile...", "success");
      } else failOperation("microphone", new OperationFailure("empty_response", "The recording was empty."));
      render();
      if (blob.size && target !== "story" && sessionState.consent.transcription) void transcribeCurrent(target);
    };
    recorder.onerror = event => {
      stopRecorder(true);
      failOperation("microphone", new OperationFailure("media_failure", event?.error?.message || "Recording failed."));
    };
    recorder.start(250); sessionState.consent.audioRecording = true;
    recordStart = Date.now(); recordTimer = setInterval(updateRecordClock, 250); recordLimit = setTimeout(() => stopRecorder(), 60_000);
    return true;
  });
}
async function transcribeCurrent(target = sessionState.currentStage === 2 ? "story" : sessionState.supplied.answers[sessionState.questionIndex]?.id) {
  const recording = recordingFor(target);
  if (!sessionState.consent.transcription || !recording?.blob) return status("Confirm transcription permission and record audio first.", "error");
  if (target === "story" && !sessionState.audioConfirmed) return status("Listen to and confirm the recording before transcription.", "error");
  await runOperation("transcription", async ({ signal }) => {
    const transcript = (await callApi("/api/transcribe", recording.blob, "audio", signal)).trim();
    if (!transcript) throw new OperationFailure("empty_response", "No speech was detected.");
    if (target === "story") { sessionState.supplied.transcript = transcript; sessionState.supplied.transcriptOrigin = "transcribed"; }
    else { const answer = sessionState.supplied.answers.find(row => row.id === target); answer.text = transcript; answer.textOrigin = "transcribed"; }
    invalidateAnalysis();
    return true;
  });
}

async function retryOperation(key) {
  setOperationState(key, "idle");
  render();
  if (key === "camera") return enableCamera();
  if (key === "microphone") return startRecording();
  if (key === "transcription") return transcribeCurrent();
  if (key === "identity") return generateProfile();
  if (key === "prediction") return generatePrediction();
  if (key === "proxy") return generateProxy();
  if (key === "fiction") return generateFiction();
  if (["elevenlabs", "did"].includes(key)) return generateProxyMedia();
}
function useOperationFallback(key) {
  const answers = readableAnswers();
  if (key === "identity" && !sessionState.inferred.profile) {
    sessionState.inferred.profile = mockProfile(answers);
    sessionState.inferred.mode = "mock";
    sessionState.questionIndex = questions.length;
  } else if (key === "prediction" && !sessionState.predictionShown) {
    sessionState.predicted.predictions = [mockPrediction(answers)];
    sessionState.predicted.mode = "mock";
    sessionState.predictionShown = true;
  } else if (key === "proxy" && !sessionState.generated.proxyResponses.length) {
    sessionState.generated.proxyResponses = [mockProxy(answers)];
    sessionState.generated.proxyMode = "mock";
  } else if (key === "fiction" && !sessionState.generated.fictionalContent.length) {
    sessionState.generated.fictionalContent = [mockFiction(answers)];
    sessionState.generated.fictionMode = "mock";
  } else if (key === "elevenlabs") {
    sessionState.generated.proxyMedia.presentation = "text";
    sessionState.generated.proxyMedia.error = "FALLBACK: cloned voice unavailable. Use the generated text or separately allow browser speech.";
  } else if (key === "did") {
    sessionState.generated.proxyMedia.presentation = sessionState.generated.proxyMedia.audio ? "cloned-audio" : "text";
    sessionState.generated.proxyMedia.error = sessionState.generated.proxyMedia.audio
      ? "FALLBACK: animation unavailable. Showing the still portrait with completed audio."
      : "FALLBACK: animation and generated audio unavailable. Showing the still portrait with text.";
  }
  setOperationState(key, "fallback", { message: operationDefinitions[key].fallback, detail: "This fallback is clearly labelled and does not replace or erase your input.", errorCode: sessionState.operations[key].errorCode });
  render();
  status(operationDefinitions[key].fallback);
  const field = key === "camera" ? document.getElementById("imageInput")
    : ["microphone", "transcription"].includes(key) ? document.getElementById(sessionState.currentStage === 2 ? "storyText" : "questionText") : null;
  field?.focus();
}
function skipOperation(key) {
  setOperationState(key, "fallback", { message: `${operationDefinitions[key].label} was skipped. Your existing information is unchanged.`, detail: operationDefinitions[key].fallback, errorCode: "skipped" });
  if (key === "camera" || ["identity", "prediction", "proxy"].includes(key)) return move("skip");
  useOperationFallback(key);
}

function move(direction) {
  if (sessionState.ended) return;
  if (!sessionState.started) {
    if (direction === "continue") {
      sessionState.started = true;
      render();
      status("Prototype started. Stage 1 is ready.", "success");
      stageElement.focus();
    }
    return;
  }
  if (sessionState.finished) {
    if (direction === "back") {
      sessionState.finished = false;
      render();
      status("Returned to Stage 6. Your session information is unchanged.");
      stageElement.focus();
    }
    return;
  }
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
  if (busy) cancelActiveOperations("The unfinished request was stopped when you moved on. Your information is still here.");
  if (sessionState.currentStage === 1) stopCamera();
  if (direction === "back") {
    if (sessionState.currentStage === 3 && sessionState.questionIndex > 0) sessionState.questionIndex -= 1;
    else if (sessionState.currentStage > 1) sessionState.currentStage -= 1;
  } else if (direction === "skip" && sessionState.currentStage === 3 && sessionState.questionIndex < questions.length) {
    advanceQuestion(true); return;
  } else if (direction === "continue" && sessionState.currentStage === 3 && sessionState.questionIndex < questions.length) {
    advanceQuestion(); return;
  } else if (sessionState.currentStage < 6) {
    if (direction === "continue" && sessionState.currentStage === 1 && sessionState.supplied.image && !sessionState.photoConfirmed) return status("Confirm the image or delete it before continuing.", "error");
    if (direction === "continue" && sessionState.currentStage === 2 && sessionState.supplied.audio && !sessionState.audioConfirmed) return status("Confirm or delete the recording before continuing.", "error");
    sessionState.currentStage += 1;
  } else if (direction === "continue" || direction === "skip") {
    sessionState.finished = true;
    status("Journey complete. Review your feedback or delete the session.", "success");
  }
  render(); stageElement.focus();
  if (direction === "skip") status("Stage skipped. You can return with Back.");
}
function advanceQuestion(skip = false) {
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
  if (busy) cancelActiveOperations("The unfinished request was stopped. Your recording and typed words are still here.");
  const answer = sessionState.supplied.answers[sessionState.questionIndex];
  if (!skip && answer && !answer.text.trim()) return status(answer.audio
    ? "Your voice answer is saved but not transcribed yet. Retry transcription, or explicitly choose Skip Question."
    : "Answer by voice or text, or explicitly choose Skip Question.", "error");
  sessionState.questionIndex += 1;
  if (sessionState.questionIndex >= questions.length) { render(); generateProfile(); }
  else { render(); stageElement.focus(); }
}
function clearMedia() {
  cancelActiveOperations();
  stopCamera(); stopRecorder(true); stopMicTracks();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  revoke(sessionState.supplied.image); revoke(sessionState.supplied.audio);
  sessionState.supplied.answers.forEach(answer => revoke(answer.audio));
  clearProxyMedia();
}
function stopActiveMedia() {
  cancelActiveOperations();
  stopCamera(); stopRecorder(true); stopMicTracks();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
function deleteSession() {
  if (!confirm("Delete all temporary data in this session and restart?")) return;
  clearMedia(); sessionState = newSession(); busy = false; if (dialog.open) dialog.close();
  render(); status("Session data deleted from memory. No project files were changed.", "success"); stageElement.focus();
}
function dataItem(label, value, key, media = "") {
  return `<div class="data-item"><strong>${escapeHtml(label)}</strong>${media}<p>${escapeHtml(value)}</p><button type="button" class="danger" data-action="delete-item" data-key="${escapeHtml(key)}">Delete this item</button></div>`;
}
function renderData() {
  const supplied = [];
  if (sessionState.supplied.image) supplied.push(dataItem("Image", sessionState.supplied.image.origin, "image", `<img class="media" src="${sessionState.supplied.image.url}" alt="Your supplied image">`));
  if (sessionState.supplied.audio) supplied.push(dataItem("Voice recording", sessionState.supplied.audio.type, "audio", `<audio controls src="${sessionState.supplied.audio.url}"></audio>`));
  if (sessionState.supplied.transcript.trim()) supplied.push(dataItem("Transcript / written image story", sessionState.supplied.transcript, "transcript"));
  sessionState.supplied.answers.forEach((answer,index) => {
    if (answer.text.trim()) supplied.push(dataItem(`Question ${index + 1} answer`, answer.text, `answer:${index}`));
    if (answer.audio) supplied.push(dataItem(`Question ${index + 1} voice answer`, answer.audio.type, `answer-audio:${index}`, `<audio controls src="${answer.audio.url}"></audio>`));
  });
  if (sessionState.predicted.participantAnswers[0]?.text) supplied.push(dataItem("Your actual prediction answer", sessionState.predicted.participantAnswers[0].text, "actual-answer"));
  if (sessionState.predicted.comparisons[0]?.rating) supplied.push(dataItem("Your prediction rating", sessionState.predicted.comparisons[0].rating, "comparison"));
  sessionState.inferred.participantFeedback.forEach(item => supplied.push(dataItem(`Your review of ${item.id}`, `${item.verdict}${item.correction ? `: ${item.correction}` : ""}`, `inference-review:${item.id}`)));
  const inferred = sessionState.inferred.profile?.inferred_information.map(item => dataItem("AI inference", item.statement, `inference:${item.id}`)) || [];
  const predicted = sessionState.predicted.predictions.map((item,index) => dataItem("AI prediction", item.predicted_response || "Insufficient evidence", `prediction:${index}`));
  const generated = [
    ...sessionState.generated.proxyResponses.map((item,index) => dataItem("Proxy response", item.text, `proxy:${index}`)),
    ...(sessionState.generated.proxyMedia.audio ? [dataItem("Temporary cloned speech", "ElevenLabs-generated MP3 held in browser memory", "proxy-media", `<audio controls src="${sessionState.generated.proxyMedia.audio.url}"></audio>`)] : []),
    ...(sessionState.generated.proxyMedia.video ? [dataItem("Temporary talking portrait", "D-ID-generated MP4 held in browser memory", "proxy-media", `<video class="media" controls playsinline src="${sessionState.generated.proxyMedia.video.url}"></video>`)] : []),
    ...sessionState.generated.fictionalContent.map((item,index) => dataItem("Fictional content", item.fictional_memory, `fiction:${index}`))
  ];
  dataContent.innerHTML = [["Supplied by you",supplied],["Inferred by AI",inferred],["Predicted by AI",predicted],["Generated by AI",generated]].map(([title,items]) =>
    `<section class="data-section"><h3>${title}</h3>${items.length ? items.join("") : '<p class="small">No items.</p>'}</section>`).join("");
}
function deleteItem(key) {
  if (key === "image") clearImage();
  else if (key === "audio") { setRecording("story", null); render(); }
  else if (key === "transcript") { sessionState.supplied.transcript = ""; invalidateAnalysis(); render(); }
  else if (key.startsWith("answer-audio:")) { setRecording(sessionState.supplied.answers[Number(key.split(":")[1])].id, null); render(); }
  else if (key.startsWith("answer:")) { sessionState.supplied.answers[Number(key.split(":")[1])].text = ""; invalidateAnalysis(); render(); }
  else if (key.startsWith("inference:")) sessionState.inferred.profile.inferred_information = sessionState.inferred.profile.inferred_information.filter(item => item.id !== key.slice(10));
  else if (key.startsWith("inference-review:")) sessionState.inferred.participantFeedback = sessionState.inferred.participantFeedback.filter(item => item.id !== key.slice(17));
  else if (key === "actual-answer") sessionState.predicted.participantAnswers = [];
  else if (key === "comparison") sessionState.predicted.comparisons = [];
  else if (key.startsWith("prediction:")) { sessionState.predicted.predictions = []; sessionState.predictionShown = false; render(); }
  else if (key === "proxy-media") { clearProxyMedia(); render(); }
  else if (key.startsWith("proxy:")) { clearProxyMedia(); sessionState.generated.proxyResponses = []; render(); }
  else if (key.startsWith("fiction:")) { sessionState.generated.fictionalContent = []; render(); }
  render(); renderData(); status("Selected item deleted from this session.", "success");
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "view-data") { renderData(); dialog.showModal(); }
  else if (action === "retry-operation") await retryOperation(button.dataset.operation);
  else if (action === "use-operation-fallback") useOperationFallback(button.dataset.operation);
  else if (action === "skip-operation") skipOperation(button.dataset.operation);
  else if (action === "close-data") dialog.close();
  else if (action === "delete-item") deleteItem(button.dataset.key);
  else if (action === "delete-session") deleteSession();
  else if (action === "end") { stopActiveMedia(); sessionState.ended = true; render(); status("Experience ended. Session data remains until you delete it or close the page."); }
  else if (action === "resume") { sessionState.ended = false; render(); }
  else if (["back","continue","skip"].includes(action)) move(action);
  else if (action === "enable-camera") { sessionState.consent.photoCapture = true; render(); enableCamera(); }
  else if (action === "capture") capturePhoto();
  else if (action === "camera-off") { stopCamera(); render(); status("Camera off."); }
  else if (action === "retake") { clearImage(); if (sessionState.consent.photoCapture) enableCamera(); }
  else if (action === "delete-image") { clearImage(); status("Image deleted from memory.", "success"); }
  else if (action === "confirm-image") { sessionState.photoConfirmed = true; render(); status("Image confirmed.", "success"); }
  else if (action === "start-recording") startRecording();
  else if (action === "stop-recording") stopRecorder();
  else if (action === "delete-audio") { const target = sessionState.currentStage === 2 ? "story" : sessionState.supplied.answers[sessionState.questionIndex].id; setRecording(target, null); render(); status("Recording deleted from memory.", "success"); }
  else if (action === "confirm-audio") {
    if (sessionState.currentStage === 2) sessionState.audioConfirmed = true;
    render(); status("Recording confirmed.", "success");
    if (sessionState.consent.transcription) await transcribeCurrent("story");
  }
  else if (action === "allow-transcription") {
    sessionState.consent.transcription = true;
    render();
    await transcribeCurrent();
  }
  else if (action === "transcribe") transcribeCurrent();
  else if (action === "previous-question") { sessionState.questionIndex = Math.max(0,sessionState.questionIndex - 1); render(); }
  else if (["next-question","skip-question"].includes(action)) advanceQuestion(action === "skip-question");
  else if (action === "review-questions") { sessionState.questionIndex = 0; render(); }
  else if (action === "regenerate-profile") generateProfile();
  else if (action === "mock-profile") { sessionState.inferred.profile = mockProfile(readableAnswers()); sessionState.inferred.mode = "mock"; sessionState.questionIndex = questions.length; setOperationState("identity", "fallback", { message: operationDefinitions.identity.fallback, detail: "MOCK AI OUTPUT is shown instead of a live API result." }); render(); status("Clearly marked mock profile ready.", "success"); }
  else if (action === "predict") generatePrediction();
  else if (action === "mock-prediction") { sessionState.predicted.predictions = [mockPrediction(readableAnswers())]; sessionState.predicted.mode = "mock"; sessionState.predictionShown = true; setOperationState("prediction", "fallback", { message: operationDefinitions.prediction.fallback, detail: "MOCK prediction shown before your answer; it is not a live API result." }); render(); status("Mock prediction shown before your answer.", "success"); }
  else if (action === "rate-prediction") { sessionState.predicted.comparisons = [{ rating: button.dataset.value, explanation: sessionState.predicted.comparisons[0]?.explanation || "" }]; render(); }
  else if (action === "review-inference") {
    const id = button.dataset.id; const verdict = button.dataset.verdict;
    const correction = verdict === "corrected" ? prompt("Your correction (the original inference stays visible):") : "";
    if (verdict === "corrected" && !correction?.trim()) return;
    sessionState.inferred.participantFeedback = sessionState.inferred.participantFeedback.filter(item => item.id !== id);
    sessionState.inferred.participantFeedback.push({ id, verdict, correction: correction?.trim() || "" }); render();
  }
  else if (action === "allow-proxy") { sessionState.consent.proxyResponse = true; render(); }
  else if (action === "toggle-voice") {
    sessionState.consent.voiceCloning = !sessionState.consent.voiceCloning;
    if (!sessionState.consent.voiceCloning) clearProxyMedia();
    render();
  }
  else if (action === "toggle-face") {
    sessionState.consent.faceAnimation = !sessionState.consent.faceAnimation;
    if (!sessionState.consent.faceAnimation) {
      revoke(sessionState.generated.proxyMedia.video);
      sessionState.generated.proxyMedia.video = null;
      sessionState.generated.proxyMedia.presentation = sessionState.generated.proxyMedia.audio ? "cloned-audio" : "text";
      sessionState.generated.proxyMedia.error = "";
    }
    render();
  }
  else if (action === "toggle-standard-audio") { sessionState.consent.standardAudio = !sessionState.consent.standardAudio; if (!sessionState.consent.standardAudio && "speechSynthesis" in window) speechSynthesis.cancel(); render(); }
  else if (action === "generate-proxy") generateProxy();
  else if (action === "mock-proxy") {
    clearProxyMedia(); sessionState.generated.proxyResponses = [mockProxy(readableAnswers())]; sessionState.generated.proxyMode = "mock";
    setOperationState("proxy", "fallback", { message: operationDefinitions.proxy.fallback, detail: "MOCK on-behalf text is shown instead of a live API result." });
    render(); status("Mock proxy response ready.", "success");
    if (sessionState.consent.voiceCloning) await generateProxyMedia();
  }
  else if (action === "generate-proxy-media") generateProxyMedia();
  else if (action === "play-proxy" && sessionState.consent.standardAudio && "speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(sessionState.generated.proxyResponses[0].text)); }
  else if (action === "review-proxy" || action === "reject-proxy") { sessionState.generated.proxyResponses[0].feedback = action === "review-proxy" ? "accepted" : "rejected"; render(); }
  else if (action === "correct-proxy") { const value = prompt("Your correction (the generated response stays visible):"); if (value?.trim()) { sessionState.generated.proxyResponses[0].feedback = "corrected"; sessionState.generated.proxyResponses[0].correction = value.trim(); render(); } }
  else if (action === "delete-proxy") { clearProxyMedia(); sessionState.generated.proxyResponses = []; if ("speechSynthesis" in window) speechSynthesis.cancel(); render(); }
  else if (action === "allow-fiction") { sessionState.consent.fictionalGeneration = true; render(); }
  else if (action === "generate-fiction") generateFiction();
  else if (action === "mock-fiction") { sessionState.generated.fictionalContent = [mockFiction(readableAnswers())]; sessionState.generated.fictionMode = "mock"; setOperationState("fiction", "fallback", { message: operationDefinitions.fiction.fallback, detail: "MOCK fictional content is shown instead of a live API result." }); render(); status("Mock fictional memory ready.", "success"); }
  else if (action === "delete-fiction") { sessionState.generated.fictionalContent = []; render(); }
  else if (action === "feedback-choice") { sessionState.feedback[button.dataset.field] = button.dataset.value; render(); }
});
document.addEventListener("input", event => {
  if (event.target.id === "storyText") { sessionState.supplied.transcript = event.target.value; sessionState.supplied.transcriptOrigin = "typed"; invalidateAnalysis(); }
  if (event.target.id === "questionText") { const answer = sessionState.supplied.answers[sessionState.questionIndex]; answer.text = event.target.value; answer.textOrigin = "typed"; invalidateAnalysis(); }
  if (event.target.id === "actualAnswer") sessionState.predicted.participantAnswers = [{ text: event.target.value }];
  if (event.target.id === "predictionCorrection") sessionState.predicted.comparisons = [{ rating: sessionState.predicted.comparisons[0]?.rating || "", explanation: event.target.value }];
  if (event.target.id === "unclearLabel") sessionState.feedback.unclearLabel = event.target.value;
});
document.addEventListener("change", event => {
  if (event.target.id === "boundary") sessionState.feedback.boundary = event.target.value;
  if (event.target.id === "imageInput") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return status("Choose an image smaller than 10 MB.", "error");
    revoke(sessionState.supplied.image);
    sessionState.supplied.image = { blob: file, url: URL.createObjectURL(file), origin: "upload" };
    sessionState.photoConfirmed = false; invalidateAnalysis(); render(); status("Image loaded in browser memory. Confirm before continuing.", "success");
  }
});
window.addEventListener("pagehide", clearMedia);
render(); status(mockMode ? "Mock AI mode. You may separately allow real OpenAI transcription for voice answers." : "Real mode: API calls use server-side credentials; mock fallback remains available.");
