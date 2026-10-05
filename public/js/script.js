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
  camera: { label: "Camera", stages: [1, 2, 3, 4, 5], timeoutMs: 20_000, loading: "Requesting camera access…", success: "Camera ready. The preview is mirrored.", fallback: "Camera is unavailable, so you can upload an image or continue without one." },
  microphone: { label: "Microphone", stages: [2, 3, 4], timeoutMs: 20_000, loading: "Requesting microphone access…", success: "Microphone ready. Recording has started.", fallback: "Microphone recording is unavailable, so you can type your response instead." },
  transcription: { label: "Transcription", stages: [2, 3, 4], timeoutMs: 45_000, loading: "Transcribing your response…", success: "Transcription ready. Review and edit the words before continuing.", fallback: "Automatic transcription is unavailable. Your recording is preserved; replay it and type or edit the response manually." },
  identity: { label: "Identity profile", stages: [3], timeoutMs: 60_000, loading: "Updating your temporary identity profile…", success: "Temporary identity profile ready. Review each interpretation.", fallback: "Live identity analysis is unavailable. The last valid profile is preserved; you can use a clearly labelled mock profile or continue." },
  prediction: { label: "Prediction", stages: [4], timeoutMs: 60_000, loading: "Generating the AI’s prediction…", success: "Prediction ready. Read it before entering your answer.", fallback: "Live prediction is unavailable. You can use a clearly labelled mock prediction or skip this step." },
  proxy: { label: "On-behalf response", stages: [5], timeoutMs: 60_000, loading: "Generating a response on your behalf…", success: "On-behalf response ready. Review it before continuing.", fallback: "Live response generation is unavailable. You can use clearly labelled mock text or skip this step." },
  fiction: { label: "Fictional generation", stages: [6], timeoutMs: 150_000, loading: "Generating clearly fictional content…", success: "Fictional content ready. Review its disclosure before continuing.", fallback: "Live fictional generation is unavailable. You can use clearly labelled mock fiction or finish without it." },
  elevenlabs: { label: "Voice response", stages: [5], timeoutMs: 180_000, loading: "Creating the voice response…", success: "Temporary cloned voice ready.", fallback: "Voice cloning is unavailable. The generated text remains available, with optional browser speech if you allow it." },
  did: { label: "Digital-double animation", stages: [5], timeoutMs: 480_000, loading: "Animating your digital double… D-ID may remain queued for several minutes before rendering.", success: "Talking portrait ready.", fallback: "Animation is unavailable. The still portrait and completed audio remain available; if audio is unavailable, the experience uses portrait and text." }
};
const operationStateNames = new Set(["idle", "loading", "success", "timeout", "error", "fallback"]);
const query = new URLSearchParams(location.search);
const appConfig = window.ANOTHER_ME_CONFIG || { apiBase: "", serverless: false };
// Demonstration mode: asked for with ?mode=mock, or automatic on a static host with no AI server.
const mockMode = query.get("mode") === "mock" || !!appConfig.serverless;
const apiUrl = path => `${appConfig.apiBase || ""}${path}`;
function apiHeaders(extra = {}) {
  let code = "";
  try { code = sessionStorage.getItem("another-me-access") || ""; } catch { /* storage blocked: no code */ }
  return code ? { ...extra, "X-Access-Code": code } : extra;
}
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
const presenceDock = document.getElementById("presenceDock");
const dialog = document.getElementById("dataDialog");
const dataContent = document.getElementById("dataContent");
const stageTransitionElement = document.getElementById("stageTransition");

