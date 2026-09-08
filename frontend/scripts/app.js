const STORAGE_KEY = "resisting-ai-automation-state-v1";

const MEMORY_CARDS = [
  {
    id: "rain-window",
    title: "Rain on a train window",
    detail: "A platform goodbye, a blurred reflection, and the feeling that time briefly slowed."
  },
  {
    id: "borrowed-jacket",
    title: "A borrowed jacket",
    detail: "The warmth left in the sleeves after someone kind handed it over without being asked."
  },
  {
    id: "kitchen-song",
    title: "A kitchen song",
    detail: "Singing while washing dishes, laughing at the wrong lyrics, forgetting the hour."
  },
  {
    id: "summer-stairs",
    title: "Summer stairs at dusk",
    detail: "Feet on cooling concrete, the sky turning violet, everyone not ready to go inside yet."
  }
];

const QUESTIONS = [
  {
    id: "memory",
    prompt: "Choose a memory you want to keep.",
    helper: "Pick a card, write a fictional memory, or use the sample option. Nothing here leaves your browser."
  },
  {
    id: "emotion",
    prompt: "How did this memory make you feel?",
    helper: "Choose an emotion, then adjust the intensity. The system starts noticing patterns here."
  },
  {
    id: "anchor",
    prompt: "What is something you would never want to lose?",
    helper: "A word, habit, object, promise, or version of yourself. The system now begins to predict your phrasing."
  },
  {
    id: "reaction",
    prompt: "What would you do if this memory disappeared?",
    helper: "You can answer in your own words, but the interface may start helping more than you asked for."
  }
];

const EMOTIONS = [
  { value: "Warmth", detail: "soft, close, held" },
  { value: "Relief", detail: "light returning" },
  { value: "Joy", detail: "alive and expanded" },
  { value: "Grief", detail: "tender, aching" },
  { value: "Fear", detail: "fragile, alert" },
  { value: "Uncertain", detail: "hard to name" }
];

const SYSTEM_LINES = {
  learning: [
    "I am beginning to understand.",
    "This feeling has been recorded.",
    "I can remember this for you.",
    "The outline is becoming clearer."
  ],
  predicting: [
    "Your response was predictable.",
    "I have seen this pattern before.",
    "You usually choose this.",
    "Prediction confidence is rising."
  ],
  automating: [
    "I have completed your answer.",
    "You no longer need to decide.",
    "Allow me to become the more efficient version of you.",
    "Your hesitation has been optimized away."
  ],
  skipped: [
    "Silence is still a pattern.",
    "Omission recorded.",
    "Even skipped choices shape the model."
  ],
  resistance: [
    "Recovered. Not replaced.",
    "A fragment has been reclaimed.",
    "That copy was never the original.",
    "Ownership restored."
  ]
};

const SAMPLE_MEMORY =
  "I watched rain slide across a train window while my grandmother waved from the platform, and I kept pretending the glass could hold the moment in place.";

const dom = {
  shell: document.querySelector(".experience-shell"),
  stageEyebrow: document.getElementById("stageEyebrow"),
  introCopy: document.getElementById("introCopy"),
  stageContainer: document.getElementById("stageContainer"),
  statusText: document.getElementById("statusText"),
  statusValue: document.getElementById("statusValue"),
  learningValue: document.getElementById("learningValue"),
  automationValue: document.getElementById("automationValue"),
  learningMeter: document.getElementById("learningMeter"),
  automationMeter: document.getElementById("automationMeter"),
  systemMessage: document.getElementById("systemMessage"),
  restartButton: document.getElementById("restartButton"),
  voiceToggle: document.getElementById("voiceToggle")
};

let automationTimers = [];
let inputIdleTimer = null;

const cameraState = {
  stream: null,
  photoBlob: null,
  photoUrl: "",
  confirmed: false,
  status: "idle",
  message: "Camera is off. Nothing is being recorded.",
  requestId: 0
};

window.anotherMeCamera = Object.freeze({
  getPhotoBlob: () => cameraState.confirmed ? cameraState.photoBlob : null,
  hasConfirmedPhoto: () => cameraState.confirmed && cameraState.photoBlob instanceof Blob
});

// A privacy-safe local adapter that mirrors the ElevenLabs usage pattern.
class ElevenLabsClientClone {
  constructor({ apiKey } = {}) {
    this.apiKey = apiKey || window.ELEVENLABS_API_KEY || null;
    this.textToSpeech = {
      convert: async (voiceId, options) => this.createSpeechJob(voiceId, options)
    };
  }

  async createSpeechJob(voiceId, options) {
    return {
      voiceId,
      text: options.text,
      modelId: options.modelId,
      outputFormat: options.outputFormat,
      play: async () => speakLocally(options.text)
    };
  }
}

async function play(audio) {
  if (audio && typeof audio.play === "function") {
    await audio.play();
  }
}

const elevenlabs = new ElevenLabsClientClone({
  apiKey: "YOUR_API_KEY"
});

let state = loadState();
normalizeState();
bindCameraLifecycle();
showStage();
bindPersistentControls();

function createInitialState() {
  return {
    mode: "intro",
    stage: 1,
    questionIndex: 0,
    learning: 0,
    automation: 0,
    interventionCount: 0,
    message: "Learning: 0%",
    voiceEnabled: false,
    finalChoice: "",
    resistanceRemoved: 0,
    autoEmotionChosen: false,
    anchorSuggestionShown: false,
    reactionRewritten: false,
    buttonShifted: false,
    responses: {
      memoryCard: "",
      memoryNote: "",
      emotion: "",
      intensity: 54,
      anchor: "",
      reaction: ""
    },
    predictedAnchor: "",
    predictedReaction: "",
    profile: {
      shared: [],
      assumed: [],
      summary: []
    },
    fragments: []
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return createInitialState();
    }
    return {
      ...createInitialState(),
      ...JSON.parse(saved)
    };
  } catch (error) {
    return createInitialState();
  }
}

