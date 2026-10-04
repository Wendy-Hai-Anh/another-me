"use strict";

// The copied integration owns devices and providers. This controller owns the v6 journey UI.
(() => {
  const core = window.SimulationCore;
  const room = new DigitalRoom(document.getElementById("atmo"));
  const base = { render, move, renderData, renderDevelopmentStatus, renderProfile, dataItem, status, renderOperationStatus, generateProxyMedia, capturePortrait, deleteSession, useOperationFallback, retryOperation, skipOperation, invalidateAnalysis, clearMedia, updateRecordClock, setRecording, proxySpeechText };
  const shell = document.getElementById("experienceShell");
  const pager = document.getElementById("panelPager");
  const reader = document.getElementById("readerDialog");
  const pageMemory = new Map();
  const drafts = new Map();
  let pages = [], currentPage = 0, pageKey = "", renderTick = 0, transitionTicket = 0, transitioning = false;
  let capabilities = null;
  let continueAllowed = false, continueCaption = "Continue";
  let forwardSource = null, stagePages = null;
  const forwardActions = document.createElement("div"); forwardActions.hidden = true; shell.append(forwardActions);
  let focusAfterRender = "";
  const revealedPrompts = new Set();
  labels.unknown = ["?", "UNKNOWN"];
  operationDefinitions.fiction = { label: "Behavioral simulation", stages: [6], timeoutMs: 150000, loading: "Imagining a possible decision...", success: "Your hypothetical situation is ready.", fallback: "Live simulation is unavailable. Try again, use a labelled demonstration, or skip." };
  operationDefinitions.microphone.stages = [2, 3, 4, 5];
  operationDefinitions.identity.timeoutMs = 95000;
  stages[5][2] = "Explore a situation you never described.";
  function state() {
    return sessionState.ui.v6 ||= { entry: "title", checkpoint: false, consentPage: 0, simulationStep: "consent", simulationRevision: "", simulationMode: "", simulationFeedback: {}, seenScenarios: [], portraitConfirmed: false };
  }
  function act(action, text, primary = false) { return `<button type="button" data-v6="${action}" class="${primary ? "primary" : ""}">${text}</button>`; }
  const controls = (...items) => `<div class="controls">${items.join("")}</div>`;
  const text = escapeHtml;
  window.proxySpeechText = value => base.proxySpeechText(ProxyText.forSpeech(value));
  function syncForward() {
    const next = document.querySelector('.navigation [data-action="continue"]');
    if (!next) return;
    const reading = currentPage < pages.length - 1;
    next.textContent = reading ? "Continue reading" : forwardSource?.textContent || continueCaption;
    next.dataset.forwardAction = reading ? "read-next" : forwardSource?.dataset.action || forwardSource?.dataset.v6 || "continue";
    next.disabled = transitioning || !!recorder || (reading ? false : forwardSource ? forwardSource.disabled || busy : !continueAllowed);
  }
  function prepareForward() {
    forwardSource = null; forwardActions.replaceChildren();
    const checkpoint = state().checkpoint && sessionState.currentStage === 5;
    document.getElementById("footerTextOnly").hidden = !checkpoint;
    const skip = document.querySelector('.navigation [data-action="skip"]');
    skip.textContent = checkpoint ? "Skip Stage 5" : "Skip";
    skip.classList.toggle("checkpoint-skip", checkpoint);
    if (!sessionState.started || sessionState.ended || sessionState.finished) return;
    const stage = sessionState.currentStage;
    const localAction = checkpoint ? [state().consentPage < 2 ? "consent-next" : "consent-finish", state().consentPage < 2 ? "Next permission" : "Enter Stage 5"]
      : stage === 5 && sessionState.generated.proxyResponses.length && state().proxyView !== "review" ? ["proxy-review", "Review response"]
      : stage === 6 && sessionState.generated.simulation && state().simulationStep === "scene" ? ["simulation-review", "Review this situation"]
      : stage === 6 && sessionState.generated.simulation && state().simulationStep === "review" ? ["simulation-reflect", "Final reflection"] : null;
    if (localAction) {
      forwardActions.innerHTML = act(...localAction); forwardSource = forwardActions.firstElementChild;
      return;
    }
    let action = "";
    if (stage === 3) {
      if (sessionState.questionIndex < questions.length) {
        action = "next-question";
        if (!stageElement.querySelector('[data-action="next-question"]')) {
          const a = sessionState.supplied.answers[sessionState.questionIndex];
          stageElement.insertAdjacentHTML("beforeend", buttons([[action, sessionState.questionIndex === 2 ? "Build my profile" : "Next question", "", busy || !a.text.trim()]]));
        }
      } else action = sessionState.ui.correctingInferenceId ? "save-inference-correction" : sessionState.inferred.profile
        ? sessionState.ui.profilePage < profileReviewCount(sessionState.inferred.profile) ? "next-profile-item" : "profile-move-on" : "regenerate-profile";
    }
    if (stage === 4) action = !sessionState.predictionShown ? "predict" : !sessionState.ui.predictionCompared ? "compare-prediction" : "";
    if (action) {
      forwardSource = stageElement.querySelector(`[data-action="${action}"]`);
      if (!forwardSource && stage === 4 && action === "compare-prediction") {
        forwardSource = document.createElement("button"); forwardSource.dataset.action = action;
        forwardSource.textContent = "Compare our answers"; forwardSource.disabled = true;
      }
      if (forwardSource) { forwardSource.hidden = true; forwardActions.append(forwardSource); }
    }
    stageElement.querySelectorAll('[data-action="previous-profile-item"]').forEach(el => el.remove());
    stageElement.querySelectorAll(".controls").forEach(el => { if (!el.children.length) el.remove(); });
  }
  function taskHeader(caption, stage = 3) {
    return `<header class="task-header"><div><p class="stage-title">${text(stages[stage - 1][0])}</p><p class="question-count">${caption}</p></div>${stage < 6 ? '<div id="taskCameraSlot"></div>' : ""}</header>`;
  }
  window.renderQuestions = () => {
    if (sessionState.questionIndex >= questions.length) return renderProfile();
    const a = sessionState.supplied.answers[sessionState.questionIndex], mode = sessionState.ui.inputMode[a.id];
    const editing = mode === "type" || !!a.text || !!a.audio;
    return `<section class="single-panel question-panel ${a.audio && !a.text ? "needs-transcript" : ""}">${taskHeader(`QUESTION ${sessionState.questionIndex + 1} / ${questions.length}`)}${spokenPrompt(`question-${sessionState.questionIndex + 1}`, a.question)}
      ${!mode && !a.audio && !a.text ? inputChoice(a.id) : ""}
      <div class="response-workspace ${a.audio ? "with-recording" : ""}">
        ${mode === "speak" || a.audio ? `<div class="response-audio">${renderRecordingControls(a.id, a.audio)}
          ${a.audio && !sessionState.consent.transcription ? buttons([["allow-transcription", "Send audio to OpenAI to transcribe", "", busy]]) : ""}
          ${a.audio && sessionState.consent.transcription && !a.text ? buttons([["transcribe", "Retry transcription", "", busy]]) : ""}</div>` : ""}
        ${editing ? `<div class="response-text">${source(a.textOrigin === "transcribed" ? "transcribed" : "supplied", "YOUR ANSWER")}<label class="sr-only" for="questionText">Read and edit your answer</label><textarea id="questionText" maxlength="4000" ${activeOperations.has("transcription") ? "readonly" : ""} placeholder="Your answer, in your own words...">${text(a.text)}</textarea></div>` : ""}
      </div>${mode && !a.audio ? `<button class="text-link" type="button" data-action="switch-input" data-target="${a.id}" data-mode="${mode === "type" ? "speak" : "type"}">${mode === "type" ? "Speak instead" : "Type instead"}</button>` : ""}</section>`;
  };
  window.renderContradiction = (item, index) => {
    const id = contradictionId(index), review = sessionState.inferred.contradictionFeedback.find(row => row.id === id);
    return `<article class="debate-grid"><div class="debate-claim">${source("inferred", sessionState.inferred.mode === "mock" ? "MOCK CONTRADICTION" : "POSSIBLE CONTRADICTION")}<h3>Here is the tension I see.</h3><p class="contradiction-description">${text(item.description)}</p><details><summary>What is this based on?</summary><p>${text(item.possible_explanation || "This interpretation may be wrong.")}</p>${item.evidence_ids.map(id => { const a = readableAnswers().find(a => a.id === id); return a ? `${source("supplied")}<p>${text(a.question)}</p><p>${text(a.answer)}</p>` : ""; }).join("")}</details></div>
      <div class="debate-reply"><label for="contradictionExplanation">${source("supplied", "YOUR PERSPECTIVE")}<span>What am I missing?</span></label><textarea id="contradictionExplanation" placeholder="Explain, disagree, or add context...">${text(review?.explanation || "")}</textarea><div class="controls review-controls">${[["accurate", "Accurate"], ["context-needed", "Add context"], ["not-a-contradiction", "Not a conflict"]].map(([value, caption]) => `<button type="button" data-action="review-contradiction" data-id="${id}" data-verdict="${value}" aria-label="${value === "not-a-contradiction" ? "This is not a contradiction" : caption}" aria-pressed="${review?.verdict === value}">${caption}</button>`).join("")}</div></div></article>`;
  };
  window.renderProfile = () => {
    const profile = sessionState.inferred.profile;
    const index = profile ? sessionState.ui.profilePage - profile.inferred_information.length - 1 : -1;
    if (!profile?.contradictions[index]) {
      const page = sessionState.ui.profilePage, inference = profile?.inferred_information[page - 1];
      if (!inference) return `<section class="single-panel profile-panel">${base.renderProfile()}</section>`;
      const feedback = sessionState.inferred.participantFeedback.find(row => row.id === inference.id);
      const editing = sessionState.ui.correctingInferenceId === inference.id;
      return `<section class="single-panel debate-panel">${taskHeader(`INTERPRETATION ${page} / ${profile.inferred_information.length}`)}<article class="debate-grid"><div class="debate-claim">${source("inferred", sessionState.inferred.mode === "mock" ? "MOCK INTERPRETATION" : "INTERPRETATION")}<p class="contradiction-description">${text(inference.statement)}</p><details><summary>What is this based on?</summary><p>${text(inference.uncertainty_reason)} Confidence: ${text(inference.confidence_label)}.</p>${inference.evidence_ids.map(id => { const a = readableAnswers().find(a => a.id === id); return a ? `${source("supplied")}<p>${text(a.answer)}</p>` : ""; }).join("")}</details></div><div class="debate-reply">${source("supplied", "YOUR PERSPECTIVE")}<h3>Does this sound like you?</h3>${editing ? `<label for="inferenceCorrection">What did it miss?</label><textarea id="inferenceCorrection">${text(feedback?.correction || "")}</textarea>${buttons([["save-inference-correction", "Keep my correction", "primary"], ["cancel-inference-correction", "Cancel"]])}` : `<div class="controls review-controls">${[["accepted", "Accept"], ["corrected", "Correct"], ["rejected", "Reject"]].map(([value, caption]) => `<button data-action="review-inference" data-id="${text(inference.id)}" data-verdict="${value}" aria-pressed="${feedback?.verdict === value}">${caption}</button>`).join("")}</div>${feedback ? `<p class="review-note">${text(feedback.correction || feedback.verdict)}</p>` : ""}`}</div></article>${buttons([["next-profile-item", page === profile.inferred_information.length ? "Review contradictions" : "Next finding", "primary"]])}</section>`;
    }
    const last = index === profile.contradictions.length - 1;
    return `<section class="single-panel debate-panel">${taskHeader(`CONTRADICTION ${index + 1} / ${profile.contradictions.length}`)}${renderContradiction(profile.contradictions[index], index)}
      <div class="debate-options">${buttons([["regenerate-profile", "Retry profile", "text-link", busy], ["review-questions", "Review my answers", "text-link"], [last ? "profile-move-on" : "next-profile-item", last ? "Next stage" : "Next contradiction", "primary"]])}</div></section>`;
  };
  function simInput() {
    const answers = readableAnswers();
    const actual = sessionState.predicted.participantAnswers[0]?.text;
    if (actual?.trim()) answers.push({ id: "actual_prediction_answer", question: dilemma, answer: actual });
    return { answers, context: { profile: sessionState.inferred.profile, profile_feedback: sessionState.inferred.participantFeedback, contradiction_feedback: sessionState.inferred.contradictionFeedback }, discussed_questions: [...questions, dilemma, proxyQuestion], seen_scenarios: state().seenScenarios };
  }
  function revision() { const value = simInput(); delete value.seen_scenarios; return JSON.stringify(value); }
  function signature() {
    const u = state();
    return [sessionState.started, sessionState.ended, sessionState.finished, u.entry, sessionState.currentStage, sessionState.questionIndex,
      sessionState.ui.profilePage, sessionState.ui.predictionCompared, u.checkpoint, u.consentPage, u.simulationStep, u.proxyView,
      !!sessionState.generated.proxyResponses.length, !!sessionState.generated.simulation].join("|");
  }
  function captureDrafts() {
    stageElement.querySelectorAll("textarea").forEach(field => drafts.set(`${signature()}|${field.id}`, field.value));
  }
  function restoreDrafts() {
    for (const field of stageElement.querySelectorAll("textarea")) if (drafts.has(`${signature()}|${field.id}`) && !field.value) field.value = drafts.get(`${signature()}|${field.id}`);
  }
  // Flatten reading blocks, not controls. Pagination moves the same DOM nodes, preserving media and input state.
  function blocksFrom(element) {
    const output = [];
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent.trim()) { const p = document.createElement("p"); p.textContent = node.textContent; output.push(p); } return; }
      if (node.nodeType !== Node.ELEMENT_NODE || node.hidden) return;
      if (node.matches(".prediction-pair") && node.scrollHeight > element.clientHeight - 60 || node.matches("section,article,figure,div") && !node.matches(".single-panel,.prediction-pair,.controls,.choice-row,.input-choice,.tunnel-copy,.record-time,.consent-choice,.source-label,.simulation-part")) {
        [...node.childNodes].forEach(walk);
      } else output.push(node);
    };
    [...element.childNodes].forEach(walk);
    return output;
  }
  function paginate(container, nav, remembered = 0) {
    const blocks = blocksFrom(container);
    container.replaceChildren();
    nav.hidden = true;
    nav.replaceChildren();
    container.style.setProperty("--panel-height", `${Math.max(40, container.clientHeight - 32)}px`);
    let sheets = [], sheet, carriedLabel = "";
    const create = (carry = true) => {
      if (sheet) sheet.hidden = true;
      sheet = document.createElement("div"); sheet.className = "flow-sheet"; container.append(sheet); sheets.push(sheet);
      if (carry && carriedLabel) { const caption = document.createElement("p"); caption.className = "flow-context"; caption.textContent = carriedLabel; sheet.append(caption); }
    };
    create();
    const fits = () => sheet.scrollHeight <= sheet.clientHeight + 1 && [...sheet.children].every(child => child.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom + 1);
    // Try the whole task before reserving space for reading navigation. Most prompts
    // need no pager at all; only lengthy results should be broken into reading panels.
    sheet.append(...blocks);
    const single = fits() || blocks.some(node => node.matches(".single-panel"));
    if (!single) {
      sheet.replaceChildren(); nav.hidden = false;
      container.style.setProperty("--panel-height", `${Math.max(24, container.clientHeight - 40)}px`);
    }
    const grouped = [];
    if (!single) for (const node of blocks) {
      // Keep a short prompt and its response choices together, never orphan a CTA.
      if (node.matches(".input-choice,.controls") && grouped.at(-1)?.matches("h2,h3,.scene-line,.small")) {
        const previous = grouped.pop();
        const unit = document.createElement("section"); unit.className = "interaction-unit";
        unit.append(previous, node); grouped.push(unit);
      } else grouped.push(node);
    }
    for (const node of grouped) {
      const isSource = node.matches(".source-label");
      if (isSource) carriedLabel = node.textContent;
      sheet.append(node);
      if (fits()) continue;
      node.remove();
      if (sheet.children.length) create(!isSource);
      sheet.append(node);
      if (fits()) continue;
      // Split prose at word boundaries; do not hide a long paragraph behind ellipses.
      if (node.matches("p,blockquote,h2,h3,.simulation-part") && !node.querySelector("button,input,textarea,video,audio")) {
        const words = node.textContent.split(/\s+/); node.remove();
        let start = 0;
        while (start < words.length) {
          const part = node.cloneNode(false); sheet.append(part);
          let end = start;
          while (end < words.length) { part.textContent = words.slice(start, end + 1).join(" "); if (!fits() && end > start) break; end++; }
          if (end === start) end++;
          part.textContent = words.slice(start, end).join(" "); start = end;
          if (start < words.length) create();
        }
      } else if (node.matches(".controls,.choice-row,.input-choice")) {
        const children = [...node.children]; node.remove();
        for (const child of children) { sheet.append(child); if (!fits() && sheet.children.length > 1) { child.remove(); create(); sheet.append(child); } }
      }
    }
    sheets = sheets.filter(s => { if (!s.children.length) { s.remove(); return false; } return true; });
    let index = Math.min(remembered, Math.max(0, sheets.length - 1));
    const show = value => {
      index = Math.max(0, Math.min(value, sheets.length - 1));
      sheets.forEach((s, i) => { s.hidden = i !== index; });
      nav.innerHTML = sheets.length > 1 ? container === stageElement ? `<span>Reading ${index + 1} / ${sheets.length}</span>` : `<button type="button" data-page="prev" ${!index ? "disabled" : ""}>Previous panel</button><span>${index + 1} / ${sheets.length}</span><button type="button" data-page="next" ${index === sheets.length - 1 ? "disabled" : ""}>Next panel</button>` : "";
      nav.hidden = sheets.length <= 1;
      if (container === stageElement) {
        currentPage = index; pages = sheets; pageMemory.set(pageKey, index);
        syncForward();
      }
    };
    nav.onclick = event => { const dir = event.target.closest("[data-page]")?.dataset.page; if (dir) { show(index + (dir === "next" ? 1 : -1)); const heading = sheets[index].querySelector("h2,h3,p"); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } } };
    show(index);
    return { sheets, show };
  }
  function openReader(title, html) {
    document.getElementById("readerTitle").textContent = title;
    const content = document.getElementById("readerContent"); content.innerHTML = html;
    reader.showModal();
    paginate(content, document.getElementById("readerPager"));
  }
  function cancelTransition() {
    transitionTicket++; transitioning = false;
    stageElement.getAnimations().forEach(a => a.cancel()); stageElement.style.opacity = "";
    room.leaveTunnel();
    room.cancelTravel(); syncForward();
  }
  async function travel(change, direction = 1) {
    if (transitioning) return;
    transitioning = true;
    const ticket = ++transitionTicket;
    room.travel(direction); syncForward();
    try {
      const distance = Math.min(260, Math.max(140, innerHeight * .24));
      if (!room.reduced) await stageElement.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: `translateY(${-direction * distance}px)` }], { duration: 360, easing: "ease-in", fill: "forwards" }).finished;
      if (ticket !== transitionTicket) return;
      change();
      stageElement.getAnimations().forEach(a => a.cancel());
      if (!room.reduced) await stageElement.animate([{ opacity: 0, transform: `translateY(${direction * distance}px)` }, { opacity: 1, transform: "translateY(0)" }], { duration: 540, easing: "cubic-bezier(.2,.7,.3,1)" }).finished;
      if (ticket === transitionTicket) stageElement.focus({ preventScroll: true });
    } catch { /* End/reset cancels the visual transition immediately. */ }
    finally { if (ticket === transitionTicket) { transitioning = false; syncForward(); } }
  }
  window.showStageTransition = () => false;
  window.updateRecordClock = () => {
    base.updateRecordClock();
    document.getElementById("ambientRecordClock").textContent = formatTime(Math.floor((Date.now() - recordStart) / 1000));
  };
  window.revealPrompt = () => {
    clearInterval(promptTimer); promptTimer = null;
    const prompt = stageElement.querySelector("[data-prompt-key]");
    if (!prompt) return;
    const key = prompt.dataset.promptKey + prompt.dataset.promptText;
    const fresh = !revealedPrompts.has(key);
    revealedPrompts.add(key);
    prompt.querySelector(".prompt-letters").innerHTML = prompt.dataset.promptText.split(/\s+/).map((word, i) => `<span class="prompt-word ${fresh ? "fresh" : ""}" style="--word-delay:${Math.min(i * 16, 500)}ms">${text(word)}</span>`).join(" ");
    prompt.classList.add("is-complete");
    if (fresh) setTimeout(() => { if (prompt.isConnected) maybeAutoRecordQuestion(prompt.dataset.promptKey); }, room.reduced ? 0 : 900);
  };
  window.status = (message, kind) => {
    base.status(message, kind);
    if (state().checkpoint && sessionState.currentStage === 5) {
      statusElement.classList.remove("status-visible");
      const deviceMessage = ["camera", "microphone"].some(key => sessionState.operations[key]?.message === message);
      const help = document.getElementById("permissionHelp");
      if (kind === "error" && !deviceMessage && help) { help.textContent = message; help.classList.add("warning"); }
      return;
    }
    // Routine success is silent visually; errors and loading have an accessible recovery panel.
    statusElement.classList.toggle("status-visible", kind === "error" && !operationStatusElement.textContent);
  };
  window.renderOperationStatus = () => {
    base.renderOperationStatus();
    if (state().checkpoint && sessionState.currentStage === 5) operationStatusElement.hidden = true;
    const slot = document.getElementById("proxyOperation");
    if (slot) {
      const pending = ["proxy", "elevenlabs", "did"].map(key => sessionState.operations[key]).filter(item => ["loading", "error", "timeout"].includes(item?.state)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      slot.setAttribute("role", "status");
      slot.innerHTML = pending && (!sessionState.generated.proxyMedia.error || pending.state === "loading") ? `<p class="${pending.state === "loading" ? "small" : "warning"}">${text(pending.message)}${pending.errorCode ? ` [${text(pending.errorCode)}]` : ""}</p>` : "";
      operationStatusElement.hidden = true;
    }
  };
  function deviceNotice(key) {
    const item = sessionState.operations[key];
    if (!item || ["idle", "success"].includes(item.state)) return "";
    if (item.state === "loading") return `Requesting ${key} access...`;
    if (item.state === "timeout") return `${key === "camera" ? "Camera" : "Microphone"} took too long. Try again or use text.`;
    const reasons = { permission_denied: "Permission blocked. Allow access in your browser, then retry.", device_missing: "No device found. Connect one and retry.", device_busy: "Device in use. Close the other app and retry.", unsupported: "Device unavailable in this browser. Use text instead." };
    return reasons[item.errorCode] || "Device unavailable. Retry or use text.";
  }
  window.renderOpening = () => `<section class="single-panel opening-panel"><p class="stage-kicker">AN EXPERIMENT IN BEING SEEN</p><h2 class="opening-title">How much of you can a system make?</h2><p class="opening-lede">Enter a conversation. Meet a version of yourself.</p>${controls(act("begin", "Begin", true))}<p class="opening-note">Share only what you choose. You can skip, correct or leave at any time.</p><details><summary>Before you enter</summary><p>This experiment separates what you supply from what AI infers and generates. Your session is kept in browser memory, not a local database. Consented AI requests use external providers, whose retention policies also apply.</p></details></section>`;
  window.renderDevelopmentStatus = () => base.renderDevelopmentStatus().replace("</details>", `<label for="boundary">At which stage did the AI's version stop feeling like you?</label><select id="boundary"><option value="">Optional: choose a stage</option>${[...stages.map(s => s[0]), "It never felt like me", "It still feels like me", "I am unsure"].map(s => `<option ${sessionState.feedback.boundary === s ? "selected" : ""}>${text(s)}</option>`).join("")}</select></details>`);
  window.renderPresenceDock = () => {
    const checkpoint = state().checkpoint && sessionState.currentStage === 5;
    const slot = document.getElementById("portraitCameraSlot") || (innerWidth < 700 ? document.getElementById("taskCameraSlot") : null);
    if (slot) slot.append(presenceDock);
    const visible = sessionState.started && !sessionState.ended && !sessionState.finished && sessionState.currentStage >= 2 && sessionState.currentStage <= 5 && (!checkpoint || !!slot);
    presenceDock.hidden = !visible; shell.classList.toggle("has-camera", visible && !checkpoint);
    presenceDock.classList.toggle("inline-camera", !!slot);
    const existing = document.getElementById("presenceVideo");
    if (visible && cameraStream && existing?.srcObject === cameraStream) return;
    if (existing) { existing.pause(); existing.srcObject = null; existing.load(); }
    if (!visible) { presenceDock.replaceChildren(); return; }
    presenceDock.innerHTML = `<div class="dock-head">YOUR CAMERA</div>${cameraStream ? '<video id="presenceVideo" autoplay muted playsinline aria-label="Your live mirrored camera preview"></video>' : `<div class="camera-placeholder" role="status" aria-live="polite">${text(checkpoint ? deviceNotice("camera") || "Camera off" : "Camera off")}</div>`}<button type="button" data-v6="camera-switch" role="switch" aria-checked="${!!cameraStream}" ${sessionState.operations.camera?.state === "loading" ? "disabled" : ""}>${checkpoint && deviceNotice("camera") && !cameraStream ? "Retry camera" : `Camera ${cameraStream ? "on" : "off"}`}</button>`;
    const video = document.getElementById("presenceVideo");
    if (video && cameraStream) { video.srcObject = cameraStream; video.play().catch(() => {}); }
  };
  window.renderImage = () => {
    const image = sessionState.supplied.image;
    return `<p class="scene-line">Choose an image. A person, place, object or moment.</p>${image ? `${source("supplied", "IMAGE")}<img src="${image.url}" alt="Your chosen image"><p class="small">${sessionState.photoConfirmed ? "Your image is confirmed." : "Is this the image you want to share?"}</p>${buttons([...(sessionState.photoConfirmed ? [] : [["confirm-image", "Keep this image", "primary"]]), ["retake", "Replace image"], ["delete-image", "Delete image", "danger"]])}` : cameraStream ? `<video id="cameraVideo" class="camera" autoplay muted playsinline aria-label="Mirrored live camera preview"></video>${buttons([["capture", "Take photo", "primary"], ["camera-off", "Turn camera off"]])}` : `<div class="controls"><label class="file-button">Choose an image<input id="imageInput" type="file" accept="image/*"></label><button data-action="enable-camera">Use camera</button></div><p class="small">Camera access begins only if you choose it. This image stays in your temporary session; appearance is not used to infer personality.</p>`}`;
  };
  function samples() {
    return [["story", "Your image story"], ...sessionState.supplied.answers.map((a, i) => [a.id, `Question ${i + 1}`]), ["prediction-answer", "Your prediction answer"], ["clone-sample", "Your voice sample"]].filter(([id]) => recordingFor(id)?.blob);
  }
  window.setRecording = (target, recording) => {
    base.setRecording(target, recording);
    if (target === "clone-sample" && recording) sessionState.ui.selectedVoiceTarget = target;
  };
  function checkpoint() {
    const u = state(), c = sessionState.consent;
    const toggle = (name, caption) => `<label class="consent-choice"><input type="checkbox" data-consent="${name}" ${c[name] ? "checked" : ""}>${caption}</label>`;
    let html = `<section class="single-panel consent-panel" data-permission="${u.consentPage}"><p class="permission-count">BEFORE THE DOUBLE ANSWERS · ${u.consentPage + 1} / 3</p>`;
    if (u.consentPage === 0) html += `<h3 class="scene-line">May it speak as you?</h3><p>OpenAI will use your shared words and temporary profile to answer on your behalf. Its answer may be wrong and will be labelled as AI-generated.</p>${toggle("proxyResponse", "Allow an AI answer on my behalf")}<p id="permissionHelp" class="small" aria-live="polite">Voice and image permissions are separate. You can decline and skip Stage 5.</p>`;
    if (u.consentPage === 1) {
      const options = samples();
      if (!sessionState.ui.selectedVoiceTarget && options.length) sessionState.ui.selectedVoiceTarget = options[0][0];
      const sample = bestVoiceRecording();
      html += `<h3 class="scene-line">Your words, in your voice?</h3><p>With permission, ElevenLabs receives your recording when you generate. We request clone deletion afterward; provider retention may still apply.</p>${toggle("voiceCloning", "Allow voice cloning from my selected recording")}
      <div class="voice-tools">${options.length ? `<div class="sample-picker"><label for="voiceSample">SUPPLIED BY YOU · Choose your recording</label><select id="voiceSample">${options.map(([id, label]) => `<option value="${id}" ${sessionState.ui.selectedVoiceTarget === id ? "selected" : ""}>${label}</option>`).join("")}</select><audio aria-label="Play your selected voice sample" controls src="${sample?.url}"></audio></div>` : '<p class="small">No sample yet. Record a few sentences below, or continue without cloning.</p>'}
      <div class="sample-recorder">${recorder ? '<p class="record-time">Recording <output id="recordClock">00:00</output></p>' + buttons([["stop-recording", "Stop recording", "primary"]]) : buttons([["start-recording", deviceNotice("microphone") ? "Retry recording" : "Record a voice sample", "", busy]])}<p id="permissionHelp" class="small" role="status" aria-live="polite">${text(deviceNotice("microphone") || (capabilities?.elevenlabs === false ? "Cloning unavailable here. Use text only." : "Your voice only; local until generation."))}</p></div></div>`;
    }
    if (u.consentPage === 2) {
      const portrait = sessionState.supplied.portrait;
      const reviewing = portrait && !u.retakingPortrait;
      const portraitControls = reviewing
        ? controls(act("confirm-portrait", u.portraitConfirmed ? "Portrait confirmed" : "Keep portrait", true), act("retake-portrait", "Retake"), ...(cameraStream ? [act("camera-switch", "Turn camera off")] : []))
        : controls(act("take-portrait", "Take my portrait", true));
      const portraitHelp = capabilities?.did === false ? "Animation unavailable here. Still portrait and text remain available."
        : c.faceAnimation && !c.voiceCloning ? "Animation needs voice cloning. Enable it on the previous panel." : "Use your own portrait, not the image you chose earlier.";
      html += `<h3 class="scene-line">Give the double a face?</h3><p>D-ID receives your confirmed portrait and cloned audio, not live video. We request deletion afterward; provider retention may still apply.</p>${toggle("faceAnimation", "Allow my portrait and cloned audio to be animated")}
        <div class="portrait-tools">${reviewing ? `<div class="portrait-still">${source("supplied", "PORTRAIT")}<img class="setup-portrait" src="${portrait.url}" alt="Your portrait for animation"></div>` : '<div id="portraitCameraSlot"></div>'}<div class="portrait-actions">${portraitControls}<p id="permissionHelp" class="small" aria-live="polite">${text(portraitHelp)}</p></div></div>`;
    }
    return html + "</section>";
  }
  window.renderProxy = () => {
    if (state().checkpoint) return checkpoint();
    const item = sessionState.generated.proxyResponses[0], media = sessionState.generated.proxyMedia, portrait = sessionState.supplied.portrait;
    const head = taskHeader(item ? state().proxyView === "review" ? "YOUR REVIEW" : "THE DOUBLE'S RESPONSE" : "A QUESTION FOR YOUR DOUBLE", 5);
    if (!sessionState.consent.proxyResponse) return `<section class="single-panel proxy-panel">${head}<p>You chose not to let the double answer.</p>${controls(act("permissions", "Review permissions"), act("skip-double", "Next stage", true))}</section>`;
    if (!item) return `<section class="single-panel proxy-panel">${head}${spokenPrompt("proxy-question", proxyQuestion)}<p class="small">You do not answer first. This will be an AI interpretation, not your real answer.</p>${buttons([["generate-proxy", "Let the double answer", "primary", busy]])}${controls(act("permissions", "Review permissions"))}<div id="proxyOperation"></div></section>`;
    const evidence = `<details><summary>Why did the AI say this?</summary><p>Confidence: ${text(item.confidence_label)}. This interpretation may be wrong.</p>${item.evidence_ids.map(id => { const a = readableAnswers().find(a => a.id === id); return a ? `${source("supplied")}<p>${text(a.answer)}</p>` : ""; }).join("")}</details>`;
    if (state().proxyView === "review") return `<section class="single-panel proxy-panel proxy-review">${head}${source("proxy", "YOUR REVIEW OF THE GENERATED RESPONSE")}<h3 class="scene-line">Would you have said this?</h3>${buttons([["review-proxy", "Accept"], ["correct-proxy", "Correct"], ["reject-proxy", "Reject"], ["delete-proxy", "Delete response", "danger"]])}${sessionState.ui.correctingProxy ? `<label for="proxyCorrection">What would you say instead?</label><textarea id="proxyCorrection">${text(item.correction || "")}</textarea>${buttons([["save-proxy-correction", "Keep my correction", "primary"], ["cancel-proxy-correction", "Cancel"]])}` : item.feedback ? `<p class="review-note">Your review: ${text(item.feedback)}${item.correction ? `: ${text(item.correction)}` : ""}</p>` : ""}${evidence}</section>`;
    const hasMedia = media.video || media.audio || portrait;
    return `<section class="single-panel proxy-panel">${head}<h3 class="proxy-question">${text(proxyQuestion)}</h3><div class="proxy-composition ${hasMedia ? "with-media" : ""}">${hasMedia ? `<div class="proxy-player">${media.video ? `${source("proxy", "TALKING DOUBLE")}<video class="double-media" controls playsinline src="${media.video.url}"></video>` : portrait ? `${source("supplied", "STILL PORTRAIT")}<img class="double-media" src="${portrait.url}" alt="Your still portrait; no animation is shown">` : ""}${media.audio && !media.video ? `${source("proxy", "CLONED VOICE")}<audio controls src="${media.audio.url}"></audio>` : ""}</div>` : ""}<div class="proxy-script">${source("proxy", sessionState.generated.proxyMode === "mock" ? "MOCK DEMONSTRATION" : "")}<p class="proxy-response">${text(ProxyText.clean(item.text))}</p><p class="small">This is an AI interpretation, not your real answer.</p></div></div><p class="media-truth">${media.video ? "Talking portrait with cloned speech" : media.audio ? "Cloned speech; no talking animation" : "Text response; no generated voice or animation"}</p><div id="proxyOperation"></div>${media.error ? `<p class="warning media-error">${text(media.error)}</p>` : ""}${controls(act("permissions", "Review permissions"), ...(sessionState.consent.voiceCloning && !media.video ? [act("retry-media", media.audio ? "Retry animation" : "Retry cloned voice")] : []))}</section>`;
  };
  function simEvidence(item) {
    const context = sessionState.generated.simulationContext || core.evidenceContext(simInput());
    const rows = item.evidence.map(e => {
      const s = context.sources.find(row => row.id === e.source_id);
      return `${source(e.type)}<h3>${text(s?.label || e.source)}</h3><p>${text(s?.text || "This source is no longer eligible.")}</p>${source("inferred", "INFLUENCE ON THIS SIMULATION")}<p>${text(e.interpretation)}</p>`;
    }).join("");
    return `${rows}${item.contradictory_evidence.map(c => `${source("inferred", "POSSIBLE CONTRADICTION")}<p>${text(c.description)}</p>${c.participant_explanation ? `${source("supplied", "YOUR EXPLANATION")}<p>${text(c.participant_explanation)}</p>` : ""}`).join("")}${source("inferred", "UNCERTAINTY")}<p>Confidence: ${text(item.confidence)}</p><p>${text(item.uncertainty_statement)}</p>${source("invented", "ALTERNATIVE ACTION")}<h3>Another possible action</h3><p>${text(item.alternative_action)}</p>${source("unknown")}<p>${item.unknowns.map(text).join(" ") || "The actual outcome is unknown."}</p>`;
  }
  window.renderFiction = () => {
    const u = state(), item = sessionState.generated.simulation;
    const label = `<span class="source-label invented"><span aria-hidden="true">!</span>GENERATED${u.simulationMode === "mock" ? " · MOCK DEMONSTRATION" : ""}</span>`;
    const warning = `<p class="fiction-warning">${core.warning}</p>`;
    if (!sessionState.consent.fictionalGeneration) return `<h3 class="scene-line">You never told me this.</h3><p>May the system imagine what you might do in a new situation? Its decision, action and inner voice will be invented, not something that happened.</p>${controls(act("allow-simulation", "Allow a hypothetical simulation", true))}`;
    if (!item) return `<h3 class="scene-line">What might another version of you do?</h3>${warning}${controls(act("generate-simulation", "Create a hypothetical situation", true))}`;
    if (u.simulationRevision !== revision()) return `${label}<p>Your answers or profile reviews have changed. This simulation is no longer current.</p>${controls(act("generate-simulation", "Generate from my current information", true), act("delete-simulation", "Delete old simulation"))}`;
    if (u.simulationStep === "scenario") return `${label}${warning}<h3 class="scene-line">${text(item.scenario_title)}</h3><p>${text(item.scenario)}</p><p class="small">You never gave me this situation.</p>${controls(act("reveal-simulation", "Show what you think I would do", true))}`;
    if (u.simulationStep === "reflection") return `${label}${warning}<h3 class="scene-line">Does this still feel like you?</h3><div class="choice-row">${["Yes", "Partly", "No", "Unsure"].map(v => `<button data-action="feedback-choice" data-field="feelsLikeYou" data-value="${v}" aria-pressed="${sessionState.feedback.feelsLikeYou === v}">${v}</button>`).join("")}</div><label for="finalExplanation">Anything else you want to say?</label><textarea id="finalExplanation" placeholder="Optional">${text(sessionState.feedback.finalExplanation || "")}</textarea>${controls(act("scene-back", "Read the simulation again"))}`;
    if (u.simulationStep === "review") return `<section class="single-panel simulation-panel">${taskHeader("YOUR REVIEW", 6)}${label}<h3 class="scene-line">Would you actually do this?</h3><div class="choice-row">${["Yes", "Partly", "No", "Unsure"].map(v => `<button data-v6="judge-simulation" data-value="${v}" aria-pressed="${u.simulationFeedback.rating === v}">${v}</button>`).join("")}</div><label for="simulationExplanation">What did the AI misunderstand?</label><textarea id="simulationExplanation" placeholder="Optional">${text(u.simulationFeedback.explanation || "")}</textarea>${u.simulationFeedback.rejected ? '<p class="review-note">You rejected this simulation. It is not treated as information about you.</p>' : ""}${controls(act("reject-simulation", "Reject scene"), act("delete-simulation", "Delete scene"))}</section>`;
    const narrative = [item.scenario, item.predicted_decision, item.predicted_action, item.predicted_thought, item.predicted_dialogue ? `You might say: "${item.predicted_dialogue}"` : "", item.predicted_consequence, item.uncertainty_statement].filter(Boolean).join(" ");
    return `<section class="single-panel simulation-panel">${taskHeader("ONE POSSIBLE VERSION OF YOU", 6)}${label}<h3 class="scene-line">This is what I think you would do.</h3><p class="simulation-narrative">${text(narrative)}</p>${controls(act("simulation-evidence", "Why does the AI think this?"), act("delete-simulation", "Delete scene"))}</section>`;
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
    state().simulationMode = forceMock || mockMode ? "mock" : "real";
    state().simulationRevision = rev; state().simulationStep = "scenario"; state().simulationFeedback = {};
    state().seenScenarios.push(result.scenario_id);
    sessionState.ui.fictionAnswered = false;
    render();
  };
  const renderSimulationScreen = renderFiction;
  window.renderFiction = () => {
    const html = renderSimulationScreen();
    return html.includes('class="single-panel') ? html : `<section class="single-panel simulation-panel">${taskHeader("A HYPOTHETICAL SITUATION", 6)}${html}</section>`;
  };
  window.generateProxyMedia = async () => {
    if (mockMode) { sessionState.generated.proxyMedia.error = "Mock mode: no recording or portrait was sent to a provider. The response is text only."; render(); return; }
    if (sessionState.consent.faceAnimation && !state().portraitConfirmed) return status("Confirm your portrait in the permission checkpoint first.", "error");
    return base.generateProxyMedia();
  };
  window.useOperationFallback = key => {
    if (key === "fiction") return generateFiction(true);
    if (["microphone", "transcription"].includes(key)) {
      const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 4 ? "prediction-answer" : sessionState.supplied.answers[sessionState.questionIndex]?.id;
      if (target) sessionState.ui.inputMode[target] = "type";
    }
    base.useOperationFallback(key);
  };
  window.skipOperation = key => key === "fiction" ? move("skip") : base.skipOperation(key);
  window.invalidateAnalysis = () => { base.invalidateAnalysis(); state().simulationRevision = ""; };
  window.clearMedia = () => { room.setRecordingStream(null); base.clearMedia(); };
  window.dataItem = (label, value, key, media = "") => {
    const type = key.startsWith("inference:") ? "inferred" : key.startsWith("prediction:") ? "predicted" : key.startsWith("proxy") ? "proxy" : key.startsWith("fiction:") ? "invented"
      : key === "transcript" && sessionState.supplied.transcriptOrigin === "transcribed" ? "transcribed" : "supplied";
    return source(type) + base.dataItem(label, value, key, media);
  };
  window.renderData = () => {
    base.renderData();
    if (sessionState.supplied.cloneSample) dataContent.insertAdjacentHTML("beforeend", `${source("supplied", "CLONING SAMPLE")}<audio controls src="${sessionState.supplied.cloneSample.url}"></audio>${controls(act("delete-clone-sample", "Delete voice sample"))}`);
    const item = sessionState.generated.simulation;
    if (item) dataContent.insertAdjacentHTML("beforeend", `${source("invented", "HYPOTHETICAL SIMULATION")}<p>${core.warning}</p>${state().simulationRevision !== revision() ? '<p class="warning">Historical output: your information has changed. Evidence below is the version used when it was generated.</p>' : ''}<p>${text(item.scenario)}</p><p>${text(item.predicted_decision)} ${text(item.predicted_action)} ${text(item.predicted_thought)} ${text(item.predicted_dialogue || "")} ${text(item.predicted_consequence)}</p>${simEvidence(item)}${source("supplied", "YOUR SIMULATION REVIEW")}<p>${text(JSON.stringify(state().simulationFeedback))}</p>${controls(act("delete-simulation", "Delete simulation"))}`);
    requestAnimationFrame(() => { if (dialog.open) paginate(dataContent, document.getElementById("dataPager")); });
  };
  window.move = direction => {
    if (sessionState.ended || transitioning) return;
    if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
    if (!sessionState.started) { if (direction === "continue") begin(); return; }
    if (state().checkpoint) {
      if (direction === "back") return travel(() => { if (state().consentPage > 0) state().consentPage--; else { state().checkpoint = false; sessionState.currentStage = 4; } render(); }, -1);
      if (direction === "skip") return skipDouble();
      return;
    }
    if (direction === "back" && sessionState.currentStage === 5 && state().proxyView === "review") return travel(() => { state().proxyView = "response"; render(); }, -1);
    if (direction === "back" && sessionState.currentStage === 6 && sessionState.generated.simulation) {
      const steps = ["scenario", "scene", "review", "reflection"], index = steps.indexOf(state().simulationStep);
      if (index > 0) return travel(() => { state().simulationStep = steps[index - 1]; render(); }, -1);
    }
    if (direction === "continue" && currentPage < pages.length - 1) return travel(() => stagePages?.show(currentPage + 1));
    if (direction === "back" && currentPage > 0) return travel(() => stagePages?.show(currentPage - 1), -1);
    if (direction === "back" && sessionState.currentStage === 3 && sessionState.questionIndex >= questions.length && sessionState.ui.profilePage > 0) return travel(() => { sessionState.ui.profilePage--; render(); }, -1);
    if (sessionState.currentStage === 4 && direction !== "back") return travel(() => { if (busy) cancelActiveOperations(); sessionState.currentStage = 5; state().checkpoint = true; state().consentPage = 0; render(); });
    travel(() => base.move(direction), direction === "back" ? -1 : 1);
  };
  function begin() {
    state().entry = "tunnel";
    render();
    room.enter(document.body, enterExperience);
    stageElement.focus({ preventScroll: true });
  }
  function enterExperience() {
    room.leaveTunnel();
    travel(() => { state().entry = "complete"; sessionState.started = true; sessionState.currentStage = 1; render(); });
  }
  function skipDouble() { if (busy) cancelActiveOperations(); travel(() => { state().checkpoint = false; sessionState.currentStage = 6; stopCamera(); sessionState.consent.cameraPresence = false; render(); }); }
  function finishConsent(textOnly = false) {
    if (textOnly) { sessionState.consent.proxyResponse = true; sessionState.consent.voiceCloning = false; sessionState.consent.faceAnimation = false; clearProxyMedia(); }
    if (!sessionState.consent.proxyResponse) return status("Choose an AI answer, use text only, or skip Stage 5.", "error");
    if (sessionState.consent.voiceCloning && !bestVoiceRecording()) { state().consentPage = 1; render(); return status("Record a sample, or turn off cloning to continue with text.", "error"); }
    if (sessionState.consent.faceAnimation && (!sessionState.consent.voiceCloning || !sessionState.supplied.portrait || !state().portraitConfirmed)) return status("Animation needs a confirmed portrait and separately permitted cloned audio. You can turn animation off.", "error");
    travel(() => { state().checkpoint = false; state().proxyView = "response"; sessionState.currentStage = 5; render(); });
  }
  window.render = () => {
    const u = state();
    if (sessionState.started && u.entry === "title") u.entry = "complete";
    const tick = ++renderTick;
    // The portrait setup temporarily hosts the one camera dock; retain it across renders.
    if (stageElement.contains(presenceDock)) shell.append(presenceDock);
    const oldCapture = document.getElementById("cameraVideo");
    if (oldCapture) { oldCapture.pause(); oldCapture.srcObject = null; oldCapture.load(); }
    base.render();
    const task = stageElement.querySelector(".question-panel,.debate-panel,.proxy-panel,.simulation-panel");
    shell.classList.toggle("is-task", !!task);
    if (task) stageElement.querySelectorAll(":scope > .stage-kicker,:scope > .stage-title").forEach(el => el.remove());
    const prediction = stageElement.querySelector(".prediction-solo");
    const answer = stageElement.querySelector(".answer-moment");
    if (prediction && answer && !answer.querySelector(".source-label")) answer.insertAdjacentHTML("afterbegin", source("supplied", "YOUR ACTUAL CHOICE"));
    if (prediction && answer && innerWidth >= 900 && innerHeight >= 600) {
      const pair = document.createElement("section"); pair.className = "prediction-pair";
      prediction.before(pair); pair.append(prediction, answer);
    }
    shell.classList.toggle("is-checkpoint", u.checkpoint && sessionState.currentStage === 5);
    document.getElementById("recordingIndicator").hidden = !recorder;
    const claim = document.getElementById("claimContext");
    claim.hidden = sessionState.currentStage !== 6 || !sessionState.started || sessionState.finished || sessionState.ended;
    claim.textContent = claim.hidden ? "" : `GENERATED${u.simulationMode === "mock" ? " / MOCK" : ""} · ${core.warning}`;
    if (u.checkpoint && sessionState.currentStage === 5) { document.querySelector(".navigation [data-action=continue]").disabled = true; stageElement.querySelectorAll(".stage-kicker,.stage-title").forEach((el, index) => { if (index < 2) el.remove(); }); }
    continueAllowed = !document.querySelector('.navigation [data-action="continue"]').disabled;
    continueCaption = document.querySelector('.navigation [data-action="continue"]').textContent;
    prepareForward();
    if (!sessionState.started && u.entry === "tunnel" && !sessionState.ended) {
      stageElement.innerHTML = `<section class="tunnel-copy"><h2>Venture into the space<br>between you and another you.</h2><p>${room.reduced ? "Explore at your own pace. Reduced motion is on." : "Scroll to go deeper. Where will you end and the double begin?"}</p><div class="tunnel-meter" aria-hidden="true"><span id="tunnelDepth"></span></div>${controls(act("enter", "Enter experience", true))}</section>`;
    }
    shell.classList.toggle("is-tunnel", u.entry === "tunnel" && !sessionState.started);
    room.setScene(sessionState.started ? sessionState.currentStage : 0, sessionState.currentStage === 4 ? sessionState.predictionShown : sessionState.currentStage === 5 && !u.checkpoint && !!sessionState.generated.proxyResponses.length);
    room.setRecordingStream(recorder ? micStream : null);
    room.reduce(room.reduced);
    restoreDrafts();
    stageElement.querySelectorAll('[data-v6="generate-simulation"],[data-v6="allow-simulation"],[data-v6="retry-media"]').forEach(button => { button.disabled = busy; });
    pageKey = signature();
    // Hide optional fallback buttons until a failure or developer mode needs them.
    if (!developerMode && !mockMode) stageElement.querySelectorAll('[data-action^="mock-"]').forEach(el => el.remove());
    requestAnimationFrame(() => {
      if (tick !== renderTick) return;
      if (u.entry === "tunnel" && !sessionState.started) { pager.hidden = true; return; }
      const result = paginate(stageElement, pager, pageMemory.get(pageKey) || 0);
      stagePages = result;
      if (focusAfterRender) {
        const field = document.getElementById(focusAfterRender); focusAfterRender = "";
        const index = result.sheets.findIndex(s => s.contains(field));
        if (index >= 0) { result.show(index); field.focus({ preventScroll: true }); }
      }
    });
  };
  document.addEventListener("toggle", event => {
    const detail = event.target;
    if (detail.tagName !== "DETAILS" || !detail.open || !stageElement.contains(detail)) return;
    const title = detail.querySelector("summary")?.textContent || "More information";
    const copy = detail.cloneNode(true); copy.querySelector("summary")?.remove(); detail.open = false;
    openReader(title, copy.innerHTML);
  }, true);
  document.addEventListener("input", event => {
    if (event.target.tagName === "TEXTAREA") drafts.set(`${signature()}|${event.target.id}`, event.target.value);
    if (event.target.id === "simulationExplanation") state().simulationFeedback.explanation = event.target.value;
    if (event.target.id === "contradictionExplanation") {
      const index = sessionState.ui.profilePage - sessionState.inferred.profile.inferred_information.length - 1;
      const id = contradictionId(index);
      if (!sessionState.inferred.contradictionFeedback.some(row => row.id === id) && event.target.value.trim()) sessionState.inferred.contradictionFeedback.push({ id, verdict: "context-needed", explanation: event.target.value });
    }
    if (!forwardSource) continueAllowed = !document.querySelector('.navigation [data-action="continue"]').disabled;
    syncForward();
  });
  document.addEventListener("change", event => {
    if (event.target.dataset.consent) {
      const key = event.target.dataset.consent;
      if (busy) cancelActiveOperations("Permissions changed; unfinished generation stopped.");
      sessionState.consent[key] = event.target.checked;
      if (key === "voiceCloning" && !event.target.checked) { sessionState.consent.faceAnimation = false; clearProxyMedia(); }
      if (key === "faceAnimation" && !event.target.checked) clearAvatarVideo();
      render();
    }
    if (event.target.id === "voiceSample") { sessionState.ui.selectedVoiceTarget = event.target.value; clearProxyMedia(); render(); }
  });
  document.addEventListener("click", async event => {
    const button = event.target.closest("button,[data-action]");
    if (!button) return;
    const action = button.dataset.v6, old = button.dataset.action;
    captureDrafts();
    if (old === "continue" && button.closest(".navigation") && forwardSource && currentPage === pages.length - 1) {
      event.stopImmediatePropagation();
      if (!transitioning && !busy && !recorder && !forwardSource.disabled) forwardSource.click();
      return;
    }
    if (["next-question", "next-profile-item", "previous-profile-item", "compare-prediction"].includes(old)) {
      event.stopImmediatePropagation();
      if (recorder || transitioning || busy) return;
      if (old === "next-question") { room.react("answer"); return travel(() => { void advanceQuestion(); }); }
      if (old === "compare-prediction") return travel(() => { sessionState.ui.predictionCompared = true; render(); });
      return travel(() => { sessionState.ui.profilePage += old === "previous-profile-item" ? -1 : 1; render(); }, old === "previous-profile-item" ? -1 : 1);
    }
    if (old === "confirm-image") room.react("confirm");
    if (old === "switch-input" && button.dataset.mode === "type") focusAfterRender = button.dataset.target === "story" ? "storyText" : button.dataset.target === "prediction-answer" ? "actualAnswer" : "questionText";
    if (old === "review-inference" && button.dataset.verdict === "corrected") focusAfterRender = "inferenceCorrection";
    if (old === "correct-proxy") focusAfterRender = "proxyCorrection";
    if (old === "feedback-choice" && reader.open) queueMicrotask(() => reader.querySelectorAll('[data-action="feedback-choice"]').forEach(choice => choice.setAttribute("aria-pressed", String(sessionState.feedback[choice.dataset.field] === choice.dataset.value))));
    if (["next-question", "compare-prediction"].includes(old)) room.react("answer");
    if (["review-inference", "review-contradiction", "save-inference-correction"].includes(old)) room.react("revise");
    if (["end", "delete-session"].includes(old)) {
      cancelTransition(); room.setRecordingStream(null); reader.close();
      if (old === "delete-session") { event.stopImmediatePropagation(); base.deleteSession(); if (!sessionState.started) { pageMemory.clear(); drafts.clear(); revealedPrompts.clear(); room.reset(); render(); } }
      return;
    }
    if (old === "generate-proxy" && !sessionState.consent.proxyResponse) { event.stopImmediatePropagation(); state().checkpoint = true; render(); return; }
    if (["generate-proxy", "delete-proxy"].includes(old)) state().proxyView = "response";
    if (old === "resume" && !sessionState.started && state().entry === "tunnel") queueMicrotask(() => room.enter(document.body, enterExperience));
    if (button.id === "motionToggle") {
      event.stopImmediatePropagation(); room.reduce(!room.reduced);
      if (room.reduced) stageElement.getAnimations().forEach(animation => animation.finish());
      return;
    }
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (recorder && ["consent-next", "consent-prev", "consent-finish", "text-only", "skip-double", "permissions"].includes(action)) return status("Stop recording first so your voice sample is saved.", "error");
    if (action === "begin") return begin();
    if (action === "enter") return enterExperience();
    if (action === "close-reader") return reader.close();
    if (action === "camera-switch") {
      if (cameraStream) { stopCamera(); sessionState.consent.cameraPresence = false; render(); }
      else await enablePresenceCamera();
    }
    if (action === "permissions") { if (busy) cancelActiveOperations(); travel(() => { state().checkpoint = true; state().consentPage = 0; render(); }, -1); }
    if (action === "consent-next") travel(() => { state().consentPage = Math.min(2, state().consentPage + 1); render(); });
    if (action === "consent-prev") travel(() => { state().consentPage = Math.max(0, state().consentPage - 1); render(); }, -1);
    if (action === "consent-finish") finishConsent();
    if (action === "text-only") finishConsent(true);
    if (action === "skip-double") skipDouble();
    if (action === "retake-portrait") { state().retakingPortrait = true; render(); }
    if (action === "take-portrait") {
      if (!cameraStream) return status("Turn the camera on beside the portrait controls first.", "error");
      state().portraitConfirmed = false; state().retakingPortrait = false; await base.capturePortrait();
    }
    if (action === "confirm-portrait") { state().portraitConfirmed = true; render(); }
    if (action === "retry-media") await generateProxyMedia();
    if (action === "proxy-review") travel(() => { state().proxyView = "review"; render(); });
    if (action === "allow-simulation") { sessionState.consent.fictionalGeneration = true; await generateFiction(); }
    if (action === "generate-simulation") await generateFiction();
    if (action === "reveal-simulation") travel(() => { state().simulationStep = "scene"; room.react("reveal"); render(); });
    if (action === "scene-back") travel(() => { state().simulationStep = "scene"; render(); }, -1);
    if (action === "simulation-review") travel(() => { state().simulationStep = "review"; render(); });
    if (action === "simulation-evidence") openReader("Why does the AI think this?", simEvidence(sessionState.generated.simulation));
    if (action === "judge-simulation") { state().simulationFeedback.rating = button.dataset.value; render(); }
    if (action === "simulation-reflect") travel(() => { state().simulationStep = "reflection"; render(); });
    if (action === "reject-simulation") { state().simulationFeedback.rejected = true; room.react("reject"); render(); }
    if (action === "delete-simulation") { if (activeOperations.has("fiction")) cancelActiveOperations(); sessionState.generated.simulation = null; sessionState.generated.simulationContext = null; state().simulationFeedback = {}; sessionState.ui.fictionAnswered = false; room.react("reject"); reader.close(); render(); if (dialog.open) renderData(); }
    if (action === "delete-clone-sample") { setRecording("clone-sample", null); sessionState.ui.selectedVoiceTarget = ""; renderData(); render(); }
  }, true);
  addEventListener("resize", () => { captureDrafts(); render(); if (dialog.open) renderData(); });
  addEventListener("pagehide", () => { cancelTransition(); room.dispose(); });
  fetch("/api/capabilities").then(r => r.ok ? r.json() : null).then(value => { capabilities = value; }).catch(() => {});
  if (developerMode) window.__v6 = { room, state, simInput, signature, render, getSession: () => sessionState, getPageCount: () => pages.length };
  room.reduce(room.reduced);
  render();
})();