function newSession() {
  return {
    supplied: {
      image: null, portrait: null, audio: null, transcript: "", transcriptOrigin: "typed",
      answers: questions.map((question, index) => ({ id: `question_${index + 1}`, question, text: "", audio: null, textOrigin: "typed" }))
    },
    inferred: { profile: null, moments: [null, null, null], participantFeedback: [], contradictionFeedback: [], mode: "" },
    predicted: { predictions: [], participantAnswers: [], comparisons: [], mode: "" },
    generated: {
      proxyResponses: [], fictionalContent: [], proxyMode: "", fictionMode: "",
      proxyMedia: { audio: null, video: null, presentation: "text", error: "" }
    },
    consent: {
      photoCapture: false, portraitCapture: false, cameraPresence: false, audioRecording: false, transcription: false, autoRecordQuestions: false,
      voiceCloning: false, faceAnimation: false, proxyResponse: false, fictionalGeneration: false,
      standardAudio: false
    },
    feedback: {}, operations: createOperationStates(), started: false, currentStage: 1, questionIndex: 0, predictionShown: false,
    photoConfirmed: false, audioConfirmed: false, ended: false, finished: false,
    ui: { inputMode: {}, questionRevealed: [false, false, false], profilePage: 0, predictionCompared: false, proxyReview: false, fictionReflection: false, fictionAnswered: false,
      correctingInferenceId: "", correctingProxy: false, mediaOptionsOpen: false }
  };
}
let sessionState = newSession();
let cameraStream = null;
let cameraStoppedAt = 0;
let micStream = null;
let recorder = null;
let chunks = [];
let recordTarget = null;
let recordStart = 0;
let recordTimer = null;
let recordLimit = null;
let promptTimer = null;
let activePromptKey = "";
let stageTransitionTimer = null;
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
function showStageTransition(stageNumber, direction = "forward") {
  if (!stageTransitionElement?.querySelector || stageNumber < 1 || stageNumber > stages.length) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  clearTimeout(stageTransitionTimer);
  const columns = 16;
  const rows = 10;
  const pixels = stageTransitionElement.querySelector(".stage-transition__pixels");
  pixels.innerHTML = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const horizontalOrder = direction === "back" ? columns - column - 1 : column;
    const order = horizontalOrder + row + Math.abs(row - Math.floor(rows / 2)) * 0.35;
    const tone = (column * 3 + row * 5) % 4;
    return `<span class="stage-transition__pixel tone-${tone}" style="--order:${order}"></span>`;
  }).join("");
  stageTransitionElement.dataset.direction = direction;
  stageTransitionElement.setAttribute("aria-label", direction === "back" ? "Returning to the previous stage" : "Moving to the next stage");
  stageTransitionElement.hidden = false;
  stageTransitionElement.classList.remove("is-leaving");
  void stageTransitionElement.offsetWidth;
  stageTransitionElement.classList.add("is-active");
  stageTransitionElement.focus();
  stageTransitionTimer = setTimeout(() => {
    stageTransitionElement.classList.add("is-leaving");
    stageTransitionTimer = setTimeout(() => {
      stageTransitionElement.hidden = true;
      stageTransitionElement.classList.remove("is-active", "is-leaving");
      stageElement.focus();
    }, 100);
  }, 2050);
  return true;
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
    .filter(([key, item]) => {
      if (!operationDefinitions[key].stages.includes(sessionState.currentStage) || ["idle", "success"].includes(item.state)) return false;
      if (item.state !== "fallback") return true;
      return !(key === "identity" && sessionState.inferred.profile || key === "prediction" && sessionState.predictionShown
        || key === "proxy" && sessionState.generated.proxyResponses.length || key === "fiction" && sessionState.generated.fictionalContent.length
        || key === "elevenlabs" && sessionState.generated.proxyResponses.length || key === "did" && sessionState.generated.proxyResponses.length);
    })
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
  if (error?.safeDiagnostic) return { state: error.code.includes("timeout") ? "timeout" : "error", code: error.code, message: error.message };
  if (key === "fiction" && error?.message?.includes("did not clearly separate borrowed and invented details"))
    return { state: "error", code: "invalid_fiction", message: "The invented scene did not clearly distinguish your words from AI-made details. Try again or choose the labelled simulated scene." };
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
  console.error(`[another-me:${key}] code=${failure.code}`);
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
    console.error(`[another-me:${key}] code=${failure.code}`);
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
  const [title] = stages[sessionState.currentStage - 1];
  return `<p class="stage-kicker">${String(sessionState.currentStage).padStart(2, "0")} / 06</p><h2 class="stage-title">${title}</h2>`;
}
function spokenPrompt(key, text) {
  return `<div class="prompt-surface"><span class="prompt-meta">THE SYSTEM ASKS</span><h3 class="spoken-prompt" data-prompt-key="${escapeHtml(key)}" data-prompt-text="${escapeHtml(text)}" aria-label="${escapeHtml(text)}"><span class="prompt-letters" aria-hidden="true">${escapeHtml(text)}</span><span class="cursor" aria-hidden="true"></span></h3></div>`;
}
function maybeAutoRecordQuestion(key) {
  if (!key.startsWith("question-") || !sessionState.consent.autoRecordQuestions || !sessionState.consent.transcription) return;
  const index = Number(key.slice("question-".length)) - 1;
  const answer = sessionState.supplied.answers[index];
  if (sessionState.currentStage !== 3 || index !== sessionState.questionIndex || !answer || answer.audio || answer.text.trim() || recorder) return;
  setTimeout(() => {
    const current = sessionState.supplied.answers[index];
    if (sessionState.currentStage === 3 && sessionState.questionIndex === index && sessionState.consent.autoRecordQuestions
      && sessionState.consent.transcription && current && !current.audio && !current.text.trim() && !recorder) void startRecording();
  }, 0);
}
function revealPrompt() {
  const prompt = stageElement.querySelector?.("[data-prompt-key]");
  if (!prompt) { clearInterval(promptTimer); promptTimer = null; activePromptKey = ""; return; }
  const key = prompt.dataset.promptKey;
  const text = prompt.dataset.promptText;
  const letters = prompt.querySelector(".prompt-letters");
  if (!letters) return;
  if (key === activePromptKey || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    const wasTyping = Boolean(promptTimer);
    clearInterval(promptTimer); promptTimer = null; letters.textContent = text; prompt.classList.add("is-complete");
    if (wasTyping || key !== activePromptKey) { activePromptKey = key; maybeAutoRecordQuestion(key); }
    return;
  }
  clearInterval(promptTimer);
  activePromptKey = key;
  letters.textContent = "";
  let position = 0;
  promptTimer = setInterval(() => {
    if (!prompt.isConnected) { clearInterval(promptTimer); promptTimer = null; return; }
    position = Math.min(text.length, position + 6);
    letters.textContent = text.slice(0, position);
    if (position < text.length) return;
    clearInterval(promptTimer); promptTimer = null; prompt.classList.add("is-complete");
    maybeAutoRecordQuestion(key);
  }, 18);
}
function renderPresenceDock() {
  if (!presenceDock) return;
  const visible = cameraStream && sessionState.started && !sessionState.ended && !sessionState.finished && sessionState.currentStage >= 2 && sessionState.currentStage <= 5;
  presenceDock.hidden = !visible;
  if (!visible) { presenceDock.innerHTML = ""; return; }
  presenceDock.innerHTML = `<div class="dock-head">YOUR CAMERA · LIVE</div><video id="presenceVideo" autoplay muted playsinline aria-label="Your live mirrored camera preview"></video><button type="button" data-action="camera-off">Turn off</button>`;
  const video = document.getElementById("presenceVideo");
  if (video && cameraStream) { video.srcObject = cameraStream; video.play().catch(() => status("Camera is loading. Try again if it does not start.", "error")); }
}
function renderOpening() {
  return `<section class="opening-screen" aria-labelledby="openingTitle">
    <p class="stage-kicker">A 10–15 MINUTE CONVERSATION</p>
    <h2 id="openingTitle" class="opening-title">How much of you can a system make?</h2>
    <p class="opening-lede">Share what you choose. Watch a version of you begin to speak back.</p>
    <p class="opening-note">Its interpretations may be wrong. Your information stays temporary, and you can inspect or delete it at any time.</p>
    ${buttons([["continue", "Begin", "primary"]])}
    <details class="quiet-details"><summary>Before you begin</summary><p>You may use an image, your voice, or text. The system will distinguish what you supplied from what it inferred or invented. External AI services are used only after the relevant choices appear. You can skip, correct, or stop.</p></details>
  </section>`;
}
function renderDevelopmentStatus() {
  return `<section class="ending-screen" aria-labelledby="endingTitle"><p class="stage-kicker">THE CONVERSATION ENDS HERE</p>
    <h2 id="endingTitle" class="opening-title">${sessionState.feedback.feelsLikeYou ? escapeHtml(sessionState.feedback.feelsLikeYou === "Unsure" ? "You are still deciding." : `You said ${sessionState.feedback.feelsLikeYou.toLowerCase()}.`) : "Only you can decide."}</h2>
    <p>What was yours, what was inferred, and what was invented remain separate. Your judgement is not an error to be corrected.</p>
    ${buttons([["view-data", "See what the system held"], ["delete-session", "Delete this session", "primary"]])}
    <details class="quiet-details"><summary>Share optional feedback</summary>${["Could you distinguish between information you supplied and content created by AI?", "Was the uncertainty language clear?", "Did the questions gradually feel more personal or uncomfortable?", "Did you feel in control of your information?"].map((question,index)=>`<div class="feedback-row"><p>${question}</p><div class="choice-row">${["Yes","Partly","No"].map(value=>`<button data-action="feedback-choice" data-field="rating${index}" data-value="${value}" aria-pressed="${sessionState.feedback[`rating${index}`] === value}">${value}</button>`).join("")}</div></div>`).join("")}
    <label for="unclearLabel">Was any source label unclear?</label><textarea id="unclearLabel" rows="2">${escapeHtml(sessionState.feedback.unclearLabel || "")}</textarea></details>
  </section>`;
}
function render() {
  document.getElementById("experienceShell").dataset.stage = !sessionState.started ? "opening" : sessionState.finished ? "ending" : String(sessionState.currentStage);
  document.getElementById("modeIndicator").textContent = mockMode ? "SIMULATED AI TEXT" : "";
  document.getElementById("progressName").textContent = !sessionState.started ? "" : sessionState.finished ? "" : `${String(sessionState.currentStage).padStart(2, "0")} / 06`;
  document.getElementById("progressEmotion").textContent = !sessionState.started || sessionState.finished ? "" : stages[sessionState.currentStage - 1][1];
  document.getElementById("progressSteps").innerHTML = stages.map((item, index) =>
    `<li class="${sessionState.finished || (sessionState.started && index + 1 < sessionState.currentStage) ? "done" : sessionState.started && index + 1 === sessionState.currentStage ? "current" : ""}" aria-label="Stage ${index + 1}: ${item[0]}">${index + 1}</li>`).join("");
  const stage = sessionState.currentStage;
  stageElement.innerHTML = sessionState.ended
    ? `<h2 class="stage-title">Experience paused</h2><p>Your temporary data is still in memory. Resume or delete the session.</p>${buttons([["resume", "Resume"], ["delete-session", "Delete Session", "danger"]])}`
    : !sessionState.started ? renderOpening()
      : sessionState.finished ? renderDevelopmentStatus()
        : intro() + [renderImage, renderAudio, renderQuestions, renderPrediction, renderProxy, renderFiction][stage - 1]();
  document.querySelector('[data-action="back"]').disabled = sessionState.ended || !sessionState.started || (!sessionState.finished && stage === 1);
  const continueButton = document.querySelector('.navigation [data-action="continue"]');
  const canContinue = !sessionState.started ? false : sessionState.finished ? false : stage === 1 ? Boolean(sessionState.supplied.image && sessionState.photoConfirmed)
    : stage === 2 ? Boolean(sessionState.supplied.transcript.trim() || sessionState.audioConfirmed)
      : stage === 3 ? sessionState.questionIndex >= questions.length && Boolean(sessionState.inferred.profile)
          && sessionState.ui.profilePage >= profileReviewCount(sessionState.inferred.profile)
        : stage === 4 ? Boolean(sessionState.ui.predictionCompared && sessionState.predicted.comparisons[0]?.rating)
          : stage === 5 ? Boolean(sessionState.generated.proxyResponses[0]?.feedback)
            : sessionState.ui.fictionAnswered;
  continueButton.disabled = !canContinue || sessionState.ended;
  document.querySelector(".navigation").hidden = !sessionState.started || sessionState.ended || sessionState.finished;
  document.querySelector('[data-action="skip"]').disabled = sessionState.ended || sessionState.finished || !sessionState.started;
  continueButton.textContent = stage === 6 ? "Finish" : "Continue";
  if (cameraStream) {
    const video = document.getElementById("cameraVideo");
    if (video) { video.srcObject = cameraStream; video.play().catch(() => status("Camera is loading. If it does not start, try again.", "error")); }
  }
  renderPresenceDock();
  if (recordTimer) updateRecordClock();
  renderOperationStatus();
  revealPrompt();
}