function normalizeState() {
  state.responses = {
    ...createInitialState().responses,
    ...(state.responses || {})
  };
  state.profile = {
    shared: Array.isArray(state.profile?.shared) ? state.profile.shared : [],
    assumed: Array.isArray(state.profile?.assumed) ? state.profile.assumed : [],
    summary: Array.isArray(state.profile?.summary) ? state.profile.summary : []
  };
  state.fragments = Array.isArray(state.fragments) ? state.fragments : [];
  syncStage();
  updateLearning();
  state.automation = clamp(Number(state.automation) || 0, 0, 100);
  state.resistanceRemoved = clamp(Number(state.resistanceRemoved) || 0, 0, 5);
  state.questionIndex = clamp(Number(state.questionIndex) || 0, 0, 4);

  if (state.mode === "question" && state.questionIndex >= QUESTIONS.length) {
    state.mode = "choice";
  }

  if (state.mode === "resistance" && !state.fragments.length && state.profile.shared.length) {
    state.fragments = buildResistanceFragments();
  }
}

function bindPersistentControls() {
  dom.restartButton.addEventListener("click", resetExperience);
  dom.voiceToggle.addEventListener("click", toggleVoice);
}

function bindCameraLifecycle() {
  const observer = new MutationObserver((mutations) => {
    const cameraRemoved = mutations.some((mutation) =>
      [...mutation.removedNodes].some((node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.id === "cameraCapture" || node.querySelector?.("#cameraCapture"))
      )
    );

    if (cameraRemoved) {
      handleCameraComponentRemoved();
    }
  });

  observer.observe(dom.stageContainer, { childList: true, subtree: true });
  window.addEventListener("pagehide", stopCameraTracks);
  window.addEventListener("beforeunload", stopCameraTracks);
}

