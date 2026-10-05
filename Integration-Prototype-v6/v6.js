"use strict";

// Another Me v6: the "descent" interface layer.
// script.js owns state, devices and providers. This layer owns screens, navigation and motion.
// Rule: one screen is one meaningful interaction. Nothing here paginates arbitrary DOM blocks.
(() => {
  const BUILD = document.querySelector('meta[name="another-me-build"]')?.content || "dev";
  const core = window.SimulationCore;
  const room = new DigitalRoom(document.getElementById("atmo"));
  const base = { render, move, renderData, status, generateProxyMedia, capturePortrait, deleteSession, useOperationFallback, skipOperation, invalidateAnalysis, clearMedia, updateRecordClock, setRecording, proxySpeechText };
  const shell = document.getElementById("experienceShell");
  const forwardButton = document.getElementById("forwardButton");
  const forwardHint = document.getElementById("forwardHint");
  const forwardAlt = document.getElementById("forwardAlt");
  const backButton = document.querySelector('.navigation [data-action="back"]');
  const skipButton = document.querySelector('.navigation [data-action="skip"]');
  const marker = document.getElementById("stageTransition");
  const dockHome = document.getElementById("dockHome");
  const esc = escapeHtml;
  const pad = n => String(n).padStart(2, "0");
  const drafts = new Map();
  const revealedPrompts = new Set();
  let capabilities = null;
  let transitionTicket = 0, transitioning = false;
  let lastScreenKey = "", focusAfterRender = "", acknowledge = "", waveFrame = 0;

  console.info(`[another-me] build ${BUILD}`);
  labels.unknown = ["?", "UNKNOWN"];
  operationDefinitions.fiction = { label: "Hypothetical situation", stages: [6], timeoutMs: 150000, loading: "Generating a possible scenario…", success: "Your hypothetical situation is ready.", fallback: "Live simulation is unavailable. Try again, use a labelled demonstration, or skip." };
  operationDefinitions.microphone.stages = [2, 3, 4, 5];
  operationDefinitions.identity.timeoutMs = 95000;
  operationDefinitions.identity.loading = "Constructing an identity model from your answers…";
  operationDefinitions.prediction.loading = "Predicting what you will choose…";
  operationDefinitions.proxy.loading = "Generating a response from your digital double…";
  operationDefinitions.elevenlabs.loading = "Preparing your cloned voice…";
  operationDefinitions.did.loading = "Creating the talking double… D-ID can queue for several minutes.";
  stages[5][2] = "Explore a situation you never described.";

  function ui() {
    return sessionState.ui.v6 ||= { checkpoint: false, consentPage: 0, simulationStep: "consent", simulationRevision: "", simulationMode: "", simulationFeedback: {}, seenScenarios: [], portraitConfirmed: false, proxyView: "response" };
  }
  const atCheckpoint = () => ui().checkpoint && sessionState.currentStage === 5;

  /* ---------- small markup helpers ---------- */
  const act = (action, label, cls = "btn-secondary", extra = "") => `<button type="button" data-v6="${action}" class="${cls}" ${extra}>${label}</button>`;
  const baseAct = (action, label, cls = "btn-secondary", extra = "") => `<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
  const row = (...items) => `<div class="row">${items.filter(Boolean).join("")}</div>`;
  const TAGS = {
    you: ["■", "YOU SAID"], heard: ["≈", "TRANSCRIBED FROM YOUR VOICE"], model: ["◇", "MODEL INFERENCE"], predicted: ["◇", "MODEL PREDICTION"],
    uncertain: ["◌", "UNCERTAIN"], conflict: ["⟂", "POSSIBLE CONTRADICTION"], generated: ["✱", "GENERATED"], double: ["✱", "GENERATED · AI DOUBLE"],
    contested: ["✎", "CONTESTED BY YOU"], rejected: ["⊘", "REJECTED BY YOU"], confirmed: ["✓", "CONFIRMED BY YOU"], demo: ["◍", "LABELLED DEMONSTRATION"]
  };
  const tag = (kind, text = "") => `<span class="tag tag--${kind}"><span aria-hidden="true">${TAGS[kind][0]}</span>${text || TAGS[kind][1]}</span>`;
  function head(title, { context = "", meta = "", promptKey = "" } = {}) {
    const s = sessionState.currentStage;
    const id = atCheckpoint() ? `<span class="screen-id__num">05</span>THRESHOLD` : `<span class="screen-id__num">${pad(s)}</span>${esc(stages[s - 1][0])}`;
    const heading = promptKey
      ? `<h2 class="screen-title spoken-prompt" data-prompt-key="${esc(promptKey)}" data-prompt-text="${esc(title)}" aria-label="${esc(title)}"><span class="prompt-letters" aria-hidden="true">${esc(title)}</span></h2>`
      : `<h2 class="screen-title">${title}</h2>`;
    return `<header class="screen-head"><p class="screen-id">${id}${meta ? `<span class="screen-id__meta">${meta}</span>` : ""}</p>${heading}${context ? `<p class="screen-context">${context}</p>` : ""}</header>`;
  }
  const screen = (kind, inner) => `<div class="screen screen--${kind}">${inner}</div>`;
  const answerById = id => readableAnswers().find(a => a.id === id);
  // Evidence shows what the participant actually said; question numbers stay a faint source note.
  function evidence(ids, extra = "", summary = "Why does it think this?") {
    const items = (ids || []).map(answerById).filter(Boolean);
    const list = items.map(a => `<li>${tag("you")}<p class="evidence-quote">${esc(a.answer)}</p><p class="source-note">in reply to: ${esc(a.question)}</p></li>`).join("");
    return `<details class="evidence"><summary>${summary}</summary><div class="evidence-body">${extra}${list ? `<ul class="evidence-list">${list}</ul>` : '<p class="hint">No specific answer was cited.</p>'}</div></details>`;
  }
  const elapsed = key => sessionState.operations[key]?.state === "loading" ? `<span class="elapsed" data-since="${sessionState.operations[key].updatedAt}">0:00</span>` : "";

  /* ---------- failures, kept human-readable ---------- */
  function failureKind(code = "") {
    if (/missing_api_key|invalid_api_key|credentials/.test(code)) return ["Service not set up", "The AI provider is missing or rejected this computer's credentials (authentication / configuration)."];
    if (/rate_limit/.test(code)) return ["Service busy", "The provider is rate limiting requests. Wait a moment and retry."];
    if (/quota|credits/.test(code)) return ["Out of credits or quota", "The provider account has reached its usage or credit limit."];
    if (/account_restricted/.test(code)) return ["Account restriction", "The provider account does not allow this operation on its current plan."];
    if (/portrait_rejected/.test(code)) return ["Portrait not accepted", "Use a clear, front-facing portrait. You can retake it on the permission screen."];
    if (/audio_rejected/.test(code)) return ["Recording not accepted", "The provider rejected the voice sample's format, length or content."];
    if (/content_rejected|model_refusal/.test(code)) return ["Request declined", "The provider declined this request under its policy."];
    if (/timeout/.test(code)) return ["Took too long", "The request reached its time limit and was stopped."];
    if (/incomplete_output|empty_model_output|empty_response/.test(code)) return ["Incomplete result", "The model returned an incomplete or empty answer, so nothing was replaced."];
    if (/invalid_model_json|invalid_model_output|invalid_profile|invalid_fiction|validation/.test(code)) return ["Did not pass its checks", "The result failed validation, so it was not shown as if it were valid."];
    if (/network/.test(code)) return ["Connection problem", "The local server or provider could not be reached."];
    if (/permission_denied/.test(code)) return ["Permission blocked", "Allow access in your browser's site settings, then retry."];
    if (/device_missing/.test(code)) return ["No device found", "Connect a device and retry."];
    if (/device_busy/.test(code)) return ["Device in use", "Close the other app using it and retry."];
    if (/unsupported/.test(code)) return ["Not supported here", "Try a current Chrome or Edge browser, or use text."];
    return ["Could not finish", ""];
  }
  function notice(key, { retry = "Try again", fallback = false } = {}) {
    const op = sessionState.operations[key];
    if (!op || !["timeout", "error", "fallback"].includes(op.state)) return "";
    if (op.state === "fallback") return op.errorCode === "cancelled" ? `<div class="notice notice--info" role="status"><p>${esc(op.message)}</p>${retry ? row(baseAct("retry-operation", retry, "btn-secondary", `data-operation="${key}"`)) : ""}</div>` : "";
    const [title, hint] = failureKind(op.errorCode);
    return `<div class="notice" role="alert"><p class="notice__title">${title}</p><p>${esc(op.message)}</p>${hint ? `<p class="hint">${hint}</p>` : ""}
      ${row(retry ? baseAct("retry-operation", retry, "btn-secondary", `data-operation="${key}"`) : "", fallback ? baseAct("use-operation-fallback", "Use a labelled demonstration", "btn-tertiary", `data-operation="${key}"`) : "")}
      <details class="tech"><summary>Technical detail</summary><p><code>${esc(op.errorCode || "unknown")}</code> · ${esc(operationDefinitions[key].label)} · ${esc(op.state)}</p></details></div>`;
  }

  /* ---------- prompt reveal (words resolve once per prompt) ---------- */
  window.revealPrompt = () => {
    clearInterval(promptTimer); promptTimer = null;
    const prompt = stageElement.querySelector("[data-prompt-key]");
    if (!prompt) return;
    const key = prompt.dataset.promptKey + prompt.dataset.promptText;
    const fresh = !revealedPrompts.has(key);
    revealedPrompts.add(key);
    prompt.querySelector(".prompt-letters").innerHTML = prompt.dataset.promptText.split(/\s+/).map((word, i) => `<span class="prompt-word ${fresh ? "fresh" : ""}" style="--word-delay:${Math.min(i * 22, 600)}ms">${esc(word)}</span>`).join(" ");
    prompt.classList.add("is-complete");
    if (fresh) setTimeout(() => { if (prompt.isConnected) maybeAutoRecordQuestion(prompt.dataset.promptKey); }, room.reduced ? 0 : 900);
  };
  window.showStageTransition = () => false;
  window.intro = () => "";
  window.renderOperationStatus = () => { operationStatusElement.hidden = true; operationStatusElement.replaceChildren(); };
  window.status = (message, kind) => {
    base.status(message, kind);
    // The live region stays screen-reader only; visible feedback lives beside each control.
    statusElement.classList.add("sr-only");
    if (kind === "error" && message) forwardHint.textContent = message, forwardHint.classList.add("is-error");
  };
  window.updateRecordClock = () => {
    base.updateRecordClock();
    document.getElementById("ambientRecordClock").textContent = formatTime(Math.floor((Date.now() - recordStart) / 1000));
  };
  window.proxySpeechText = value => base.proxySpeechText(ProxyText.forSpeech(value));

  /* ---------- the shared voice + words workspace ---------- */
  function deviceNotice(key) {
    const item = sessionState.operations[key];
    if (!item || ["idle", "success"].includes(item.state) || item.errorCode === "cancelled") return "";
    if (item.state === "loading") return `<p class="hint" role="status">Requesting ${key} access…</p>`;
    return notice(key, { retry: key === "camera" ? "Retry camera" : "Retry microphone" });
  }
  function voiceColumn(target, audio, { confirmable = false } = {}) {
    const active = recorder && recordTarget === target;
    const transcribing = activeOperations.has("transcription");
    const state = active ? "recording" : transcribing ? "processing" : sessionState.operations.microphone?.state === "error" ? "error" : audio ? "complete" : "ready";
    const word = { ready: "Ready", recording: "Recording", processing: "Transcribing", complete: confirmable && !sessionState.audioConfirmed ? "Recorded · listen back" : "Recorded", error: "Microphone problem" }[state];
    let body;
    if (active) body = `<div class="rec-live"><span class="rec-dot" aria-hidden="true"></span><output id="recordClock" aria-label="Recording time">00:00</output><span class="rec-limit">/ 01:00</span><canvas class="rec-wave" id="recWave" width="240" height="40" aria-hidden="true"></canvas></div>${row(baseAct("stop-recording", "Stop recording", "btn-primary"))}`;
    else if (audio) body = `<audio controls preload="metadata" src="${audio.url}" aria-label="Your recording"></audio>${row(baseAct("start-recording", "Record again", "btn-secondary", busy ? "disabled" : ""), baseAct("delete-audio", "Delete recording", "btn-tertiary danger"))}`;
    else body = `<button type="button" class="rec-button" data-action="start-recording" ${busy ? "disabled" : ""}><span class="rec-button__icon" aria-hidden="true"></span><span>Record your answer</span></button><p class="hint">Up to a minute. When you stop, the recording is sent to OpenAI and turned into words you can edit.</p>`;
    return `<section class="ws-voice" aria-label="Speak your answer"><p class="ws-label">SPEAK <span class="rec-state" data-state="${state}">${word}</span></p>${body}${deviceNotice("microphone")}</section>`;
  }
  function wordsColumn({ id, text, origin, audio, placeholder, transcribeNeedsConfirm = false }) {
    const transcribing = activeOperations.has("transcription");
    const status = transcribing ? '<span class="ws-status is-working">Transcribing your response…</span>'
      : origin === "transcribed" ? '<span class="ws-status">Transcribed · edit anything</span>' : text?.trim() ? '<span class="ws-status">Written by you</span>' : '<span class="ws-status">or type instead</span>';
    const needsConsent = audio && !sessionState.consent.transcription && !text?.trim();
    const consentCard = needsConsent ? `<div class="inline-consent"><p>Turn your recording into editable words? The audio is sent to OpenAI for transcription.</p>${row(baseAct("allow-transcription", "Transcribe my recording", "btn-secondary", busy ? "disabled" : ""))}</div>` : "";
    const retry = audio && sessionState.consent.transcription && !text?.trim() && !transcribing && !(transcribeNeedsConfirm && !sessionState.audioConfirmed)
      ? (notice("transcription", { retry: "Retry transcription" }) || row(baseAct("transcribe", "Transcribe my recording", "btn-secondary", busy ? "disabled" : ""))) : "";
    return `<section class="ws-words" aria-label="Your words"><p class="ws-label">${origin === "transcribed" ? "WHAT THE SYSTEM HEARD" : "IN YOUR WORDS"} ${status}</p>${consentCard}${retry}
      <label class="sr-only" for="${id}">Your answer, editable</label><textarea id="${id}" maxlength="4000" ${transcribing ? 'readonly aria-busy="true"' : ""} placeholder="${esc(placeholder)}">${esc(text || "")}</textarea>
      <p class="hint">Edit freely. What you leave here, not the raw recording, is what the system reads.</p></section>`;
  }
  const workspace = (voice, words, cls = "") => `<div class="workspace ${cls}">${voice}${words}</div>`;

  /* ---------- opening + stage 1 ---------- */
  window.renderOpening = () => screen("opening", `<div class="opening">
    <p class="opening__kicker">AN EXPERIMENT IN BEING SEEN</p>
    <h2 class="opening__title opening__title--split"><span>How much of you</span> <span>can a system make?</span></h2>
    <p class="opening__lede">Give it an image, your voice and a few answers. It will build an interpretation of you, and then speak as you.</p>
    <p class="opening__note">What it builds is a model, not you. You can correct it, reject it or delete everything at any time.</p>
    ${row(act("begin", "Enter", "btn-primary btn-large"))}
    <div class="opening__more"><details><summary>What happens to my information?</summary><p>Your session lives only in this browser's memory, not a database. What you supply, what the AI infers and what it generates are always labelled separately. External AI services (OpenAI, ElevenLabs, D-ID) are used only after you allow each one, and their own retention policies apply.</p></details>
    <details><summary>How long does it take?</summary><p>About 10–15 minutes, in six stages that go progressively deeper. You can skip, go back or leave whenever you like.</p></details></div></div>`);

  window.renderImage = () => {
    const image = sessionState.supplied.image;
    let frame;
    if (image) frame = `<figure class="image-frame">${tag("you", "YOUR IMAGE")}<img src="${image.url}" alt="Your chosen image"><figcaption>${sessionState.photoConfirmed ? "This is the image you chose." : "Is this the one?"}</figcaption></figure>${row(baseAct("retake", "Replace image"), baseAct("delete-image", "Delete", "btn-tertiary danger"))}`;
    else if (cameraStream) frame = `<figure class="image-frame image-frame--live"><video id="cameraVideo" class="camera" autoplay muted playsinline aria-label="Mirrored live camera preview"></video><figcaption>Live and mirrored. Nothing is kept until you take the photo.</figcaption></figure>${row(baseAct("capture", "Take photo", "btn-primary"), baseAct("camera-off", "Turn camera off", "btn-tertiary"))}`;
    else frame = `<div class="image-drop"><span class="image-drop__ring" aria-hidden="true"></span>${row(`<label class="btn-secondary file-button">Choose an image<input id="imageInput" type="file" accept="image/*"></label>`, baseAct("enable-camera", "Use camera"))}<p class="hint">The camera starts only if you choose it.</p></div>`;
    return screen("image", `<div class="split split--image"><div>${head("Begin with one image that matters to you.", { context: "A person, place, object or moment. The system will not read your personality or appearance from it. It only knows that you chose it." })}
      <details class="evidence"><summary>What is this experience?</summary><div class="evidence-body"><p>Over six stages, a system turns what you share into an interpretation of you, then a prediction, then a double that speaks as you. Every step is an AI reading of limited information, not an objective version of you.</p></div></details></div>
      <div class="image-col">${frame}${deviceNotice("camera")}</div></div>`);
  };

  /* ---------- stage 2 ---------- */
  window.renderAudio = () => {
    const s = sessionState, image = s.supplied.image;
    const thumb = image && s.photoConfirmed ? `<img class="thumb" src="${image.url}" alt="The image you chose">` : "";
    return screen("respond", `<div class="respond-head">${thumb}${head("Tell me something this image doesn't show.", { promptKey: "image-story", context: "Speak for about twenty seconds, or write a few lines." })}</div>
      ${workspace(voiceColumn("story", s.supplied.audio, { confirmable: true }), wordsColumn({ id: "storyText", text: s.supplied.transcript, origin: s.supplied.transcriptOrigin, audio: s.supplied.audio, placeholder: "Begin here…", transcribeNeedsConfirm: true }))}
      ${s.consent.transcription && s.consent.audioRecording ? `<details class="evidence quiet"><summary>Record the next questions automatically?</summary><div class="evidence-body">${baseAct("toggle-auto-record", s.consent.autoRecordQuestions ? "Turn off automatic recording" : "Start recording after each question appears", "btn-secondary", `aria-pressed="${s.consent.autoRecordQuestions}"`)}<p class="hint">You can stop, re-record or edit every answer.</p></div></details>` : ""}`);
  };

  /* ---------- stage 3: questions, profile, reviews ---------- */
  window.renderQuestions = () => {
    const s = sessionState;
    if (s.questionIndex >= questions.length) return renderProfile();
    const a = s.supplied.answers[s.questionIndex];
    return screen("respond", `${head(a.question, { promptKey: `question-${s.questionIndex + 1}`, meta: `Question ${s.questionIndex + 1} of ${questions.length}` })}
      ${workspace(voiceColumn(a.id, a.audio), wordsColumn({ id: "questionText", text: a.text, origin: a.textOrigin, audio: a.audio, placeholder: "Your answer, in your own words…" }))}`);
  };
  function verdictState(feedback) {
    if (!feedback) return "";
    return feedback.verdict === "corrected" ? "contested" : feedback.verdict === "rejected" ? "rejected" : feedback.verdict === "accepted" ? "confirmed" : "";
  }
  function profileGenerating() {
    const answered = readableAnswers().filter(a => a.id.startsWith("question_"));
    return screen("generating", `${head("A model of you is being constructed.", { context: "The system is reading your three answers and separating what you said from what it concludes." })}
      <div class="generating"><div class="pulse-rings" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="generating__line" role="status">${esc(operationDefinitions.identity.loading)} ${elapsed("identity")}</p><p class="hint">This usually takes under a minute. Your answers are safe if it fails.</p></div>
      <ul class="held-input">${answered.map(a => `<li>${tag("you")}<p>${esc(a.answer.length > 140 ? a.answer.slice(0, 140) + "…" : a.answer)}</p></li>`).join("")}</ul>`);
  }
  window.renderProfile = () => {
    const s = sessionState, profile = s.inferred.profile, demo = s.inferred.mode === "mock";
    if (activeOperations.has("identity")) return profileGenerating();
    if (!profile) {
      const voiceOnly = s.supplied.answers.filter(a => a.audio && !a.text.trim()).length;
      const typed = s.supplied.answers.filter(a => a.text.trim()).length;
      return screen("generating", `${head(typed ? "The model could not be built yet." : "There is nothing to interpret yet.", { context: typed ? "Your answers are kept exactly as you left them." : "You chose not to answer, or your recordings still need words." })}
        ${notice("identity", { retry: "", fallback: true })}
        ${voiceOnly ? `<p class="notice notice--info">${voiceOnly} voice ${voiceOnly === 1 ? "answer was" : "answers were"} recorded but not transcribed. Go back to transcribe or type ${voiceOnly === 1 ? "it" : "them"}.</p>` : ""}
        ${row(act("review-questions", "Review my answers", "btn-tertiary"))}`);
    }
    const page = s.ui.profilePage, n = profile.inferred_information.length;
    if (page === 0) return profileOverview(profile, demo);
    if (page <= n) return inferenceReview(profile.inferred_information[page - 1], page, n, demo);
    const index = page - n - 1;
    if (!profile.contradictions.length) return screen("debate", `${head("No contradiction was found.", { meta: "Contradictions" })}<div class="split split--debate"><section class="side side--model">${columnLabel("THE MODEL")}<p class="claim">The answers did not give enough evidence for a clear tension, so the system has not invented one.</p><p class="hint">This does not mean your answers are perfectly consistent, only that this limited information did not show a supported conflict.</p></section><section class="side side--you">${columnLabel("YOU")}<p class="hint">Nothing to confront here. Continue when you are ready.</p>${row(baseAct("regenerate-profile", "Rebuild the profile", "btn-tertiary", busy ? "disabled" : ""), act("review-questions", "Review my answers", "btn-tertiary"))}</section></div>`);
    return contradictionReview(profile.contradictions[index], index, profile.contradictions.length, demo);
  };
  const columnLabel = text => `<p class="column-label">${text}</p>`;
  function profileOverview(profile, demo) {
    const s = sessionState;
    const supplied = readableAnswers().filter(a => a.id !== "image_context");
    const inferred = profile.inferred_information.map((item, i) => {
      const state = verdictState(s.inferred.participantFeedback.find(f => f.id === item.id));
      return `<li class="reveal-item model-item ${state ? `is-${state}` : ""} confidence-${esc(item.confidence_label)}" style="--i:${i + 2}">${state ? tag(state) : tag("model")}<p>${esc(item.statement)}</p><p class="confidence">${esc(item.confidence_label)} confidence · a label, not a measurement</p></li>`;
    }).join("");
    const unknowns = (profile.unknowns || []).slice(0, 3).map(u => `<li class="reveal-item uncertain-item" style="--i:${profile.inferred_information.length + 2}">${tag("uncertain")}<p>${esc(u)}</p></li>`).join("");
    const conflicts = profile.contradictions.length ? `<li class="reveal-item conflict-item" style="--i:${profile.inferred_information.length + 3}">${tag("conflict", `${profile.contradictions.length} POSSIBLE ${profile.contradictions.length === 1 ? "CONTRADICTION" : "CONTRADICTIONS"}`)}<p>Something in your answers does not quite fit. You will be asked to confront ${profile.contradictions.length === 1 ? "it" : "them"}.</p></li>` : "";
    return screen("profile", `${head("A version of you is taking shape.", { context: "This is a temporary interpretation built from limited answers, not your identity. Review each part next." })}
      ${demo ? `<p>${tag("demo")}</p>` : ""}${notice("identity", { retry: "Retry profile" })}
      <p class="profile-summary reveal-item" style="--i:0">${esc(profile.profile_summary)}</p>
      <div class="split split--profile"><section class="side side--you">${columnLabel("WHAT YOU SAID")}<ul class="ledger">${supplied.map((a, i) => `<li class="reveal-item you-item" style="--i:${i + 1}"><p>${esc(a.answer.length > 160 ? a.answer.slice(0, 160) + "…" : a.answer)}</p></li>`).join("")}</ul></section>
      <section class="side side--model">${columnLabel("WHAT THE MODEL CONCLUDED")}<ul class="ledger">${inferred}${unknowns}${conflicts}</ul></section></div>
      ${row(baseAct("regenerate-profile", "Rebuild the profile", "btn-tertiary", busy ? "disabled" : ""), act("review-questions", "Review my answers", "btn-tertiary"))}`);
  }
  function inferenceReview(item, page, n, demo) {
    const s = sessionState, feedback = s.inferred.participantFeedback.find(f => f.id === item.id);
    const state = verdictState(feedback), editing = s.ui.correctingInferenceId === item.id;
    const ack = acknowledge === item.id ? "is-ack" : "";
    const extra = `<p>${tag("uncertain")} ${esc(item.uncertainty_reason)}</p>${item.alternative_interpretation ? `<p class="hint">Another reading: ${esc(item.alternative_interpretation)}</p>` : ""}`;
    const choices = [["accepted", "Accurate"], ["corrected", "Correct it"], ["rejected", "Reject"]].map(([value, caption]) => `<button type="button" class="choice" data-action="review-inference" data-id="${esc(item.id)}" data-verdict="${value}" aria-pressed="${editing ? value === "corrected" : feedback?.verdict === value}">${caption}</button>`).join("");
    const correction = editing ? `<div class="inline-field"><label for="inferenceCorrection">What did it miss? Say it in your own words.</label><textarea id="inferenceCorrection">${esc(feedback?.correction || "")}</textarea>${row(baseAct("save-inference-correction", "Keep my correction", "btn-secondary"), baseAct("cancel-inference-correction", "Cancel", "btn-tertiary"))}</div>` : "";
    const yours = feedback?.correction && !editing ? `<div class="you-statement">${tag("you", "YOUR CORRECTION")}<p>${esc(feedback.correction)}</p></div>` : "";
    return screen("debate", `${head("Does this sound like you?", { meta: `Interpretation ${page} of ${n}` })}${demo ? `<p>${tag("demo")}</p>` : ""}
      <div class="split split--debate"><section class="side side--model ${state ? `is-${state}` : ""} ${ack}">${columnLabel("THE MODEL")}${state ? tag(state) : tag("model")}<p class="claim">${esc(item.statement)}</p><p class="confidence">${esc(item.confidence_label)} confidence</p>${state ? `<p class="revision-note">${{ contested: "The model has been contested. Your correction replaces this reading in later stages.", rejected: "Rejected. This reading is excluded from later stages.", confirmed: "You confirmed this reading." }[state]}</p>` : ""}${evidence(item.evidence_ids, extra)}</section>
      <section class="side side--you">${columnLabel("YOU")}<div class="choices" role="group" aria-label="Your verdict">${choices}</div>${correction}${yours}</section></div>`);
  }
  function contradictionReview(item, index, total, demo) {
    const id = contradictionId(index), review = sessionState.inferred.contradictionFeedback.find(r => r.id === id);
    const ack = acknowledge === id ? "is-ack" : "";
    const choices = [["accurate", "It's a real tension"], ["context-needed", "It needs context"], ["not-a-contradiction", "Not a conflict"]].map(([value, caption]) => `<button type="button" class="choice" data-action="review-contradiction" data-id="${id}" data-verdict="${value}" aria-pressed="${review?.verdict === value}">${caption}</button>`).join("");
    const state = review?.verdict ? (review.verdict === "not-a-contradiction" ? "rejected" : review.verdict === "context-needed" ? "context" : "confirmed") : "";
    const stateTag = state === "context" ? tag("contested", "CONTEXT ADDED BY YOU") : state === "rejected" ? tag("rejected", "DISPUTED BY YOU") : state ? tag(state) : tag("conflict");
    return screen("debate", `${head("Something does not quite fit.", { meta: `Contradiction ${index + 1} of ${total}` })}${demo ? `<p>${tag("demo")}</p>` : ""}
      <div class="split split--debate split--tension"><section class="side side--model ${state ? `is-${state}` : ""} ${ack}">${columnLabel("THE MODEL")}${stateTag}<p class="claim">${esc(item.description)}</p>${state ? `<p class="revision-note">${{ rejected: "You disputed this tension. Your explanation travels with it.", context: "You added context the model could not see.", confirmed: "You agreed this tension is real." }[state]}</p>` : ""}${evidence(item.evidence_ids, item.possible_explanation ? `<p>${tag("model", "ITS GUESS AT AN EXPLANATION")} ${esc(item.possible_explanation)}</p>` : "")}</section>
      <section class="side side--you">${columnLabel("YOU")}<div class="choices" role="group" aria-label="Your response to this contradiction">${choices}</div>
      <div class="inline-field"><label for="contradictionExplanation">What is the model missing?</label><textarea id="contradictionExplanation" placeholder="Explain, disagree or add context…">${esc(review?.explanation || "")}</textarea></div></section></div>`);
  }

  /* ---------- stage 4 ---------- */
  window.renderPrediction = () => {
    const s = sessionState, prediction = s.predicted.predictions[0], actual = s.predicted.participantAnswers[0], comparison = s.predicted.comparisons[0];
    const demo = s.predicted.mode === "mock" ? tag("demo") : "";
    const title = head(dilemma, { promptKey: "prediction-dilemma", context: s.predictionShown ? "" : "Before you answer, the system will make its guess." });
    const modelText = prediction?.predicted_response ? `<p class="claim claim--predicted">${esc(prediction.predicted_response)}</p>` : `<p class="claim">I do not have enough evidence to predict your choice.</p>`;
    const why = prediction ? evidence(prediction.evidence_ids, `<p>${tag("uncertain")} ${esc(prediction.uncertainty_statement || "")}</p>${prediction.alternative_possible_response ? `<p class="hint">It also considered: ${esc(prediction.alternative_possible_response)}</p>` : ""}`) : "";
    if (!s.predictionShown) {
      const loading = activeOperations.has("prediction");
      return screen("predict", `${title}<div class="split split--debate"><section class="side side--model ${loading ? "is-working" : "is-silent"}">${columnLabel("THE MODEL")}<p class="claim claim--quiet" role="status">${loading ? `${esc(operationDefinitions.prediction.loading)} ${elapsed("prediction")}` : "The model has not spoken yet."}</p>${notice("prediction", { retry: "", fallback: true })}</section>
        <section class="side side--you">${columnLabel("YOU")}<p class="hint">You will answer after you see its guess.</p>${developerMode || mockMode ? row(baseAct("mock-prediction", "Use simulated prediction", "btn-tertiary")) : ""}</section></div>`);
    }
    if (!s.ui.predictionCompared) {
      return screen("predict", `${title}<div class="split split--debate"><section class="side side--model">${columnLabel("THE MODEL")}${tag("predicted")}${demo}${modelText}<p class="confidence">${esc(prediction?.confidence_label || "low")} confidence</p>${why}</section>
        <section class="side side--you">${columnLabel("YOU")}<p class="side-question">And you? What would you actually choose?</p>
        ${workspace(voiceColumn("prediction-answer", actual?.audio), wordsColumn({ id: "actualAnswer", text: actual?.text, origin: actual?.textOrigin, audio: actual?.audio, placeholder: "What would you choose?" }), "workspace--stacked")}</section></div>`);
    }
    const choices = ["Correct", "Partly correct", "Incorrect"].map(v => `<button type="button" class="choice" data-action="rate-prediction" data-value="${v}" aria-pressed="${comparison?.rating === v}">${v}</button>`).join("");
    return screen("predict", `${head("How close was it?", { meta: "Prediction and reality" })}
      <div class="split split--compare"><section class="side side--model">${columnLabel("THE MODEL PREDICTED")}${demo}<p class="claim">${esc(prediction?.predicted_response || "It withheld a prediction.")}</p></section>
      <section class="side side--you">${columnLabel("YOU CHOSE")}${tag(actual?.textOrigin === "transcribed" ? "heard" : "you")}<p class="you-claim">${esc(actual?.text || "")}</p></section></div>
      <div class="verdict"><div class="choices" role="group" aria-label="How close was the prediction">${choices}</div><div class="inline-field"><label for="predictionCorrection">What did it miss? (optional)</label><textarea id="predictionCorrection" placeholder="In your own words…">${esc(comparison?.explanation || "")}</textarea></div></div>`);
  };

  /* ---------- threshold: three permission screens ---------- */
  function samples() {
    return [["story", "Your image story"], ...sessionState.supplied.answers.map((a, i) => [a.id, `Your answer to question ${i + 1}`]), ["prediction-answer", "Your prediction answer"], ["clone-sample", "A new voice sample"]].filter(([id]) => recordingFor(id)?.blob);
  }
  // Every answer recording is transcribed as soon as it stops; recording is the consent, disclosed on the button.
  const transcribable = target => target === "story" || target === "prediction-answer" || /^question_/.test(target);
  window.setRecording = (target, recording) => {
    if (recording && transcribable(target)) sessionState.consent.transcription = true;
    base.setRecording(target, recording);
    if (target === "clone-sample" && recording) sessionState.ui.selectedVoiceTarget = target;
    // script.js auto-transcribes question and prediction answers; the image story also needed a confirm step.
    if (recording && target === "story") { sessionState.audioConfirmed = true; setTimeout(() => void transcribeCurrent("story"), 0); }
  };
  function permission(n, title, uses, purpose, body, alternatives, state) {
    return screen("permission", `<div class="permission" data-permission="${n}">
      <ol class="permission-steps" aria-label="Permission ${n + 1} of 3">${[0, 1, 2].map(i => `<li class="${i < n ? "done" : i === n ? "current" : ""}"><span class="sr-only">Permission ${i + 1}${i === n ? " (current)" : ""}</span></li>`).join("")}</ol>
      ${head(title, { meta: `Permission ${n + 1} of 3`, context: "The system is about to become more like you." })}
      <dl class="permission-terms"><div><dt>What it uses</dt><dd>${uses}</dd></div><div><dt>What for</dt><dd>${purpose}</dd></div></dl>
      ${state ? `<p class="permission-state">${state}</p>` : ""}${body}
</div>`);
  }
  function checkpoint() {
    const u = ui(), c = sessionState.consent;
    if (u.consentPage === 0) return permission(0, "May it speak as you?", "Your answers, corrections and the temporary profile.", "OpenAI writes an answer to a new question, in the first person, as if it were you. It will be labelled as generated and may be wrong.", "",
      "", c.proxyResponse ? "Currently allowed." : "");
    if (u.consentPage === 1) {
      const options = samples();
      if (!sessionState.ui.selectedVoiceTarget && options.length) sessionState.ui.selectedVoiceTarget = options[0][0];
      const sample = bestVoiceRecording(), active = recorder && recordTarget === "clone-sample";
      const picker = options.length ? `<div class="field"><label for="voiceSample">Which recording should it learn from?</label><select id="voiceSample">${options.map(([id, label]) => `<option value="${id}" ${sessionState.ui.selectedVoiceTarget === id ? "selected" : ""}>${label}</option>`).join("")}</select><audio controls src="${sample?.url || ""}" aria-label="Play the selected voice sample"></audio></div>` : '<p class="hint">No recording yet. Record a few sentences in your own voice.</p>';
      const recorderUi = active ? `<div class="rec-live"><span class="rec-dot" aria-hidden="true"></span><output id="recordClock">00:00</output><span class="rec-limit">/ 01:00</span><canvas class="rec-wave" id="recWave" width="240" height="40" aria-hidden="true"></canvas></div>${row(baseAct("stop-recording", "Stop recording", "btn-primary"))}`
        : row(baseAct("start-recording", options.length ? "Record a new sample" : "Record a voice sample", "btn-secondary", busy ? "disabled" : ""));
      const unavailable = capabilities?.elevenlabs === false ? '<p class="notice notice--info">Voice cloning is not configured on this computer. You can continue with text only.</p>' : "";
      return permission(1, "Your words, in your voice?", "One recording of your own voice that you choose here.", "ElevenLabs creates a temporary clone so the double's answer is spoken in your voice. Deletion of the clone is requested afterwards; provider retention may still apply.",
        `<div class="permission-tools">${picker}<div class="field">${recorderUi}${deviceNotice("microphone")}</div></div>${unavailable}`,
        "", c.voiceCloning ? "Currently allowed." : "");
    }
    const portrait = sessionState.supplied.portrait, reviewing = portrait && !u.retakingPortrait;
    const frame = reviewing ? `<div class="portrait-frame"><figure class="portrait-frame">${tag("you", "YOUR PORTRAIT")}<img src="${portrait.url}" alt="Your captured portrait"><figcaption>${u.portraitConfirmed ? "Confirmed as the face of your double." : "Not used until you confirm it."}</figcaption></figure>${row(act("retake-portrait", "Retake", "btn-secondary"))}</div>`
      : `<div class="portrait-frame portrait-frame--live"><div id="portraitCameraSlot"></div>${cameraStream ? row(act("take-portrait", "Take photo", "btn-primary")) : row(act("camera-switch", "Turn on camera", "btn-secondary"))}<p class="hint">Look into the camera, face lit from the front. Your earlier image is not reused.</p></div>`;
    const blocked = !c.voiceCloning ? '<p class="notice notice--info">Animation needs your cloned voice. You chose not to clone it, so the double will appear as text with no face.</p>'
      : capabilities?.did === false ? '<p class="notice notice--info">Animation is not configured on this computer. The double will use your voice without a moving face.</p>' : "";
    return permission(2, "Give the double a face?", "A portrait you take and confirm here, plus the cloned audio. Never live video.", "D-ID animates the portrait so it appears to speak the double's answer. Deletion is requested afterwards; provider retention may still apply.",
      blocked || `<div class="permission-tools permission-tools--portrait">${frame}${deviceNotice("camera")}</div>`,
      "", c.faceAnimation ? "Currently allowed." : "");
  }

  /* ---------- stage 5: response screen + review screen ---------- */
  function pipeline() {
    const s = sessionState, media = s.generated.proxyMedia, ops = s.operations, has = !!s.generated.proxyResponses.length;
    const word = (done, key, wanted = true) => !wanted ? ["off", "not requested"] : done ? ["done", "ready"] : key !== "proxy" && mockMode ? ["off", "not sent in demonstration"] : ops[key].state === "loading" ? ["working", "in progress"] : ["error", "timeout"].includes(ops[key].state) ? ["error", "failed"] : ["waiting", "waiting"];
    const steps = [["Constructing response", word(has, "proxy")], ["Preparing your cloned voice", word(!!media.audio, "elevenlabs", s.consent.voiceCloning)], ["Creating the talking double", word(!!media.video, "did", s.consent.faceAnimation)]];
    return `<ol class="pipeline" aria-label="Generation steps">${steps.map(([label, [state, text]]) => `<li data-state="${state}"><span class="pipeline__dot" aria-hidden="true"></span>${label}<span class="pipeline__state">${text}</span></li>`).join("")}</ol>`;
  }
  function doubleMedia() {
    const media = sessionState.generated.proxyMedia, portrait = sessionState.supplied.portrait, loadingDid = activeOperations.has("did");
    if (media.video) return `<div class="double-frame is-present"><video class="double-video" controls playsinline preload="metadata" src="${media.video.url}" aria-label="Your talking double"></video></div>`;
    const still = portrait && sessionState.consent.faceAnimation ? `<img src="${portrait.url}" alt="Your still portrait; it is not animated">` : `<span class="double-frame__ghost" aria-hidden="true"></span>`;
    return `<div class="double-frame ${loadingDid ? "is-forming" : ""}">${still}</div>${media.audio ? `<audio controls preload="metadata" src="${media.audio.url}" aria-label="The double's answer in your cloned voice"></audio>` : ""}`;
  }
  function mediaTruth() {
    const media = sessionState.generated.proxyMedia;
    return media.video ? "Talking portrait with your cloned voice" : media.audio ? (sessionState.consent.faceAnimation ? "Your cloned voice; the face is not animated" : "Your cloned voice, no face") : "Text only; no voice or animation was generated";
  }
  window.renderProxy = () => {
    if (atCheckpoint()) return checkpoint();
    const s = sessionState, u = ui(), item = s.generated.proxyResponses[0], media = s.generated.proxyMedia;
    if (!s.consent.proxyResponse) return screen("double", `${head("The double stays silent.", { context: "You chose not to let the system speak as you. Nothing was generated." })}${row(act("permissions", "Review permissions", "btn-tertiary"))}`);
    const demo = s.generated.proxyMode === "mock" ? tag("demo") : "";
    if (item && u.proxyView === "review") {
      const editing = s.ui.correctingProxy, state = item.feedback === "corrected" ? "contested" : item.feedback === "rejected" ? "rejected" : item.feedback === "accepted" ? "confirmed" : "";
      const choices = [["review-proxy", "Accept", "accepted"], ["correct-proxy", "Correct", "corrected"], ["reject-proxy", "Reject", "rejected"]].map(([action, caption, value]) => `<button type="button" class="choice" data-action="${action}" aria-pressed="${editing ? value === "corrected" : item.feedback === value}">${caption}</button>`).join("");
      return screen("review", `${head("Would you have said this?", { meta: "Your judgement" })}
        <div class="split split--debate"><section class="side side--model side--double ${state ? `is-${state}` : ""} ${acknowledge === "proxy" ? "is-ack" : ""}">${columnLabel("YOUR DOUBLE SAID")}${state ? tag(state) : tag("double")}${demo}
          <div class="double-recap">${s.supplied.portrait && s.consent.faceAnimation ? `<img class="thumb" src="${s.supplied.portrait.url}" alt="">` : ""}<p class="double-speech">${esc(ProxyText.clean(item.text))}</p></div>
          ${state ? `<p class="revision-note">${{ contested: "Contested. Your words now stand beside the double's.", rejected: "Rejected. This is not treated as something you would say.", confirmed: "You accepted this as something you might say." }[state]}</p>` : ""}</section>
        <section class="side side--you">${columnLabel("YOU")}<p class="side-question">At what point does a plausible answer stop being you?</p><div class="choices" role="group" aria-label="Your judgement of the double's answer">${choices}</div>
          ${editing ? `<div class="inline-field"><label for="proxyCorrection">What would you actually say?</label><textarea id="proxyCorrection">${esc(item.correction || "")}</textarea>${row(baseAct("save-proxy-correction", "Keep my correction", "btn-secondary"), baseAct("cancel-proxy-correction", "Cancel", "btn-tertiary"))}</div>`
            : item.feedback === "corrected" && item.correction ? `<div class="you-statement">${tag("you", "WHAT YOU WOULD SAY")}<p>${esc(item.correction)}</p></div>` : ""}
          ${row(baseAct("delete-proxy", "Delete this response", "btn-tertiary danger"))}</section></div>`);
    }
    const busyNow = ["proxy", "elevenlabs", "did"].some(k => activeOperations.has(k));
    const failures = ["proxy", "elevenlabs", "did"].map(k => k === "proxy" && item ? "" : notice(k, { retry: k === "did" ? "Retry animation" : k === "elevenlabs" ? "Retry cloned voice" : "", fallback: k === "proxy" })).join("");
    const mediaLabel = !media.audio ? "Create the cloned voice" : s.consent.faceAnimation ? "Create the talking face" : "";
    const retryMedia = item && mediaLabel && !busyNow && s.consent.voiceCloning && !mockMode && !media.video && !failures.includes("data-operation") ? row(act("retry-media", mediaLabel, "btn-secondary")) : "";
    const response = item ? `${tag("double")}${demo}<p class="double-speech">${esc(ProxyText.clean(item.text))}</p><p class="hint">An AI interpretation of you, not your real answer.</p>${evidence(item.evidence_ids, `<p>${esc(item.confidence_label)} confidence. This interpretation may be wrong.</p>`, "What did it draw on?")}`
      : activeOperations.has("proxy") ? `<p class="claim claim--quiet" role="status">${esc(operationDefinitions.proxy.loading)} ${elapsed("proxy")}</p>`
        : `<p class="claim claim--quiet">You do not answer first. When you are ready, the double will answer in your place.</p>`;
    const did = s.operations.did;
    return screen("double", `${head(proxyQuestion, { promptKey: "proxy-question", meta: item ? "The double answers" : "A question for your double" })}
      <div class="split split--double"><section class="double-stage" aria-label="Your digital double">${doubleMedia()}<p class="media-truth">${item ? mediaTruth() : "Not yet generated"}</p>${pipeline()}${did.state === "loading" ? `<p class="hint" role="status">${esc(did.message)} ${elapsed("did")}</p>` : ""}</section>
      <section class="double-script">${response}${failures}${item && media.error && mockMode ? `<p class="notice notice--info">${esc(media.error)}</p>` : ""}${retryMedia}${item && busyNow ? row(act("stop-waiting", "Stop waiting, keep what is ready", "btn-tertiary")) : ""}${row(act("permissions", "Review permissions", "btn-tertiary"), developerMode || mockMode ? (!item ? baseAct("mock-proxy", "Use simulated answer", "btn-tertiary") : "") : "")}</section></div>`);
  };
  window.generateProxyMedia = async () => {
    if (mockMode) { sessionState.generated.proxyMedia.error = "Demonstration mode: nothing was sent to a voice or animation provider."; render(); return; }
    if (sessionState.consent.faceAnimation && !ui().portraitConfirmed) return status("Confirm your portrait in the permission screen first.", "error");
    return base.generateProxyMedia();
  };

  /* ---------- stage 6: hypothetical self ---------- */
  function simInput() {
    const answers = readableAnswers();
    const actual = sessionState.predicted.participantAnswers[0]?.text;
    if (actual?.trim()) answers.push({ id: "actual_prediction_answer", question: dilemma, answer: actual });
    return { answers, context: { profile: sessionState.inferred.profile, profile_feedback: sessionState.inferred.participantFeedback, contradiction_feedback: sessionState.inferred.contradictionFeedback }, discussed_questions: [...questions, dilemma, proxyQuestion], seen_scenarios: ui().seenScenarios };
  }
  function revision() { const value = simInput(); delete value.seen_scenarios; return JSON.stringify(value); }
  function simEvidence(item) {
    const context = sessionState.generated.simulationContext || core.evidenceContext(simInput());
    const rows = item.evidence.map(e => {
      const src = context.sources.find(r => r.id === e.source_id);
      return `<li>${tag(e.type === "inferred" ? "model" : "you")}<p class="evidence-quote">${esc(src?.text || "This source is no longer eligible.")}</p><p class="source-note">${esc(src?.label || e.source)}</p><p>${tag("generated", "HOW IT WAS USED")} ${esc(e.interpretation)}</p></li>`;
    }).join("");
    const conflicts = item.contradictory_evidence.map(c => `<li>${tag("conflict")}<p>${esc(c.description)}</p>${c.participant_explanation ? `<p>${tag("you", "YOUR EXPLANATION")} ${esc(c.participant_explanation)}</p>` : ""}</li>`).join("");
    return `<ul class="evidence-list">${rows}${conflicts}</ul><p>${tag("uncertain")} ${esc(item.confidence)} confidence. ${esc(item.uncertainty_statement)}</p><p>${tag("generated", "ANOTHER POSSIBLE ACTION")} ${esc(item.alternative_action)}</p><p>${tag("uncertain", "UNKNOWN")} ${item.unknowns.map(esc).join(" ") || "The actual outcome is unknown."}</p>`;
  }
  // Presentation only: the saved structured result becomes one passage. No new model call.
  function narrative(item) {
    const dialogue = item.predicted_dialogue ? `<p>You might say, <q>${esc(item.predicted_dialogue.replace(/^["“]|["”]$/g, ""))}</q></p>` : "";
    return `<p class="narrative__context">${esc(item.scenario)}</p><p>${esc(item.predicted_decision)} ${esc(item.predicted_action)}</p><p class="narrative__inner">${esc(item.predicted_thought)}</p>${dialogue}<p>${esc(item.predicted_consequence)}</p><p class="narrative__uncertain">${esc(item.uncertainty_statement)}</p>`;
  }
  const simLabel = () => `${tag("generated", `GENERATED · HYPOTHETICAL${ui().simulationMode === "mock" ? " · DEMONSTRATION" : ""}`)}`;
  const simWarning = () => `<p class="hypothetical-warning"><strong>This never happened.</strong> It is a possible situation the AI produced from its interpretation of you, not a memory and not something you said.</p>`;
  window.renderFiction = () => {
    const s = sessionState, u = ui(), item = s.generated.simulation;
    if (!s.consent.fictionalGeneration) return screen("deep", `${head("You never told me this.", { context: "The system can now invent a situation you never described, and predict what you would do in it. The situation, your decision, your inner voice and your words will all be generated." })}
      ${simWarning()}<p class="hint">Nothing is generated until you allow it.</p>`);
    if (activeOperations.has("fiction")) return screen("deep", `${head("Imagining another version of you.", { context: "The system is choosing an unfamiliar situation and extending its model of you into it." })}<div class="generating"><div class="pulse-rings" aria-hidden="true"><span></span><span></span><span></span></div><p class="generating__line" role="status">${esc(operationDefinitions.fiction.loading)} ${elapsed("fiction")}</p><p class="hint">This can take up to two minutes.</p></div>`);
    if (!item) return screen("deep", `${head("What might another version of you do?", { context: "One hypothetical situation, generated from the model's interpretation of you." })}${simWarning()}${notice("fiction", { retry: "", fallback: true })}`);
    if (u.simulationRevision !== revision()) return screen("deep", `${head("This situation is out of date.", { context: "Your answers or reviews changed after it was generated, so it no longer reflects the current model." })}${simLabel()}${row(act("delete-simulation", "Delete the old situation", "btn-tertiary danger"))}`);
    if (u.simulationStep === "scenario" || u.simulationStep === "consent") return screen("deep", `${head(esc(item.scenario_title), { meta: "A situation you never described", context: "" })}${simLabel()}
      <p class="scenario">${esc(item.scenario)}</p>${simWarning()}`);
    if (u.simulationStep === "review") {
      const fb = u.simulationFeedback;
      const choices = ["Yes", "Partly", "No", "Unsure"].map(v => `<button type="button" class="choice" data-v6="judge-simulation" data-value="${v}" aria-pressed="${fb.rating === v}">${v}</button>`).join("");
      return screen("deep", `${head("Would you actually do this?", { meta: "Your judgement" })}
        <div class="split split--debate"><section class="side side--model side--generated ${fb.rejected ? "is-rejected" : ""} ${acknowledge === "simulation" ? "is-ack" : ""}">${columnLabel("THE GENERATED YOU")}${fb.rejected ? tag("rejected") : simLabel()}<p class="claim">${esc(item.predicted_decision)} ${esc(item.predicted_action)}</p>${item.predicted_dialogue ? `<p class="hint">You might say, <q>${esc(item.predicted_dialogue.replace(/^["“]|["”]$/g, ""))}</q></p>` : ""}${fb.rejected ? '<p class="revision-note">Rejected. It is not treated as information about you.</p>' : ""}</section>
        <section class="side side--you">${columnLabel("YOU")}<div class="choices" role="group" aria-label="Would you do this">${choices}</div><div class="inline-field"><label for="simulationExplanation">What did the AI misunderstand? (optional)</label><textarea id="simulationExplanation" placeholder="In your own words…">${esc(fb.explanation || "")}</textarea></div>
        ${row(act("reject-simulation", fb.rejected ? "Rejected · undo" : "Reject this version of me", "btn-secondary", `aria-pressed="${!!fb.rejected}"`), act("delete-simulation", "Delete it", "btn-tertiary danger"))}</section></div>`);
    }
    if (u.simulationStep === "reflection") {
      const choices = ["Yes", "Partly", "No", "Unsure"].map(v => `<button type="button" class="choice" data-action="feedback-choice" data-field="feelsLikeYou" data-value="${v}" aria-pressed="${s.feedback.feelsLikeYou === v}">${v}</button>`).join("");
      return screen("final", `${head("Does this still feel like you?", { promptKey: "final-question", meta: "The last question" })}
        <p class="hint">The situation before this was generated, not remembered.</p><div class="choices choices--large" role="group" aria-label="Does this still feel like you">${choices}</div>
        <div class="inline-field"><label for="finalExplanation">If you want, say why.</label><textarea id="finalExplanation" placeholder="Optional">${esc(s.feedback.finalExplanation || "")}</textarea></div>`);
    }
    return screen("narrative", `<div class="narrative-wrap">${simLabel()}<p class="screen-id"><span class="screen-id__num">06</span>${esc(stages[5][0])}<span class="screen-id__meta">${esc(item.scenario_title)}</span></p>
      <h2 class="narrative-title">One possible version of you.</h2><article class="narrative">${narrative(item)}</article>${simWarning()}
      <details class="evidence"><summary>Why does the AI think this?</summary><div class="evidence-body">${simEvidence(item)}</div></details>
      ${row(act("delete-simulation", "Delete this situation", "btn-tertiary danger"))}</div>`);
  };
  window.generateFiction = async function generateSimulation(forceMock = false) {
    if (!sessionState.consent.fictionalGeneration) return;
    const input = simInput(), rev = revision(), ticket = generation, original = sessionState;
    const result = await runOperation("fiction", async ({ signal }) => {
      const simulation = forceMock || mockMode ? core.mock(input) : (await callApi("/api/simulation", input, "json", signal)).simulation;
      const errors = core.validate(simulation, core.evidenceContext(input), core.candidates(input));
      if (errors.length) throw new OperationFailure("empty_response", "The simulation did not pass its evidence checks.");
      if (signal.aborted) throw new OperationFailure("cancelled", "Stopped.");
      return simulation;
    });
    if (!result || ticket !== generation || original !== sessionState || rev !== revision()) return;
    sessionState.generated.simulation = result;
    sessionState.generated.simulationContext = core.evidenceContext(input);
    ui().simulationMode = forceMock || mockMode ? "mock" : "real";
    ui().simulationRevision = rev; ui().simulationStep = "scenario"; ui().simulationFeedback = {};
    ui().seenScenarios.push(result.scenario_id);
    sessionState.ui.fictionAnswered = false;
    render();
  };

  /* ---------- ending + paused ---------- */
  window.renderDevelopmentStatus = () => {
    const f = sessionState.feedback;
    const verdict = f.feelsLikeYou ? (f.feelsLikeYou === "Unsure" ? "You are still deciding." : `You said: ${esc(f.feelsLikeYou.toLowerCase())}.`) : "Only you can decide.";
    return screen("ending", `<div class="ending"><p class="opening__kicker">THE EXPERIMENT ENDS HERE</p><h2 class="opening__title">${verdict}</h2>
      <p class="opening__lede">What you supplied, what was inferred and what was invented have stayed separate. Your judgement is not an error to be corrected.</p>
      ${row(baseAct("view-data", "See what the system held", "btn-secondary"), baseAct("delete-session", "Delete this session", "btn-secondary danger"))}
      <details class="evidence"><summary>Share optional feedback</summary><div class="evidence-body">
      ${["Could you tell what you supplied from what the AI created?", "Was the uncertainty language clear?", "Did the questions gradually feel more personal?", "Did you feel in control of your information?"].map((q, i) => `<div class="feedback-row"><p>${q}</p><div class="choices">${["Yes", "Partly", "No"].map(v => `<button type="button" class="choice" data-action="feedback-choice" data-field="rating${i}" data-value="${v}" aria-pressed="${f[`rating${i}`] === v}">${v}</button>`).join("")}</div></div>`).join("")}
      <div class="field"><label for="boundary">At which stage did the AI's version stop feeling like you?</label><select id="boundary"><option value="">Optional: choose a stage</option>${[...stages.map(st => st[0]), "It never felt like me", "It still feels like me", "I am unsure"].map(v => `<option ${f.boundary === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div class="field"><label for="unclearLabel">Was any label unclear?</label><textarea id="unclearLabel" rows="2">${esc(f.unclearLabel || "")}</textarea></div></div></details></div>`);
  };
  const pausedScreen = () => screen("ending", `<div class="ending"><p class="opening__kicker">PAUSED</p><h2 class="opening__title">You have stepped out.</h2><p class="opening__lede">Your temporary data is still in this browser's memory. Resume where you were, or delete everything.</p>${row(baseAct("resume", "Resume", "btn-primary"), baseAct("delete-session", "Delete session", "btn-secondary danger"))}</div>`);

  /* ---------- presence camera ---------- */
  window.renderPresenceDock = () => {
    const slot = document.getElementById("portraitCameraSlot");
    (slot || dockHome).append(presenceDock);
    const s = sessionState;
    const visible = !!slot || s.started && !s.ended && !s.finished && s.currentStage >= 2 && s.currentStage <= 5 && !atCheckpoint();
    presenceDock.hidden = !visible;
    shell.classList.toggle("has-camera", visible && !slot && !!cameraStream);
    presenceDock.classList.toggle("is-portrait", !!slot);
    const existing = document.getElementById("presenceVideo");
    if (visible && cameraStream && existing?.srcObject === cameraStream && presenceDock.dataset.mode === String(!!slot)) { existing.play().catch(() => {}); return; }
    if (existing) { existing.pause(); existing.srcObject = null; existing.load(); }
    if (!visible) { presenceDock.replaceChildren(); return; }
    presenceDock.dataset.mode = String(!!slot);
    const loading = s.operations.camera?.state === "loading";
    presenceDock.innerHTML = slot
      ? (cameraStream ? '<video id="presenceVideo" autoplay muted playsinline aria-label="Your live mirrored camera preview for the portrait"></video>' : `<div class="camera-placeholder" role="status">${loading ? "Starting camera…" : "Camera off"}</div>`)
      : `${cameraStream ? '<video id="presenceVideo" autoplay muted playsinline aria-label="Your live mirrored camera"></video>' : ""}<button type="button" class="dock-switch" data-v6="camera-switch" role="switch" aria-checked="${!!cameraStream}" ${loading ? "disabled" : ""}>${loading ? "Camera…" : `Camera ${cameraStream ? "on" : "off"}`}</button>`;
    const video = document.getElementById("presenceVideo");
    if (video && cameraStream) { video.srcObject = cameraStream; video.play().catch(() => {}); }
  };

  /* ---------- operation hooks kept from the integration ---------- */
  window.useOperationFallback = key => {
    if (key === "fiction") return generateFiction(true);
    if (["microphone", "transcription"].includes(key)) {
      const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 4 ? "prediction-answer" : sessionState.supplied.answers[sessionState.questionIndex]?.id;
      if (target) sessionState.ui.inputMode[target] = "type";
    }
    base.useOperationFallback(key);
  };
  window.skipOperation = key => key === "fiction" ? move("skip") : base.skipOperation(key);
  window.invalidateAnalysis = () => { base.invalidateAnalysis(); ui().simulationRevision = ""; };
  window.clearMedia = () => { room.setRecordingStream(null); base.clearMedia(); };
  window.dataItem = (label, value, key, media = "") => {
    const type = key.startsWith("inference:") ? "inferred" : key.startsWith("prediction:") ? "predicted" : key.startsWith("proxy") ? "proxy" : key.startsWith("fiction:") ? "invented"
      : key === "transcript" && sessionState.supplied.transcriptOrigin === "transcribed" ? "transcribed" : "supplied";
    return source(type) + `<div class="data-item"><strong>${esc(label)}</strong>${media}<p>${esc(value)}</p><button type="button" class="btn-tertiary danger" data-action="delete-item" data-key="${esc(key)}">Delete this item</button></div>`;
  };
  window.renderData = () => {
    base.renderData();
    if (sessionState.supplied.cloneSample) dataContent.insertAdjacentHTML("beforeend", `<section class="data-section"><h3>Voice sample for cloning</h3>${source("supplied", "CLONING SAMPLE")}<audio controls src="${sessionState.supplied.cloneSample.url}"></audio>${row(act("delete-clone-sample", "Delete voice sample", "btn-tertiary danger"))}</section>`);
    const item = sessionState.generated.simulation;
    if (item) dataContent.insertAdjacentHTML("beforeend", `<section class="data-section"><h3>Hypothetical situation</h3>${source("invented", "HYPOTHETICAL")}<p>${core.warning}</p>${ui().simulationRevision !== revision() ? '<p class="warning">Historical: your information changed after this was generated.</p>' : ""}<div class="narrative narrative--small">${narrative(item)}</div>${ui().simulationFeedback.rating ? `${source("supplied", "YOUR REVIEW")}<p>${esc(ui().simulationFeedback.rating)}${ui().simulationFeedback.rejected ? " · rejected" : ""}${ui().simulationFeedback.explanation ? ` · ${esc(ui().simulationFeedback.explanation)}` : ""}</p>` : ""}${row(act("delete-simulation", "Delete simulation", "btn-tertiary danger"))}</section>`);
  };

  /* ---------- the single forward action ---------- */
  function forward() {
    const s = sessionState, u = ui(), stage = s.currentStage;
    if (!s.started || s.ended || s.finished) return null;
    if (atCheckpoint()) {
      const c = s.consent;
      if (u.consentPage === 0) return { label: "Allow and continue", enabled: true, run: () => { c.proxyResponse = true; travel(() => { u.consentPage = 1; render(); }); }, alt: { label: "Don't let it speak for me", run: skipDouble } };
      if (u.consentPage === 1) {
        if (capabilities?.elevenlabs === false) return { label: "Continue with text only", enabled: true, run: () => finishConsent(true) };
        return { label: "Allow voice cloning", enabled: !!bestVoiceRecording() && !recorder, reason: recorder ? "Stop recording first." : "Record or choose a voice sample first.", run: () => { c.voiceCloning = true; travel(() => { u.consentPage = 2; render(); }); }, alt: { label: "Use text only", run: () => finishConsent(true) } };
      }
      if (!c.voiceCloning || capabilities?.did === false) return { label: "Meet your double", enabled: true, run: () => { setFace(false); finishConsent(); } };
      const noFace = { label: "Continue without a face", run: () => { setFace(false); finishConsent(); } };
      if (!s.supplied.portrait || u.retakingPortrait) return { label: "Allow animation", enabled: false, reason: "Take your portrait first, or continue without a face.", alt: noFace };
      if (!u.portraitConfirmed) return { label: "Use this portrait", enabled: true, run: () => { u.portraitConfirmed = true; acknowledge = ""; render(); }, alt: noFace };
      return { label: "Allow animation and meet your double", enabled: true, run: () => { c.faceAnimation = true; finishConsent(); }, alt: noFace };
    }
    if (stage === 1) {
      if (!s.supplied.image) return { label: "Continue", enabled: false, reason: cameraStream ? "Take the photo, or choose a file instead." : "Choose an image, or skip this step." };
      if (!s.photoConfirmed) return { label: "Use this image", enabled: true, run: () => { s.photoConfirmed = true; room.react("confirm"); move("continue"); } };
      return { label: "Continue", enabled: true, run: () => move("continue") };
    }
    if (stage === 2) {
      if (s.supplied.audio && !s.audioConfirmed) return { label: "Use this recording", enabled: !recorder, reason: "Stop recording first.", run: confirmStory };
      const transcribing = activeOperations.has("transcription");
      return { label: "Continue", enabled: !!(s.supplied.transcript.trim() || s.audioConfirmed) && !recorder && !transcribing, reason: recorder ? "Stop recording first." : transcribing ? "Transcribing your response…" : "Speak or write a few words, or skip.", run: () => move("continue") };
    }
    if (stage === 3) {
      if (s.questionIndex < questions.length) {
        const a = s.supplied.answers[s.questionIndex];
        return { label: s.questionIndex === questions.length - 1 ? "Build my profile" : "Next question", enabled: !!a.text.trim() && !busy && !recorder,
          reason: recorder ? "Stop recording first." : activeOperations.has("transcription") ? "Transcribing your response…" : a.audio ? "Transcribe or type your answer first." : "Answer by voice or text, or skip this question.",
          run: () => { room.react("answer"); travel(() => { void advanceQuestion(); }); } };
      }
      const p = s.inferred.profile;
      if (activeOperations.has("identity")) return { label: "Constructing…", enabled: false, reason: "The model is being built from your answers." };
      if (!p) return { label: s.operations.identity.state === "idle" ? "Build my profile" : "Retry profile", enabled: readableAnswers().some(a => a.id.startsWith("question_")), reason: "Answer at least one question first.", run: () => generateProfile() };
      if (s.ui.correctingInferenceId) return { label: "Keep correction and continue", enabled: true, run: () => { saveInferenceCorrection(); nextProfilePage(); } };
      const page = s.ui.profilePage, n = p.inferred_information.length, count = profileReviewCount(p);
      if (page < count) {
        const label = page === 0 ? (n ? "Review the first interpretation" : "Continue") : page < n ? "Next interpretation" : page === n ? (p.contradictions.length ? "Confront the contradiction" + (p.contradictions.length > 1 ? "s" : "") : "Continue") : "Next contradiction";
        return { label, enabled: !busy, run: nextProfilePage };
      }
      return { label: "Continue to Stage 4", enabled: !busy, run: () => move("continue") };
    }
    if (stage === 4) {
      if (!s.predictionShown) return { label: activeOperations.has("prediction") ? "Predicting…" : s.operations.prediction.state === "idle" ? "Show its prediction" : "Try again", enabled: !busy, reason: "The model is predicting.", run: () => generatePrediction() };
      if (!s.ui.predictionCompared) return { label: "Compare our answers", enabled: !!s.predicted.participantAnswers[0]?.text?.trim() && !recorder && !busy, reason: recorder ? "Stop recording first." : "Give your own answer first.", run: () => { room.react("answer"); travel(() => { s.ui.predictionCompared = true; render(); }); } };
      return { label: "Continue", enabled: !!s.predicted.comparisons[0]?.rating, reason: "Say how close it was first.", run: enterCheckpoint };
    }
    if (stage === 5) {
      const item = s.generated.proxyResponses[0];
      if (!s.consent.proxyResponse) return { label: "Continue to Stage 6", enabled: true, run: () => move("skip") };
      if (!item) return { label: activeOperations.has("proxy") ? "The double is answering…" : "Let the double answer", enabled: !busy, reason: "Generating…", run: () => generateProxy() };
      if (u.proxyView !== "review") return { label: "Would you have said this?", enabled: !busy, reason: "The double is still being created. You can stop waiting and keep what is ready.", run: () => travel(() => { u.proxyView = "review"; render(); }) };
      if (s.ui.correctingProxy) return { label: "Keep correction", enabled: true, run: saveProxyCorrection };
      return { label: "Continue to Stage 6", enabled: !!item.feedback, reason: "Accept, correct or reject the response first.", run: () => move("continue") };
    }
    const item = s.generated.simulation;
    if (!s.consent.fictionalGeneration) return { label: "Allow a hypothetical situation", enabled: true, run: () => { s.consent.fictionalGeneration = true; generateFiction(); } };
    if (activeOperations.has("fiction")) return { label: "Generating…", enabled: false, reason: "Generating a possible scenario." };
    if (!item) return { label: s.operations.fiction.state === "idle" ? "Create a hypothetical situation" : "Try again", enabled: !busy, run: () => generateFiction() };
    if (u.simulationRevision !== revision()) return { label: "Generate from my current information", enabled: !busy, run: () => generateFiction() };
    if (u.simulationStep === "scenario" || u.simulationStep === "consent") return { label: "Show what it thinks I would do", enabled: true, run: () => travel(() => { u.simulationStep = "scene"; room.react("reveal"); render(); }) };
    if (u.simulationStep === "scene") return { label: "Review this version of me", enabled: true, run: () => travel(() => { u.simulationStep = "review"; render(); }) };
    if (u.simulationStep === "review") return { label: "The last question", enabled: true, run: () => travel(() => { u.simulationStep = "reflection"; render(); }) };
    return { label: "Finish", enabled: !!s.feedback.feelsLikeYou, reason: "Choose an answer first, or skip.", run: () => move("continue") };
  }
  let currentForward = null;
  function syncForward() {
    const f = forward();
    currentForward = f;
    forwardButton.hidden = !f;
    forwardHint.classList.remove("is-error");
    if (!f) { forwardHint.textContent = ""; return; }
    const enabled = f.enabled && !transitioning;
    forwardButton.textContent = f.label;
    forwardButton.disabled = !enabled;
    forwardButton.setAttribute("aria-disabled", String(!enabled));
    forwardHint.textContent = !f.enabled && f.reason ? f.reason : "";
    forwardAlt.hidden = !f.alt;
    if (f.alt) { forwardAlt.textContent = f.alt.label; forwardAlt.disabled = transitioning || !!recorder; }
  }
  function skipLabel() {
    const s = sessionState, stage = s.currentStage;
    if (atCheckpoint()) return "Skip Stage 5";
    return ({ 1: "Continue without an image", 2: "Skip this step", 3: s.questionIndex < questions.length ? "Skip this question" : "Skip the review", 4: "Skip the prediction", 5: "Skip to Stage 6", 6: "Finish without this" })[stage] || "Skip";
  }
  // A second click on a selected verdict takes it back; written explanations are kept as drafts.
  function undoChoice(button) {
    const s = sessionState, old = button.dataset.action, v6 = button.dataset.v6;
    if (old === "review-inference") {
      if (s.ui.correctingInferenceId === button.dataset.id) s.ui.correctingInferenceId = "";
      else s.inferred.participantFeedback = s.inferred.participantFeedback.filter(f => f.id !== button.dataset.id);
    } else if (old === "review-contradiction") {
      const row = s.inferred.contradictionFeedback.find(r => r.id === button.dataset.id);
      if (row?.explanation?.trim()) row.verdict = ""; else s.inferred.contradictionFeedback = s.inferred.contradictionFeedback.filter(r => r.id !== button.dataset.id);
    } else if (old === "rate-prediction") s.predicted.comparisons = [{ rating: "", explanation: s.predicted.comparisons[0]?.explanation || "" }];
    else if (["review-proxy", "reject-proxy", "correct-proxy"].includes(old)) {
      if (old === "correct-proxy" && s.ui.correctingProxy) s.ui.correctingProxy = false;
      else s.generated.proxyResponses[0].feedback = "";
    } else if (v6 === "judge-simulation") delete ui().simulationFeedback.rating;
    else if (old === "feedback-choice") { delete s.feedback[button.dataset.field]; if (button.dataset.field === "feelsLikeYou") s.ui.fictionAnswered = false; }
    status("Choice removed.");
  }
  function nextProfilePage() { travel(() => { sessionState.ui.profilePage += 1; render(); }); }
  function saveInferenceCorrection() {
    const s = sessionState, id = s.ui.correctingInferenceId, value = document.getElementById("inferenceCorrection")?.value?.trim();
    if (value) { s.inferred.participantFeedback = s.inferred.participantFeedback.filter(f => f.id !== id); s.inferred.participantFeedback.push({ id, verdict: "corrected", correction: value }); room.react("revise"); }
    s.ui.correctingInferenceId = ""; drafts.delete("inferenceCorrection");
  }
  function saveProxyCorrection() {
    const value = document.getElementById("proxyCorrection")?.value?.trim();
    if (!value) return status("Write your correction first, or cancel.", "error");
    const item = sessionState.generated.proxyResponses[0];
    item.feedback = "corrected"; item.correction = value; sessionState.ui.correctingProxy = false; drafts.delete("proxyCorrection");
    acknowledge = "proxy"; room.react("revise"); render();
  }
  function confirmStory() {
    const s = sessionState;
    s.audioConfirmed = true; render();
    if (s.consent.transcription && !s.supplied.transcript.trim()) void transcribeCurrent("story");
  }
  function setFace(value) { sessionState.consent.faceAnimation = value; if (!value) clearAvatarVideo(); }
  function finishConsent(textOnly = false) {
    const s = sessionState, c = s.consent, u = ui();
    if (textOnly) { c.proxyResponse = true; c.voiceCloning = false; setFace(false); clearProxyMedia(); }
    if (c.faceAnimation && (!c.voiceCloning || !s.supplied.portrait || !u.portraitConfirmed)) setFace(false);
    if (!c.voiceCloning) clearProxyMedia();
    travel(() => { u.checkpoint = false; u.proxyView = "response"; render(); }, 1, markerFor(5));
  }
  function enterCheckpoint() {
    travel(() => { if (busy) cancelActiveOperations(); sessionState.currentStage = 5; Object.assign(ui(), { checkpoint: true, consentPage: 0 }); render(); }, 1, { num: "05", title: "THRESHOLD" });
  }
  function skipDouble() {
    if (busy) cancelActiveOperations();
    travel(() => { ui().checkpoint = false; sessionState.currentStage = 6; stopCamera(); sessionState.consent.cameraPresence = false; render(); }, 1, markerFor(6));
  }
  const markerFor = stage => ({ num: pad(stage), title: stages[stage - 1][0] });

  /* ---------- vertical travel: forward descends, back ascends ---------- */
  function cancelTransition() {
    transitionTicket++; transitioning = false; document.body.classList.remove("is-passing");
    stageElement.getAnimations().forEach(a => a.cancel());
    marker.getAnimations({ subtree: true }).forEach(a => a.cancel());
    marker.hidden = true; marker.classList.remove("is-active");
    room.cancelTravel(); syncForward();
  }
  async function travel(change, direction = 1, stageMarker = null) {
    if (transitioning) return;
    transitioning = true;
    const ticket = ++transitionTicket;
    const depthStage = stageMarker ? Math.max(1, Number(stageMarker.num) || 5) : sessionState.currentStage || 1;
    // Between stages (and on entering) the passage lingers in an empty gap so the tunnel can bloom;
    // steps inside a stage stay short and quiet.
    const passage = !!stageMarker;
    // Passages grow more complex (and a little longer) the deeper the destination:
    // into Stage 1 is a plain tunnel; into Stage 6 is the fullest sequence.
    const destination = !passage ? 0 : stageMarker.title === "THRESHOLD" ? 4.5 : Number(stageMarker.num) || 1;
    // Eased so the light stages stay simple; Stage 6 gets the fullest sequence.
    const complexity = passage ? ({ 1: 0, 2: .12, 3: .25, 4: .42, 4.5: .52, 5: .6, 6: .8 })[destination] ?? 0 : 0;
    const gap = passage ? Math.round(380 + complexity * 1250) : 0, arrive = passage ? Math.round(600 + complexity * 500) : 440;
    // The atmosphere overlay steps back during a stage passage so the tunnel itself is seen.
    document.body.classList.toggle("is-passing", passage && !room.reduced);
    room.travel(direction, passage ? 1 + complexity * .6 : .45 + depthStage * .12, passage ? { burst: true, duration: (480 + gap + 160) / 1000, complexity } : {});
    document.getElementById("sessionMenu").open = false;
    syncForward();
    const quiet = room.reduced;
    const distance = Math.min(240, Math.max(120, innerHeight * .22));
    try {
      // The stage number rises through the gap between screens; it overlaps rather than adds time.
      const markerDone = stageMarker && !quiet ? showMarker(stageMarker, direction, ticket, 300 + gap + 520 + complexity * 300) : null;
      if (!quiet) await stageElement.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: `translateY(${-direction * distance}px) scale(${direction > 0 ? .97 : 1.03})`, filter: "blur(5px)" }], { duration: passage ? 480 : 320, easing: "cubic-bezier(.55,0,.8,.2)", fill: "forwards" }).finished;
      if (ticket !== transitionTicket) return;
      if (passage && !quiet) { await new Promise(r => setTimeout(r, gap)); if (ticket !== transitionTicket) return; }
      change();
      stageElement.scrollTop = 0;
      stageElement.getAnimations().forEach(a => a.cancel());
      if (!quiet) await stageElement.animate([{ opacity: 0, transform: `translateY(${direction * distance}px) scale(${direction > 0 ? 1.03 : .97})`, filter: "blur(5px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: arrive, easing: "cubic-bezier(.15,.75,.25,1)", fill: "backwards" }).finished;
      await markerDone;
    } catch { /* End/Delete cancels the passage immediately. */ }
    finally {
      if (ticket === transitionTicket) {
        document.body.classList.remove("is-passing");
        transitioning = false; syncForward();
        const heading = stageElement.querySelector(".screen-title,.opening__title,.narrative-title");
        if (heading && !stageElement.contains(document.activeElement)) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    }
  }
  async function showMarker({ num, title }, direction, ticket, duration = 1500) {
    marker.querySelector(".stage-marker__num").textContent = num;
    marker.querySelector(".stage-marker__title").textContent = title;
    marker.setAttribute("aria-label", `${direction > 0 ? "Descending to" : "Returning to"} ${title}`);
    // The number is drawn against the screen being left: dark type on the light stages, glowing on the deep ones.
    marker.dataset.tone = ["opening", "1", "2"].includes(document.body.dataset.depth) ? "light" : "dark";
    marker.hidden = false; marker.classList.add("is-active");
    const content = marker.querySelector(".stage-marker");
    try {
      await content.animate([{ opacity: 0, transform: `translateY(${direction * 46}px)`, filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)", offset: .4 }, { opacity: 1, transform: "none", offset: .62 }, { opacity: 0, transform: `translateY(${-direction * 34}px)`, filter: "blur(4px)" }], { duration, delay: 260, easing: "ease-in-out" }).finished;
    } finally { if (ticket === transitionTicket) { marker.hidden = true; marker.classList.remove("is-active"); } }
  }
  window.move = direction => {
    const s = sessionState, u = ui();
    if (s.ended || transitioning) return;
    if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
    if (!s.started) { if (direction === "continue") begin(); return; }
    if (s.finished) { if (direction === "back") travel(() => base.move("back"), -1, markerFor(6)); return; }
    const stage = s.currentStage;
    if (atCheckpoint()) {
      if (direction === "skip") return skipDouble();
      if (direction === "back") return travel(() => { if (u.consentPage > 0) u.consentPage--; else { u.checkpoint = false; s.currentStage = 4; } render(); }, -1, u.consentPage === 0 ? markerFor(4) : null);
      return;
    }
    if (direction === "back") {
      if (stage === 5 && u.proxyView === "review") return travel(() => { u.proxyView = "response"; render(); }, -1);
      if (stage === 5) return travel(() => { if (busy) cancelActiveOperations(); u.checkpoint = true; u.consentPage = 2; render(); }, -1, { num: "05", title: "THRESHOLD" });
      if (stage === 6 && s.generated.simulation) {
        const steps = ["scenario", "scene", "review", "reflection"], index = steps.indexOf(u.simulationStep);
        if (index > 0) return travel(() => { u.simulationStep = steps[index - 1]; render(); }, -1);
      }
      if (stage === 6) return travel(() => { s.currentStage = 5; u.proxyView = s.generated.proxyResponses.length ? "review" : "response"; render(); }, -1, markerFor(5));
      if (stage === 4 && s.ui.predictionCompared) return travel(() => { s.ui.predictionCompared = false; render(); }, -1);
      if (stage === 3 && s.questionIndex >= questions.length && s.ui.profilePage > 0) return travel(() => { s.ui.profilePage--; render(); }, -1);
    }
    if (stage === 4 && direction !== "back") return enterCheckpoint();
    const changesStage = direction === "back" ? stage > 1 && !(stage === 3 && s.questionIndex > 0) : !(stage === 3 && s.questionIndex < questions.length) && stage < 6;
    const blocked = direction === "continue" && (stage === 1 && s.supplied.image && !s.photoConfirmed || stage === 2 && s.supplied.audio && !s.audioConfirmed);
    if (blocked) return base.move(direction);
    travel(() => base.move(direction), direction === "back" ? -1 : 1, changesStage ? markerFor(stage + (direction === "back" ? -1 : 1)) : null);
  };
  function begin() {
    travel(() => { sessionState.started = true; sessionState.currentStage = 1; render(); }, 1, markerFor(1));
  }

  /* ---------- render wrapper ---------- */
  function screenKey() {
    const s = sessionState, u = ui();
    return [s.started, s.ended, s.finished, s.currentStage, s.questionIndex, s.ui.profilePage, s.ui.predictionCompared, s.predictionShown, u.checkpoint, u.consentPage, u.simulationStep, u.proxyView, !!s.generated.proxyResponses.length, !!s.generated.simulation, !!s.inferred.profile].join("|");
  }
  // Re-rendering replaces nodes; return keyboard focus to the equivalent control.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !stageElement.contains(el)) return null;
    if (el.id) return { selector: `#${CSS.escape(el.id)}`, start: el.selectionStart, end: el.selectionEnd };
    const keys = ["action", "v6", "verdict", "value", "id", "operation"].filter(k => el.dataset?.[k]).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join("");
    return keys ? { selector: keys } : null;
  }
  // Keep playing media alive across re-renders of the same screen.
  function captureMedia() {
    return [...stageElement.querySelectorAll("audio[src],video[src]")].filter(m => !m.paused || m.currentTime > 0).map(m => [m.getAttribute("src"), m]);
  }
  function restoreMedia(list) {
    for (const [src, old] of list) {
      const fresh = [...stageElement.querySelectorAll("audio[src],video[src]")].find(m => m.getAttribute("src") === src);
      if (fresh) fresh.replaceWith(old);
    }
  }
  // Rail positions: stages 1-6, with the threshold at 4.5. Any position already reached is a link.
  const railPosition = () => { const s = sessionState; return !s.started ? 0 : s.finished ? 7 : atCheckpoint() ? 4.5 : s.currentStage; };
  function renderRail() {
    const s = sessionState, u = ui(), list = document.getElementById("progressSteps");
    const here = railPosition();
    u.reached = Math.max(u.reached || 0, Math.min(6, here));
    const link = (pos, num, label, extra = "") => {
      const isHere = pos === here, open = pos <= u.reached && !isHere;
      const name = `${pos === 4.5 ? "Threshold: permissions" : `Stage ${num}: ${label}`}${isHere ? " (you are here)" : open ? "" : " (not reached yet)"}`;
      return `<button type="button" class="rail-link" data-v6="jump" data-pos="${pos}" ${open ? "" : "disabled"} ${isHere ? 'aria-current="step"' : ""} aria-label="${esc(name)}">${extra}<span class="rail-node" aria-hidden="true"></span><span class="rail-label">${esc(label)}</span></button>`;
    };
    const items = stages.map((st, i) => {
      const n = i + 1, state = s.finished || n < here ? "done" : n === here ? "current" : "";
      const threshold = n === 5 ? `<li class="rail-threshold ${here === 4.5 ? "current" : here > 4.5 ? "done" : ""}">${link(4.5, "", "THRESHOLD")}</li>` : "";
      return `${threshold}<li class="${state}">${link(n, pad(n), st[0], `<span class="rail-num" aria-hidden="true">${pad(n)}</span>`)}</li>`;
    });
    list.innerHTML = items.join("");
    document.getElementById("progressName").textContent = !s.started || s.finished ? "" : atCheckpoint() ? "THRESHOLD · BEFORE THE DOUBLE" : `${pad(s.currentStage)} · ${stages[s.currentStage - 1][0]}`;
  }
  // Jump to a stage already reached, travelling up or down through the tunnel. Nothing is erased.
  function jumpTo(pos) {
    const s = sessionState, u = ui(), here = railPosition();
    if (transitioning || !s.started || s.ended || pos === here || pos > (u.reached || 0)) return;
    if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
    const marker = pos === 4.5 ? { num: "05", title: "THRESHOLD" } : markerFor(pos);
    travel(() => {
      if (busy) cancelActiveOperations("You moved to another stage. Everything already made is kept.");
      s.finished = false;
      if (pos === 4.5) { s.currentStage = 5; Object.assign(u, { checkpoint: true, consentPage: 0 }); }
      else {
        u.checkpoint = false; s.currentStage = pos;
        if (pos === 3) { s.questionIndex = s.inferred.profile ? questions.length : 0; s.ui.profilePage = 0; }
        // Stage 5 opens on the double only once its permissions were answered; otherwise on the threshold.
        if (pos === 5) { if (s.consent.proxyResponse || s.generated.proxyResponses.length) u.proxyView = "response"; else Object.assign(u, { checkpoint: true, consentPage: 0 }); }
      }
      if (s.currentStage === 6) { stopCamera(); s.consent.cameraPresence = false; }
      render();
    }, pos > here ? 1 : -1, marker);
  }
  // Two or more consecutive labels (column label, source tags, demonstration tag) share one row.
  function groupLabels(root) {
    const lone = el => el?.matches("p") && el.children.length === 1 && el.firstElementChild.matches(".tag") && el.textContent.trim() === el.firstElementChild.textContent.trim();
    root.querySelectorAll(".tag,.column-label").forEach(el => {
      if (el.parentElement.classList.contains("tag-row")) return;
      const start = lone(el.parentElement) ? el.parentElement : el, run = [start];
      for (let n = start.nextElementSibling; n && (n.matches(".tag") || lone(n)); n = n.nextElementSibling) run.push(n);
      if (run.length < 2) return;
      const row = document.createElement("div"); row.className = "tag-row"; start.before(row);
      run.forEach(node => { row.append(lone(node) ? node.firstElementChild : node); if (lone(node) || node.matches("p:empty")) node.remove(); });
    });
  }
  window.render = () => {
    const s = sessionState, u = ui();
    const focus = captureFocus(), media = captureMedia();
    stageElement.querySelectorAll("textarea[id]").forEach(f => { if (["inferenceCorrection", "proxyCorrection"].includes(f.id)) drafts.set(f.id, f.value); });
    if (stageElement.contains(presenceDock)) dockHome.append(presenceDock);
    const oldCapture = document.getElementById("cameraVideo");
    if (oldCapture) { oldCapture.pause(); oldCapture.srcObject = null; oldCapture.load(); }
    base.render();
    if (s.ended) stageElement.innerHTML = pausedScreen();
    restoreMedia(media);
    groupLabels(stageElement);
    const key = screenKey();
    const settled = key === lastScreenKey;
    lastScreenKey = key;
    stageElement.querySelector(".screen")?.classList.toggle("is-settled", settled);
    const depth = !s.started ? "opening" : s.ended ? "paused" : s.finished ? "ending" : atCheckpoint() ? "threshold" : String(s.currentStage);
    shell.dataset.stage = depth;
    shell.dataset.depth = depth;
    shell.classList.toggle("has-rail", s.started && !s.finished && !s.ended);
    document.body.dataset.depth = depth;
    renderRail();
    const nav = document.querySelector(".navigation");
    nav.hidden = !s.started || s.ended || s.finished;
    // move() already ignores input mid-passage; don't leave Back disabled after a render inside one.
    backButton.disabled = s.ended || !s.started || (!s.finished && s.currentStage === 1 && !atCheckpoint());
    skipButton.textContent = skipLabel();
    skipButton.disabled = s.ended || s.finished || !s.started || (s.currentStage === 6 && !!s.feedback.feelsLikeYou);
    document.getElementById("recordingIndicator").hidden = !recorder;
    room.setScene(s.started && !s.finished ? s.currentStage : s.finished ? 6 : 0,
      s.currentStage === 4 ? s.predictionShown : s.currentStage === 5 && !u.checkpoint && !!s.generated.proxyResponses.length, atCheckpoint());
    room.setRecordingStream(recorder ? micStream : null);
    for (const [id, value] of drafts) { const f = document.getElementById(id); if (f && !f.value) f.value = value; }
    if (focusAfterRender) { const f = document.getElementById(focusAfterRender); focusAfterRender = ""; f?.focus({ preventScroll: false }); }
    else if (focus) { const f = stageElement.querySelector(focus.selector); if (f) { f.focus({ preventScroll: true }); try { if (focus.start != null) f.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } } }
    if (cameraStream) { const v = document.getElementById("cameraVideo"); if (v && v.srcObject !== cameraStream) { v.srcObject = cameraStream; v.play().catch(() => {}); } }
    acknowledge = "";
    syncForward();
    if (recorder) drawWave();
  };

  /* ---------- recorder waveform and elapsed timers ---------- */
  function drawWave() {
    cancelAnimationFrame(waveFrame);
    const step = () => {
      const canvas = document.getElementById("recWave");
      if (!canvas || !recorder) return;
      const ctx = canvas.getContext("2d"), data = room.waveform(), w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#78a9ff";
      const bars = 40;
      for (let i = 0; i < bars; i++) {
        const v = data ? Math.abs(data[Math.floor(i / bars * data.length)] - 128) / 128 : 0;
        const bh = Math.max(2, Math.min(h, v * h * 2.4));
        ctx.globalAlpha = .45 + v;
        ctx.fillRect(i * (w / bars) + 1, (h - bh) / 2, w / bars - 3, bh);
      }
      ctx.globalAlpha = 1;
      if (!room.reduced) waveFrame = requestAnimationFrame(step);
    };
    step();
  }
  setInterval(() => {
    document.querySelectorAll(".elapsed[data-since]").forEach(el => {
      const sec = Math.max(0, Math.floor((Date.now() - Number(el.dataset.since)) / 1000));
      el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    });
  }, 1000);

  /* ---------- events ---------- */
  document.addEventListener("input", event => {
    const s = sessionState, id = event.target.id;
    if (id === "simulationExplanation") ui().simulationFeedback.explanation = event.target.value;
    if (id === "contradictionExplanation" && s.inferred.profile) {
      const index = s.ui.profilePage - s.inferred.profile.inferred_information.length - 1, cid = contradictionId(index);
      if (!s.inferred.contradictionFeedback.some(r => r.id === cid) && event.target.value.trim()) s.inferred.contradictionFeedback.push({ id: cid, verdict: "context-needed", explanation: event.target.value });
    }
    if (["inferenceCorrection", "proxyCorrection"].includes(id)) drafts.set(id, event.target.value);
    syncForward();
  });
  document.addEventListener("change", event => {
    if (event.target.id === "voiceSample") { sessionState.ui.selectedVoiceTarget = event.target.value; clearProxyMedia(); render(); }
  });
  document.addEventListener("click", async event => {
    const button = event.target.closest("button,[data-action],summary");
    if (!button) return;
    const s = sessionState, u = ui(), action = button.dataset.v6, old = button.dataset.action;
    if (button.closest("#sessionMenu") && button.tagName === "BUTTON") document.getElementById("sessionMenu").open = false;
    if (button.id === "motionToggle") {
      event.stopImmediatePropagation(); room.reduce(!room.reduced);
      if (room.reduced) [...stageElement.getAnimations(), ...marker.getAnimations({ subtree: true })].forEach(a => a.finish());
      return;
    }
    if (["end", "delete-session"].includes(old)) {
      cancelTransition(); room.setRecordingStream(null);
      if (old === "delete-session") {
        event.stopImmediatePropagation(); base.deleteSession();
        if (!s.started || sessionState !== s) { drafts.clear(); revealedPrompts.clear(); lastScreenKey = ""; room.reset(); render(); }
      }
      return;
    }
    if (old === "allow-transcription" && s.currentStage === 2 && s.supplied.audio) s.audioConfirmed = true;
    if (button.classList.contains("choice") && button.getAttribute("aria-pressed") === "true") {
      event.preventDefault(); event.stopImmediatePropagation(); undoChoice(button); render(); return;
    }
    if (old === "review-inference" && button.dataset.verdict !== "corrected") s.ui.correctingInferenceId = "";
    if (["review-proxy", "reject-proxy"].includes(old)) s.ui.correctingProxy = false;
    if (old === "review-questions") { event.stopImmediatePropagation(); return travel(() => { s.questionIndex = 0; render(); }, -1); }
    if (old === "review-inference") { acknowledge = button.dataset.id; if (button.dataset.verdict === "corrected") focusAfterRender = "inferenceCorrection"; else room.react("revise"); }
    if (old === "save-inference-correction") { event.stopImmediatePropagation(); acknowledge = s.ui.correctingInferenceId; const before = document.getElementById("inferenceCorrection")?.value?.trim(); if (!before) return status("Write your correction first, or cancel.", "error"); saveInferenceCorrection(); render(); return; }
    if (old === "cancel-inference-correction") drafts.delete("inferenceCorrection");
    if (old === "review-contradiction") { acknowledge = button.dataset.id; room.react("revise"); }
    if (["review-proxy", "reject-proxy"].includes(old)) { acknowledge = "proxy"; room.react(old === "reject-proxy" ? "reject" : "revise"); }
    if (old === "correct-proxy") focusAfterRender = "proxyCorrection";
    if (old === "save-proxy-correction") { event.stopImmediatePropagation(); return saveProxyCorrection(); }
    if (old === "cancel-proxy-correction") drafts.delete("proxyCorrection");
    if (old === "delete-proxy") u.proxyView = "response";
    if (old === "confirm-image") room.react("confirm");
    if (old === "resume") queueMicrotask(() => { lastScreenKey = ""; });
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (action === "forward") { if (!transitioning && currentForward?.enabled && !button.disabled) currentForward.run?.(); return; }
    if (action === "forward-alt") { if (recorder) return status("Stop recording first so your voice sample is saved.", "error"); if (!transitioning && currentForward?.alt && !button.disabled) currentForward.alt.run(); return; }
    if (recorder && ["text-only", "skip-double", "permissions", "no-face"].includes(action)) return status("Stop recording first so your voice sample is saved.", "error");
    if (action === "begin") return begin();
    if (action === "jump") { document.activeElement?.blur?.(); return jumpTo(Number(button.dataset.pos)); }
    if (action === "camera-switch") {
      if (cameraStream) { stopCamera(); s.consent.cameraPresence = false; render(); }
      else await enablePresenceCamera();
      return;
    }
    if (action === "permissions") { if (busy) cancelActiveOperations(); return travel(() => { u.checkpoint = true; u.consentPage = 0; render(); }, -1, { num: "05", title: "THRESHOLD" }); }
    if (action === "text-only") return finishConsent(true);
    if (action === "no-face") { setFace(false); return finishConsent(); }
    if (action === "skip-double") return skipDouble();
    if (action === "retake-portrait") { u.retakingPortrait = true; u.portraitConfirmed = false; s.consent.faceAnimation = false; clearAvatarVideo(); render(); if (!cameraStream) await enablePresenceCamera(); return; }
    if (action === "take-portrait") {
      if (!cameraStream) return enablePresenceCamera();
      u.portraitConfirmed = false; u.retakingPortrait = false; await base.capturePortrait();
      // The still is all that is needed; release the camera until a retake is requested.
      if (s.supplied.portrait) { stopCamera(); s.consent.cameraPresence = false; render(); }
      return;
    }
    if (action === "retry-media") return generateProxyMedia();
    if (action === "stop-waiting") { cancelActiveOperations("You stopped waiting. Everything that was ready is kept."); render(); return; }
    if (action === "judge-simulation") { u.simulationFeedback.rating = button.dataset.value; acknowledge = "simulation"; render(); return; }
    if (action === "reject-simulation") { u.simulationFeedback.rejected = !u.simulationFeedback.rejected; acknowledge = "simulation"; room.react("reject"); render(); return; }
    if (action === "delete-simulation") {
      if (activeOperations.has("fiction")) cancelActiveOperations();
      s.generated.simulation = null; s.generated.simulationContext = null; u.simulationFeedback = {}; u.simulationStep = "scenario"; s.ui.fictionAnswered = false;
      room.react("reject"); render(); if (dialog.open) renderData(); return;
    }
    if (action === "delete-clone-sample") { setRecording("clone-sample", null); s.ui.selectedVoiceTarget = ""; renderData(); render(); }
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.getElementById("sessionMenu").open = false;
  });
  let resizeTimer = 0;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!transitioning) render(); }, 150); });
  addEventListener("pagehide", () => { cancelTransition(); room.dispose(); });
  fetch("/api/capabilities").then(r => r.ok ? r.json() : null).then(value => { capabilities = value; render(); }).catch(() => {});

  /* ---------- stale-build protection: an old tab says so instead of silently lagging ---------- */
  const buildNotice = document.getElementById("buildNotice");
  async function checkBuild() {
    try {
      const html = await (await fetch("/", { cache: "no-store" })).text();
      const latest = html.match(/name="another-me-build" content="([^"]+)"/)?.[1];
      if (!latest || latest === BUILD || buildNotice.dataset.latest === latest) return;
      buildNotice.dataset.latest = latest;
      buildNotice.innerHTML = `<p>This tab runs <code>${esc(BUILD)}</code>; the server now has <code>${esc(latest)}</code>. Reloading shows it but clears this session's in-memory data.</p>${row(`<button type="button" class="btn-secondary" id="reloadBuild">Reload now</button>`, `<button type="button" class="btn-tertiary" id="dismissBuild">Later</button>`)}`;
      buildNotice.hidden = false;
      document.getElementById("reloadBuild").onclick = () => location.reload();
      document.getElementById("dismissBuild").onclick = () => { buildNotice.hidden = true; };
    } catch { /* server offline: nothing to compare */ }
  }
  if (["localhost", "127.0.0.1"].includes(location.hostname)) { addEventListener("focus", checkBuild); setInterval(checkBuild, 60000); }

  if (developerMode) window.__v6 = { room, ui, state: ui, simInput, forward, render, getSession: () => sessionState, build: BUILD };
  room.reduce(room.reduced);
  render();
})();