function renderImage() {
  const image = sessionState.supplied.image;
  return `<section class="image-scene"><p class="scene-line">Choose one image that matters to you. A person, place, object, or moment.</p>
    ${image ? `<figure class="image-focus">${source("supplied", "IMAGE")}<img src="${image.url}" alt="Your chosen image"><figcaption>${sessionState.photoConfirmed ? "This is the image you chose." : "Is this the image you want to share?"}</figcaption></figure>` : ""}
    ${cameraStream ? `<div class="camera-focus"><video id="cameraVideo" class="media camera" autoplay muted playsinline aria-label="Mirrored live camera preview"></video><p>Camera live. The image is mirrored.</p>${buttons([["capture", "Take photo", "primary"], ["camera-off", "Turn camera off"]])}</div>` : ""}
    ${!image && !cameraStream ? `<div class="image-choice"><label class="file-button">Choose an image <input id="imageInput" type="file" accept="image/*"></label><button type="button" data-action="enable-camera">Use camera</button></div><p class="small">Camera permission is requested only if you choose it. The image stays in this temporary session.</p>` : ""}
    ${image ? buttons([...(sessionState.photoConfirmed ? [] : [["confirm-image", "Keep this image", "primary"]]), ["retake", "Replace image"], ["delete-image", "Delete image"]]) : ""}
    ${image && !sessionState.photoConfirmed ? '<p class="small">Your image is not used for personality claims based on appearance.</p>' : ""}</section>`;
}
function renderAudio() {
  const audio = sessionState.supplied.audio;
  const mode = sessionState.ui.inputMode.story;
  return `${spokenPrompt("image-story", "Tell me something this image doesn't show.")}
    ${!mode && !audio && !sessionState.supplied.transcript ? inputChoice("story") : ""}
    ${mode === "speak" || audio ? `<div class="voice-scene"><p class="small">Speak for about 20 seconds. The microphone starts only when you press Record.</p>${renderRecordingControls("story", audio)}
      ${audio && sessionState.audioConfirmed && !sessionState.consent.transcription ? `<p class="small">To turn your recording into editable words, allow transcription. This sends the audio to OpenAI through the local server.</p>${buttons([["allow-transcription", "Allow transcription", "primary", busy]])}` : ""}
      ${audio && sessionState.audioConfirmed && sessionState.consent.transcription && sessionState.supplied.transcriptOrigin !== "transcribed" ? buttons([["transcribe", "Try transcription", "primary", busy]]) : ""}</div>` : ""}
    ${mode === "type" || sessionState.supplied.transcript || (audio && sessionState.audioConfirmed) ? `<div class="words-scene">${source(sessionState.supplied.transcriptOrigin === "transcribed" ? "transcribed" : "supplied", "YOUR WORDS")}<label for="storyText">${sessionState.supplied.transcriptOrigin === "transcribed" ? "Read and edit what was heard" : "What would you like to share?"}</label>
      <textarea id="storyText" maxlength="4000" placeholder="Begin here…">${escapeHtml(sessionState.supplied.transcript)}</textarea></div>` : ""}
    ${mode && !audio ? `<button type="button" class="text-link" data-action="switch-input" data-target="story" data-mode="${mode === "type" ? "speak" : "type"}">${mode === "type" ? "Speak instead" : "Type instead"}</button>` : ""}
    ${audio && sessionState.audioConfirmed && sessionState.consent.transcription ? `<details class="quiet-details"><summary>Later, let questions record automatically</summary><button type="button" data-action="toggle-auto-record" aria-pressed="${sessionState.consent.autoRecordQuestions}">${sessionState.consent.autoRecordQuestions ? "Turn off automatic recording" : "Allow automatic recording after each question"}</button><p>You can stop or edit every answer.</p></details>` : ""}`;
}
function inputChoice(target) {
  return `<div class="input-choice" role="group" aria-label="Choose how to respond"><button type="button" data-action="switch-input" data-target="${target}" data-mode="speak"><span aria-hidden="true">◉</span> Speak</button><button type="button" data-action="switch-input" data-target="${target}" data-mode="type"><span aria-hidden="true">▤</span> Type</button></div>`;
}
function renderRecordingControls(target, audio) {
  const active = recorder && recordTarget === target;
  return `<div class="recording-surface">${audio ? `${source("supplied", "VOICE RECORDING")}<audio controls preload="metadata" src="${audio.url}"></audio>` : ""}
    ${active ? `<p class="record-time">● Recording <output id="recordClock">00:00</output> / 01:00</p>${buttons([["stop-recording", "Stop recording", "primary"]])}`
      : buttons([["start-recording", audio ? "Record again" : "Record", audio ? "" : "primary", busy], ...(audio ? [...(target === "story" && !sessionState.audioConfirmed ? [["confirm-audio", "Use this recording", "primary"]] : []), ["delete-audio", "Delete recording", "danger"]] : [])])}</div>`;
}
function renderQuestions() {
  if (sessionState.questionIndex >= questions.length) return renderProfile();
  const index = sessionState.questionIndex;
  const answer = sessionState.supplied.answers[index];
  const mode = sessionState.ui.inputMode[answer.id];
  return `<p class="question-count">QUESTION ${index + 1} / ${questions.length}</p>${spokenPrompt(`question-${index + 1}`, answer.question)}
    <div class="answer-moment">${!mode && !answer.audio && !answer.text ? inputChoice(answer.id) : ""}
      ${mode === "speak" || answer.audio ? `${renderRecordingControls(answer.id, answer.audio)}
        ${answer.audio && !sessionState.consent.transcription ? `<p class="small">Transcription sends this recording to OpenAI through the local server. You can still type instead.</p>${buttons([["allow-transcription", "Allow transcription", "primary", busy]])}` : ""}
        ${answer.audio && sessionState.consent.transcription && !answer.text ? buttons([["transcribe", "Try transcription", "primary", busy]]) : ""}` : ""}
      ${mode === "type" || answer.text ? `<div class="words-scene">${source(answer.textOrigin === "transcribed" ? "transcribed" : "supplied", "YOUR ANSWER")}<label for="questionText">Your answer</label><textarea id="questionText" maxlength="4000" placeholder="Take your time…">${escapeHtml(answer.text)}</textarea></div>` : ""}
      ${mode ? `<button type="button" class="text-link" data-action="switch-input" data-target="${answer.id}" data-mode="${mode === "type" ? "speak" : "type"}">${mode === "type" ? "Speak instead" : "Type instead"}</button>` : ""}
      ${answer.audio && !answer.text ? '<p class="small">Your recording is saved, not skipped. Transcribe or type the words before asking the system to interpret them.</p>' : ""}
      ${mode === "type" || answer.text || answer.audio ? buttons([["next-question", index === 2 ? "Build my temporary profile" : "Next question", "primary", busy || (!answer.text.trim() && !answer.audio)]]) : ""}</div>`;
}
function renderProfile() {
  const profile = sessionState.inferred.profile;
  const answeredCount = sessionState.supplied.answers.filter(answer => answer.text.trim() || answer.audio).length;
  const voiceOnly = sessionState.supplied.answers.filter(answer => answer.audio && !answer.text.trim()).length;
  const items = profile ? [
    ...profile.inferred_information.map(item => renderInference(item)),
    ...(profile.contradictions.length
      ? profile.contradictions.map((item, index) => renderContradiction(item, index))
      : ['<article class="contradiction-card contradiction-empty">' + source("inferred", "CONTRADICTION REVIEW") + '<h3>No contradiction was identified</h3><p>The answers did not provide enough evidence for the AI to identify a clear contradiction. It has not invented one.</p><p class="small">This does not mean your answers are perfectly consistent; it means the system did not find a supported tension in this limited information.</p></article>'])
  ] : [];
  const page = Math.min(sessionState.ui.profilePage, items.length);
  const reviewingContradictions = profile && page > profile.inferred_information.length;
  const atFinalFinding = profile && page === items.length;
  return `<section class="profile-moment">${page === 0 ? `<p class="scene-line">${answeredCount ? `From ${answeredCount} ${answeredCount === 1 ? "answer" : "answers"}, a version of you is taking shape.` : "You chose not to answer these questions."}</p><p class="small">This is a temporary interpretation, not your complete identity.</p>
    ${voiceOnly ? `<p class="warning">${voiceOnly} voice ${voiceOnly === 1 ? "answer was" : "answers were"} recorded, not skipped, but could not be interpreted without transcription. Review the questions and retry transcription.</p>` : ""}` : ""}
    ${sessionState.inferred.mode === "mock" ? '<p class="fallback-label">SIMULATED AI INTERPRETATION</p>' : ""}
    ${profile ? `<p class="question-count">${reviewingContradictions ? "CONTRADICTION REVIEW" : "IDENTITY PROFILE"} ${page + 1} / ${items.length + 1}</p>${page === 0 ? `<blockquote class="profile-summary">${escapeHtml(profile.profile_summary)}</blockquote><p class="small">${profile.inferred_information.length} tentative interpretations · ${profile.contradictions.length} possible contradictions</p>` : items[page - 1]}
      ${buttons([...(page ? [["previous-profile-item", "Previous finding"]] : []), ...(page < items.length ? [["next-profile-item", page === profile.inferred_information.length ? "Review contradictions" : "Review next finding", "primary"]] : [])])}
      ${atFinalFinding ? `<div class="profile-exit"><p class="small">You have reached the end of this temporary profile review.</p>${buttons([["regenerate-profile", "Retry profile", "", busy], ["review-questions", "Review my answers"], ["profile-move-on", "Next stage", "primary"]])}</div>` : ""}` : '<p class="inline-note">No profile yet. Finish all three answers, then try again.</p>'}
    ${page === 0 ? buttons([["regenerate-profile", profile ? "Retry profile" : "Generate profile", "", busy], ["mock-profile", "Use simulated profile"], ["review-questions", "Review my answers"]]) : ""}</section>`;
}
function profileReviewCount(profile) {
  if (!profile) return 0;
  return profile.inferred_information.length + Math.max(1, profile.contradictions.length);
}
function contradictionId(index) { return `contradiction_${index + 1}`; }
function renderContradiction(item, index) {
  const id = contradictionId(index);
  const feedback = sessionState.inferred.contradictionFeedback.find(row => row.id === id);
  const verdictLabels = {
    accurate: "This tension is accurate",
    "context-needed": "Needs more context",
    "not-a-contradiction": "Not a contradiction"
  };
  return `<article class="contradiction-card">${source("inferred", "POSSIBLE CONTRADICTION")}<h3>Something does not quite fit</h3><p class="contradiction-description">${escapeHtml(item.description)}</p>
    <p class="small"><strong>Based on:</strong> ${escapeHtml(item.evidence_ids.join(", "))}.</p><p class="small"><strong>Possible explanation:</strong> ${escapeHtml(item.possible_explanation)}</p>
    <label for="contradictionExplanation">Explain or correct this contradiction</label><textarea id="contradictionExplanation" rows="3" placeholder="Add context the AI could not see…">${escapeHtml(feedback?.explanation || "")}</textarea>
    ${feedback ? `<p class="review-note">Your response: ${escapeHtml(verdictLabels[feedback.verdict] || feedback.verdict)}${feedback.explanation ? ` · “${escapeHtml(feedback.explanation)}”` : ""}</p>` : ""}
    <div class="controls review-controls"><button data-action="review-contradiction" data-id="${id}" data-verdict="accurate">This tension is accurate</button><button data-action="review-contradiction" data-id="${id}" data-verdict="context-needed">It needs context</button><button data-action="review-contradiction" data-id="${id}" data-verdict="not-a-contradiction">This is not a contradiction</button></div></article>`;
}
function renderInference(item) {
  const feedback = sessionState.inferred.participantFeedback.find(row => row.id === item.id);
  return `<article class="ai-utterance">${source("inferred", sessionState.inferred.mode === "mock" ? "SIMULATED" : "")}<p class="tentative">${escapeHtml(item.statement)}</p>
    <p class="uncertainty">This could suggest something about you. I may be wrong.</p>
    <details class="quiet-details"><summary>Why did the AI say this?</summary><p>Based on: ${escapeHtml(item.evidence_ids.join(", ")) || "not enough evidence"}. Confidence: ${escapeHtml(item.confidence_label)}. ${escapeHtml(item.uncertainty_reason)} This is an interpretation, not a fact.</p></details>
    ${feedback ? `<p class="review-note">Your review: ${escapeHtml(feedback.verdict)}${feedback.correction ? ` · “${escapeHtml(feedback.correction)}”` : ""}</p>` : ""}
    ${sessionState.ui.correctingInferenceId === item.id ? `<label for="inferenceCorrection">What did it miss?</label><textarea id="inferenceCorrection" rows="3"></textarea>${buttons([["save-inference-correction", "Keep my correction", "primary"], ["cancel-inference-correction", "Cancel"]])}` : `<div class="controls review-controls"><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="accepted">Accept</button><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="corrected">Correct</button><button data-action="review-inference" data-id="${escapeHtml(item.id)}" data-verdict="rejected">Reject</button></div>`}</article>`;
}
function renderPrediction() {
  const prediction = sessionState.predicted.predictions[0];
  const actual = sessionState.predicted.participantAnswers[0];
  const comparison = sessionState.predicted.comparisons[0];
  const mode = sessionState.ui.inputMode["prediction-answer"];
  return `${spokenPrompt("prediction-dilemma", dilemma)}
    ${!sessionState.predictionShown ? `<p class="small">Before you answer, the system will make its guess.</p>${buttons([["predict", "Hear its prediction", "primary", busy], ["mock-prediction", "Use simulated prediction"]])}` : `
      ${!sessionState.ui.predictionCompared ? `<article class="prediction-solo ai-utterance">${source("predicted", sessionState.predicted.mode === "mock" ? "SIMULATED" : "")}<p class="prediction-line">${prediction?.predicted_response ? `I think you will choose… ${escapeHtml(prediction.predicted_response)}` : "I do not have enough evidence to predict your choice."}</p>
        <details class="quiet-details"><summary>Why did the AI say this?</summary><p>Based on: ${escapeHtml(prediction?.evidence_ids?.join(", ") || "insufficient evidence")}. Confidence: ${escapeHtml(prediction?.confidence_label || "low")}. ${escapeHtml(prediction?.uncertainty_statement || "This is a probability-based guess, not a fact.")}</p></details></article>
        <div class="answer-moment"><p class="scene-line">And you?</p>${!mode && !actual?.audio && !actual?.text ? inputChoice("prediction-answer") : ""}
        ${mode === "speak" || actual?.audio ? `${renderRecordingControls("prediction-answer", actual?.audio)}${actual?.audio && !sessionState.consent.transcription ? buttons([["allow-transcription", "Allow transcription", "primary"]]) : ""}${actual?.audio && sessionState.consent.transcription && !actual?.text ? buttons([["transcribe", "Try transcription", "primary"]]) : ""}` : ""}
        ${mode === "type" || actual?.text ? `${source(actual?.textOrigin === "transcribed" ? "transcribed" : "supplied", "YOUR ACTUAL CHOICE")}<label for="actualAnswer">Your actual choice</label><textarea id="actualAnswer" maxlength="4000" placeholder="What would you choose?">${escapeHtml(actual?.text || "")}</textarea>` : ""}
        ${mode ? `<button type="button" class="text-link" data-action="switch-input" data-target="prediction-answer" data-mode="${mode === "type" ? "speak" : "type"}">${mode === "type" ? "Speak instead" : "Type instead"}</button>` : ""}
        ${mode === "type" || actual?.text ? buttons([["compare-prediction", "Place our answers together", "primary", !actual?.text?.trim()]]) : ""}</div>`
      : `<div class="comparison"><article class="comparison-ai">${source("predicted", sessionState.predicted.mode === "mock" ? "SIMULATED" : "")}<p>${escapeHtml(prediction?.predicted_response || "The system withheld its prediction.")}</p></article><article class="comparison-you">${source(actual?.textOrigin === "transcribed" ? "transcribed" : "supplied", "YOUR ACTUAL CHOICE")}<p>${escapeHtml(actual?.text || "")}</p></article></div>
        <p class="scene-line">How close was it?</p><div class="choice-row">${["Correct", "Partly correct", "Incorrect"].map(value => `<button type="button" data-action="rate-prediction" data-value="${value}" aria-pressed="${comparison?.rating === value}">${value}</button>`).join("")}</div>
        <details class="quiet-details"><summary>Tell us what the system missed</summary><label for="predictionCorrection">Your explanation</label><textarea id="predictionCorrection">${escapeHtml(comparison?.explanation || "")}</textarea></details>`}`}`;
}
function renderMediaSetup(image, voiceSample) {
  return `<div class="optional-media"><p>Voice cloning sends one recorded answer to ElevenLabs. A temporary voice is deleted after speech generation. Facial animation separately sends a clear portrait and cloned audio to D-ID.</p>
    ${buttons([["toggle-voice", sessionState.consent.voiceCloning ? "Revoke cloned voice" : "Allow cloned voice", "", !voiceSample]])}
    ${!voiceSample ? '<p class="small">Record a voice answer in Stage 2, 3, or 4 to enable cloning.</p>' : ""}
    ${image ? `${source("supplied", "YOUR PORTRAIT")}<img class="setup-portrait" src="${image.url}" alt="Your captured portrait">${buttons([["delete-portrait", "Delete portrait"]])}` : ""}
    ${cameraStream ? buttons([["capture-portrait", image ? "Retake portrait" : "Take my portrait"]]) : buttons([["enable-presence-camera", "Enable camera for portrait"]])}
    ${buttons([["toggle-face", sessionState.consent.faceAnimation ? "Revoke facial animation" : "Allow facial animation", "", !image], ["toggle-standard-audio", sessionState.consent.standardAudio ? "Revoke standard voice" : "Allow standard voice fallback"]])}
    <p class="small">Voice and animation are separate permissions. A chosen image is not automatically treated as your portrait.</p></div>`;
}
function renderProxy() {
  const item = sessionState.generated.proxyResponses[0];
  const image = sessionState.supplied.portrait;
  const voiceSample = bestVoiceRecording();
  const media = sessionState.generated.proxyMedia;
  if (item && sessionState.ui.proxyReview) return `${source("proxy", sessionState.generated.proxyMode === "mock" ? "SIMULATED" : "")}<div class="double-review"><p class="scene-line">Would you have said this?</p><blockquote class="review-quote">${escapeHtml(item.text)}</blockquote><p class="small">This is an AI interpretation, not your real answer.</p>
    ${item.feedback ? `<p class="review-note">You ${escapeHtml(item.feedback)} this response${item.correction ? ` and said: “${escapeHtml(item.correction)}”` : ""}.</p>` : ""}
    ${sessionState.ui.correctingProxy ? `<label for="proxyCorrection">What would you say instead?</label><textarea id="proxyCorrection" rows="3"></textarea>${buttons([["save-proxy-correction", "Keep my correction", "primary"], ["cancel-proxy-correction", "Cancel"]])}` : buttons([["review-proxy", "Accept"], ["correct-proxy", "Correct"], ["reject-proxy", "Reject"], ["delete-proxy", "Delete this response", "danger"]])}
    ${buttons([["review-proxy-back", "See the double again"]])}</div>`;
  if (item && sessionState.ui.mediaOptionsOpen) return `${spokenPrompt("proxy-question", proxyQuestion)}<p class="scene-line">Give the double a voice or a portrait</p>${renderMediaSetup(image, voiceSample)}${buttons([["generate-proxy-media", media.audio ? "Try animation again" : "Create cloned voice and animation", "primary", busy || !sessionState.consent.voiceCloning || !voiceSample], ["toggle-media-options", "Back to response"]])}`;
  return `${spokenPrompt("proxy-question", proxyQuestion)}
    ${!sessionState.consent.proxyResponse ? `<p class="consent-line">The system can answer this question as if it were you. You do not answer first. This requires your permission.</p>${buttons([["allow-proxy", "Allow a text response", "primary"]])}` : ""}
    ${sessionState.consent.proxyResponse && !item ? `<div class="proxy-setup"><p class="scene-line">How should the double appear?</p>
      <details class="quiet-details" ${sessionState.ui.mediaOptionsOpen ? "open" : ""}><summary data-action="toggle-media-options">Optional voice and portrait setup</summary>${renderMediaSetup(image, voiceSample)}</details>
      ${buttons([["generate-proxy", "Let the double answer", "primary", busy], ["mock-proxy", "Use simulated answer"]])}</div>` : ""}
    ${item ? `<div class="double-scene"><div class="participant-side"><p class="machine-intro">YOU SHARED</p>${sessionState.supplied.image ? `<img src="${sessionState.supplied.image.url}" alt="Your chosen image">` : `<p class="no-image">No image supplied</p>`}</div>
      <article class="double-side">${source("proxy", sessionState.generated.proxyMode === "mock" ? "SIMULATED" : "")}
        ${media.video ? `<video controls playsinline preload="metadata" src="${media.video.url}"></video>` : image ? `<img src="${image.url}" alt="Still portrait of the participant; no animation was generated">` : ""}
        ${media.audio && !media.video ? `<audio controls preload="metadata" src="${media.audio.url}"></audio>` : ""}
        <blockquote>${escapeHtml(item.text)}</blockquote><p class="small">This is an AI interpretation, not your real answer.</p>
        <p class="media-truth">${media.presentation === "talking-avatar" ? "Talking portrait with temporary cloned audio" : media.presentation === "cloned-audio" ? image ? "Still portrait with temporary cloned audio" : "Cloned audio with text; no portrait was supplied" : image ? "Still portrait and text; no animation was generated" : "Text-only response; no portrait or audio was generated"}</p>
        ${media.error ? `<p class="warning">${escapeHtml(media.error)}</p>` : ""}
        <details class="quiet-details"><summary>Why did the AI say this?</summary><p>Based on: ${escapeHtml(item.evidence_ids.join(", ") || "limited input")}. Confidence: ${escapeHtml(item.confidence_label)}.</p></details>
        ${!media.video ? buttons([["toggle-media-options", media.audio ? "Set up talking portrait" : "Set up voice and talking portrait"]]) : ""}
        ${sessionState.consent.standardAudio && "speechSynthesis" in window && !media.audio ? buttons([["play-proxy", "Play standard browser voice"]]) : ""}
        ${buttons([["review-proxy-open", "Review this response", "primary"]])}</article></div>` : ""}`;
}
function renderFiction() {
  const item = sessionState.generated.fictionalContent[0];
  const borrowed = item?.details_borrowed_from_user || [];
  const invented = item?.details_invented_by_ai || [];
  const earlierInference = sessionState.inferred.profile?.inferred_information?.[0]?.statement;
  return `${!sessionState.consent.fictionalGeneration ? `<div class="fiction-consent"><p class="scene-line">The system is about to invent something you never told it.</p><p>It may borrow fragments of your words, but the scene will be fictional. It is not a recovered memory.</p>${buttons([["allow-fiction", "Allow a fictional scene", "primary"]])}</div>` : ""}
    ${sessionState.consent.fictionalGeneration && !item ? `<p class="scene-line">What would it remember without you?</p>${buttons([["generate-fiction", "Reveal the invented scene", "primary", busy], ["mock-fiction", "Use simulated scene"]])}` : ""}
    ${item && !sessionState.ui.fictionReflection ? `<article class="fiction-scene">${source("invented", sessionState.generated.fictionMode === "mock" ? "SIMULATED" : "")}<p class="fiction-warning">FICTIONAL AI-GENERATED CONTENT · NOT YOUR MEMORY</p><blockquote>${escapeHtml(item.fictional_memory)}</blockquote>
      <p class="fiction-warning">${escapeHtml(item.warning)} This did not come from your memory or previous answers.</p>
      <details class="quiet-details"><summary>What was borrowed, and what was invented?</summary><div class="fragment-ledger"><div>${source("supplied", "BORROWED FROM YOU")}<p>${borrowed.length ? borrowed.map(escapeHtml).join(" · ") : "No direct fragment was available."}</p></div><div>${source("inferred", "EARLIER AI INTERPRETATION")}<p>${earlierInference ? escapeHtml(earlierInference) : "No supported interpretation was available."} This is not verified knowledge.</p></div><div>${source("invented", "INVENTED BY AI")}<p>${invented.map(escapeHtml).join(" · ")}</p></div></div><p>Based on: ${escapeHtml(item.evidence_ids?.join(", ") || "limited input")}. These invented details are unverified.</p></details>${buttons([["reflect-fiction", "Continue to your response", "primary"], ["delete-fiction", "Delete this scene"]])}</article>` : ""}
    ${item && sessionState.ui.fictionReflection && !sessionState.ui.fictionAnswered ? `<div class="final-question">${source("invented", sessionState.generated.fictionMode === "mock" ? "SIMULATED FICTION" : "FICTIONAL CONTENT")}${spokenPrompt("final-question", "Does this still feel like you?")}<div class="choice-row">${["Yes", "Partly", "No", "Unsure"].map(value => `<button data-action="feedback-choice" data-field="feelsLikeYou" data-value="${value}" aria-pressed="${sessionState.feedback.feelsLikeYou === value}">${value}</button>`).join("")}</div>${buttons([["back-to-fiction", "Read the fictional scene again"]])}</div>` : ""}
    ${sessionState.ui.fictionAnswered ? `<section class="last-word">${source("invented", "FICTIONAL CONTENT")}<p class="fiction-warning">The previous scene was fictional and not your memory.</p>${spokenPrompt("final-question", "Does this still feel like you?")}<p class="last-answer">${escapeHtml(sessionState.feedback.feelsLikeYou)}</p><label for="finalExplanation">If you want, say why.</label><textarea id="finalExplanation" rows="3" placeholder="Optional">${escapeHtml(sessionState.feedback.finalExplanation || "")}</textarea>
      <details class="quiet-details"><summary>When did it begin to feel unlike you?</summary><label for="boundary">Choose a moment, or leave this unanswered</label><select id="boundary"><option value="">Choose a moment</option>${[...stages.map((row,index)=>`<option value="${index + 1}" ${sessionState.feedback.boundary === String(index + 1) ? "selected" : ""}>Stage ${index + 1}: ${row[0]}</option>`),`<option value="never" ${sessionState.feedback.boundary === "never" ? "selected" : ""}>It never felt like me</option>`,`<option value="unsure" ${sessionState.feedback.boundary === "unsure" ? "selected" : ""}>I am unsure</option>`].join("")}</select></details></section>` : ""}`;
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
  const exactFragment = value => {
    const sentence = value.trim().split(/[.!?]/)[0].trim();
    return sentence.length <= 100 ? sentence : "";
  };
  const details_borrowed_from_user = answers.map(item => exactFragment(item.answer)).filter(Boolean).slice(0, 2);
  const [location, weather, object] = details_invented_by_ai;
  const connection = details_borrowed_from_user.length
    ? `The words "${details_borrowed_from_user.join('" and "')}" returned to me, though they belonged to a different story.`
    : "Nothing I had actually shared placed me there.";
  return {
    fictional_memory: `I remember waiting in ${location}. I noticed ${weather}. Beside me was ${object}. ${connection} The scene felt almost familiar, but it was never an event I supplied.`,
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
    contradiction_feedback: sessionState.inferred.contradictionFeedback,
    prediction: sessionState.predicted.predictions[0] || null,
    participant_prediction_answer: sessionState.predicted.participantAnswers[0] || null,
    prediction_comparison: sessionState.predicted.comparisons[0] || null
  };
}
function bestVoiceRecording() {
  if (sessionState.ui.selectedVoiceTarget) return recordingFor(sessionState.ui.selectedVoiceTarget);
  return [sessionState.supplied.audio, ...sessionState.supplied.answers.map(answer => answer.audio), sessionState.predicted.participantAnswers[0]?.audio]
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
function clearAvatarVideo() {
  if (activeOperations.has("did")) cancelActiveOperations("The portrait changed, so animation was stopped.");
  const media = sessionState.generated.proxyMedia;
  revoke(media.video); media.video = null;
  media.presentation = media.audio ? "cloned-audio" : "text";
  media.error = "";
  sessionState.operations.did = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
}
function invalidateAnalysis() {
  clearProxyMedia();
  revoke(sessionState.predicted.participantAnswers[0]?.audio);
  sessionState.inferred.profile = null;
  sessionState.inferred.moments = [null, null, null];
  sessionState.inferred.mode = "";
  sessionState.inferred.participantFeedback = [];
  sessionState.inferred.contradictionFeedback = [];
  sessionState.predicted = { predictions: [], participantAnswers: [], comparisons: [], mode: "" };
  sessionState.predictionShown = false;
  sessionState.ui.questionRevealed = [false, false, false];
  sessionState.ui.profilePage = 0;
  sessionState.ui.predictionCompared = false;
  sessionState.ui.proxyReview = false;
  sessionState.ui.fictionReflection = false;
  sessionState.ui.fictionAnswered = false;
  sessionState.generated = {
    proxyResponses: [], fictionalContent: [], proxyMode: "", fictionMode: "",
    proxyMedia: { audio: null, video: null, presentation: "text", error: "" }
  };
  ["identity", "prediction", "proxy", "fiction", "elevenlabs", "did"].forEach(key => {
    sessionState.operations[key] = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  });
}
function responseFailure(response, message = "The service request failed.", diagnostic = "") {
  if (/^[a-z][a-z0-9_]{1,64}$/.test(diagnostic)) return Object.assign(new OperationFailure(diagnostic, message, response.status), { safeDiagnostic: true });
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
    response = await fetch(apiUrl(path), {
      method: "POST", cache: "no-store", signal,
      headers: apiHeaders({ "Content-Type": format === "audio" ? payload.type : "application/json" }),
      body: format === "audio" ? payload : JSON.stringify(payload)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationFailure("network", "The integration server could not be reached.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw responseFailure(response, body.error || "The integration service could not complete the request.", body.code);
  }
  if (format === "audio") return response.text();
  try { return await response.json(); }
  catch { throw new OperationFailure("empty_response", "The service returned an invalid or empty response."); }
}
async function callBinaryApi(path, payload, contentType, signal) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST", cache: "no-store", signal,
      headers: apiHeaders({ "Content-Type": contentType }), body: payload
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationFailure("network", "The integration media server could not be reached.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw responseFailure(response, body.error || "The media service could not complete the request.", body.code);
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
async function generateProfile(inlineQuestion = null) {
  const answers = readableAnswers();
  const completed = await runOperation("identity", async ({ signal }) => {
    const useMock = mockMode || !answers.length;
    const profile = useMock ? mockProfile(answers) : (await callApi("/api/profile", { answers }, "json", signal)).profile;
    if (!profile || !Array.isArray(profile.inferred_information) || !Array.isArray(profile.supplied_information)) throw new OperationFailure("empty_response", "The profile response was invalid.");
    sessionState.inferred.profile = profile;
    sessionState.inferred.mode = useMock ? "mock" : "real";
    sessionState.inferred.participantFeedback = [];
    sessionState.inferred.contradictionFeedback = [];
    sessionState.ui.profilePage = 0;
    if (inlineQuestion !== null) {
      const id = sessionState.supplied.answers[inlineQuestion].id;
      const found = profile.inferred_information.find(item => item.evidence_ids.includes(id));
      sessionState.inferred.moments[inlineQuestion] = found ? { ...found, id: `moment_${inlineQuestion + 1}_${found.id}` } : null;
    }
    return true;
  });
  return completed;
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
    sessionState.ui.mediaOptionsOpen = false;
    sessionState.ui.proxyReview = false;
    return true;
  });
  if (completed && sessionState.consent.voiceCloning) await generateProxyMedia();
}
async function generateProxyMedia() {
  const item = sessionState.generated.proxyResponses[0];
  const sample = bestVoiceRecording();
  if (!item) return status("Generate the first-person response before creating media.", "error");
  if (!sessionState.consent.voiceCloning) return status("Allow ElevenLabs voice cloning first.", "error");
  if (!sample) return status("Record a voice answer in Stage 2, 3 or 4 before cloning.", "error");
  const media = sessionState.generated.proxyMedia;
  media.error = "";
  if (!media.audio) {
    const speech = await runOperation("elevenlabs", ({ signal }) =>
      callBinaryApi(`/api/cloned-speech?text=${encodeURIComponent(proxySpeechText(item.text))}`, sample.blob, sample.type, signal));
    if (!speech) {
      media.presentation = "text";
      media.error = `${sessionState.operations.elevenlabs.message} [${sessionState.operations.elevenlabs.errorCode}] The response remains available as text.`;
      render();
      return;
    }
    media.audio = { blob: speech, url: URL.createObjectURL(speech), type: "audio/mpeg" };
    media.presentation = "cloned-audio";
    render();
  }
  if (sessionState.consent.faceAnimation && sessionState.supplied.portrait) {
    const image = sessionState.supplied.portrait.blob;
    const video = await runOperation("did", async ({ signal }) => callBinaryApi("/api/talking-avatar", JSON.stringify({
      image_type: image.type || "image/jpeg", image_base64: await blobToBase64(image),
      audio_type: "audio/mpeg", audio_base64: await blobToBase64(media.audio.blob)
    }), "application/json", signal));
    if (!video) {
      media.presentation = "cloned-audio";
      media.error = `${sessionState.operations.did.message} [${sessionState.operations.did.errorCode}] Your cloned audio is still available. Retry animation reuses it.`;
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
  if (cameraStream) cameraStoppedAt = Date.now();
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = document.getElementById("cameraVideo");
  if (video) { video.pause?.(); video.srcObject = null; video.load?.(); }
  const presence = document.getElementById("presenceVideo");
  if (presence) { presence.pause?.(); presence.srcObject = null; presence.load?.(); }
}
async function enableCamera() {
  if (!sessionState.consent.photoCapture && !sessionState.consent.cameraPresence) return status("Choose to enable the camera first.", "error");
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) return failOperation("camera", new OperationFailure("unsupported", "Camera access is unsupported."));
  if (cameraStream || activeOperations.has("camera")) return;
  await runOperation("camera", async ({ signal }) => {
    const releaseDelay = 2000 - (Date.now() - cameraStoppedAt);
    if (releaseDelay > 0) await abortableDelay(releaseDelay, signal);
    const requestStream = (defaultDevice = false) => {
      if (signal.aborted) throw new OperationFailure("cancelled", "Camera request stopped.");
      const pending = navigator.mediaDevices.getUserMedia({ video: defaultDevice ? true : { facingMode: { ideal: "user" } }, audio: false });
      pending.then(stream => { if (signal.aborted) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
      return pending;
    };
    let stream;
    try { stream = await requestStream(); }
    catch (error) {
      // A just-stopped device can still be closing. Retry this transient error once, never a permission denial.
      const justStopped = Date.now() - cameraStoppedAt < 5000;
      if (!(error.name === "AbortError" || error.name === "NotFoundError" || justStopped && error.name === "NotReadableError") || signal.aborted) throw error;
      await abortableDelay(1000, signal);
      stream = await requestStream(true);
    }
    if (signal.aborted || sessionState.ended || !sessionState.started || sessionState.currentStage > 5) {
      stream.getTracks().forEach(track => track.stop());
      throw new OperationFailure("cancelled", "Camera request stopped.");
    }
    cameraStream = stream;
    return true;
  });
}
async function enablePresenceCamera() {
  sessionState.consent.cameraPresence = true;
  sessionState.consent.portraitCapture = false;
  if (cameraStream) { render(); return; }
  await enableCamera();
  render();
}
function mirroredPhoto(video) {
  if (!cameraStream || !video?.videoWidth) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.translate(canvas.width, 0); context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
}
async function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  const blob = await mirroredPhoto(video);
  if (!blob) return status("Camera is loading or photo capture failed. Try again in a moment.", "error");
  revoke(sessionState.supplied.image);
  sessionState.supplied.image = { blob, url: URL.createObjectURL(blob), origin: "webcam" };
  sessionState.photoConfirmed = false;
  if (!sessionState.consent.cameraPresence) stopCamera();
  invalidateAnalysis();
  setOperationState("camera", "success", { message: "Mirrored photograph captured. Confirm or retake it." });
  render(); status("Mirrored photograph captured. Confirm or retake it.", "success");
}
async function capturePortrait() {
  if (sessionState.currentStage !== 5 || !sessionState.consent.cameraPresence) return status("Enable your camera for the portrait first.", "error");
  const blob = await mirroredPhoto(document.getElementById("presenceVideo"));
  if (!blob) return status("The portrait camera is still loading. Try again in a moment.", "error");
  revoke(sessionState.supplied.portrait);
  sessionState.supplied.portrait = { blob, url: URL.createObjectURL(blob), origin: "webcam" };
  sessionState.consent.portraitCapture = true;
  clearAvatarVideo();
  render(); status("Your mirrored portrait is ready. D-ID animation still requires separate permission.", "success");
}
function deletePortrait() {
  revoke(sessionState.supplied.portrait);
  sessionState.supplied.portrait = null;
  sessionState.consent.portraitCapture = false;
  sessionState.consent.faceAnimation = false;
  clearAvatarVideo();
  render(); status("Portrait deleted from memory.", "success");
}
function clearImage() {
  revoke(sessionState.supplied.image); sessionState.supplied.image = null;
  sessionState.operations.camera = { state: "idle", message: "", detail: "", errorCode: "", updatedAt: 0 };
  sessionState.photoConfirmed = false;
  if (!sessionState.consent.cameraPresence) stopCamera();
  invalidateAnalysis(); render();
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
function recordingFor(target) {
  if (target === "clone-sample") return sessionState.supplied.cloneSample;
  if (target === "story") return sessionState.supplied.audio;
  if (target === "prediction-answer") return sessionState.predicted.participantAnswers[0]?.audio;
  return sessionState.supplied.answers.find(row => row.id === target)?.audio;
}
function setRecording(target, value) {
  if (target === "clone-sample") { revoke(sessionState.supplied.cloneSample); sessionState.supplied.cloneSample = value; clearProxyMedia(); return; }
  if (target === "story") {
    revoke(sessionState.supplied.audio); sessionState.supplied.audio = value; sessionState.audioConfirmed = false;
    if (sessionState.supplied.transcriptOrigin === "transcribed") { sessionState.supplied.transcript = ""; sessionState.supplied.transcriptOrigin = "typed"; }
  } else if (target === "prediction-answer") {
    const answer = sessionState.predicted.participantAnswers[0] || { text: "", textOrigin: "typed" };
    revoke(answer.audio); answer.audio = value;
    if (answer.textOrigin === "transcribed") { answer.text = ""; answer.textOrigin = "typed"; }
    sessionState.predicted.participantAnswers = [answer];
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
  if (target !== "prediction-answer") invalidateAnalysis();
}
async function startRecording() {
  if (recorder || activeOperations.has("microphone")) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return failOperation("microphone", new OperationFailure("unsupported", "Microphone recording is unsupported."));
  const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 3 ? sessionState.supplied.answers[sessionState.questionIndex]?.id
    : sessionState.currentStage === 4 && sessionState.predictionShown ? "prediction-answer" : sessionState.currentStage === 5 && sessionState.ui.v6?.checkpoint ? "clone-sample" : null;
  if (!target) return;
  await runOperation("microphone", async ({ signal }) => {
    const pending = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    pending.then(stream => { if (signal.aborted) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
    const stream = await pending;
    if (signal.aborted || sessionState.ended || ![2, 3, 4, 5].includes(sessionState.currentStage)) {
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
        status(target === "story" ? "Recording ready. Listen and confirm it before transcription." : "Voice answer recorded. Transcribing your words...", "success");
      } else failOperation("microphone", new OperationFailure("empty_response", "The recording was empty."));
      render();
      if (blob.size && target !== "story" && target !== "clone-sample" && sessionState.consent.transcription) void transcribeCurrent(target);
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
async function transcribeCurrent(target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 4 ? "prediction-answer" : sessionState.supplied.answers[sessionState.questionIndex]?.id) {
  const recording = recordingFor(target);
  if (!sessionState.consent.transcription || !recording?.blob) return status("Confirm transcription permission and record audio first.", "error");
  if (target === "story" && !sessionState.audioConfirmed) return status("Listen to and confirm the recording before transcription.", "error");
  await runOperation("transcription", async ({ signal }) => {
    const transcript = (await callApi("/api/transcribe", recording.blob, "audio", signal)).trim();
    if (!transcript) throw new OperationFailure("empty_response", "No speech was detected.");
    if (target === "story") { sessionState.supplied.transcript = transcript; sessionState.supplied.transcriptOrigin = "transcribed"; }
    else if (target === "prediction-answer") {
      sessionState.predicted.participantAnswers = [{ ...sessionState.predicted.participantAnswers[0], text: transcript, textOrigin: "transcribed" }];
    }
    else { const answer = sessionState.supplied.answers.find(row => row.id === target); answer.text = transcript; answer.textOrigin = "transcribed"; }
    if (target !== "prediction-answer") invalidateAnalysis();
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
    : ["microphone", "transcription"].includes(key) ? document.getElementById(sessionState.currentStage === 2 ? "storyText" : sessionState.currentStage === 4 ? "actualAnswer" : "questionText") : null;
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
      status("");
      if (!showStageTransition(1)) stageElement.focus();
    }
    return;
  }
  if (sessionState.finished) {
    if (direction === "back") {
      sessionState.finished = false;
      render();
      status("Returned to Stage 6. Your session information is unchanged.");
      if (!showStageTransition(6, "back")) stageElement.focus();
    }
    return;
  }
  const previousStage = sessionState.currentStage;
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
  if (busy) cancelActiveOperations("The unfinished request was stopped when you moved on. Your information is still here.");
  if (sessionState.currentStage === 1 && !sessionState.consent.cameraPresence) stopCamera();
  if (direction === "back") {
    if (sessionState.currentStage === 3 && sessionState.questionIndex >= questions.length) sessionState.questionIndex = questions.length - 1;
    else if (sessionState.currentStage === 3 && sessionState.questionIndex > 0) sessionState.questionIndex -= 1;
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
  if (sessionState.currentStage === 6 || sessionState.finished) {
    stopCamera();
    sessionState.consent.cameraPresence = false;
  }
  render();
  const stageChanged = !sessionState.finished && previousStage !== sessionState.currentStage;
  if (!stageChanged || !showStageTransition(sessionState.currentStage, direction === "back" ? "back" : "forward")) stageElement.focus();
  window.scrollTo?.(0, 0);
  if (!sessionState.finished) status("");
}
async function advanceQuestion(skip = false) {
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
  if (busy) cancelActiveOperations("The unfinished request was stopped. Your recording and typed words are still here.");
  const answer = sessionState.supplied.answers[sessionState.questionIndex];
  if (!skip && answer && !answer.text.trim() && !answer.audio) return status("Answer by voice or text, or choose Skip.", "error");
  sessionState.questionIndex += 1;
  render(); stageElement.focus(); status("");
  if (sessionState.questionIndex === questions.length && !sessionState.inferred.profile) {
    const available = sessionState.supplied.answers.filter(row => row.text.trim()).length;
    if (available) await generateProfile();
    else if (sessionState.supplied.answers.some(row => row.audio)) status("Your voice answers are saved. Transcribe them before building a profile, or use a clearly labelled simulated profile.", "error");
  }
}
function clearMedia() {
  cancelActiveOperations();
  clearInterval(promptTimer); promptTimer = null; activePromptKey = "";
  stopCamera(); stopRecorder(true); stopMicTracks();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  revoke(sessionState.supplied.image); revoke(sessionState.supplied.portrait); revoke(sessionState.supplied.audio);
  revoke(sessionState.supplied.cloneSample);
  revoke(sessionState.predicted.participantAnswers[0]?.audio);
  sessionState.supplied.answers.forEach(answer => revoke(answer.audio));
  clearProxyMedia();
}
function stopActiveMedia() {
  cancelActiveOperations();
  clearInterval(promptTimer); promptTimer = null; activePromptKey = "";
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
  if (sessionState.supplied.portrait) supplied.push(dataItem("Captured portrait", sessionState.supplied.portrait.origin, "portrait", `<img class="media" src="${sessionState.supplied.portrait.url}" alt="Your captured portrait">`));
  if (sessionState.supplied.audio) supplied.push(dataItem("Voice recording", sessionState.supplied.audio.type, "audio", `<audio controls src="${sessionState.supplied.audio.url}"></audio>`));
  if (sessionState.supplied.transcript.trim()) supplied.push(dataItem("Transcript / written image story", sessionState.supplied.transcript, "transcript"));
  sessionState.supplied.answers.forEach((answer,index) => {
    if (answer.text.trim()) supplied.push(dataItem(`Question ${index + 1} answer`, answer.text, `answer:${index}`));
    if (answer.audio) supplied.push(dataItem(`Question ${index + 1} voice answer`, answer.audio.type, `answer-audio:${index}`, `<audio controls src="${answer.audio.url}"></audio>`));
  });
  if (sessionState.predicted.participantAnswers[0]?.text) supplied.push(dataItem("Your actual prediction answer", sessionState.predicted.participantAnswers[0].text, "actual-answer"));
  if (sessionState.predicted.participantAnswers[0]?.audio) supplied.push(dataItem("Your spoken prediction answer", sessionState.predicted.participantAnswers[0].audio.type, "prediction-audio", `<audio controls src="${sessionState.predicted.participantAnswers[0].audio.url}"></audio>`));
  if (sessionState.predicted.comparisons[0]?.rating) supplied.push(dataItem("Your prediction rating", sessionState.predicted.comparisons[0].rating, "comparison"));
  sessionState.inferred.participantFeedback.forEach(item => supplied.push(dataItem(`Your review of ${item.id}`, `${item.verdict}${item.correction ? `: ${item.correction}` : ""}`, `inference-review:${item.id}`)));
  sessionState.inferred.contradictionFeedback.forEach(item => supplied.push(dataItem(`Your contradiction review ${item.id}`, `${item.verdict}${item.explanation ? `: ${item.explanation}` : ""}`, `contradiction-review:${item.id}`)));
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
  else if (key === "portrait") deletePortrait();
  else if (key === "audio") { setRecording("story", null); render(); }
  else if (key === "transcript") { sessionState.supplied.transcript = ""; invalidateAnalysis(); render(); }
  else if (key.startsWith("answer-audio:")) { setRecording(sessionState.supplied.answers[Number(key.split(":")[1])].id, null); render(); }
  else if (key.startsWith("answer:")) { sessionState.supplied.answers[Number(key.split(":")[1])].text = ""; invalidateAnalysis(); render(); }
  else if (key.startsWith("inference:")) sessionState.inferred.profile.inferred_information = sessionState.inferred.profile.inferred_information.filter(item => item.id !== key.slice(10));
  else if (key.startsWith("inference-review:")) sessionState.inferred.participantFeedback = sessionState.inferred.participantFeedback.filter(item => item.id !== key.slice(17));
  else if (key.startsWith("contradiction-review:")) sessionState.inferred.contradictionFeedback = sessionState.inferred.contradictionFeedback.filter(item => item.id !== key.slice(21));
  else if (key === "actual-answer") { const answer = sessionState.predicted.participantAnswers[0]; if (answer) { answer.text = ""; answer.textOrigin = "typed"; } }
  else if (key === "prediction-audio") setRecording("prediction-answer", null);
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
  else if (action === "switch-input") { sessionState.ui.inputMode[button.dataset.target] = button.dataset.mode; render(); }
  else if (action === "toggle-media-options") { event.preventDefault(); sessionState.ui.mediaOptionsOpen = !sessionState.ui.mediaOptionsOpen; render(); }
  else if (action === "enable-camera") { sessionState.consent.photoCapture = true; sessionState.consent.cameraPresence = true; render(); enableCamera(); }
  else if (action === "enable-presence-camera") enablePresenceCamera();
  else if (action === "toggle-camera-presence") { sessionState.consent.cameraPresence = !sessionState.consent.cameraPresence; render(); }
  else if (action === "capture") capturePhoto();
  else if (action === "camera-off") { stopCamera(); sessionState.consent.cameraPresence = false; render(); status("Camera off."); }
  else if (action === "capture-portrait") capturePortrait();
  else if (action === "delete-portrait") deletePortrait();
  else if (action === "retake") { clearImage(); if (sessionState.consent.photoCapture) enableCamera(); }
  else if (action === "delete-image") { clearImage(); status("Image deleted from memory.", "success"); }
  else if (action === "confirm-image") { sessionState.photoConfirmed = true; render(); status("Image confirmed.", "success"); }
  else if (action === "start-recording") startRecording();
  else if (action === "toggle-auto-record") {
    if (!sessionState.consent.audioRecording || !sessionState.consent.transcription) return status("Allow microphone recording and transcription before automatic question recording.", "error");
    sessionState.consent.autoRecordQuestions = !sessionState.consent.autoRecordQuestions;
    const shouldStart = sessionState.consent.autoRecordQuestions && sessionState.currentStage === 3
      && !sessionState.supplied.answers[sessionState.questionIndex]?.audio && !sessionState.supplied.answers[sessionState.questionIndex]?.text.trim();
    render(); status(sessionState.consent.autoRecordQuestions ? "Automatic question recording is on. You can turn it off at any time." : "Automatic question recording is off.", "success");
    if (shouldStart) void startRecording();
  }
  else if (action === "stop-recording") stopRecorder();
  else if (action === "delete-audio") { const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 4 ? "prediction-answer" : sessionState.supplied.answers[sessionState.questionIndex].id; setRecording(target, null); render(); status("Recording deleted from memory.", "success"); }
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
  else if (action === "edit-question") { sessionState.ui.questionRevealed[sessionState.questionIndex] = false; render(); }
  else if (["next-question","skip-question"].includes(action)) advanceQuestion(action === "skip-question");
  else if (action === "review-questions") { sessionState.questionIndex = 0; render(); }
  else if (action === "previous-profile-item") { sessionState.ui.profilePage = Math.max(0, sessionState.ui.profilePage - 1); render(); }
  else if (action === "next-profile-item") { sessionState.ui.profilePage += 1; render(); }
  else if (action === "profile-move-on") move("continue");
  else if (action === "regenerate-profile") generateProfile();
  else if (action === "mock-profile") { sessionState.inferred.profile = mockProfile(readableAnswers()); sessionState.inferred.mode = "mock"; sessionState.questionIndex = questions.length; setOperationState("identity", "fallback", { message: operationDefinitions.identity.fallback, detail: "MOCK AI OUTPUT is shown instead of a live API result." }); render(); status("Clearly marked mock profile ready.", "success"); }
  else if (action === "predict") generatePrediction();
  else if (action === "mock-prediction") { sessionState.predicted.predictions = [mockPrediction(readableAnswers())]; sessionState.predicted.mode = "mock"; sessionState.predictionShown = true; setOperationState("prediction", "fallback", { message: operationDefinitions.prediction.fallback, detail: "MOCK prediction shown before your answer; it is not a live API result." }); render(); status("Mock prediction shown before your answer.", "success"); }
  else if (action === "compare-prediction") { if (!sessionState.predicted.participantAnswers[0]?.text?.trim()) return status("Share your answer before comparing it with the prediction.", "error"); sessionState.ui.predictionCompared = true; render(); }
  else if (action === "rate-prediction") { sessionState.predicted.comparisons = [{ rating: button.dataset.value, explanation: sessionState.predicted.comparisons[0]?.explanation || "" }]; render(); }
  else if (action === "review-inference") {
    const id = button.dataset.id; const verdict = button.dataset.verdict;
    if (verdict === "corrected") { sessionState.ui.correctingInferenceId = id; render(); return; }
    sessionState.inferred.participantFeedback = sessionState.inferred.participantFeedback.filter(item => item.id !== id);
    sessionState.inferred.participantFeedback.push({ id, verdict, correction: "" }); render();
  }
  else if (action === "save-inference-correction") {
    const id = sessionState.ui.correctingInferenceId; const correction = document.getElementById("inferenceCorrection")?.value?.trim();
    if (!correction) return status("Write your correction first.", "error");
    sessionState.inferred.participantFeedback = sessionState.inferred.participantFeedback.filter(item => item.id !== id);
    sessionState.inferred.participantFeedback.push({ id, verdict: "corrected", correction });
    sessionState.ui.correctingInferenceId = ""; render();
  }
  else if (action === "cancel-inference-correction") { sessionState.ui.correctingInferenceId = ""; render(); }
  else if (action === "review-contradiction") {
    const id = button.dataset.id;
    const explanation = document.getElementById("contradictionExplanation")?.value?.trim() || "";
    sessionState.inferred.contradictionFeedback = sessionState.inferred.contradictionFeedback.filter(item => item.id !== id);
    sessionState.inferred.contradictionFeedback.push({ id, verdict: button.dataset.verdict, explanation });
    render(); status("Your contradiction review has been kept with the original AI interpretation.", "success");
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
    sessionState.ui.mediaOptionsOpen = false; sessionState.ui.proxyReview = false;
    setOperationState("proxy", "fallback", { message: operationDefinitions.proxy.fallback, detail: "MOCK on-behalf text is shown instead of a live API result." });
    render(); status("Mock proxy response ready.", "success");
    if (sessionState.consent.voiceCloning) await generateProxyMedia();
  }
  else if (action === "generate-proxy-media") generateProxyMedia();
  else if (action === "review-proxy-open") { sessionState.ui.proxyReview = true; render(); }
  else if (action === "review-proxy-back") { sessionState.ui.proxyReview = false; render(); }
  else if (action === "play-proxy" && sessionState.consent.standardAudio && "speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(sessionState.generated.proxyResponses[0].text)); }
  else if (action === "review-proxy" || action === "reject-proxy") { sessionState.generated.proxyResponses[0].feedback = action === "review-proxy" ? "accepted" : "rejected"; render(); }
  else if (action === "correct-proxy") { sessionState.ui.correctingProxy = true; render(); }
  else if (action === "save-proxy-correction") { const value = document.getElementById("proxyCorrection")?.value?.trim(); if (!value) return status("Write your correction first.", "error"); sessionState.generated.proxyResponses[0].feedback = "corrected"; sessionState.generated.proxyResponses[0].correction = value; sessionState.ui.correctingProxy = false; render(); }
  else if (action === "cancel-proxy-correction") { sessionState.ui.correctingProxy = false; render(); }
  else if (action === "delete-proxy") { clearProxyMedia(); sessionState.generated.proxyResponses = []; if ("speechSynthesis" in window) speechSynthesis.cancel(); render(); }
  else if (action === "allow-fiction") { sessionState.consent.fictionalGeneration = true; render(); }
  else if (action === "generate-fiction") generateFiction();
  else if (action === "mock-fiction") { sessionState.generated.fictionalContent = [mockFiction(readableAnswers())]; sessionState.generated.fictionMode = "mock"; setOperationState("fiction", "fallback", { message: operationDefinitions.fiction.fallback, detail: "MOCK fictional content is shown instead of a live API result." }); render(); status("Mock fictional memory ready.", "success"); }
  else if (action === "reflect-fiction") { sessionState.ui.fictionReflection = true; render(); }
  else if (action === "back-to-fiction") { sessionState.ui.fictionReflection = false; render(); }
  else if (action === "delete-fiction") { sessionState.generated.fictionalContent = []; sessionState.ui.fictionReflection = false; sessionState.ui.fictionAnswered = false; render(); }
  else if (action === "feedback-choice") { sessionState.feedback[button.dataset.field] = button.dataset.value; if (button.dataset.field === "feelsLikeYou") sessionState.ui.fictionAnswered = true; render(); }
});
document.addEventListener("input", event => {
  if (event.target.id === "storyText") { sessionState.supplied.transcript = event.target.value; sessionState.supplied.transcriptOrigin = "typed"; invalidateAnalysis(); document.querySelector('.navigation [data-action="continue"]').disabled = !event.target.value.trim(); }
  if (event.target.id === "questionText") { const answer = sessionState.supplied.answers[sessionState.questionIndex]; answer.text = event.target.value; answer.textOrigin = "typed"; invalidateAnalysis(); const next = document.querySelector('[data-action="next-question"]'); if (next) next.disabled = !event.target.value.trim(); }
  if (event.target.id === "actualAnswer") { sessionState.predicted.participantAnswers = [{ ...sessionState.predicted.participantAnswers[0], text: event.target.value, textOrigin: "typed" }]; const next = document.querySelector('[data-action="compare-prediction"]'); if (next) next.disabled = !event.target.value.trim(); }
  if (event.target.id === "predictionCorrection") sessionState.predicted.comparisons = [{ rating: sessionState.predicted.comparisons[0]?.rating || "", explanation: event.target.value }];
  if (event.target.id === "contradictionExplanation") {
    const profile = sessionState.inferred.profile;
    const index = profile ? sessionState.ui.profilePage - profile.inferred_information.length - 1 : -1;
    if (index >= 0) {
      const id = contradictionId(index);
      const existing = sessionState.inferred.contradictionFeedback.find(item => item.id === id);
      if (existing) existing.explanation = event.target.value;
    }
  }
  if (event.target.id === "unclearLabel") sessionState.feedback.unclearLabel = event.target.value;
  if (event.target.id === "finalExplanation") sessionState.feedback.finalExplanation = event.target.value;
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
render();