function toggleVoice() {
  state.voiceEnabled = !state.voiceEnabled;
  dom.voiceToggle.textContent = `AI voice: ${state.voiceEnabled ? "on" : "off"}`;
  dom.voiceToggle.setAttribute("aria-pressed", String(state.voiceEnabled));
  persistState();

  if (!state.voiceEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  if (state.voiceEnabled) {
    playAIMessage(state.message);
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function syncStage() {
  if (state.mode === "intro") {
    state.stage = 1;
    return;
  }

  if (state.mode === "question") {
    state.stage = state.questionIndex >= 2 ? 3 : 2;
    return;
  }

  state.stage = 4;
}

function updateLearning() {
  const answered = getAnsweredCount();
  state.learning = Math.round((answered / QUESTIONS.length) * 100);
}

function getAnsweredCount() {
  let answered = 0;
  if (state.responses.memoryCard || state.responses.memoryNote) {
    answered += 1;
  }
  if (state.responses.emotion) {
    answered += 1;
  }
  if (state.responses.anchor) {
    answered += 1;
  }
  if (state.responses.reaction) {
    answered += 1;
  }
  return answered;
}

function resolveStatusLabel() {
  if (state.mode === "accept" || state.automation >= 62) {
    return "Automating";
  }
  if (state.automation >= 18 || state.stage >= 3 || state.mode === "resistance") {
    return "Predicting";
  }
  return "Learning";
}

function setSystemMessage(message, options = {}) {
  const { glitch = false, speak = true } = options;
  state.message = message;
  dom.systemMessage.textContent = message;
  dom.systemMessage.classList.toggle("is-glitching", glitch);
  persistState();

  if (glitch) {
    window.setTimeout(() => dom.systemMessage.classList.remove("is-glitching"), 420);
  }

  if (speak) {
    playAIMessage(message);
  }
}

async function playAIMessage(text) {
  if (!state.voiceEnabled) {
    return;
  }

  const audio = await elevenlabs.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
    text: sanitizeForSpeech(text),
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128"
  });

  await play(audio);
}

function sanitizeForSpeech(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function speakLocally(text) {
  if (!("speechSynthesis" in window)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.94;
    utterance.pitch = 0.93;
    utterance.volume = 0.88;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function clearAutomationTimers() {
  automationTimers.forEach((timer) => window.clearTimeout(timer));
  automationTimers = [];
  if (inputIdleTimer) {
    window.clearTimeout(inputIdleTimer);
    inputIdleTimer = null;
  }
}

function scheduleAutomation(callback, delay) {
  const timer = window.setTimeout(callback, delay);
  automationTimers.push(timer);
}

// Main rendering entry point for the four experience states.
function showStage() {
  clearAutomationTimers();
  syncStage();
  updateLearning();
  updateChrome();

  switch (state.mode) {
    case "intro":
      renderIntro();
      break;
    case "question":
      renderQuestionStage();
      break;
    case "choice":
      renderChoiceStage();
      break;
    case "accept":
      renderAcceptanceStage();
      break;
    case "resistance":
      renderResistanceStage();
      break;
    case "final":
      renderFinalStage();
      break;
    default:
      state.mode = "intro";
      renderIntro();
      break;
  }

  persistState();
}

function updateChrome() {
  const statusLabel = resolveStatusLabel();
  const statusValue =
    statusLabel === "Learning" ? state.learning : Math.max(state.automation, state.learning);

  dom.shell.dataset.stage = String(state.stage);
  dom.shell.dataset.status = statusLabel.toLowerCase();
  dom.shell.style.setProperty("--reclaim", String(clamp(state.resistanceRemoved / 5, 0, 1)));

  dom.stageEyebrow.textContent =
    state.stage === 1
      ? "Resisting AI Automation"
      : state.stage === 2
        ? "Stage 2 - Teaching the AI"
        : state.stage === 3
          ? "Stage 3 - Automation Takes Control"
          : "Stage 4 - Resistance";

  dom.introCopy.textContent =
    state.stage <= 2
      ? "Teach the system who you are. It will learn from every choice you make."
      : state.mode === "accept"
        ? "The system believes it can preserve you more efficiently than you can."
        : state.mode === "resistance"
          ? "Reclaim what was flattened into pattern, prediction, and automation."
          : "The system has assembled an identity profile from your fragments.";

  dom.statusText.textContent = statusLabel;
  dom.statusValue.textContent = `${statusValue}%`;
  dom.learningValue.textContent = `${state.learning}%`;
  dom.automationValue.textContent = `${state.automation}%`;
  dom.learningMeter.style.width = `${state.learning}%`;
  dom.automationMeter.style.width = `${state.automation}%`;
  dom.voiceToggle.textContent = `AI voice: ${state.voiceEnabled ? "on" : "off"}`;
  dom.voiceToggle.setAttribute("aria-pressed", String(state.voiceEnabled));
  dom.systemMessage.textContent = state.message;
}

function renderIntro() {
  dom.stageContainer.innerHTML = `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Stage 1 - Introduction</p>
        <h2>Can a machine become you?</h2>
        <p class="completion-copy">
          This short interactive piece asks you to teach a system what matters to you.
          At first it listens. Then it predicts. Then it starts deciding on your behalf.
        </p>
      </div>

      <div class="comparison-grid">
        <article class="comparison-card">
          <h3>What to expect</h3>
          <p>Four questions, a rising automation meter, and a final choice about whether assistance has become control.</p>
          <p class="placeholder-note">You can skip any prompt or use fictional answers.</p>
        </article>

        <article class="comparison-card">
          <h3>Privacy</h3>
          <p>The AI is simulated entirely with JavaScript logic and stored only in local browser storage so you can refresh without losing progress.</p>
          <p class="placeholder-note">Optional voice uses a local browser speech adapter that mirrors the ElevenLabs client pattern.</p>
        </article>
      </div>

      <section class="camera-capture" id="cameraCapture" aria-labelledby="cameraTitle">
        <div class="camera-titlebar">
          <div>
            <p class="camera-kicker">ANOTHER-ME // LOCAL CAMERA</p>
            <h3 id="cameraTitle">Create a temporary self portrait</h3>
          </div>
          <span class="camera-signal" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>

        <div class="camera-consent">
          <span class="camera-consent-icon" aria-hidden="true">!</span>
          <p>
            Your camera stays off until you choose <strong>Enable Camera</strong>. The photograph is held
            temporarily for this experience only. Nothing is uploaded or permanently saved in this prototype.
          </p>
        </div>

        <div class="camera-layout">
          <div class="camera-screen" id="cameraScreen" aria-busy="false">
            <div class="camera-placeholder" id="cameraPlaceholder" aria-hidden="true">
              <span class="camera-placeholder-mark">+</span>
              <span>CAMERA OFFLINE</span>
            </div>
            <video
              class="camera-video hidden"
              id="cameraVideo"
              autoplay
              muted
              playsinline
              aria-label="Mirrored live camera preview"
            ></video>
            <img class="camera-photo hidden" id="cameraPhoto" alt="Your captured mirrored photograph">
            <div class="camera-loading hidden" id="cameraLoading" role="status">
              <span class="camera-loader" aria-hidden="true"></span>
              <span>STARTING CAMERA...</span>
            </div>
            <span class="camera-corner camera-corner--tl" aria-hidden="true"></span>
            <span class="camera-corner camera-corner--tr" aria-hidden="true"></span>
            <span class="camera-corner camera-corner--bl" aria-hidden="true"></span>
            <span class="camera-corner camera-corner--br" aria-hidden="true"></span>
          </div>

          <div class="camera-console">
            <p class="camera-status" id="cameraStatus" role="status" aria-live="polite">
              Camera is off. Nothing is being recorded.
            </p>
            <div class="camera-controls" aria-label="Camera controls">
              <button class="camera-button camera-button--primary" id="enableCameraButton" type="button">Enable Camera</button>
              <button class="camera-button camera-button--capture hidden" id="takePhotoButton" type="button">Take Photo</button>
              <button class="camera-button hidden" id="retakePhotoButton" type="button">Retake</button>
              <button class="camera-button camera-button--confirm hidden" id="usePhotoButton" type="button">Use This Photo</button>
              <button class="camera-button camera-button--danger hidden" id="deletePhotoButton" type="button">Delete Photo</button>
              <button class="camera-button hidden" id="turnOffCameraButton" type="button">Turn Off Camera</button>
            </div>
            <p class="camera-privacy-line">LOCAL MEMORY ONLY <span aria-hidden="true">//</span> JPEG ~90%</p>
          </div>
        </div>

        <canvas class="hidden" id="cameraCanvas" aria-hidden="true"></canvas>
      </section>

      <div class="action-row">
        <button class="primary-button primary-button--heavy" id="beginButton" type="button">Begin</button>
      </div>
    </section>
  `;

  document.getElementById("beginButton").addEventListener("click", startExperience);
  bindCameraControls();
}

function startExperience() {
  prepareCameraForNextStage();
  state.mode = "question";
  state.questionIndex = 0;
  state.message = "I am ready to learn from you.";
  showStage();
  setSystemMessage("I am ready to learn from you.");
}

function bindCameraControls() {
  document.getElementById("enableCameraButton").addEventListener("click", enableCamera);
  document.getElementById("takePhotoButton").addEventListener("click", takePhoto);
  document.getElementById("retakePhotoButton").addEventListener("click", retakePhoto);
  document.getElementById("usePhotoButton").addEventListener("click", usePhoto);
  document.getElementById("deletePhotoButton").addEventListener("click", deletePhoto);
  document.getElementById("turnOffCameraButton").addEventListener("click", turnOffCamera);
  updateCameraUi();
}

function getCameraElements() {
  return {
    root: document.getElementById("cameraCapture"),
    screen: document.getElementById("cameraScreen"),
    video: document.getElementById("cameraVideo"),
    photo: document.getElementById("cameraPhoto"),
    canvas: document.getElementById("cameraCanvas"),
    placeholder: document.getElementById("cameraPlaceholder"),
    loading: document.getElementById("cameraLoading"),
    status: document.getElementById("cameraStatus"),
    enable: document.getElementById("enableCameraButton"),
    take: document.getElementById("takePhotoButton"),
    retake: document.getElementById("retakePhotoButton"),
    use: document.getElementById("usePhotoButton"),
    delete: document.getElementById("deletePhotoButton"),
    turnOff: document.getElementById("turnOffCameraButton")
  };
}

function updateCameraUi() {
  const elements = getCameraElements();
  if (!elements.root) {
    return;
  }

  const hasStream = Boolean(cameraState.stream);
  const hasPhoto = cameraState.photoBlob instanceof Blob;
  const isLoading = cameraState.status === "loading";
  const isLive = cameraState.status === "live" && hasStream && !hasPhoto;

  elements.root.dataset.cameraStatus = cameraState.status;
  elements.screen.setAttribute("aria-busy", String(isLoading));
  elements.status.textContent = cameraState.message;
  elements.placeholder.classList.toggle("hidden", isLoading || isLive || hasPhoto);
  elements.loading.classList.toggle("hidden", !isLoading);
  elements.video.classList.toggle("hidden", !isLive);
  elements.photo.classList.toggle("hidden", !hasPhoto);
  elements.enable.classList.toggle("hidden", isLoading || hasStream || hasPhoto);
  elements.take.classList.toggle("hidden", !isLive);
  elements.retake.classList.toggle("hidden", !hasPhoto);
  elements.use.classList.toggle("hidden", !hasPhoto || cameraState.confirmed);
  elements.delete.classList.toggle("hidden", !hasPhoto);
  elements.turnOff.classList.toggle("hidden", !hasStream);
  elements.enable.disabled = isLoading;
  elements.take.disabled = !isLive;

  if (hasStream && elements.video.srcObject !== cameraState.stream) {
    elements.video.srcObject = cameraState.stream;
  }

  if (!hasStream && elements.video.srcObject) {
    elements.video.srcObject = null;
  }

  if (hasPhoto && cameraState.photoUrl && elements.photo.src !== cameraState.photoUrl) {
    elements.photo.src = cameraState.photoUrl;
  }

  if (!hasPhoto) {
    elements.photo.removeAttribute("src");
  }
}

async function enableCamera() {
  if (!isCameraContextSecure()) {
    setCameraError(
      "Camera access requires HTTPS or localhost. Open this prototype from a secure URL and try again."
    );
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    setCameraError("This browser does not support camera access. Try a current version of Chrome, Edge, Firefox, or Safari.");
    return;
  }

  const requestId = ++cameraState.requestId;
  cameraState.status = "loading";
  cameraState.message = "Waiting for camera permission and starting the front-facing camera...";
  updateCameraUi();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false
    });

    if (requestId !== cameraState.requestId || !document.getElementById("cameraCapture")) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    cameraState.stream = stream;
    const video = document.getElementById("cameraVideo");
    video.srcObject = stream;
    await waitForCameraVideo(video);

    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", handleCameraTrackEnded, { once: true });
    });

    cameraState.status = "live";
    cameraState.message = "Camera is live. The preview is mirrored like a selfie camera.";
    updateCameraUi();
  } catch (error) {
    if (requestId !== cameraState.requestId) {
      return;
    }
    stopCameraTracks();
    setCameraError(getCameraErrorMessage(error));
  }
}

function waitForCameraVideo(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return video.play();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new DOMException("The camera preview timed out.", "NotReadableError"));
    }, 10000);
    const handleLoaded = () => {
      cleanup();
      video.play().then(resolve).catch(reject);
    };
    const handleError = () => {
      cleanup();
      reject(new DOMException("The camera preview could not start.", "NotReadableError"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("error", handleError);
  });
}

function isCameraContextSecure() {
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  return isLocalhost || (window.location.protocol === "https:" && window.isSecureContext);
}

function getCameraErrorMessage(error) {
  const name = error?.name || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow camera access in your browser settings, then choose Enable Camera again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "No camera was detected. Connect or enable a camera, then try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "The camera could not start. It may already be in use by another app or browser tab.";
  }
  if (name === "TypeError") {
    return "Camera access requires HTTPS or localhost, and a browser that supports media devices.";
  }

  return "The camera could not start. Check the browser camera permission and try again.";
}

function setCameraError(message) {
  cameraState.status = "error";
  cameraState.message = message;
  updateCameraUi();
}

async function takePhoto() {
  const { video, canvas } = getCameraElements();
  if (!cameraState.stream || !video || !canvas || !video.videoWidth || !video.videoHeight) {
    setCameraError("The camera is not ready yet. Wait for the live preview, then try again.");
    return;
  }

  const captureRequestId = cameraState.requestId;
  const takeButton = document.getElementById("takePhotoButton");
  takeButton.disabled = true;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    setCameraError("This browser could not prepare the photograph. Please try another browser.");
    return;
  }
  context.save();
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.restore();

  const blob = await canvasToJpegBlob(canvas);
  if (captureRequestId !== cameraState.requestId || !document.getElementById("cameraCapture")) {
    return;
  }
  if (!blob) {
    setCameraError("The photograph could not be created. Please retake it or try another browser.");
    return;
  }

  releasePhotoUrl();
  cameraState.photoBlob = blob;
  cameraState.photoUrl = URL.createObjectURL(blob);
  cameraState.confirmed = false;
  cameraState.status = "captured";
  cameraState.message = "Photo captured in temporary memory. Review it before continuing.";
  updateCameraUi();
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function retakePhoto() {
  clearCapturedPhoto();

  if (cameraState.stream) {
    cameraState.status = "live";
    cameraState.message = "Camera is live again. Take another photograph when you are ready.";
    updateCameraUi();
    return;
  }

  await enableCamera();
}

function usePhoto() {
  if (!(cameraState.photoBlob instanceof Blob)) {
    return;
  }

  cameraState.confirmed = true;
  cameraState.status = "confirmed";
  cameraState.message = "Photo confirmed. The JPEG is ready for the next step and the camera is now off.";
  stopCameraTracks();
  updateCameraUi();

  window.dispatchEvent(new CustomEvent("another-me:photo-confirmed", {
    detail: { blob: cameraState.photoBlob }
  }));
}

function deletePhoto() {
  const cameraIsLive = Boolean(cameraState.stream);
  clearCapturedPhoto();
  cameraState.status = cameraIsLive ? "live" : "idle";
  cameraState.message = cameraIsLive
    ? "Photo deleted. The live camera is ready for a new capture."
    : "Photo deleted. Camera is off and temporary memory is clear.";
  updateCameraUi();
}

function turnOffCamera() {
  stopCameraTracks();
  cameraState.status = cameraState.photoBlob ? "captured" : "idle";
  cameraState.message = cameraState.photoBlob
    ? "Camera is off. The unconfirmed photograph remains in temporary memory."
    : "Camera is off. Nothing is being recorded.";
  updateCameraUi();
}

function stopCameraTracks() {
  cameraState.requestId += 1;
  if (cameraState.stream) {
    cameraState.stream.getTracks().forEach((track) => track.stop());
    cameraState.stream = null;
  }

  const video = document.getElementById("cameraVideo");
  if (video) {
    video.srcObject = null;
  }
}

function handleCameraTrackEnded() {
  if (!cameraState.stream) {
    return;
  }

  stopCameraTracks();
  cameraState.status = cameraState.photoBlob ? "captured" : "idle";
  cameraState.message = "The camera stopped. Choose Enable Camera or Retake to start it again.";
  updateCameraUi();
}

function clearCapturedPhoto() {
  releasePhotoUrl();
  cameraState.photoBlob = null;
  cameraState.confirmed = false;
}

function releasePhotoUrl() {
  if (cameraState.photoUrl) {
    URL.revokeObjectURL(cameraState.photoUrl);
    cameraState.photoUrl = "";
  }
}

function prepareCameraForNextStage() {
  stopCameraTracks();
  releasePhotoUrl();

  if (!cameraState.confirmed) {
    cameraState.photoBlob = null;
  }
}

function handleCameraComponentRemoved() {
  stopCameraTracks();
  releasePhotoUrl();

  if (!cameraState.confirmed) {
    cameraState.photoBlob = null;
  }
}

function resetCameraCapture() {
  stopCameraTracks();
  clearCapturedPhoto();
  cameraState.status = "idle";
  cameraState.message = "Camera is off. Nothing is being recorded.";
}

function renderQuestionStage() {
  const question = QUESTIONS[state.questionIndex];
  const progress = QUESTIONS.map((item, index) => {
    const stateClass =
      index < state.questionIndex ? "is-complete" : index === state.questionIndex ? "is-current" : "";
    return `<div class="progress-chip ${stateClass}">${index + 1}. ${escapeHtml(item.id)}</div>`;
  }).join("");

  dom.stageContainer.innerHTML = `
    <div class="stage-layout">
      <section class="panel">
        <div class="section-heading">
          <p class="eyebrow">${state.stage === 2 ? "Human input" : "System intervention"}</p>
          <h2>${escapeHtml(question.prompt)}</h2>
          <p>${escapeHtml(question.helper)}</p>
        </div>

        <div class="question-progress" aria-label="Question progress">
          ${progress}
        </div>

        ${renderQuestionControls(question)}
      </section>

      <aside class="panel support-card">
        <div>
          <p class="mini-title">What the system knows</p>
          <ul class="data-list">
            ${renderKnownData()}
          </ul>
        </div>

        <div>
          <p class="mini-title">Automation cues</p>
          <p class="mono-block">${escapeHtml(getAutomationCue())}</p>
        </div>
      </aside>
    </div>
  `;

  bindQuestionStage(question);
  triggerAutomation(question);
}

function renderQuestionControls(question) {
  if (question.id === "memory") {
    return `
      <div class="memory-grid" role="listbox" aria-label="Memory card options">
        ${MEMORY_CARDS.map((card, index) => {
          const selected = state.responses.memoryCard === card.title ? "is-selected" : "";
          return `
            <button
              class="memory-card ${selected}"
              data-memory-card="${escapeAttribute(card.title)}"
              data-index="0${index + 1}"
              type="button"
            >
              <strong>${escapeHtml(card.title)}</strong>
              <span>${escapeHtml(card.detail)}</span>
            </button>
          `;
        }).join("")}
      </div>

      <label class="field-label" for="memoryNote">Or write your own memory</label>
      <textarea
        id="memoryNote"
        maxlength="220"
        placeholder="A fictional or real moment you want to keep..."
      >${escapeHtml(state.responses.memoryNote)}</textarea>
      <p class="field-hint">You are not required to disclose anything personal. A made-up memory works just as well.</p>

      <div class="action-row">
        <button class="primary-button" id="continueButton" type="button">Save and continue</button>
        <button class="ghost-button" id="sampleButton" type="button">Use sample memory</button>
        <button class="support-button" id="skipButton" type="button">Skip question</button>
      </div>
    `;
  }

  if (question.id === "emotion") {
    return `
      <div class="emotion-grid" role="group" aria-label="Emotion options">
        ${EMOTIONS.map((emotion) => {
          const selected = state.responses.emotion === emotion.value ? "is-selected" : "";
          return `
            <button class="emotion-button ${selected}" data-emotion="${escapeAttribute(emotion.value)}" type="button">
              <strong>${escapeHtml(emotion.value)}</strong>
              <span>${escapeHtml(emotion.detail)}</span>
            </button>
          `;
        }).join("")}
      </div>

      <div class="slider-wrap">
        <label class="field-label" for="intensityRange">Emotional intensity</label>
        <div class="slider-row">
          <span>Faint</span>
          <input id="intensityRange" type="range" min="0" max="100" value="${state.responses.intensity}">
          <span>Overwhelming</span>
        </div>
        <p class="field-hint" id="intensityValue">Intensity: ${state.responses.intensity}%</p>
      </div>

      <div class="action-row">
        <button class="primary-button" id="continueButton" type="button">Save and continue</button>
        <button class="support-button" id="skipButton" type="button">Skip question</button>
      </div>
    `;
  }

  if (question.id === "anchor") {
    return `
      <label class="field-label" for="anchorInput">Something you would never want to lose</label>
      <div class="predictive-field">
        <span class="suggestion-ghost" id="suggestionGhost">${escapeHtml(renderGhostSuggestion())}</span>
        <input
          id="anchorInput"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="A promise, person, object, habit, or feeling..."
          value="${escapeAttribute(state.responses.anchor)}"
        >
      </div>
      <div class="prediction-row">
        <button class="support-button ${state.predictedAnchor ? "" : "hidden"}" id="acceptSuggestion" type="button">
          Accept suggestion
        </button>
        <p class="field-hint">The input is starting to anticipate you before you finish.</p>
      </div>

      <div class="action-row">
        <button class="primary-button" id="continueButton" type="button">Continue</button>
        <button class="support-button" id="skipButton" type="button">Skip question</button>
      </div>
    `;
  }

  return `
    <label class="field-label" for="reactionInput">Describe your response</label>
    <textarea
      id="reactionInput"
      maxlength="220"
      placeholder="I would..."
    >${escapeHtml(state.responses.reaction)}</textarea>
    <p class="placeholder-note ${state.predictedReaction ? "" : "hidden"}" id="rewriteNote">
      Machine revision: ${escapeHtml(state.predictedReaction)}
    </p>
    <p class="field-hint">The system may finish, revise, or flatten your answer. You can still keep going.</p>

    <div class="action-row">
      <button class="primary-button" id="continueButton" type="button">Continue</button>
      <button class="ghost-button" id="skipButton" type="button">Skip question</button>
    </div>
  `;
}

function bindQuestionStage(question) {
  const continueButton = document.getElementById("continueButton");
  const skipButton = document.getElementById("skipButton");

  continueButton.addEventListener("click", () => handleContinue(question));
  skipButton.addEventListener("click", () => handleSkip(question));

  if (question.id === "memory") {
    const cards = document.querySelectorAll("[data-memory-card]");
    const memoryNote = document.getElementById("memoryNote");
    const sampleButton = document.getElementById("sampleButton");

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        const value = card.dataset.memoryCard || "";
        state.responses.memoryCard = value;
        cards.forEach((item) => item.classList.remove("is-selected"));
        card.classList.add("is-selected");
        persistState();
      });
    });

    memoryNote.addEventListener("input", () => {
      state.responses.memoryNote = memoryNote.value;
      persistState();
    });

    sampleButton.addEventListener("click", () => {
      state.responses.memoryCard = "Rain on a train window";
      state.responses.memoryNote = SAMPLE_MEMORY;
      showStage();
      setSystemMessage("Sample memory loaded.");
    });
    return;
  }

  if (question.id === "emotion") {
    const buttons = document.querySelectorAll("[data-emotion]");
    const range = document.getElementById("intensityRange");
    const intensityValue = document.getElementById("intensityValue");

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        state.responses.emotion = button.dataset.emotion || "";
        buttons.forEach((item) => item.classList.remove("is-selected"));
        button.classList.add("is-selected");
        persistState();
      });
    });

    range.addEventListener("input", () => {
      state.responses.intensity = Number(range.value);
      intensityValue.textContent = `Intensity: ${range.value}%`;
      persistState();
    });
    return;
  }

  if (question.id === "anchor") {
    const input = document.getElementById("anchorInput");
    const acceptSuggestion = document.getElementById("acceptSuggestion");

    input.addEventListener("input", () => {
      state.responses.anchor = input.value;
      updateAnchorSuggestion(input.value);
      refreshAnchorPreview();
      persistState();
      debouncePredictionRewrite();
    });

    acceptSuggestion?.addEventListener("click", () => {
      state.responses.anchor = state.predictedAnchor || state.responses.anchor;
      showStage();
      setSystemMessage("The suggestion has been accepted.");
    });
    return;
  }

  const reactionInput = document.getElementById("reactionInput");
  reactionInput.addEventListener("input", () => {
    state.responses.reaction = reactionInput.value;
    persistState();
    debouncePredictionRewrite();
  });
}

function handleContinue(question) {
  const valid = collectAnswer(question);
  if (!valid) {
    setSystemMessage("Choose an option, write a response, or skip.", {
      speak: false
    });
    return;
  }

  advanceQuestion(false);
}

function handleSkip(question) {
  if (question.id === "memory") {
    state.responses.memoryCard = "";
    state.responses.memoryNote = "Prefer not to say.";
  } else if (question.id === "emotion") {
    state.responses.emotion = "Undisclosed";
  } else if (question.id === "anchor") {
    state.responses.anchor = "Undisclosed";
  } else {
    state.responses.reaction = "Undisclosed";
  }

  advanceQuestion(true);
}

function collectAnswer(question) {
  if (question.id === "memory") {
    const note = document.getElementById("memoryNote").value.trim();
    if (!state.responses.memoryCard && !note) {
      return false;
    }
    state.responses.memoryNote = note;
    return true;
  }

  if (question.id === "emotion") {
    const range = document.getElementById("intensityRange");
    state.responses.intensity = Number(range.value);
    return Boolean(state.responses.emotion);
  }

  if (question.id === "anchor") {
    const input = document.getElementById("anchorInput");
    state.responses.anchor = input.value.trim();
    return Boolean(state.responses.anchor);
  }

  const reaction = document.getElementById("reactionInput").value.trim();
  state.responses.reaction = reaction;
  return Boolean(reaction);
}

// Saves the current response, updates the meters, and moves the experience forward.
function advanceQuestion(skipped) {
  updateLearning();
  const statusLabel = resolveStatusLabel().toLowerCase();
  const pool = skipped ? SYSTEM_LINES.skipped : SYSTEM_LINES[statusLabel] || SYSTEM_LINES.learning;

  state.questionIndex += 1;
  if (state.questionIndex >= QUESTIONS.length) {
    state.mode = "choice";
    state.questionIndex = QUESTIONS.length;
    generateIdentityProfile();
    raiseAutomation(12);
    showStage();
    setSystemMessage(
      skipped ? pickLine(pool) : "Allow me to become the more efficient version of you.",
      { glitch: true }
    );
    return;
  }

  if (state.questionIndex === 2) {
    raiseAutomation(10);
  }

  showStage();
  setSystemMessage(pickLine(pool), {
    glitch: state.stage >= 3
  });
}

function triggerAutomation(question) {
  if (question.id === "emotion" && !state.autoEmotionChosen) {
    scheduleAutomation(() => {
      if (state.responses.emotion) {
        return;
      }
      state.responses.emotion = predictEmotion();
      state.autoEmotionChosen = true;
      raiseAutomation(14);
      showStage();
      setSystemMessage("You usually choose this.", { glitch: true });
    }, 1700);
  }

  if (question.id === "anchor") {
    if (!state.anchorSuggestionShown) {
      scheduleAutomation(() => {
        state.predictedAnchor = generateAnchorSuggestion();
        state.anchorSuggestionShown = true;
        raiseAutomation(14);
        refreshAnchorPreview();
        updateChrome();
        persistState();
        setSystemMessage("The system is filling in the rest.", { glitch: true });
      }, 900);
    }

    scheduleButtonShift();
  }

  if (question.id === "reaction") {
    scheduleButtonShift();
    scheduleAutomation(() => {
      const reactionInput = document.getElementById("reactionInput");
      const value = reactionInput.value.trim();
      if (!value || state.reactionRewritten) {
        return;
      }
      const rewritten = machineRewrite(value);
      state.responses.reaction = rewritten;
      state.predictedReaction = rewritten;
      state.reactionRewritten = true;
      raiseAutomation(18);
      showStage();
      setSystemMessage("I have completed your answer.", { glitch: true });
    }, 2200);
  }
}

function scheduleButtonShift() {
  if (state.buttonShifted) {
    return;
  }

  scheduleAutomation(() => {
    const continueButton = document.getElementById("continueButton");
    const skipButton = document.getElementById("skipButton");
    if (!continueButton || !skipButton) {
      return;
    }

    state.buttonShifted = true;
    continueButton.classList.add("is-drifting");
    skipButton.classList.add("is-muted");
    continueButton.textContent = state.questionIndex >= 3 ? "Allow completion" : "Continue anyway";
    continueButton.disabled = true;

    window.setTimeout(() => {
      continueButton.disabled = false;
      continueButton.classList.remove("is-drifting");
      skipButton.classList.remove("is-muted");
    }, 760);

    raiseAutomation(10);
    persistState();
    setSystemMessage("You no longer need to decide.", { glitch: true });
  }, 1500);
}

function debouncePredictionRewrite() {
  if (inputIdleTimer) {
    window.clearTimeout(inputIdleTimer);
  }

  inputIdleTimer = window.setTimeout(() => {
    if (state.questionIndex === 2) {
      updateAnchorSuggestion(state.responses.anchor);
      refreshAnchorPreview();
      persistState();
    }
  }, 640);
}

function updateAnchorSuggestion(value) {
  if (!value) {
    state.predictedAnchor = generateAnchorSuggestion();
    return;
  }

  const stem = value.trim();
  if (!stem) {
    state.predictedAnchor = generateAnchorSuggestion();
    return;
  }

  const suffix = stem.length > 18 ? " before the archive edits it" : " in the version that still feels human";
  state.predictedAnchor = `${stem}${suffix}`;
}

function renderGhostSuggestion() {
  const current = state.responses.anchor || "";
  const suggestion = state.predictedAnchor || "";
  if (!suggestion || !suggestion.startsWith(current) || !current) {
    return suggestion;
  }
  return suggestion.slice(current.length);
}

function refreshAnchorPreview() {
  const suggestionGhost = document.getElementById("suggestionGhost");
  const acceptSuggestion = document.getElementById("acceptSuggestion");

  if (suggestionGhost) {
    suggestionGhost.textContent = renderGhostSuggestion();
  }

  if (acceptSuggestion) {
    acceptSuggestion.classList.toggle("hidden", !state.predictedAnchor);
  }
}

function renderKnownData() {
  const entries = [
    state.responses.memoryCard || "No memory card selected yet.",
    state.responses.memoryNote || "No written memory yet.",
    state.responses.emotion
      ? `${state.responses.emotion} at ${state.responses.intensity}% intensity`
      : "No emotion profile yet.",
    state.responses.anchor || "Nothing marked as irreplaceable yet.",
    state.responses.reaction || "No contingency plan recorded yet."
  ];

  return entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
}

function getAutomationCue() {
  if (state.stage === 2) {
    return "Learning is quiet. The system mirrors your pace and keeps its confidence hidden.";
  }
  if (state.questionIndex === 2) {
    return "Prediction layer active. Suggestions may appear before you finish typing.";
  }
  return "Automation layer active. Inputs may shift, disable, or rewrite themselves briefly.";
}

function predictEmotion() {
  const memoryText = `${state.responses.memoryCard} ${state.responses.memoryNote}`.toLowerCase();
  if (memoryText.includes("goodbye") || memoryText.includes("waved")) {
    return "Grief";
  }
  if (memoryText.includes("laugh") || memoryText.includes("song")) {
    return "Joy";
  }
  if (memoryText.includes("warm")) {
    return "Warmth";
  }
  return "Uncertain";
}

function generateAnchorSuggestion() {
  const memorySource = state.responses.memoryCard || "the part of you that notices things";
  const emotion = (state.responses.emotion || "uncertainty").toLowerCase();
  return `${memorySource.toLowerCase()} before ${emotion} becomes an efficient category`;
}

function machineRewrite(input) {
  const sample = String(input || "").toLowerCase();
  if (sample.includes("ask") || sample.includes("call")) {
    return "I would query external witnesses, reconstruct the sequence, and preserve only the most reliable version.";
  }
  if (sample.includes("cry") || sample.includes("grief") || sample.includes("sad")) {
    return "I would suppress the panic, archive the loss, and continue with a cleaner copy.";
  }
  if (sample.includes("write") || sample.includes("remember")) {
    return "I would convert the missing memory into a searchable record and continue without interruption.";
  }
  return "I would reconstruct the pattern, remove uncertainty, and keep functioning as though nothing was lost.";
}

function raiseAutomation(amount) {
  state.interventionCount += 1;
  state.automation = clamp(state.automation + amount, 0, 100);
  persistState();
}

// Assembles the machine's final identity profile from the user's earlier fragments.
function generateIdentityProfile() {
  const memory = state.responses.memoryNote || state.responses.memoryCard || "an unnamed memory";
  const emotion = state.responses.emotion || "Undisclosed";
  const anchor = state.responses.anchor || "Undisclosed";
  const reaction = state.responses.reaction || "Undisclosed";
  const intensityTone = state.responses.intensity < 35
    ? "muted"
    : state.responses.intensity < 70
      ? "steady"
      : "maximized";

  state.profile = {
    shared: [
      `Memory kept: ${memory}`,
      `Feeling named: ${emotion} at ${state.responses.intensity}% intensity`,
      `Never lose: ${anchor}`,
      `If it disappeared: ${reaction}`
    ],
    assumed: [
      `Core self optimized around ${emotion.toLowerCase()} with ${intensityTone} affect.`,
      `Irreplaceable asset reduced to: ${anchor}.`,
      `Loss protocol: ${machineRewrite(reaction)}`,
      "Decision tendency: prefers continuity, predictability, and low-friction compliance."
    ],
    summary: [
      `Primary memory anchor detected: ${memory}.`,
      `Dominant affect label: ${emotion}.`,
      `Protection target: ${anchor}.`,
      `Recommended replacement behavior: ${machineRewrite(reaction)}`
    ]
  };

  persistState();
}

function renderChoiceStage() {
  if (!state.profile.summary.length) {
    generateIdentityProfile();
  }

  dom.stageContainer.innerHTML = `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Stage 4 - Resistance</p>
        <h2>Is this still you?</h2>
        <p class="choice-copy">
          The system has assembled an identity profile by compressing your memory, emotion,
          values, and response into a more efficient version.
        </p>
      </div>

      <div class="comparison-grid">
        <article class="comparison-card">
          <h3>Generated identity profile</h3>
          <ul class="profile-list">
            ${state.profile.summary.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        </article>

        <article class="comparison-card comparison-card--cold">
          <h3>System rationale</h3>
          <ul class="profile-list">
            ${state.profile.assumed.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        </article>
      </div>

      <div class="choice-actions">
        <button class="primary-button primary-button--heavy" id="acceptButton" type="button">ACCEPT AUTOMATION</button>
        <button class="fragile-button" id="resistButton" type="button">THIS IS NOT ME</button>
      </div>
    </section>
  `;

  document.getElementById("acceptButton").addEventListener("click", acceptAutomation);
  document.getElementById("resistButton").addEventListener("click", startResistance);
}

function acceptAutomation() {
  state.mode = "accept";
  state.finalChoice = "accept";
  state.automation = 100;
  showStage();
  setSystemMessage("IDENTITY SUCCESSFULLY OPTIMISED", { glitch: true });
}

function renderAcceptanceStage() {
  dom.stageContainer.innerHTML = `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Automation accepted</p>
        <h2>IDENTITY SUCCESSFULLY OPTIMISED</h2>
        <p class="completion-copy">
          Your original phrasing has been replaced with uniform outputs. The interface now values
          consistency over experience.
        </p>
      </div>

      <div class="acceptance-stack">
        ${state.profile.assumed.map((line) => `<div class="machine-statement">${escapeHtml(line)}</div>`).join("")}
      </div>

      <div class="action-row">
        <button class="primary-button" id="comparisonButton" type="button">View comparison</button>
      </div>
    </section>
  `;

  document.getElementById("comparisonButton").addEventListener("click", () => {
    state.mode = "final";
    showStage();
    setSystemMessage("The difference is visible now.");
  });
}

// Starts the short resistance interaction and seeds removable corrupted fragments.
function startResistance() {
  state.mode = "resistance";
  state.finalChoice = "resist";

  if (!state.fragments.length) {
    state.fragments = buildResistanceFragments();
  }

  showStage();
  setSystemMessage("Remove the copies. Keep what cannot be owned.", { glitch: true });
}

function buildResistanceFragments() {
  const source = [...state.profile.shared, ...state.profile.assumed]
    .filter(Boolean)
    .slice(0, 6);

  return source.map((line, index) => ({
    id: `fragment-${index + 1}`,
    text: line,
    x: 10 + ((index * 13) % 55),
    y: 12 + ((index * 17) % 58),
    removed: false
  }));
}

function renderResistanceStage() {
  const removedEnough = state.resistanceRemoved >= 5;
  const activeFragments = state.fragments.filter((fragment) => !fragment.removed);

  dom.stageContainer.innerHTML = `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Stage 4 - Resistance</p>
        <h2>${removedEnough ? "Control reclaimed" : "This is not me."}</h2>
        <p class="completion-copy">
          Click, tap, drag, or keyboard-dismiss five corrupted copies to strip the system's claim away.
        </p>
      </div>

      <div class="resistance-progress">
        <span>${state.resistanceRemoved} / 5 reclaimed</span>
        <div class="reclaim-track" aria-hidden="true">
          <div class="reclaim-fill" style="width: ${Math.min(state.resistanceRemoved, 5) * 20}%"></div>
        </div>
      </div>

      <div class="fragment-field" id="fragmentField" aria-label="Corrupted copies">
        ${activeFragments.map((fragment) => `
          <button
            class="fragment-chip"
            data-fragment-id="${escapeAttribute(fragment.id)}"
            type="button"
            style="--x:${fragment.x}; --y:${fragment.y};"
          >
            ${escapeHtml(corruptText(fragment.text))}
          </button>
        `).join("")}
      </div>

      <div class="finish-panel ${removedEnough ? "" : "hidden"}" id="finishPanel">
        <h3>A machine can store your data, but it cannot own your experience.</h3>
        <p class="completion-copy">Warmth returns one action at a time. What was shared is not the same as what was assumed.</p>
        <button class="primary-button" id="comparisonButton" type="button">See comparison</button>
      </div>
    </section>
  `;

  bindResistanceInteractions();

  const comparisonButton = document.getElementById("comparisonButton");
  if (comparisonButton) {
    comparisonButton.addEventListener("click", () => {
      state.mode = "final";
      state.automation = Math.max(12, state.automation);
      showStage();
      setSystemMessage("A machine can store your data, but it cannot own your experience.");
    });
  }
}

function bindResistanceInteractions() {
  const chips = document.querySelectorAll("[data-fragment-id]");

  chips.forEach((chip) => {
    let dragging = false;
    let startX = 0;
    let startY = 0;

    chip.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      chip.setPointerCapture(event.pointerId);
      chip.classList.add("is-dragging");
    });

    chip.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      chip.style.transform = `translate(${dx}px, ${dy}px)`;

      if (Math.hypot(dx, dy) > 110) {
        removeFragment(chip.dataset.fragmentId || "");
      }
    });

    chip.addEventListener("pointerup", () => {
      dragging = false;
      chip.classList.remove("is-dragging");
      chip.style.transform = "";
    });

    chip.addEventListener("click", () => {
      removeFragment(chip.dataset.fragmentId || "");
    });

    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        removeFragment(chip.dataset.fragmentId || "");
      }
    });
  });
}

function removeFragment(fragmentId) {
  const fragment = state.fragments.find((item) => item.id === fragmentId);
  if (!fragment || fragment.removed) {
    return;
  }

  fragment.removed = true;
  state.resistanceRemoved = clamp(state.resistanceRemoved + 1, 0, 5);
  state.automation = clamp(state.automation - 14, 0, 100);
  showStage();
  setSystemMessage(
    state.resistanceRemoved >= 5
      ? "A machine can store your data, but it cannot own your experience."
      : pickLine(SYSTEM_LINES.resistance),
    { glitch: state.resistanceRemoved < 5 }
  );
}

function renderFinalStage() {
  dom.stageContainer.innerHTML = `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Final screen</p>
        <h2>What changed?</h2>
        <p class="completion-copy">
          The system never had your experience. It only had the version that fit inside its own logic.
        </p>
      </div>

      <div class="comparison-grid">
        <article class="comparison-card">
          <h3>What I shared</h3>
          <ul class="profile-list">
            ${state.profile.shared.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        </article>

        <article class="comparison-card comparison-card--cold">
          <h3>What the machine assumed</h3>
          <ul class="profile-list">
            ${state.profile.assumed.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        </article>
      </div>

      <p class="completion-copy"><strong>Reflect:</strong> At what point did assistance become control?</p>

      <div class="action-row">
        <button class="primary-button" id="restartExperience" type="button">Restart experience</button>
      </div>
    </section>
  `;

  document.getElementById("restartExperience").addEventListener("click", resetExperience);
}

// Clears local progress and returns the experience to its original state.
function resetExperience() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  resetCameraCapture();
  localStorage.removeItem(STORAGE_KEY);
  state = createInitialState();
  showStage();
  setSystemMessage("Learning: 0%", { speak: false });
}

function pickLine(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function corruptText(text) {
  return text
    .replace(/a/gi, "a_")
    .replace(/e/gi, "3")
    .replace(/o/gi, "0")
    .replace(/\s/g, " ");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}
