"use strict";

// Another Me v6: the "descent" interface layer, spoken by one conversational presence.
// script.js owns state, devices and providers. This layer owns screens, navigation, motion and the conversation.
// Rule: one screen is one moment. The system speaks, you respond, it answers briefly, you continue.
(() => {
  const BUILD = document.querySelector('meta[name="another-me-build"]')?.content || "dev";
  const core = window.SimulationCore;
  const music = window.AnotherMeMusic || { unlock() {}, setActive() {}, duck() {} };
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
  // Disclosure panels marked data-keep stay open across re-renders (feedback form, "What happened?", evidence).
  const keptOpen = new Set();
  let capabilities = null;
  let transitionTicket = 0, transitioning = false, synthTicket = 0;
  let lastScreenKey = "", focusAfterRender = "", acknowledge = "", waveFrame = 0;

  console.info(`[another-me] build ${BUILD}`);
  labels.unknown = ["?", "UNKNOWN"];
  // Every wait is finite. When one runs out the experience continues on its own with a calm note.
  Object.assign(operationDefinitions, {
    image: { label: "Image reading", stages: [1], timeoutMs: 25000, loading: "Looking at your image…", success: "", fallback: "" },
    reply: { label: "Response", stages: [2, 3], timeoutMs: 18000, loading: "Thinking about your answer…", success: "", fallback: "" },
    synthesis: { label: "Reading your answers together", stages: [3], timeoutMs: 35000, loading: "Reading your answers together…", success: "", fallback: "" },
    feedback: { label: "Feedback", stages: [], timeoutMs: 15000, loading: "Sending your feedback…", success: "", fallback: "" }
  });
  operationDefinitions.fiction = { label: "Fictional scene", stages: [6], timeoutMs: 90000, loading: "Writing a fictional scene…", success: "Your fictional scene is ready.", fallback: "" };
  operationDefinitions.microphone.stages = [2, 3, 4, 5];
  operationDefinitions.identity.timeoutMs = 95000;
  operationDefinitions.identity.loading = "Building a model of you from your answers…";
  operationDefinitions.prediction.timeoutMs = 45000;
  operationDefinitions.prediction.loading = "Preparing a prediction…";
  operationDefinitions.proxy.timeoutMs = 35000;
  operationDefinitions.proxy.loading = "Writing your double's reply…";
  operationDefinitions.elevenlabs.timeoutMs = 75000;
  operationDefinitions.elevenlabs.loading = "Creating your double's voice…";
  operationDefinitions.did.timeoutMs = 300000;
  operationDefinitions.did.loading = "Animating your double…";
  operationDefinitions.transcription.timeoutMs = 35000;
  stages[2][2] = "Three situations, one at a time.";
  stages[5][2] = "A situation you never described.";

  const imagePrompt = "Choose an image that says something about you.";
  const imageContext = "It could show you, a place, an object or a moment that matters.";
  const storyHelper = "You could tell me what was happening outside the frame, how you felt, or why you chose this image.";
  const followUpHints = {
    question_1: "What would you be thinking that you might leave out of your message?",
    question_2: "What matters most to you in deciding how to respond?",
    question_3: "What would make you reconsider?"
  };
  const predictionTarget = `${dilemma} What would you say to them?`;
  const proxyContext = "Someone close to you has volunteered you to help with an event this weekend without asking. You had deliberately kept that time free for yourself.";
  const proxyMessage = "I told them you'd help. You're always the reliable one.";
  const s6Intro = "I have your words and some of your choices. Here is a situation you never gave me—and the version of you I made for it.";
  const tensionChoices = [["circumstances", "Different circumstances"], ["changed", "I changed my mind"], ["misread", "You misunderstood"]];
  const wrongParts = ["The action", "The thoughts", "The way I spoke", "The whole interpretation"];
  const FEEDBACK_QUESTIONS = [["distinguish_sources", "Could you tell what you supplied from what the AI created?"], ["uncertainty_clear", "Was the uncertainty language clear?"], ["gradually_personal", "Did the questions gradually feel more personal?"], ["in_control", "Did you feel in control of your information?"]];

  function ui() {
    return sessionState.ui.v6 ||= {
      checkpoint: false, consentPage: 0, messageSeen: false, simulationStep: "intro", simulationRevision: "", simulationMode: "", simulationFeedback: {}, seenScenarios: [], portraitConfirmed: false, proxyView: "response",
      conv: { image: null, moments: {}, synthesis: null, speculations: {}, tension: null, s3: "questions", detour: false },
      s4: "situation", s4Pred: null, s5: null, s6: null, describing: false,
      feedback: { answers: {}, comments: {}, boundary: "", state: "idle", id: "", error: "" }
    };
  }
  const conv = () => ui().conv;
  const atCheckpoint = () => ui().checkpoint && sessionState.currentStage === 5;
  function moment(key) { return conv().moments[key] ||= { status: "asking", reply: null, forText: "", followUp: null, note: "", ticket: 0 }; }
  const followUpsUsed = () => Object.values(conv().moments).filter(m => m.followUp).length;

  /* ---------- small markup helpers ---------- */
  const act = (action, label, cls = "btn-secondary", extra = "") => `<button type="button" data-v6="${action}" class="${cls}" ${extra}>${label}</button>`;
  const baseAct = (action, label, cls = "btn-secondary", extra = "") => `<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
  const row = (...items) => `<div class="row">${items.filter(Boolean).join("")}</div>`;
  const clip = (text, max) => { const t = String(text || "").trim(); return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t; };
  const unquote = text => String(text || "").trim().replace(/^["“'‘]+|["”'’]+$/g, "");
  const TAGS = {
    you: ["■", "YOU SAID"], heard: ["≈", "TRANSCRIBED FROM YOUR VOICE"], model: ["◇", "MODEL INFERENCE"], predicted: ["◇", "MODEL PREDICTION"],
    uncertain: ["◌", "UNCERTAIN"], conflict: ["⟂", "POSSIBLE CONTRADICTION"], generated: ["✱", "GENERATED"], double: ["✱", "GENERATED · AI DOUBLE"],
    contested: ["✎", "CONTESTED BY YOU"], rejected: ["⊘", "REJECTED BY YOU"], confirmed: ["✓", "CONFIRMED BY YOU"], demo: ["◍", "LABELLED DEMONSTRATION"]
  };
  const tag = (kind, text = "") => `<span class="tag tag--${kind}"><span aria-hidden="true">${TAGS[kind][0]}</span>${text || TAGS[kind][1]}</span>`;
  function idLine(meta = "") {
    const s = sessionState.currentStage;
    const id = atCheckpoint() ? `<span class="screen-id__num">05</span>THRESHOLD` : `<span class="screen-id__num">${pad(s)}</span>${esc(stages[s - 1][0])}`;
    return `<p class="screen-id">${id}${meta ? `<span class="screen-id__meta">${meta}</span>` : ""}</p>`;
  }
  // bare: the stage line is already above (conversation screens put your words between it and the reply).
  function head(title, { context = "", meta = "", promptKey = "", bare = false } = {}) {
    const long = String(title).length > 150 ? " screen-title--long" : "";
    const heading = promptKey
      ? `<h2 class="screen-title spoken-prompt${long}" data-prompt-key="${esc(promptKey)}" data-prompt-text="${esc(title)}" aria-label="${esc(title)}"><span class="prompt-letters" aria-hidden="true">${esc(title)}</span></h2>`
      : `<h2 class="screen-title${long}">${title}</h2>`;
    return `<header class="screen-head">${bare ? "" : idLine(meta)}${heading}${context ? `<p class="screen-context">${context}</p>` : ""}</header>`;
  }
  const screen = (kind, inner) => `<div class="screen screen--${kind}">${inner}</div>`;
  const answerById = id => readableAnswers().find(a => a.id === id);
  // Evidence shows what the participant actually said; question numbers stay a faint source note.
  function evidence(ids, extra = "", summary = "Why do you think that?", keep = "") {
    const items = (ids || []).map(answerById).filter(Boolean);
    const list = items.map(a => `<li>${tag("you")}<p class="evidence-quote">${esc(a.answer)}</p><p class="source-note">in reply to: ${esc(clip(a.question, 140))}</p></li>`).join("");
    return `<details class="evidence" ${keep ? `data-keep="${keep}"` : ""}><summary>${summary}</summary><div class="evidence-body">${extra}${list ? `<ul class="evidence-list">${list}</ul>` : '<p class="hint">No specific answer was cited.</p>'}</div></details>`;
  }
  const since = time => { const sec = Math.max(0, Math.floor((Date.now() - time) / 1000)); return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; };
  // A real elapsed timer, continuous across the steps of one wait; it disappears when the wait ends.
  const progress = (label, start) => `<p class="progress-line" role="status"><span class="progress-line__dot" aria-hidden="true"></span><span>${esc(label)}</span><span aria-hidden="true">·</span><span class="elapsed" data-since="${start}">${since(start)}</span></p>`;
  const thinking = label => `<p class="thinking" role="status"><span class="sr-only">${esc(label)}</span><span class="thinking__dot" aria-hidden="true"></span><span class="thinking__dot" aria-hidden="true"></span><span class="thinking__dot" aria-hidden="true"></span></p>`;
  const calm = text => `<p class="calm-note" role="status">${esc(text)}</p>`;
  const said = (text, origin = "typed", label = "") => `<blockquote class="said">${tag(origin === "transcribed" ? "heard" : "you", label)}<p>${esc(clip(text, 280))}</p></blockquote>`;

  /* ---------- failures: calm on the surface, specific on request ---------- */
  function failureKind(code = "") {
    if (/access_code/.test(code)) return ["Access code needed", "The live AI asks for the researcher's access code.", "Enter the access code on the first screen, then try again."];
    if (/origin_not_allowed/.test(code)) return ["Site not allowed", "The AI server does not list this website.", "The researcher needs to add this site to ALLOWED_ORIGINS."];
    if (/missing_api_key|invalid_api_key|credentials|not_configured/.test(code)) return ["Service not set up", "The AI provider is missing or rejected the server's credentials.", "The researcher needs to check the server's API keys."];
    if (/rate_limit/.test(code)) return ["Service busy", "Too many requests arrived in a short time.", "Wait a few minutes; it should work again."];
    if (/quota|credits/.test(code)) return ["Out of credits", "The provider account reached its usage or credit limit.", "The researcher needs to check the provider account."];
    if (/account_restricted/.test(code)) return ["Account restriction", "The provider's plan does not allow this operation.", "The researcher needs to check the provider plan."];
    if (/portrait_rejected/.test(code)) return ["Portrait not accepted", "The provider could not use the portrait.", "A clear, front-facing portrait usually works; you can retake it on the permission screen."];
    if (/audio_rejected/.test(code)) return ["Recording not accepted", "The provider rejected the voice sample's format, length or content.", "A longer, clearer recording usually helps."];
    if (/content_rejected|model_refusal/.test(code)) return ["Request declined", "The provider declined this request under its policy.", "Rewording your answer may help, or you can simply continue."];
    if (/no_speech/.test(code)) return ["No speech heard", "Not a technical fault: the recording didn't contain words the service could hear.", "Speak a little closer to the microphone and record again, or type instead."];
    if (/timeout/.test(code)) return ["Took too long", "The request reached its time limit and was stopped.", "It may work later; nothing is needed from you now."];
    if (/incomplete_output|empty_model_output|empty_response|invalid_response/.test(code)) return ["Incomplete result", "The answer came back empty or incomplete, so it wasn't used.", "Nothing is needed from you; you can continue."];
    if (/invalid_model_json|invalid_model_output|invalid_profile|invalid_fiction|validation/.test(code)) return ["Did not pass its checks", "The result failed the prototype's own checks, so it wasn't shown.", "Nothing is needed from you; you can continue."];
    if (/network/.test(code)) return ["Connection problem", "The server or the provider could not be reached.", "Check the internet connection, or that the local server is running."];
    if (/permission_denied/.test(code)) return ["Permission blocked", "The browser did not allow access.", "Allow access in your browser's site settings, then try again."];
    if (/device_missing/.test(code)) return ["No device found", "No device was detected.", "Connect a device and try again."];
    if (/device_busy/.test(code)) return ["Device in use", "Another app is using it.", "Close the other app and try again."];
    if (/unsupported/.test(code)) return ["Not supported here", "This browser or file format isn't supported for this step.", "Try a current Chrome or Edge browser, or use text."];
    if (/feedback_store_failed/.test(code)) return ["Not stored", "The feedback store did not accept the record.", "Try again in a moment, or download a copy."];
    return ["Could not finish", "The service could not complete this step.", "Nothing is needed from you; you can continue."];
  }
  const WHERE = {
    camera: ["Your camera", "Kept everything else. The image can come from a file or a description instead."],
    microphone: ["Your microphone", "Kept your typed words. Nothing was recorded."],
    transcription: ["Turning your recording into words", "Kept your recording and left the words for you to type."],
    identity: ["Building a model of you", "Kept your answers and any earlier model."],
    prediction: ["Preparing a prediction", "Kept your answers and moved on without a prediction. Your own answer is never used to make one."],
    proxy: ["Writing your double's reply", "Tried once more in the background, then moved on without a reply."],
    elevenlabs: ["Creating your double's voice", "Kept the written reply. Nothing was spoken in a voice that isn't labelled."],
    did: ["Animating your double", "Kept your cloned voice and a still portrait."],
    fiction: ["Writing a fictional scene", "Showed a prepared demonstration scene instead. It does not come from an AI reading of your answers."],
    image: ["Looking at your image", "Kept your image. I'll go by what you tell me about it, and nothing about it was guessed."],
    reply: ["Responding to your answer", "Kept your answer exactly as you wrote it and moved on."],
    synthesis: ["Reading your answers together", "Kept your answers and continued without an interpretation."],
    feedback: ["Sending your feedback", "Kept everything you chose in the form. Nothing was reported as sent."]
  };
  // Where / what happened / what the system did / what can help. Technical failures and missing information are
  // told apart. No keys, request contents or stack traces are ever shown.
  function whatHappened(id, { where, what, did, help = "", insufficient = false, code = "", actions = "" }) {
    return `<details class="what-happened" data-keep="wh-${esc(id)}"><summary>${insufficient ? "Why?" : "What happened?"}</summary>
      <dl class="what-happened__list"><div><dt>Where</dt><dd>${esc(where)}</dd></div><div><dt>What happened</dt><dd>${esc(what)}${code ? ` <code>${esc(code)}</code>` : ""}</dd></div><div><dt>What the system did</dt><dd>${esc(did)}</dd></div>${help ? `<div><dt>What can help</dt><dd>${esc(help)}</dd></div>` : ""}</dl>${actions ? row(actions) : ""}</details>`;
  }
  function technical(key, { did = "", actions = "", code = "" } = {}) {
    const op = sessionState.operations[key] || {}, errorCode = code || op.errorCode || "";
    const [title, what, help] = failureKind(errorCode);
    return whatHappened(key, { where: WHERE[key]?.[0] || operationDefinitions[key]?.label || key, what: `${title}. ${what}`, did: did || WHERE[key]?.[1] || "Kept your information and continued.", help, code: errorCode, actions });
  }
  const failed = key => ["timeout", "error"].includes(sessionState.operations[key]?.state);
  const CALM = {
    camera: "The camera isn't available, so you can choose a file or describe the image instead.",
    microphone: "The microphone isn't available, so you can type instead.",
    transcription: "I couldn't turn your recording into words, so please type what you said. Your recording is kept.",
    identity: "I couldn't build the model of you this time. Your answers are kept."
  };
  function notice(key, { retry = "" } = {}) {
    if (!failed(key)) return "";
    const text = key === "transcription" && sessionState.operations.transcription?.errorCode === "no_speech" ? "I couldn't hear any words in that recording, so you can record again or type what you said. Your recording is kept." : CALM[key];
    return `${calm(text || "That step couldn't finish, so the experience continues without it.")}${technical(key, { actions: retry ? baseAct("retry-operation", retry, "btn-tertiary", `data-operation="${key}"`) : "" })}`;
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
    return notice(key, { retry: key === "camera" ? "Try the camera again" : "Try the microphone again" });
  }
  function voiceColumn(target, audio, { confirmable = false } = {}) {
    const active = recorder && recordTarget === target;
    const transcribing = activeOperations.has("transcription");
    const state = active ? "recording" : transcribing ? "processing" : failed("microphone") ? "error" : audio ? "complete" : "ready";
    const word = { ready: "Ready", recording: "Recording", processing: "Transcribing", complete: confirmable && !sessionState.audioConfirmed ? "Recorded · listen back" : "Recorded", error: "Microphone unavailable" }[state];
    let body;
    if (active) body = `<div class="rec-live"><span class="rec-dot" aria-hidden="true"></span><output id="recordClock" aria-label="Recording time">00:00</output><span class="rec-limit">/ 01:00</span><canvas class="rec-wave" id="recWave" width="240" height="40" aria-hidden="true"></canvas></div>${row(baseAct("stop-recording", "Stop recording", "btn-primary"))}`;
    else if (audio) body = `<audio controls preload="metadata" src="${audio.url}" aria-label="Your recording"></audio>${row(baseAct("start-recording", "Record again", "btn-secondary", busy ? "disabled" : ""), baseAct("delete-audio", "Delete recording", "btn-tertiary danger"))}`;
    else if (appConfig.serverless) body = `<p class="calm-note">This online demonstration has no AI server, so spoken answers can't be turned into words. Please type your answer.</p>`;
    else body = `<button type="button" class="rec-button" data-action="start-recording" ${busy ? "disabled" : ""}><span class="rec-button__icon" aria-hidden="true"></span><span>Record your answer</span></button><p class="hint">Up to a minute. When you stop, the recording is sent to OpenAI and turned into words you can edit.</p>`;
    return `<section class="ws-voice" aria-label="Speak your answer"><p class="ws-label">SPEAK <span class="rec-state" data-state="${state}">${word}</span></p>${body}${deviceNotice("microphone")}</section>`;
  }
  function wordsColumn({ id, text, origin, audio, placeholder, transcribeNeedsConfirm = false }) {
    const transcribing = activeOperations.has("transcription");
    const status = transcribing ? '<span class="ws-status is-working">Transcribing your response…</span>'
      : origin === "transcribed" ? '<span class="ws-status">Transcribed · edit anything</span>' : text?.trim() ? '<span class="ws-status">Written by you</span>' : '<span class="ws-status">or type instead</span>';
    const needsConsent = audio && !sessionState.consent.transcription && !text?.trim();
    const consentCard = needsConsent ? `<div class="inline-consent"><p>Turn your recording into editable words? The audio is sent to OpenAI for transcription.</p>${row(baseAct("allow-transcription", "Transcribe my recording", "btn-secondary", busy ? "disabled" : ""))}</div>` : "";
    // A failed transcription falls back to typing at once; trying again stays available but is never required.
    const retry = audio && sessionState.consent.transcription && !text?.trim() && !transcribing && !(transcribeNeedsConfirm && !sessionState.audioConfirmed)
      ? (notice("transcription", { retry: "Try transcribing again" }) || row(baseAct("transcribe", "Transcribe my recording", "btn-secondary", busy ? "disabled" : ""))) : "";
    return `<section class="ws-words" aria-label="Your words"><p class="ws-label">${origin === "transcribed" ? "WHAT THE SYSTEM HEARD" : "IN YOUR WORDS"} ${status}</p>${consentCard}${retry}
      <label class="sr-only" for="${id}">Your answer, editable</label><textarea id="${id}" maxlength="4000" ${transcribing ? 'readonly aria-busy="true"' : ""} placeholder="${esc(placeholder)}">${esc(text || "")}</textarea>
      <p class="hint">Edit freely. What you leave here, not the raw recording, is what the system reads.</p></section>`;
  }
  const workspace = (voice, words, cls = "") => `<div class="workspace ${cls}">${voice}${words}</div>`;

  /* ---------- opening ---------- */
  window.renderOpening = () => screen("opening", `<div class="opening">
    <p class="opening__kicker">AN EXPERIMENT IN BEING SEEN</p>
    <h2 class="opening__title opening__title--split"><span>How much of you</span> <span>can a system make?</span></h2>
    <p class="opening__lede">Give it an image, your voice and a few answers. It will talk with you, form an interpretation of you, and then speak as you.</p>
    <p class="opening__note">What it builds is a model, not you. You can correct it, reject it or delete everything at any time.</p>
    ${appConfig.serverless ? '<p class="opening__note">Online demonstration: the AI text is simulated and nothing you enter leaves this browser. The full version with live AI, voice and the talking double runs with the project server.</p>' : ""}
    ${capabilities?.accessCode && !mockMode ? `<div class="field access-field"><label for="accessCode">Access code for the live AI (from the researcher)</label><input id="accessCode" type="password" autocomplete="off" value="${esc(storedAccessCode())}"></div>` : ""}
    ${row(act("begin", "Enter", "btn-primary btn-large"))}
    <div class="opening__more"><details><summary>What happens to my information?</summary><p>Your session lives only in this browser's memory, not a database. What you supply, what the AI infers and what it generates are always labelled separately. External AI services (OpenAI, ElevenLabs, D-ID) are used only after you allow each one, and their own retention policies apply.</p></details>
    <details><summary>How long does it take?</summary><p>About 10–15 minutes, in six stages that go progressively deeper. You can skip, go back or leave whenever you like. Quiet music plays; switch it off with the Music button.</p></details></div></div>`);

  /* ---------- the conversation engine ---------- */
  // A short request with its own deadline. It never blocks the interface (no global busy flag), and a
  // result that arrives after the participant has moved on is ignored by the caller.
  // The server answered, but not with something usable: recorded as such, never shown as if it were valid.
  const invalidResult = key => setOperationState(key, "error", { message: failureKind("invalid_response")[1], errorCode: "invalid_response" });
  async function converse(key, path, payload) {
    const controller = new AbortController(), ticket = generation;
    let timedOut = false;
    inFlight.add(controller);
    setOperationState(key, "loading");
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, operationTimeout(key));
    try {
      await applyDevelopmentScenario(key, controller.signal);
      const result = await callApi(path, payload, "json", controller.signal);
      if (ticket !== generation) return null;
      setOperationState(key, "success");
      return result;
    } catch (error) {
      if (ticket !== generation) return null;
      const code = timedOut ? "timeout" : typeof error?.code === "string" && error.code ? error.code : "service_error";
      setOperationState(key, code === "timeout" ? "timeout" : "error", { message: failureKind(code)[1], errorCode: code });
      console.warn(`[another-me:${key}] code=${code}`);
      return null;
    } finally { clearTimeout(timer); inFlight.delete(controller); }
  }
  const pause = ms => room.reduced ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms));
  const answerRow = key => {
    const s = sessionState;
    if (key === "story") return { text: s.supplied.transcript || "", origin: s.supplied.transcriptOrigin, question: storyQuestion, id: "image_story" };
    const a = s.supplied.answers.find(r => r.id === key);
    return a ? { text: a.text || "", origin: a.textOrigin, question: a.question, id: a.id } : { text: "", origin: "typed", question: "", id: key };
  };
  const rejectedClaims = () => Object.values(conv().speculations).filter(sp => sp.reaction === "isnt").map(sp => sp.claim).slice(0, 6);
  function imageReadingFor() {
    const r = conv().image;
    return r?.status === "done" && r.forBlob === sessionState.supplied.image?.blob ? { observation: r.reading.observation, interpretation: r.reading.interpretation } : null;
  }
  // Rule-based stand-ins for the serverless demonstration. They are always labelled and never claim to have read anything.
  function mockReply(key, payload) {
    const answer = answerRow(key).text.trim(), words = answer.split(/\s+/).filter(Boolean).length;
    if (payload.allowed_moves.includes("follow_up") && key !== "story" && words < 12) return { move: "follow_up", text: followUpHints[key], inferred: "", unknown: "", evidence: [] };
    if (key === "story" && payload.allowed_moves.includes("interpret") && answer) {
      const quote = clip(answer.split(/(?<=[.!?])\s/)[0], 120).replace(/…$/, "");
      const claim = /friend|family|mum|mom|dad|sister|brother|partner|\bwe\b|together|people/i.test(answer) ? "This image might matter less for what it shows than for who was there when it was taken."
        : /felt|feel|happy|sad|calm|lonely|proud|scared|miss/i.test(answer) ? "You might hold on to how a moment felt for longer than to what actually happened in it."
          : "Perhaps the image stands in for something you would rather show than explain.";
      return { move: "interpret", text: claim, inferred: "This demonstration matched a few words in your answer to a prepared sentence. No AI read it.", unknown: "Whether any of this is true for you.", evidence: answer.toLowerCase().includes(quote.toLowerCase()) ? [{ source_id: "image_story", quote }] : [] };
    }
    return { move: "acknowledge", text: "Thank you. I've kept that exactly as you wrote it.", inferred: "", unknown: "", evidence: [] };
  }
  function movesFor(key, m, isFollow) {
    const moves = ["acknowledge"];
    if (key === "story") moves.push("interpret");
    if (!isFollow && !m.followUp && followUpsUsed() < 2) moves.push("follow_up");
    return moves;
  }
  async function respond(key, isFollow = false) {
    const s = sessionState, c = conv(), m = moment(key), row = answerRow(key);
    const ticket = ++m.ticket, waiting = isFollow ? "followThinking" : "thinking";
    m.status = waiting; m.note = "";
    if (!isFollow) m.forText = row.text.trim();
    render();
    const answers = [{ id: row.id, question: row.question, answer: row.text.trim() }];
    if (key === "story" && s.supplied.imageDescription?.trim() && !s.supplied.image) answers.unshift({ id: "image_context", question: "Describe an image that says something about you.", answer: s.supplied.imageDescription.trim() });
    const payload = {
      moment: key, question: row.question, answers, allowed_moves: movesFor(key, m, isFollow), avoid_claims: rejectedClaims(),
      suggested_follow_up: followUpHints[key] || "", follow_up_question: isFollow ? m.followUp.question : "", follow_up_answer: isFollow ? m.followUp.text.trim() : "",
      image_reading: key === "story" ? imageReadingFor() : null
    };
    if (isFollow) answers.push({ id: `${row.id === "image_story" ? "story" : row.id}_followup`, question: m.followUp.question, answer: m.followUp.text.trim() });
    const started = Date.now();
    let result = null;
    if (mockMode) result = { reply: mockReply(key, payload) };
    else if (capabilities?.openai !== false) result = await converse("reply", "/api/reply", payload);
    // A short beat keeps the rhythm of a conversation even when the answer is instant.
    await pause(Math.max(0, 650 - (Date.now() - started)));
    if (s !== sessionState || ticket !== m.ticket || m.status !== waiting) return;
    const valid = x => x && typeof x.text === "string" && x.text.trim() && payload.allowed_moves.includes(x.move);
    const r = valid(result?.reply) ? result.reply : null;
    if (result && !r) invalidResult("reply");
    if (r && r.move === "follow_up" && payload.allowed_moves.includes("follow_up")) {
      m.followUp = { question: r.text, text: "", origin: "typed", declined: false, mode: mockMode ? "demo" : "live" };
      m.status = "following";
    } else {
      m.reply = r && payload.allowed_moves.includes(r.move) ? { ...r, mode: mockMode ? "demo" : "live" } : null;
      m.note = m.reply ? "" : capabilities?.openai === false ? "config" : "failed";
      if (m.reply?.move === "interpret") c.speculations[key] = { claim: r.text, inferred: r.inferred, unknown: r.unknown, evidence: r.evidence || [], reaction: "", explanation: "", mode: m.reply.mode };
      m.status = "responded";
    }
    render();
  }
  function send(key) {
    const m = moment(key), text = answerRow(key).text.trim();
    room.react("answer");
    if (m.forText === text && (m.reply || m.followUp || m.note)) {
      // Unchanged answer: return to where the conversation was instead of asking again.
      return travel(() => { m.status = m.followUp && !m.followUp.text.trim() && !m.followUp.declined ? "following" : "responded"; render(); });
    }
    // A changed answer: the earlier response, follow-up and interpretation no longer apply.
    if (m.followUp) setRecording(`extra:${key}-followup`, null);
    m.followUp = null; m.reply = null; m.note = "";
    delete conv().speculations[key];
    travel(() => { void respond(key, false); });
  }
  function sendFollow(key) { room.react("answer"); travel(() => { void respond(key, true); }); }
  function stopWaiting(key) { const m = moment(key); m.ticket++; m.status = "responded"; m.reply = m.reply || null; if (!m.reply) m.note = "skipped"; }
  window.customRecordTarget = () => {
    const s = sessionState;
    if (!s.started || atCheckpoint()) return null;
    if (s.currentStage === 2 && moment("story").status === "following") return "extra:story-followup";
    if (s.currentStage === 3 && s.questionIndex < questions.length) { const key = `question_${s.questionIndex + 1}`; if (moment(key).status === "following") return `extra:${key}-followup`; }
    if (s.currentStage === 4 && ui().s4 === "answer") return "prediction-answer";
    return null;
  };
  window.applyExtraTranscript = (target, transcript) => {
    const m = conv().moments[String(target).replace(/^extra:/, "").replace(/-followup$/, "")];
    if (m?.followUp) { m.followUp.text = transcript; m.followUp.origin = "transcribed"; }
  };

  /* ---------- what the system is allowed to know, in one place ---------- */
  const uncertaintyReplies = () => (sessionState.inferred.uncertaintyFeedback ||= []);
  const replyFor = text => uncertaintyReplies().find(r => r.text === text);
  const unknownsOf = profile => profile?.unknowns || [];
  // Supplied answers only. Interpretations enter as the participant's reaction to them, never as facts;
  // a rejected interpretation is left out entirely and only the participant's own words remain.
  window.readableAnswers = () => {
    const s = sessionState, c = conv(), answers = [];
    if (s.supplied.image && s.photoConfirmed) answers.push({ id: "image_context", question: "Did you supply an image?", answer: "I chose an image that says something about me." });
    else if (s.supplied.imageDescription?.trim()) answers.push({ id: "image_context", question: "Describe an image that says something about you.", answer: s.supplied.imageDescription.trim() });
    if (s.supplied.transcript.trim()) answers.push({ id: "image_story", question: storyQuestion, answer: s.supplied.transcript.trim() });
    const storyFollow = c.moments.story?.followUp;
    if (storyFollow?.text?.trim()) answers.push({ id: "story_followup", question: storyFollow.question, answer: storyFollow.text.trim() });
    s.supplied.answers.forEach(row => {
      if (row.text.trim()) answers.push({ id: row.id, question: row.question, answer: row.text.trim() });
      const follow = c.moments[row.id]?.followUp;
      if (follow?.text?.trim()) answers.push({ id: `${row.id}_followup`, question: follow.question, answer: follow.text.trim() });
    });
    for (const key of ["story", "synthesis"]) {
      const sp = c.speculations[key];
      if (!sp?.reaction) continue;
      if (sp.reaction === "isnt") { if (sp.explanation?.trim()) answers.push({ id: `correction_${key}`, question: "Something the AI got wrong about me, in my own words", answer: sp.explanation.trim() }); }
      else answers.push({ id: `reaction_${key}`, question: `The AI suggested: "${sp.claim}" Does that fit?`, answer: `${sp.reaction === "fits" ? "That fits." : "Partly, but it stretched it."}${sp.explanation?.trim() ? ` ${sp.explanation.trim()}` : ""}` });
    }
    const t = c.tension;
    if (t?.choice && t.choice !== "skip") answers.push({ id: "tension_explanation", question: `Two of my answers seemed to pull in different directions ("${t.first.quote}" and "${t.second.quote}"). What makes these situations different for me?`, answer: `${tensionChoices.find(([v]) => v === t.choice)?.[1] || ""}.${t.explanation?.trim() ? ` ${t.explanation.trim()}` : ""}` });
    uncertaintyReplies().filter(r => r.verdict !== "private" && r.explanation?.trim()).slice(0, 3).forEach((r, i) => {
      answers.push({ id: `uncertainty_${i + 1}`, question: `The model was unsure: ${r.text}`, answer: r.explanation.trim() });
    });
    return answers.slice(0, 19);
  };
  // The model of you remembers exactly which answers it was built from. Reactions and corrections made later
  // rebuild it when it is next needed; if that fails, the last valid model is used with its own answers.
  const baseGenerateProfile = generateProfile;
  window.generateProfile = async (...args) => {
    const answers = readableAnswers();
    const completed = await baseGenerateProfile(...args);
    if (completed && sessionState.inferred.profile) sessionState.inferred.profileAnswers = answers;
    return completed;
  };
  const profileStale = () => !!sessionState.inferred.profile && sessionState.inferred.mode !== "mock" && JSON.stringify(sessionState.inferred.profileAnswers || []) !== JSON.stringify(readableAnswers());
  const synthesisAnswers = () => readableAnswers().filter(a => /^(image_story|story_followup|question_\d(_followup)?)$/.test(a.id));

  /* ---------- stage 1: an image, then one look at it ---------- */
  async function downscale(blob, max = 768) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const small = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
    if (!small) throw new OperationFailure("unsupported", "The image could not be prepared.");
    return blobToBase64(small);
  }
  async function readImageNow() {
    const s = sessionState, image = s.supplied.image, c = conv();
    if (!image) return;
    const entry = c.image = { status: "reading", forBlob: image.blob, reading: null, note: "" };
    render();
    if (mockMode || capabilities?.openai === false) { await pause(500); if (c.image === entry) { entry.status = "unavailable"; entry.note = mockMode ? "demo" : "config"; render(); } return; }
    let data = "";
    try { data = await downscale(image.blob); }
    catch { if (c.image === entry) { entry.status = "failed"; entry.note = "unsupported"; render(); } return; }
    const result = await converse("image", "/api/image-reading", { image_base64: data, image_type: "image/jpeg" });
    if (s !== sessionState || c.image !== entry || entry.status !== "reading" || s.supplied.image?.blob !== image.blob) return;
    if (typeof result?.reading?.observation === "string" && typeof result.reading.interpretation === "string") { entry.status = "done"; entry.reading = result.reading; }
    else { if (result) invalidResult("image"); entry.status = "failed"; entry.note = "failed"; }
    render();
  }
  function maybeReadImage() {
    const s = sessionState, c = conv(), image = s.supplied.image;
    if (s.currentStage !== 1 || !s.started || s.ended || s.finished || !image || !s.photoConfirmed) return;
    if (c.image && c.image.forBlob === image.blob) return;
    queueMicrotask(() => void readImageNow());
  }
  function imageReadingScreen() {
    const s = sessionState, r = conv().image, image = s.supplied.image;
    const figure = `<figure class="image-frame image-frame--held">${tag("you", "YOUR IMAGE")}<img src="${image.url}" alt="Your chosen image"></figure>${row(baseAct("retake", "Choose a different image", "btn-tertiary"))}`;
    let voice;
    if (!r || r.status === "reading") voice = `${head("Let me look at it.", { meta: "Your image" })}${thinking("Looking at your image")}`;
    else if (r.status === "done") voice = `${head(r.reading.observation, { meta: "What I can see", promptKey: "image-observation" })}
      <div class="speculation side side--model">${tag("model", "SPECULATIVE AI READING")}<p class="claim">${esc(r.reading.interpretation)}</p>${r.reading.context === "limited" ? '<p class="hint">There isn\'t much context in the image, so this is only a small guess.</p>' : ""}<p class="hint">I only look at what is in the frame, never at faces or appearance.</p></div>`;
    else if (r.status === "skipped") voice = `${head("You moved on before I looked closely.", { meta: "Your image" })}${calm("I'll go by what you tell me about it.")}`;
    else {
      const text = r.note === "demo" ? "In this demonstration I can't look at images, so I'll go by what you tell me about it."
        : r.note === "config" ? "I can't look at images on this server, so I'll go by what you tell me about it."
          : "I couldn't look closely at this image, so I'll go by what you tell me about it.";
      const panel = r.note === "demo" ? "" : r.note === "config" ? whatHappened("image", { where: WHERE.image[0], what: "Service not set up. The AI server has no image model configured.", did: WHERE.image[1], help: "The researcher needs to add an OpenAI key to the server." })
        : r.note === "unsupported" ? whatHappened("image", { where: WHERE.image[0], what: "Not supported here. The browser could not prepare this file for reading.", did: WHERE.image[1], help: "A JPEG or PNG usually works." }) : technical("image");
      voice = `${head("I'll go by what you tell me.", { meta: "Your image" })}${calm(text)}${panel}`;
    }
    return screen("image", `<div class="split split--image"><div class="image-voice">${voice}</div><div class="image-col">${figure}</div></div>`);
  }
  window.renderImage = () => {
    const s = sessionState, u = ui(), image = s.supplied.image;
    if (image && s.photoConfirmed) return imageReadingScreen();
    if (u.describing) return screen("image", `<div class="split split--image"><div>${head(imagePrompt, { context: "Describe it in words instead. I won't see an image, only what you write." })}</div>
      <div class="image-col"><div class="inline-field"><label for="imageDescription">The image, in a few words</label><textarea id="imageDescription" maxlength="1200" placeholder="What it shows, and why it matters…">${esc(s.supplied.imageDescription || "")}</textarea></div>${row(act("stop-describing", "Use an image instead", "btn-tertiary"))}</div></div>`);
    let frame;
    if (image) frame = `<figure class="image-frame">${tag("you", "YOUR IMAGE")}<img src="${image.url}" alt="Your chosen image"><figcaption>Is this the one?</figcaption></figure>${row(baseAct("retake", "Replace image"), baseAct("delete-image", "Delete", "btn-tertiary danger"))}`;
    else if (cameraStream) frame = `<figure class="image-frame image-frame--live"><video id="cameraVideo" class="camera" autoplay muted playsinline aria-label="Mirrored live camera preview"></video><figcaption>Live and mirrored. Nothing is kept until you take the photo.</figcaption></figure>${row(baseAct("capture", "Take photo", "btn-primary"), baseAct("camera-off", "Turn camera off", "btn-tertiary"))}`;
    else frame = `<div class="image-drop"><span class="image-drop__ring" aria-hidden="true"></span>${row(`<label class="btn-secondary file-button">Choose an image<input id="imageInput" type="file" accept="image/*"></label>`, baseAct("enable-camera", "Use camera"))}${row(act("describe-image", "Describe an image instead", "btn-tertiary"))}<p class="hint">The camera starts only if you choose it.</p></div>`;
    return screen("image", `<div class="split split--image"><div>${head(imagePrompt, { promptKey: "image-prompt", context: `${imageContext} I'll describe what I can see in it, never faces or appearance.` })}
      <details class="evidence" data-keep="what-is-this"><summary>What is this experience?</summary><div class="evidence-body"><p>Over six stages, a system talks with you, turns what you share into an interpretation of you, then a prediction, then a double that speaks as you. Every step is an AI reading of limited information, not an objective version of you.</p></div></details></div>
      <div class="image-col">${frame}${deviceNotice("camera")}</div></div>`);
  };

  /* ---------- stages 2 and 3: one answer, one brief response ---------- */
  // Never dressed up as a personal response: the same plain line whenever there is no real reply.
  const fallbackAck = () => "Thank you. I've kept that exactly as you wrote it.";
  function speculationCard(key, sp, lead) {
    const r = sp.reaction, state = r === "isnt" ? "rejected" : r === "partly" ? "context" : r === "fits" ? "confirmed" : "";
    const reactions = [["fits", "That fits"], ["partly", "Partly, but you've stretched it"], ["isnt", "That isn't me"]]
      .map(([value, label]) => `<button type="button" class="choice" data-v6="react" data-key="${key}" data-value="${value}" aria-pressed="${r === value}">${label}</button>`).join("");
    const note = { rejected: "Set aside. It won't shape anything that follows, and saying no doesn't prove anything either way.", context: "Kept with your reservation. Only what you say about it travels on.", confirmed: "Kept as something you recognise." }[state];
    return `<section class="speculation side side--model ${state ? `is-${state}` : ""} ${acknowledge === `sp:${key}` ? "is-ack" : ""}">${lead ? `<p class="speculation__lead">${esc(lead)}</p>` : ""}
        ${tag("model", "SPECULATIVE AI INTERPRETATION")}${sp.mode === "demo" ? tag("demo") : ""}
        <p class="claim speculation__claim">${esc(sp.claim)}</p>${note ? `<p class="revision-note">${note}</p>` : ""}${why(key, sp)}</section>
      <section class="reaction" aria-label="Your reaction"><div class="choices" role="group" aria-label="Does this interpretation fit you?">${reactions}</div>
        ${r ? `<div class="inline-field"><label for="reactionExplanation">${r === "isnt" ? "What would you put instead? (optional)" : "Anything to add? (optional)"}</label><textarea id="reactionExplanation" data-key="${key}" maxlength="600" rows="2">${esc(sp.explanation || "")}</textarea></div>` : ""}</section>`;
  }
  function why(key, sp) {
    const quotes = (sp.evidence || []).map(e => { const a = answerById(e.source_id); return `<li><p class="evidence-quote">“${esc(unquote(e.quote))}”</p>${a ? `<p class="source-note">You, in reply to: ${esc(clip(a.question, 110))}</p>` : ""}</li>`; }).join("");
    return `<details class="evidence why" data-keep="why-${key}"><summary>Why do you think that?</summary><div class="evidence-body">
      <div class="why__part">${tag("you", "WHAT YOU SAID")}${quotes ? `<ul class="evidence-list">${quotes}</ul>` : '<p class="hint">No exact words were cited.</p>'}</div>
      <div class="why__part">${tag("model", "WHAT I INFERRED")}<p>${esc(sp.inferred)}</p></div>
      <div class="why__part">${tag("uncertain", "WHAT I CAN'T KNOW")}<p>${esc(sp.unknown)}</p></div></div></details>`;
  }
  function conversationScreen(key, { thumb = "", meta = "" } = {}) {
    const m = moment(key), row = answerRow(key), target = `extra:${key}-followup`;
    const recap = row.text.trim() ? said(row.text, row.origin) : "";
    const followRecap = m.followUp?.text?.trim() ? said(m.followUp.text, m.followUp.origin, m.followUp.origin === "transcribed" ? "" : "YOU ADDED") : "";
    if (m.status === "thinking" || m.status === "followThinking") {
      return screen("conversation", `${idLine(meta)}<div class="conversation">${thumb ? `<div class="respond-head">${thumb}</div>` : ""}${recap}${m.status === "followThinking" ? `<p class="asked">${esc(m.followUp.question)}</p>${followRecap}` : ""}</div>${head(`<span class="sr-only">I'm thinking about what you said.</span>`, { bare: true })}${thinking("Thinking about your answer")}`);
    }
    if (m.status === "following") {
      const audio = recordingFor(target);
      return screen("respond", `${idLine(meta)}<div class="conversation conversation--compact">${recap}</div>${head(m.followUp.question, { bare: true, promptKey: `follow-${key}`, context: m.followUp.mode === "demo" ? "A prepared question, shown because this is a demonstration." : "One question about what you said. Answering is optional." })}
        ${workspace(voiceColumn(target, audio), wordsColumn({ id: "followText", text: m.followUp.text, origin: m.followUp.origin, audio, placeholder: "Your answer, if you want to give one…" }))}`);
    }
    const sp = conv().speculations[key];
    let body;
    if (m.reply?.move === "interpret" && sp) body = `${head("Here is what I wonder.", { bare: true })}${speculationCard(key, sp)}`;
    else if (m.reply?.text) body = `${head(m.reply.text, { bare: true, promptKey: `ack-${key}` })}${m.reply.mode === "demo" ? `<p>${tag("demo")}</p>` : ""}`;
    else {
      const panel = m.note === "failed" ? technical("reply") : m.note === "config" ? whatHappened("reply", { where: WHERE.reply[0], what: "Service not set up. The AI server has no OpenAI key, so it can't respond.", did: WHERE.reply[1], help: "The researcher needs to add an OpenAI key to the server." }) : "";
      body = `${head(fallbackAck(m), { bare: true })}${panel}`;
    }
    return screen("conversation", `${idLine(meta)}<div class="conversation">${thumb ? `<div class="respond-head">${thumb}</div>` : ""}${recap}${m.followUp && !m.followUp.declined ? `<p class="asked">${esc(m.followUp.question)}</p>${followRecap}` : ""}</div>${body}`);
  }
  window.renderAudio = () => {
    const s = sessionState, image = s.supplied.image, m = moment("story");
    const thumb = image && s.photoConfirmed ? `<img class="thumb" src="${image.url}" alt="The image you chose">` : "";
    if (m.status !== "asking") return conversationScreen("story", { thumb, meta: "Beyond the frame" });
    return screen("respond", `<div class="respond-head">${thumb}${head(storyQuestion, { promptKey: "image-story", context: storyHelper })}</div>
      ${workspace(voiceColumn("story", s.supplied.audio, { confirmable: true }), wordsColumn({ id: "storyText", text: s.supplied.transcript, origin: s.supplied.transcriptOrigin, audio: s.supplied.audio, placeholder: "Begin here…", transcribeNeedsConfirm: true }))}
      ${s.consent.transcription && s.consent.audioRecording ? `<details class="evidence quiet" data-keep="auto-record"><summary>Record the next answers automatically?</summary><div class="evidence-body">${baseAct("toggle-auto-record", s.consent.autoRecordQuestions ? "Turn off automatic recording" : "Start recording after each situation appears", "btn-secondary", `aria-pressed="${s.consent.autoRecordQuestions}"`)}<p class="hint">You can stop, re-record or edit every answer.</p></div></details>` : ""}`);
  };
  window.renderQuestions = () => {
    const s = sessionState;
    if (s.questionIndex >= questions.length) return conv().detour ? renderProfile() : synthesisPhase();
    const a = s.supplied.answers[s.questionIndex], meta = `Situation ${s.questionIndex + 1} of ${questions.length}`;
    if (moment(a.id).status !== "asking") return conversationScreen(a.id, { meta });
    return screen("respond", `${head(a.question, { promptKey: `question-${s.questionIndex + 1}`, meta })}
      ${workspace(voiceColumn(a.id, a.audio), wordsColumn({ id: "questionText", text: a.text, origin: a.textOrigin, audio: a.audio, placeholder: "Your answer, in your own words…" }))}`);
  };

  /* ---------- end of stage 3: the answers read together ---------- */
  const phaseAfterSynthesis = () => { const c = conv(); return c.tension ? (c.tension.choice ? "tension-ask" : "tension") : c.speculations.synthesis ? "speculation" : "closing"; };
  function startReading() {
    const s = sessionState, c = conv(), signature = JSON.stringify(synthesisAnswers());
    c.detour = false;
    if (c.synthesis && c.synthesis.signature === signature && c.synthesis.status !== "thinking") { c.s3 = phaseAfterSynthesis(); render(); return; }
    c.tension = null; delete c.speculations.synthesis;
    const entry = c.synthesis = { status: "thinking", startedAt: Date.now(), signature, ticket: ++synthTicket, note: "", result: null, mode: "" };
    c.s3 = "reading"; render();
    // The model of you is built alongside; Stage 4 waits for it if it is still running.
    if (!s.inferred.profile && !activeOperations.has("identity") && readableAnswers().some(a => a.id.startsWith("question_"))) void generateProfile();
    void runSynthesis(entry);
  }
  async function runSynthesis(entry) {
    const s = sessionState, c = conv(), answers = synthesisAnswers();
    let result = null;
    const started = Date.now();
    if (!answers.some(a => a.id.startsWith("question_"))) entry.note = "nothing";
    else if (mockMode) result = { contradiction: { present: false }, interpretation: { offer: false }, closing: "That's all three. I'll carry your answers into what comes next." };
    else if (capabilities?.openai === false) entry.note = "config";
    else {
      const response = await converse("synthesis", "/api/synthesis", { answers, avoid_claims: rejectedClaims() });
      result = response?.synthesis && typeof response.synthesis.closing === "string" && response.synthesis.contradiction && response.synthesis.interpretation ? response.synthesis : null;
      if (response && !result) invalidResult("synthesis");
    }
    await pause(Math.max(0, 1200 - (Date.now() - started)));
    if (s !== sessionState || c.synthesis !== entry || entry.status !== "thinking") return;
    entry.status = result ? "done" : "failed"; entry.result = result; entry.mode = mockMode ? "demo" : "live";
    if (!result && !entry.note) entry.note = "failed";
    // A visible tension takes the place of a bold interpretation; never both.
    if (result?.contradiction?.present) c.tension = { first: result.contradiction.first, second: result.contradiction.second, tension: result.contradiction.tension, choice: "", explanation: "", mode: entry.mode };
    else if (result?.interpretation?.offer) c.speculations.synthesis = { claim: result.interpretation.claim, inferred: result.interpretation.inferred, unknown: result.interpretation.unknown, evidence: result.interpretation.evidence || [], reaction: "", explanation: "", mode: entry.mode };
    if (s.currentStage === 3 && s.questionIndex >= questions.length && c.s3 === "reading") c.s3 = phaseAfterSynthesis();
    render();
  }
  const detourLink = () => row(act("detour", "See how I built this", "btn-tertiary"));
  const situationName = id => { const i = questions.findIndex((_, n) => id.startsWith(`question_${n + 1}`)); return i >= 0 ? `Situation ${i + 1}` : id.startsWith("story") || id === "image_story" ? "Your image story" : "Your answer"; };
  function synthesisPhase() {
    const s = sessionState, c = conv(), entry = c.synthesis;
    if (c.s3 === "reading") return screen("conversation", `${head("Let me read your three answers together.", { meta: "Your answers" })}${progress("Reading your answers together", entry?.startedAt || Date.now())}
      <ul class="held-input">${synthesisAnswers().filter(a => /^question_\d$/.test(a.id)).map(a => `<li>${tag("you", situationName(a.id).toUpperCase())}<p>${esc(clip(a.answer, 160))}</p></li>`).join("")}</ul>`);
    if (c.s3 === "tension" && c.tension) {
      const t = c.tension, full = [t.first, t.second].map(e => answerById(e.source_id)).filter(Boolean);
      return screen("conversation", `${head("Two of your answers seem to pull in different directions.", { meta: "Something I noticed" })}
        <div class="tension-pair">${[t.first, t.second].map(e => `<blockquote class="said">${tag("you", situationName(e.source_id).toUpperCase())}<p>“${esc(unquote(e.quote))}”</p></blockquote>`).join('<span class="tension-pair__mark" aria-hidden="true">⟂</span>')}</div>
        <div class="speculation side side--model">${tag("model", "TENTATIVE")}${t.mode === "demo" ? tag("demo") : ""}<p class="claim">${esc(t.tension)}</p></div>
        <details class="evidence" data-keep="tension-full"><summary>Show the full answers</summary><div class="evidence-body"><ul class="evidence-list">${full.map(a => `<li>${tag("you")}<p class="evidence-quote">${esc(a.answer)}</p><p class="source-note">${esc(situationName(a.id))}</p></li>`).join("")}</ul></div></details>`);
    }
    if (c.s3 === "tension-ask" && c.tension) {
      const t = c.tension, choices = tensionChoices.map(([value, label]) => `<button type="button" class="choice" data-v6="tension-choice" data-value="${value}" aria-pressed="${t.choice === value}">${label}</button>`).join("");
      return screen("conversation", `${head("What makes these situations different for you?", { meta: "Your view", promptKey: "tension-ask" })}
        <div class="choices choices--large" role="group" aria-label="What makes these situations different for you?">${choices}</div>
        ${t.choice && t.choice !== "skip" ? `<div class="inline-field"><label for="tensionExplanation">Say more, if you want (optional)</label><textarea id="tensionExplanation" maxlength="800" rows="3">${esc(t.explanation || "")}</textarea></div>` : '<p class="hint">You don\'t have to explain. Different answers to different situations are not a mistake.</p>'}
        ${detourLink()}`);
    }
    if (c.s3 === "speculation" && c.speculations.synthesis) return screen("conversation", `${head("Reading your answers together, here is what I wonder.", { meta: "Across your answers" })}${speculationCard("synthesis", c.speculations.synthesis)}${detourLink()}`);
    const closing = entry?.result?.closing || "That's all three. I'll carry your answers into what comes next.";
    const panel = entry?.note === "failed" ? technical("synthesis") : entry?.note === "config" ? whatHappened("synthesis", { where: WHERE.synthesis[0], what: "Service not set up. The AI server has no OpenAI key.", did: WHERE.synthesis[1], help: "The researcher needs to add an OpenAI key to the server." })
      : entry?.note === "nothing" ? whatHappened("synthesis", { insufficient: true, where: WHERE.synthesis[0], what: "Not enough information. None of the three situations was answered, so there was nothing to read together.", did: "Moved on without an interpretation.", help: "You can go back and answer a situation if you want." })
        : entry?.status === "skipped" ? "" : "";
    return screen("conversation", `${head(closing, { meta: "Your answers", promptKey: "closing" })}${entry?.mode === "demo" ? `<p>${tag("demo")}</p>` : ""}${entry?.status === "skipped" ? calm("You moved on before I finished reading.") : ""}${panel}${detourLink()}`);
  }

  /* ---------- the optional detour: how the model of you was built ---------- */
  window.profileReviewCount = profile => profile ? 1 + profile.inferred_information.length + unknownsOf(profile).length : 0;
  function verdictState(feedback) {
    if (!feedback) return "";
    return feedback.verdict === "corrected" ? "contested" : feedback.verdict === "rejected" ? "rejected" : feedback.verdict === "accepted" ? "confirmed" : "";
  }
  function profileGenerating() {
    const op = sessionState.operations.identity;
    return screen("generating", `${head("A model of you is being built.", { context: "The system is separating what you said from what it concludes." })}
      <div class="generating"><div class="pulse-rings" aria-hidden="true"><span></span><span></span><span></span></div>${progress("Building a model of you", op.updatedAt || Date.now())}<p class="hint">Your answers are safe if it fails.</p></div>`);
  }
  function uncertaintyReview(text, index, total, demo) {
    const reply = replyFor(text), editing = acknowledge === `u:${text}` ? "is-ack" : "";
    const state = reply?.verdict === "private" ? "rejected" : reply?.verdict === "irrelevant" ? "rejected" : reply?.verdict ? "context" : "";
    const stateTag = reply?.verdict === "private" ? tag("rejected", "KEPT PRIVATE BY YOU") : reply?.verdict === "irrelevant" ? tag("rejected", "DISMISSED BY YOU") : reply?.verdict ? tag("contested", "EXPLAINED BY YOU") : tag("uncertain");
    const note = { private: "You chose not to tell it. The gap stays a gap, and your reply is not used anywhere.", irrelevant: "You said this does not matter for understanding you.", explained: "Your explanation now stands in for the model's guess in later stages." }[reply?.verdict];
    const choices = [["explained", "Here's the truth"], ["irrelevant", "It doesn't matter"], ["private", "Keep it private"]].map(([value, caption]) => `<button type="button" class="choice" data-v6="review-uncertainty" data-index="${index}" data-value="${value}" aria-pressed="${reply?.verdict === value}">${caption}</button>`).join("");
    return screen("debate", `${head("The model is not sure about this.", { meta: `Uncertainty ${index + 1} of ${total}` })}${demo ? `<p>${tag("demo")}</p>` : ""}
      <div class="split split--debate split--tension"><section class="side side--model ${state ? `is-${state}` : ""} ${editing}">${columnLabel("THE MODEL")}${stateTag}<p class="claim">${esc(text)}</p><p class="hint">Where it lacks information, a model fills the gap with assumptions. This is one of its gaps.</p>${note ? `<p class="revision-note">${note}</p>` : ""}</section>
      <section class="side side--you">${columnLabel("YOU")}<div class="choices" role="group" aria-label="Your answer to this uncertainty">${choices}</div>
      <div class="inline-field"><label for="uncertaintyExplanation">What should it understand instead?</label><textarea id="uncertaintyExplanation" data-index="${index}" maxlength="600" placeholder="Explain, correct or confront it…">${esc(reply?.explanation || "")}</textarea></div></section></div>`);
  }
  window.renderProfile = () => {
    const s = sessionState, profile = s.inferred.profile, demo = s.inferred.mode === "mock";
    if (activeOperations.has("identity")) return profileGenerating();
    if (!profile) return screen("generating", `${head("The model of you couldn't be built this time.", { context: "Your answers are kept exactly as you left them. The conversation continues without it." })}
        ${failed("identity") ? technical("identity", { actions: baseAct("retry-operation", "Try building it again", "btn-tertiary", 'data-operation="identity"') }) : ""}`);
    const page = s.ui.profilePage, n = profile.inferred_information.length;
    if (page === 0) return profileOverview(profile, demo);
    if (page <= n) return inferenceReview(profile.inferred_information[page - 1], page, n, demo);
    const unknowns = unknownsOf(profile);
    return uncertaintyReview(unknowns[page - n - 1], page - n - 1, unknowns.length, demo);
  };
  const columnLabel = text => `<p class="column-label">${text}</p>`;
  function profileOverview(profile, demo) {
    const s = sessionState;
    const supplied = readableAnswers().filter(a => a.id !== "image_context");
    const inferred = profile.inferred_information.map((item, i) => {
      const state = verdictState(s.inferred.participantFeedback.find(f => f.id === item.id));
      return `<li class="reveal-item model-item ${state ? `is-${state}` : ""} confidence-${esc(item.confidence_label)}" style="--i:${i + 2}">${state ? tag(state) : tag("model")}<p>${esc(item.statement)}</p><p class="confidence">${esc(item.confidence_label)} confidence · a label, not a measurement</p></li>`;
    }).join("");
    const unknowns = unknownsOf(profile).map(u => `<li class="reveal-item uncertain-item" style="--i:${profile.inferred_information.length + 2}">${replyFor(u)?.verdict === "explained" ? tag("contested", "EXPLAINED BY YOU") : replyFor(u)?.verdict ? tag("rejected", replyFor(u).verdict === "private" ? "KEPT PRIVATE BY YOU" : "DISMISSED BY YOU") : tag("uncertain")}<p>${esc(u)}</p></li>`).join("");
    return screen("profile", `${head("How I built a version of you.", { context: "A temporary interpretation built from limited answers, not your identity. You can review each part." })}
      ${demo ? `<p>${tag("demo")}</p>` : ""}
      <p class="profile-summary reveal-item" style="--i:0">${esc(profile.profile_summary)}</p>
      <div class="split split--profile"><section class="side side--you">${columnLabel("WHAT YOU SAID")}<ul class="ledger">${supplied.map((a, i) => `<li class="reveal-item you-item" style="--i:${i + 1}"><p>${esc(clip(a.answer, 160))}</p></li>`).join("")}</ul></section>
      <section class="side side--model">${columnLabel("WHAT THE MODEL CONCLUDED")}<ul class="ledger">${inferred}${unknowns}</ul></section></div>`);
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
      <div class="split split--debate"><section class="side side--model ${state ? `is-${state}` : ""} ${ack}">${columnLabel("THE MODEL")}${state ? tag(state) : tag("model")}<p class="claim">${esc(item.statement)}</p><p class="confidence">${esc(item.confidence_label)} confidence</p>${state ? `<p class="revision-note">${{ contested: "Contested. Your correction replaces this reading in later stages.", rejected: "Rejected. This reading is excluded from later stages.", confirmed: "You confirmed this reading." }[state]}</p>` : ""}${evidence(item.evidence_ids, extra, "Why does it think this?", `inference-${item.id}`)}</section>
      <section class="side side--you">${columnLabel("YOU")}<div class="choices" role="group" aria-label="Your verdict">${choices}</div>${correction}${yours}</section></div>`);
  }

  /* ---------- stage 4: the prediction comes first ---------- */
  function maybePredict() {
    const s = sessionState, u = ui();
    if (!s.started || s.ended || s.finished || s.currentStage !== 4 || atCheckpoint() || u.s4 !== "situation") return;
    if (u.s4Pred && (u.s4Pred.status !== "ready" || s.predictionShown)) return;
    // A prediction already made is reused; it is never regenerated once the participant has answered.
    if (s.predictionShown && s.predicted.predictions[0]) { u.s4Pred = { status: s.predicted.predictions[0].predicted_response ? "ready" : "insufficient", startedAt: Date.now() }; return; }
    if (s.predicted.participantAnswers[0]?.text?.trim()) { u.s4Pred = { status: "skipped", startedAt: Date.now() }; return; }
    const p = u.s4Pred = { status: "preparing", startedAt: Date.now(), reason: "" };
    queueMicrotask(() => void predictFlow(p));
  }
  const until = (test, ms) => new Promise(resolve => { const end = Date.now() + ms; const check = () => test() || Date.now() > end ? resolve() : setTimeout(check, 250); check(); });
  async function predictFlow(p) {
    const s = sessionState;
    const live = () => sessionState === s && ui().s4Pred === p && p.status === "preparing";
    if (!mockMode && capabilities?.openai !== false && (!s.inferred.profile || profileStale())) {
      if (activeOperations.has("identity")) await until(() => !activeOperations.has("identity") || !live(), 100000);
      // One bounded attempt to build or refresh the profile; the last valid profile is otherwise kept.
      if ((!s.inferred.profile || profileStale()) && live()) await generateProfile();
    }
    if (!live()) return;
    if (!mockMode && (capabilities?.openai === false || !s.inferred.profile)) { p.status = "unavailable"; p.reason = capabilities?.openai === false ? "config" : "profile"; render(); return; }
    if (!readableAnswers().some(a => /^(question_\d|image_story)/.test(a.id))) { p.status = "insufficient"; p.reason = "no-answers"; render(); return; }
    await generatePrediction();
    if (!live()) return;
    const prediction = s.predicted.predictions[0];
    p.status = prediction?.predicted_response ? "ready" : prediction ? "insufficient" : "unavailable";
    if (!prediction) p.reason = "failed";
    render();
  }
  // The participant's own answer to this situation is never sent: the prediction always comes first.
  window.generatePrediction = async () => {
    const answers = !mockMode && sessionState.inferred.profileAnswers ? sessionState.inferred.profileAnswers : readableAnswers();
    const p = ui().s4Pred;
    let cancel = () => {};
    if (p) p.cancel = () => cancel();
    return runOperation("prediction", async ({ signal }) => {
      const inner = new AbortController();
      signal.addEventListener("abort", () => inner.abort(), { once: true });
      const stopped = new Promise((_, reject) => { cancel = () => { inner.abort(); reject(new OperationFailure("cancelled", "Stopped by the participant.")); }; });
      const work = (async () => {
        const prediction = mockMode
          ? { ...mockPrediction(answers), target_question: predictionTarget, predicted_response: answers.some(a => a.id.startsWith("question_")) ? "Go to the interview. I'll be fine finishing on my own, but could you look over my slides tonight if you get a chance?" : null }
          : (await callApi("/api/predict", { answers, profile: sessionState.inferred.profile, target_question: predictionTarget }, "json", inner.signal)).prediction;
        if (!prediction || prediction.target_question !== predictionTarget) throw new OperationFailure("invalid_response", "The prediction response was invalid.");
        if (ui().s4Pred !== p || p?.status !== "preparing") throw new OperationFailure("cancelled", "No longer needed.");
        sessionState.predicted.predictions = [prediction];
        sessionState.predicted.mode = mockMode ? "mock" : "real";
        sessionState.predictionShown = true;
        return true;
      })();
      return Promise.race([work, stopped]);
    });
  };
  function answerWithoutPrediction() {
    const p = ui().s4Pred;
    if (p) { p.status = "skipped"; p.cancel?.(); }
    travel(() => { ui().s4 = "answer"; render(); });
  }
  function predictionWhy(prediction) {
    const against = (prediction.conflicting_evidence_ids || []).map(answerById).filter(Boolean);
    const extra = `<div class="why__part">${tag("model", "WHAT I INFERRED")}<p>${esc(prediction.uncertainty_statement || "")}</p></div>${against.length ? `<div class="why__part">${tag("conflict", "WHAT POINTS THE OTHER WAY")}<ul class="evidence-list">${against.map(a => `<li><p class="evidence-quote">${esc(a.answer)}</p><p class="source-note">in reply to: ${esc(clip(a.question, 140))}</p></li>`).join("")}</ul></div>` : ""}${prediction.alternative_possible_response ? `<div class="why__part">${tag("uncertain", "ANOTHER POSSIBILITY")}<p>${esc(unquote(prediction.alternative_possible_response))}</p></div>` : ""}`;
    return evidence(prediction.evidence_ids, extra, "Why do you think that?", "why-prediction");
  }
  function situationScreen() {
    const s = sessionState, p = ui().s4Pred, prediction = s.predicted.predictions[0], answered = !!s.predicted.participantAnswers[0]?.text?.trim();
    let model;
    if (!p || p.status === "preparing") model = progress("Preparing a prediction", p?.startedAt || Date.now());
    else if (p.status === "ready" && prediction?.predicted_response) model = `<div class="prediction side side--model">${tag("predicted", "AI PREDICTION")}${s.predicted.mode === "mock" ? tag("demo") : ""}<p class="claim claim--predicted">I think you would tell them: <q>${esc(unquote(prediction.predicted_response))}</q></p><p class="confidence">${esc(prediction.confidence_label)} confidence · a label, not a measurement</p>${predictionWhy(prediction)}</div>`;
    else if (p.status === "skipped") model = calm("You chose to answer without waiting, so there is no prediction for this situation.");
    else if (p.status === "insufficient") model = `${calm("I don't have enough from your answers to predict this one, so I'll just ask you.")}${whatHappened("prediction", { insufficient: true, where: WHERE.prediction[0], what: `Not enough information. ${prediction?.uncertainty_statement || "Your answers don't say enough about situations like this one."}`, did: "Asked you directly instead of guessing.", help: "Nothing is needed from you. This is not a technical problem." })}`;
    else {
      const retry = !answered && (p.reason === "failed" || p.reason === "profile") ? act("retry-prediction", "Try the prediction again", "btn-tertiary") : "";
      const panel = p.reason === "config" ? whatHappened("prediction", { where: WHERE.prediction[0], what: "Service not set up. The AI server has no OpenAI key.", did: WHERE.prediction[1], help: "The researcher needs to add an OpenAI key to the server." })
        : p.reason === "profile" ? technical("identity", { did: "Kept your answers; without a model of you there was nothing to predict from.", actions: retry }) : technical("prediction", { actions: retry });
      model = `${calm("I couldn't prepare a prediction this time, so I'll just ask you.")}${panel}`;
    }
    return screen("predict", `${head(dilemma, { promptKey: "prediction-dilemma", meta: "A new situation" })}${model}`);
  }
  window.renderPrediction = () => {
    const s = sessionState, u = ui(), prediction = s.predicted.predictions[0], actual = s.predicted.participantAnswers[0], comparison = s.predicted.comparisons[0];
    const ready = u.s4Pred?.status === "ready" && prediction?.predicted_response;
    if (u.s4 === "situation") return situationScreen();
    if (u.s4 === "answer") return screen("predict", `${head("What would you actually say?", { promptKey: "prediction-answer", meta: "Your answer" })}
      ${ready ? `<p class="recap-line">${tag("predicted", "I PREDICTED")}<span>${esc(unquote(prediction.predicted_response))}</span></p>` : ""}
      <details class="evidence quiet" data-keep="s4-situation"><summary>The situation</summary><div class="evidence-body"><p>${esc(dilemma)}</p></div></details>
      ${workspace(voiceColumn("prediction-answer", actual?.audio), wordsColumn({ id: "actualAnswer", text: actual?.text, origin: actual?.textOrigin, audio: actual?.audio, placeholder: "What would you say to them?" }))}`);
    const choices = ["Both", "Decision only", "Reason only", "Neither"].map(v => `<button type="button" class="choice" data-action="rate-prediction" data-value="${v}" aria-pressed="${comparison?.rating === v}">${v}</button>`).join("");
    return screen("predict", `${head("Did I get your decision right, your reason right, both, or neither?", { meta: "Prediction and reality", promptKey: "prediction-compare" })}
      <div class="split split--compare"><section class="side side--model">${columnLabel("I PREDICTED")}${s.predicted.mode === "mock" ? tag("demo") : ""}<p class="claim">${esc(unquote(prediction?.predicted_response || ""))}</p></section>
      <section class="side side--you">${columnLabel("YOU SAID")}${tag(actual?.textOrigin === "transcribed" ? "heard" : "you")}<p class="you-claim">${esc(actual?.text || "")}</p></section></div>
      <div class="verdict"><div class="choices" role="group" aria-label="What did the prediction get right">${choices}</div><div class="inline-field"><label for="predictionCorrection">What did I miss? (optional)</label><textarea id="predictionCorrection" placeholder="In your own words…">${esc(comparison?.explanation || "")}</textarea></div><p class="hint">A different answer isn't a contradiction. People answer new situations differently.</p></div>`);
  };

  /* ---------- threshold: the message, then three permission screens ---------- */
  function samples() {
    return [["story", "Your image story"], ...sessionState.supplied.answers.map((a, i) => [a.id, `Your answer to situation ${i + 1}`]), ["prediction-answer", "Your answer in Stage 4"], ["clone-sample", "A new voice sample"]].filter(([id]) => recordingFor(id)?.blob);
  }
  // Every answer recording is transcribed as soon as it stops; recording is the consent, disclosed on the button.
  const transcribable = target => target === "story" || target === "prediction-answer" || /^question_/.test(target) || String(target).startsWith("extra:");
  window.setRecording = (target, recording) => {
    if (recording && transcribable(target)) sessionState.consent.transcription = true;
    base.setRecording(target, recording);
    if (target === "clone-sample" && recording) sessionState.ui.selectedVoiceTarget = target;
    // script.js auto-transcribes question and prediction answers; the image story also needed a confirm step.
    if (recording && target === "story") { sessionState.audioConfirmed = true; setTimeout(() => void transcribeCurrent("story"), 0); }
  };
  function messageScreen() {
    return screen("permission", `<div class="permission">${head(proxyContext, { meta: "A message arrives", promptKey: "proxy-message" })}
      <div class="message-card"><p class="column-label">THEY MESSAGE YOU</p><p class="message-card__text">${esc(proxyMessage)}</p></div>
      <p class="screen-context">Your double will answer this message for you.</p></div>`);
  }
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
    if (!u.messageSeen) return messageScreen();
    if (u.consentPage === 0) return permission(0, "May it reply as you?", "Your answers, corrections and the temporary profile.", "OpenAI writes the reply to this message in the first person, as if it were you. It will be labelled as generated and may be wrong.", "",
      "", c.proxyResponse ? "Currently allowed." : "");
    if (u.consentPage === 1) {
      const options = samples();
      if (!sessionState.ui.selectedVoiceTarget && options.length) sessionState.ui.selectedVoiceTarget = options[0][0];
      const sample = bestVoiceRecording(), active = recorder && recordTarget === "clone-sample";
      const picker = options.length ? `<div class="field"><label for="voiceSample">Which recording should it learn from?</label><select id="voiceSample">${options.map(([id, label]) => `<option value="${id}" ${sessionState.ui.selectedVoiceTarget === id ? "selected" : ""}>${label}</option>`).join("")}</select><audio controls src="${sample?.url || ""}" aria-label="Play the selected voice sample"></audio></div>` : '<p class="hint">No recording yet. Record a few sentences in your own voice.</p>';
      const recorderUi = active ? `<div class="rec-live"><span class="rec-dot" aria-hidden="true"></span><output id="recordClock">00:00</output><span class="rec-limit">/ 01:00</span><canvas class="rec-wave" id="recWave" width="240" height="40" aria-hidden="true"></canvas></div>${row(baseAct("stop-recording", "Stop recording", "btn-primary"))}`
        : row(baseAct("start-recording", options.length ? "Record a new sample" : "Record a voice sample", "btn-secondary", busy ? "disabled" : ""));
      const unavailable = capabilities?.elevenlabs === false ? calm("Voice cloning is not set up on this server, so your double will reply in text.") : "";
      return permission(1, "Your words, in your voice?", "One recording of your own voice that you choose here.", "ElevenLabs creates a temporary clone so the double's reply is spoken in your voice. Deletion of the clone is requested afterwards; provider retention may still apply.",
        `<div class="permission-tools">${picker}<div class="field">${recorderUi}${deviceNotice("microphone")}</div></div>${unavailable}`,
        "", c.voiceCloning ? "Currently allowed." : "");
    }
    const portrait = sessionState.supplied.portrait, reviewing = portrait && !u.retakingPortrait;
    const frame = reviewing ? `<div class="portrait-frame"><figure class="portrait-frame">${tag("you", "YOUR PORTRAIT")}<img src="${portrait.url}" alt="Your captured portrait"><figcaption>${u.portraitConfirmed ? "Confirmed as the face of your double." : "Not used until you confirm it."}</figcaption></figure>${row(act("retake-portrait", "Retake", "btn-secondary"))}</div>`
      : `<div class="portrait-frame portrait-frame--live"><div id="portraitCameraSlot"></div>${cameraStream ? row(act("take-portrait", "Take photo", "btn-primary")) : row(act("camera-switch", "Turn on camera", "btn-secondary"))}<p class="hint">Look into the camera, face lit from the front. Your Stage 1 image is not reused.</p></div>`;
    const blocked = !c.voiceCloning ? calm("Animation needs your cloned voice. You chose not to clone it, so the double will reply in text with no face.")
      : capabilities?.did === false ? calm("Animation is not set up on this server, so the double will use your voice without a moving face.") : "";
    return permission(2, "Give the double a face?", "A portrait you take and confirm here, plus the cloned audio. Never live video.", "D-ID animates the portrait so it appears to speak the double's reply. Deletion is requested afterwards; provider retention may still apply.",
      blocked || `<div class="permission-tools permission-tools--portrait">${frame}${deviceNotice("camera")}</div>`,
      "", c.faceAnimation ? "Currently allowed." : "");
  }

  /* ---------- stage 5: the double replies, then you judge it sentence by sentence ---------- */
  const mediaKeys = ["proxy", "elevenlabs", "did"];
  const loadingMedia = () => mediaKeys.find(k => activeOperations.has(k));
  function maybeStartDouble() {
    const s = sessionState, u = ui();
    if (!s.started || s.ended || s.finished || s.currentStage !== 5 || atCheckpoint() || !s.consent.proxyResponse) return;
    if (s.generated.proxyResponses.length || u.s5 || activeOperations.has("proxy")) return;
    const flow = u.s5 = { startedAt: Date.now(), retried: false, choice: "", done: false };
    queueMicrotask(() => void doubleFlow(flow));
  }
  async function doubleFlow(flow) {
    const s = sessionState, current = () => sessionState === s && ui().s5 === flow;
    await generateProxy();
    // One bounded background retry of the words only, never of paid voice or animation.
    if (current() && !s.generated.proxyResponses.length && !flow.retried && !mockMode && capabilities?.openai !== false) { flow.retried = true; await generateProxy(); }
    if (!current()) return;
    flow.done = true; render();
  }
  window.generateProxyMedia = async () => {
    if (mockMode) { sessionState.generated.proxyMedia.error = "demo"; render(); return; }
    if (sessionState.consent.faceAnimation && !ui().portraitConfirmed) sessionState.consent.faceAnimation = false;
    return base.generateProxyMedia();
  };
  function doubleNote() {
    const s = sessionState, flow = ui().s5, media = s.generated.proxyMedia, item = s.generated.proxyResponses[0], ops = s.operations;
    const broke = k => failed(k) || ops[k]?.state === "fallback" && ops[k].errorCode !== "cancelled" && ops[k].errorCode !== "skipped";
    if (!item && flow?.deleted) return { text: "You deleted your double's reply. Nothing of it is kept." };
    if (!item) return !loadingMedia() && flow?.done ? { text: "Your double couldn't find words this time, so this part continues without a reply.", panel: capabilities?.openai === false ? whatHappened("proxy", { where: WHERE.proxy[0], what: "Service not set up. The AI server has no OpenAI key.", did: "Moved on without a reply.", help: "The researcher needs to add an OpenAI key to the server." }) : technical("proxy") } : null;
    if (flow?.choice === "text") return { text: "You chose not to wait for the voice, so your double replies in text." };
    if (flow?.choice === "audio") return { text: "You chose not to wait for the animation, so your double continues with audio and a still image." };
    if (s.generated.proxyMode === "mock" && s.consent.voiceCloning) return { text: "In this demonstration nothing is sent to a voice or animation service, so your double replies in text." };
    if (s.consent.voiceCloning && !media.audio && broke("elevenlabs")) return { text: "Your voice couldn't be created this time, so your double replies in text.", panel: technical("elevenlabs") };
    if (s.consent.faceAnimation && media.audio && !media.video && broke("did")) return { text: "The animation couldn't finish, so your double will continue with audio and a still image.", panel: technical("did") };
    return null;
  }
  function doubleMedia() {
    const media = sessionState.generated.proxyMedia, portrait = sessionState.supplied.portrait, loadingDid = activeOperations.has("did");
    if (media.video) return `<div class="double-frame is-present"><video class="double-video" controls playsinline preload="metadata" src="${media.video.url}" aria-label="Your talking double"></video></div>`;
    const still = portrait && sessionState.consent.faceAnimation ? `<img src="${portrait.url}" alt="Your still portrait; it is not animated">` : `<span class="double-frame__ghost" aria-hidden="true"></span>`;
    return `<div class="double-frame ${loadingDid ? "is-forming" : ""}">${still}</div>${media.audio ? `<audio controls preload="metadata" src="${media.audio.url}" aria-label="The double's reply in your cloned voice"></audio>` : ""}`;
  }
  function mediaTruth() {
    const media = sessionState.generated.proxyMedia;
    return media.video ? "Talking portrait with your cloned voice" : media.audio ? (sessionState.consent.faceAnimation ? "Your cloned voice; the face is not animated" : "Your cloned voice, no face") : "Text only; no voice or animation";
  }
  const progressLabel = { proxy: "Writing your double's reply", elevenlabs: "Creating your double's voice", did: "Animating your double" };
  function sentencesOf(item) {
    if (!item.sentences) item.sentences = (ProxyText.clean(item.text).match(/[^.!?]+[.!?]+["”’']?|[^.!?]+$/g) || [item.text]).map(text => ({ text: text.trim(), mark: "", edit: "" })).filter(x => x.text);
    return item.sentences;
  }
  function reviewScreen(item) {
    const s = sessionState, editing = s.ui.correctingProxy, state = item.feedback === "corrected" ? "contested" : item.feedback === "rejected" ? "rejected" : item.feedback === "accepted" ? "confirmed" : "";
    const sentences = sentencesOf(item).map((x, i) => {
      const editingThis = ui().editingSentence === i;
      return `<li class="sentence ${x.mark ? `is-${x.mark}` : ""}"><p class="sentence__text">${x.edit ? `<del>${esc(x.text)}</del> <ins>${esc(x.edit)}</ins>` : esc(x.text)}</p>
        <div class="choices choices--small" role="group" aria-label="Sentence ${i + 1}"><button type="button" class="choice" data-v6="mark-sentence" data-index="${i}" data-value="mine" aria-pressed="${x.mark === "mine"}">Could be me</button><button type="button" class="choice" data-v6="mark-sentence" data-index="${i}" data-value="never" aria-pressed="${x.mark === "never"}">I'd never say this</button>${act("edit-sentence", x.edit ? "Change my version" : "Say it my way", "btn-tertiary", `data-index="${i}"`)}</div>
        ${editingThis ? `<div class="inline-field"><label for="sentenceEdit">How would you say it?</label><textarea id="sentenceEdit" rows="2" maxlength="400">${esc(x.edit || x.text)}</textarea>${row(act("save-sentence", "Keep my version", "btn-secondary", `data-index="${i}"`), act("cancel-sentence", "Cancel", "btn-tertiary"))}</div>` : ""}</li>`;
    }).join("");
    const choices = [["review-proxy", "Accept it", "accepted"], ["correct-proxy", "Correct it", "corrected"], ["reject-proxy", "Reject it", "rejected"]].map(([action, caption, value]) => `<button type="button" class="choice" data-action="${action}" aria-pressed="${editing ? value === "corrected" : item.feedback === value}">${caption}</button>`).join("");
    return screen("review", `${head("Which part could have come from you—and which part would you never say?", { meta: "Your judgement", promptKey: "proxy-review" })}
      <div class="review-wrap ${state ? `is-${state}` : ""} ${acknowledge === "proxy" ? "is-ack" : ""}">${tag("double", "GENERATED ON YOUR BEHALF · AI DOUBLE")}${s.generated.proxyMode === "mock" ? tag("demo") : ""}
        <ol class="sentence-list">${sentences}</ol></div>
      <section class="overall"><p class="column-label">OVERALL · NO EXPLANATION NEEDED</p><div class="choices" role="group" aria-label="Your judgement of the whole reply">${choices}</div>
        ${editing ? `<div class="inline-field"><label for="proxyCorrection">What would you actually reply?</label><textarea id="proxyCorrection">${esc(item.correction || "")}</textarea>${row(baseAct("save-proxy-correction", "Keep my correction", "btn-secondary"), baseAct("cancel-proxy-correction", "Cancel", "btn-tertiary"))}</div>`
          : item.feedback === "corrected" && item.correction ? `<div class="you-statement">${tag("you", "WHAT YOU WOULD REPLY")}<p>${esc(item.correction)}</p></div>` : ""}
        ${state ? `<p class="revision-note">${{ contested: "Your words now stand beside the double's.", rejected: "Rejected. It is not treated as something you would say.", confirmed: "Accepted as something you might say." }[state]}</p>` : ""}
        ${row(baseAct("delete-proxy", "Delete this reply", "btn-tertiary danger"))}</section>`);
  }
  window.renderProxy = () => {
    if (atCheckpoint()) return checkpoint();
    const s = sessionState, u = ui(), item = s.generated.proxyResponses[0], flow = u.s5;
    if (!s.consent.proxyResponse) return screen("double", `${head("The double stays silent.", { context: "You chose not to let the system reply as you. Nothing was generated." })}${row(act("permissions", "Review permissions", "btn-tertiary"))}`);
    if (item && u.proxyView === "review") return reviewScreen(item);
    const loading = loadingMedia(), note = doubleNote(), media = s.generated.proxyMedia;
    const standard = item && !media.audio && !loading && "speechSynthesis" in window ? `${act("standard-voice", "Play in a standard voice (not yours)", "btn-tertiary")}<p class="hint">A standard computer voice from your browser, not a clone of yours.</p>` : "";
    const reply = item ? `<div class="double-reply">${tag("double", "GENERATED ON YOUR BEHALF · AI DOUBLE")}${s.generated.proxyMode === "mock" ? tag("demo") : ""}<p class="double-speech">${esc(ProxyText.clean(item.text))}</p><p class="hint">An AI interpretation of you, not your real reply.</p>${evidence(item.evidence_ids, `<p>${esc(item.confidence_label)} confidence. This interpretation may be wrong.</p>`, "What did it draw on?", "proxy-evidence")}</div>` : "";
    return screen("double", `${head(item ? "Your double has replied for you." : flow?.done ? "Your double has no reply this time." : "Your double is replying for you.", { meta: "Generated on your behalf" })}
      <div class="split split--double"><section class="double-stage" aria-label="Your digital double">${doubleMedia()}<p class="media-truth">${item ? mediaTruth() : "Not yet generated"}</p></section>
      <section class="double-script"><div class="message-card message-card--small"><p class="column-label">THEY MESSAGED YOU</p><p class="message-card__text">${esc(proxyMessage)}</p></div>
        ${reply}${loading && flow ? progress(progressLabel[loading], flow.startedAt) : ""}${note ? calm(note.text) + (note.panel || "") : ""}${standard}
        ${row(act("permissions", "Review permissions", "btn-tertiary"))}</section></div>`);
  };
  function continueWith(kind) {
    const flow = ui().s5;
    if (flow) flow.choice = kind;
    cancelActiveOperations(kind === "text" ? "You chose to continue with text." : "You chose to continue with audio.");
    render();
  }

  /* ---------- stage 6: a situation you never gave, and a version of you for it ---------- */
  function simInput() {
    const answers = readableAnswers();
    const actual = sessionState.predicted.participantAnswers[0]?.text;
    if (actual?.trim()) answers.push({ id: "actual_prediction_answer", question: predictionTarget, answer: actual });
    const proxy = sessionState.generated.proxyResponses[0];
    if (proxy?.feedback === "corrected" && proxy.correction?.trim()) answers.push({ id: "proxy_correction", question: `How I would actually reply to: "${proxyMessage}"`, answer: proxy.correction.trim() });
    return { scenario: "overlooked-helper", answers: answers.slice(0, 20), context: { profile: sessionState.inferred.profile, profile_feedback: sessionState.inferred.participantFeedback, contradiction_feedback: sessionState.inferred.contradictionFeedback }, discussed_questions: [...questions, dilemma, proxyQuestion], seen_scenarios: [] };
  }
  function revision() { const value = simInput(); delete value.seen_scenarios; return JSON.stringify(value); }
  function maybeStartScene() {
    const s = sessionState, u = ui();
    if (!s.started || s.ended || s.finished || s.currentStage !== 6 || s.generated.simulation || activeOperations.has("fiction") || u.s6) return;
    s.consent.fictionalGeneration = true;
    u.s6 = { startedAt: Date.now(), fallback: false };
    u.simulationStep = "intro";
    queueMicrotask(() => void generateFiction());
  }
  function simEvidence(item) {
    const context = sessionState.generated.simulationContext || core.evidenceContext(simInput());
    const rows = item.evidence.map(e => {
      const src = context.sources.find(r => r.id === e.source_id);
      return `<li>${tag(e.type === "inferred" ? "model" : "you")}<p class="evidence-quote">${esc(src?.text || "This source is no longer eligible.")}</p><p class="source-note">${esc(clip(src?.label || e.source, 140))}</p><p>${tag("generated", "HOW IT WAS USED")} ${esc(e.interpretation)}</p></li>`;
    }).join("");
    const conflicts = item.contradictory_evidence.map(c => `<li>${tag("conflict")}<p>${esc(c.description)}</p>${c.participant_explanation ? `<p>${tag("you", "YOUR EXPLANATION")} ${esc(c.participant_explanation)}</p>` : ""}</li>`).join("");
    return `<ul class="evidence-list">${rows}${conflicts}</ul><p>${tag("uncertain")} ${esc(item.confidence)} confidence. ${esc(item.uncertainty_statement)}</p><p>${tag("generated", "ANOTHER POSSIBLE ACTION")} ${esc(item.alternative_action)}</p><p>${tag("uncertain", "UNKNOWN")} ${item.unknowns.map(esc).join(" ") || "The actual outcome is unknown."}</p>`;
  }
  // Presentation only: the saved structured result becomes one passage, in the order a moment unfolds.
  function narrative(item) {
    const words = item.predicted_dialogue ? `<p>You might say, <q>${esc(unquote(item.predicted_dialogue))}</q></p>` : "";
    return `<p class="narrative__context">${esc(item.scenario)}</p><p class="narrative__inner">${esc(item.predicted_thought)}</p>${words}<p>${esc(item.predicted_decision)}</p><p>${esc(item.predicted_action)}</p><p>${esc(item.predicted_consequence)}</p><p class="narrative__uncertain">${esc(item.uncertainty_statement)}</p>`;
  }
  const simLabel = () => ui().simulationMode === "mock" ? tag("generated", "FICTIONAL SCENE · PREPARED DEMONSTRATION, NOT AI") : tag("generated", "FICTIONAL AI-GENERATED SCENE");
  const simWarning = () => `<p class="hypothetical-warning"><strong>This never happened.</strong> It is a possible situation the AI produced from its interpretation of you. It is not a memory, and it is never used as evidence about you.</p>`;
  function finalScreen() {
    const f = sessionState.feedback;
    const choices = ["Yes", "Partly", "No", "Unsure"].map(v => `<button type="button" class="choice" data-action="feedback-choice" data-field="feelsLikeYou" data-value="${v}" aria-pressed="${f.feelsLikeYou === v}">${v}</button>`).join("");
    const wrong = ["Partly", "No"].includes(f.feelsLikeYou) ? `<fieldset class="wrong-parts"><legend>What did this version of you get wrong? (optional)</legend><div class="choices" role="group">${wrongParts.map(p => `<button type="button" class="choice" data-v6="wrong-part" data-value="${p}" aria-pressed="${(f.wrongParts || []).includes(p)}">${p}</button>`).join("")}</div></fieldset>
      <div class="inline-field"><label for="finalExplanation">If you want, say more.</label><textarea id="finalExplanation" maxlength="1200" placeholder="Optional">${esc(f.finalExplanation || "")}</textarea></div>` : "";
    return screen("final", `${head("Does this still feel like you?", { promptKey: "final-question", meta: "The last question" })}
      <p class="hint">${simLabel()} The scene before this was generated, not remembered.</p><div class="choices choices--large" role="group" aria-label="Does this still feel like you">${choices}</div>${wrong}`);
  }
  window.renderFiction = () => {
    const s = sessionState, u = ui(), item = s.generated.simulation;
    if (u.simulationStep === "final") return finalScreen();
    if (item && u.simulationRevision !== revision()) return screen("deep", `${head("This scene is out of date.", { context: "Your answers or reviews changed after it was written, so it no longer reflects what you told me." })}${simLabel()}${row(act("delete-simulation", "Write it again from my current answers", "btn-secondary"))}`);
    if (!item || u.simulationStep === "intro") {
      const writing = !item && (activeOperations.has("fiction") || !u.s6 || !u.s6.done);
      const note = u.s6?.fallback ? `${calm("The live scene couldn't be written, so here is a prepared demonstration scene. It does not come from an AI reading of your answers.")}${technical("fiction")}` : "";
      return screen("deep", `${head(s6Intro, { promptKey: "s6-intro", meta: "A situation you never described" })}<p>${simLabel()}</p>
        ${writing ? progress("Writing a fictional scene", u.s6?.startedAt || Date.now()) : note}`);
    }
    return screen("narrative", `<div class="narrative-wrap">${simLabel()}<p class="screen-id"><span class="screen-id__num">06</span>${esc(stages[5][0])}<span class="screen-id__meta">${esc(item.scenario_title)}</span></p>
      <h2 class="narrative-title">One possible version of you.</h2><article class="narrative">${narrative(item)}</article>${simWarning()}
      <details class="evidence" data-keep="scene-evidence"><summary>Why do you think that?</summary><div class="evidence-body">${simEvidence(item)}</div></details>
      ${row(act("delete-simulation", "Delete this scene", "btn-tertiary danger"))}</div>`);
  };
  window.generateFiction = async function generateSimulation(forceMock = false) {
    const s = sessionState, u = ui();
    s.consent.fictionalGeneration = true;
    const input = simInput(), rev = revision(), ticket = generation;
    const flow = u.s6 ||= { startedAt: Date.now(), fallback: false };
    let mode = forceMock || mockMode ? "mock" : "real", result = null;
    if (mode === "real" && capabilities?.openai !== false) result = await runOperation("fiction", async ({ signal }) => {
      const simulation = (await callApi("/api/simulation", input, "json", signal)).simulation;
      const errors = core.validate(simulation, core.evidenceContext(input), core.candidates(input));
      if (errors.length) throw new OperationFailure("invalid_response", "The scene did not pass its evidence checks.");
      return simulation;
    });
    if (ticket !== generation || s !== sessionState || rev !== revision()) return;
    if (!result) {
      // Never presented as personalised: the demonstration scene is labelled wherever it appears.
      if (mode === "real") { flow.fallback = true; if (capabilities?.openai === false) setOperationState("fiction", "error", { errorCode: "missing_api_key" }); }
      result = core.mock(input); mode = "mock";
    }
    s.generated.simulation = result;
    s.generated.simulationContext = core.evidenceContext(input);
    u.simulationMode = mode; u.simulationRevision = rev; u.simulationFeedback = {};
    flow.done = true;
    s.ui.fictionAnswered = false;
    render();
  };

  /* ---------- ending: the participant's verdict, then optional feedback ---------- */
  function feedbackPayload() {
    const fb = ui().feedback;
    return { submission_id: fb.id, version: BUILD, answers: { ...fb.answers, ...(fb.boundary ? { boundary_stage: fb.boundary } : {}) }, comments: { unclear_label: fb.comments.unclear_label || "", comment: fb.comments.comment || "" } };
  }
  const feedbackHasContent = () => { const fb = ui().feedback; return Object.keys(fb.answers).length > 0 || !!fb.boundary || Object.values(fb.comments).some(v => v?.trim()); };
  async function sendFeedback() {
    const fb = ui().feedback, session = sessionState;
    if (fb.state === "sending" || fb.state === "sent" || !feedbackHasContent()) return;
    fb.id ||= globalThis.crypto?.randomUUID?.() || `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    if (appConfig.serverless) { fb.state = "unavailable"; render(); return; }
    fb.state = "sending"; fb.error = ""; render();
    const result = await converse("feedback", "/api/feedback", feedbackPayload());
    if (session !== sessionState) return;
    // Success is shown only once the server confirms the record was stored.
    if (result?.stored === true) fb.state = "sent";
    else { if (result) invalidResult("feedback"); fb.state = "failed"; fb.error = sessionState.operations.feedback?.errorCode || "service_error"; }
    render();
  }
  function downloadFeedback() {
    const fb = ui().feedback;
    fb.id ||= globalThis.crypto?.randomUUID?.() || `fb-${Date.now().toString(36)}`;
    const blob = new Blob([JSON.stringify(feedbackPayload(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `another-me-feedback-${BUILD}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }
  window.renderDevelopmentStatus = () => {
    const f = sessionState.feedback, fb = ui().feedback;
    const verdict = f.feelsLikeYou ? (f.feelsLikeYou === "Unsure" ? "You are still deciding." : `You said: ${esc(f.feelsLikeYou.toLowerCase())}.`) : "Only you can decide.";
    const locked = fb.state === "sending" || fb.state === "sent";
    const questionsMarkup = FEEDBACK_QUESTIONS.map(([id, q]) => `<fieldset class="feedback-row"><legend>${q}</legend><div class="choices" role="group" aria-label="${esc(q)}">${["Yes", "Partly", "No"].map(v => `<button type="button" class="choice" data-v6="feedback-answer" data-q="${id}" data-value="${v}" aria-pressed="${fb.answers[id] === v}" ${locked ? "disabled" : ""}>${v}</button>`).join("")}</div></fieldset>`).join("");
    const stateLine = {
      sending: '<p class="calm-note" role="status">Sending…</p>',
      sent: '<p class="feedback-sent" role="status">Feedback sent—thank you.</p>',
      failed: `<div class="feedback-failed" role="alert"><p>Your feedback couldn't be sent. Everything you chose is still here.</p>${technical("feedback", { code: fb.error })}</div>`,
      unavailable: '<p class="calm-note" role="status">This online demonstration has nowhere to send feedback. You can download a copy and give it to the researcher.</p>'
    }[fb.state] || "";
    const buttons = fb.state === "sent" ? "" : row(act("send-feedback", fb.state === "sending" ? "Sending…" : fb.state === "failed" ? "Try sending again" : "Send feedback", "btn-secondary", fb.state === "sending" || !feedbackHasContent() || appConfig.serverless ? "disabled" : ""),
      ["failed", "unavailable"].includes(fb.state) || appConfig.serverless ? act("download-feedback", "Download a copy", "btn-tertiary") : "");
    return screen("ending", `<div class="ending"><p class="opening__kicker">THE EXPERIMENT ENDS HERE</p><h2 class="opening__title">${verdict}</h2>
      <p class="opening__lede">What you supplied, what was inferred and what was invented have stayed separate. Your judgement is not an error to be corrected.</p>
      ${row(baseAct("view-data", "See what the system held", "btn-secondary"), baseAct("delete-session", "Delete this session", "btn-secondary danger"))}
      <details class="evidence feedback-panel" data-keep="feedback"><summary>Share optional feedback</summary><div class="evidence-body feedback-form">
      ${questionsMarkup}
      <div class="field"><label for="fbBoundary">At which stage did the AI's version stop feeling like you?</label><select id="fbBoundary" ${locked ? "disabled" : ""}><option value="">Optional: choose a stage</option>${[...stages.map(st => st[0]), "It never felt like me", "It still feels like me", "I am unsure"].map(v => `<option value="${esc(v)}" ${fb.boundary === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div class="field"><label for="fbUnclear">Was any label unclear?</label><textarea id="fbUnclear" rows="2" maxlength="2000" ${locked ? "readonly" : ""}>${esc(fb.comments.unclear_label || "")}</textarea></div>
      <div class="field"><label for="fbComment">Anything else? (optional)</label><textarea id="fbComment" rows="2" maxlength="2000" ${locked ? "readonly" : ""}>${esc(fb.comments.comment || "")}</textarea></div>
      ${stateLine}${buttons}
      <p class="hint">Only these answers, your comments and the prototype version are stored. Never your image, voice, answers from the experience or the model of you.</p></div></details></div>`);
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
  window.invalidateAnalysis = () => {
    base.invalidateAnalysis();
    // Anything built from the old answers is out of date; it is rebuilt when next needed.
    const u = ui();
    u.simulationRevision = ""; u.s4Pred = null; u.s4 = "situation"; u.s5 = null; u.s6 = null;
  };
  window.clearMedia = () => { room.setRecordingStream(null); base.clearMedia(); };
  window.dataItem = (label, value, key, media = "") => {
    const type = key.startsWith("inference:") ? "inferred" : key.startsWith("prediction:") ? "predicted" : key.startsWith("proxy") ? "proxy" : key.startsWith("fiction:") ? "invented"
      : key === "transcript" && sessionState.supplied.transcriptOrigin === "transcribed" ? "transcribed" : "supplied";
    return source(type) + `<div class="data-item"><strong>${esc(label)}</strong>${media}<p>${esc(value)}</p><button type="button" class="btn-tertiary danger" data-action="delete-item" data-key="${esc(key)}">Delete this item</button></div>`;
  };
  function conversationData() {
    const c = conv(), rows = [], del = key => row(act("delete-conv", "Delete this item", "btn-tertiary danger", `data-key="${key}"`));
    if (c.image?.status === "done") rows.push(`${source("inferred", "AI READING OF YOUR IMAGE")}<div class="data-item"><p>${esc(c.image.reading.observation)} ${esc(c.image.reading.interpretation)}</p>${del("image")}</div>`);
    if (sessionState.supplied.imageDescription?.trim()) rows.push(`${source("supplied", "YOUR DESCRIPTION OF AN IMAGE")}<div class="data-item"><p>${esc(sessionState.supplied.imageDescription)}</p>${del("description")}</div>`);
    for (const [key, m] of Object.entries(c.moments)) if (m.followUp) rows.push(`${source("inferred", "FOLLOW-UP QUESTION")}<div class="data-item"><strong>${esc(m.followUp.question)}</strong>${m.followUp.text?.trim() ? `${source("supplied", "YOUR ANSWER")}<p>${esc(m.followUp.text)}</p>` : '<p class="small">Not answered.</p>'}${del(`follow:${key}`)}</div>`);
    for (const [key, sp] of Object.entries(c.speculations)) rows.push(`${source("inferred", "SPECULATIVE INTERPRETATION")}<div class="data-item"><p>${esc(sp.claim)}</p>${sp.reaction ? `${source("supplied", "YOUR REACTION")}<p>${esc({ fits: "That fits", partly: "Partly, but you've stretched it", isnt: "That isn't me" }[sp.reaction])}${sp.explanation ? ` · ${esc(sp.explanation)}` : ""}</p>` : ""}${del(`speculation:${key}`)}</div>`);
    if (c.tension) rows.push(`${source("inferred", "POSSIBLE TENSION")}<div class="data-item"><p>${esc(c.tension.tension)}</p>${c.tension.choice ? `${source("supplied", "YOUR VIEW")}<p>${esc(tensionChoices.find(([v]) => v === c.tension.choice)?.[1] || "Continued without explaining")}${c.tension.explanation ? ` · ${esc(c.tension.explanation)}` : ""}</p>` : ""}${del("tension")}</div>`);
    return rows.length ? `<section class="data-section"><h3>The conversation</h3>${rows.join("")}</section>` : "";
  }
  window.renderData = () => {
    base.renderData();
    dataContent.insertAdjacentHTML("afterbegin", conversationData());
    const replies = uncertaintyReplies();
    if (replies.length) dataContent.insertAdjacentHTML("beforeend", `<section class="data-section"><h3>Your answers to the model's uncertainties</h3>${replies.map((r, i) => `${source("supplied", r.verdict === "private" ? "KEPT PRIVATE" : r.verdict === "irrelevant" ? "DISMISSED" : "EXPLAINED")}<div class="data-item"><strong>${esc(r.text)}</strong><p>${esc(r.explanation || "(no explanation)")}</p>${row(act("delete-uncertainty", "Delete this item", "btn-tertiary danger", `data-index="${i}"`))}</div>`).join("")}</section>`);
    if (sessionState.supplied.cloneSample) dataContent.insertAdjacentHTML("beforeend", `<section class="data-section"><h3>Voice sample for cloning</h3>${source("supplied", "CLONING SAMPLE")}<audio controls src="${sessionState.supplied.cloneSample.url}"></audio>${row(act("delete-clone-sample", "Delete voice sample", "btn-tertiary danger"))}</section>`);
    const item = sessionState.generated.simulation;
    if (item) dataContent.insertAdjacentHTML("beforeend", `<section class="data-section"><h3>Fictional scene</h3>${source("invented", "FICTIONAL · NEVER EVIDENCE")}<p>${core.warning}</p>${ui().simulationRevision !== revision() ? '<p class="warning">Historical: your information changed after this was generated.</p>' : ""}<div class="narrative narrative--small">${narrative(item)}</div>${row(act("delete-simulation", "Delete this scene", "btn-tertiary danger"))}</section>`);
  };
  function deleteConversationItem(key) {
    const c = conv();
    if (key === "image" && c.image) { c.image.status = "skipped"; c.image.reading = null; }
    else if (key === "description") sessionState.supplied.imageDescription = "";
    else if (key.startsWith("follow:")) { const k = key.slice(7), m = c.moments[k]; if (m) { setRecording(`extra:${k}-followup`, null); m.followUp = null; if (m.status === "following") m.status = "asking"; } }
    else if (key.startsWith("speculation:")) { const k = key.slice(12); delete c.speculations[k]; if (c.moments[k]?.reply?.move === "interpret") c.moments[k].reply = null; }
    else if (key === "tension") { c.tension = null; if (["tension", "tension-ask"].includes(c.s3)) c.s3 = "closing"; }
    renderData(); render();
  }

  /* ---------- the single forward action ---------- */
  function momentForward(key, nextLabel, next) {
    const m = moment(key), transcribing = activeOperations.has("transcription");
    if (m.status === "thinking" || m.status === "followThinking") return { label: "Continue without waiting", enabled: true, run: () => { stopWaiting(key); next(); } };
    if (m.status === "following") return { label: "Send", enabled: !!m.followUp.text.trim() && !recorder && !transcribing,
      reason: recorder ? "Stop recording first." : transcribing ? "Turning your recording into words…" : "Answer if you want to, or continue without answering.",
      run: () => sendFollow(key), alt: { label: "Continue without answering", run: () => { m.followUp.declined = true; m.status = "responded"; m.reply = null; m.note = "declined"; next(); } } };
    return { label: nextLabel, enabled: true, run: next };
  }
  function nextQuestion() {
    const s = sessionState;
    if (s.questionIndex < questions.length - 1) return travel(() => { s.questionIndex++; render(); });
    travel(() => { s.questionIndex = questions.length; startReading(); });
  }
  function toStage4() {
    // Not base.move: the model of you may still be building, and Stage 4 waits for it.
    travel(() => { sessionState.currentStage = 4; ui().s4 ||= "situation"; render(); }, 1, markerFor(4));
  }
  function forward() {
    const s = sessionState, u = ui(), c = u.conv, stage = s.currentStage;
    if (!s.started || s.ended || s.finished) return null;
    if (atCheckpoint()) {
      const cs = s.consent;
      if (!u.messageSeen) return { label: "Continue", enabled: true, run: () => travel(() => { u.messageSeen = true; u.consentPage = 0; render(); }) };
      if (u.consentPage === 0) return { label: "Allow and continue", enabled: true, run: () => { cs.proxyResponse = true; travel(() => { u.consentPage = 1; render(); }); }, alt: { label: "Don't let it reply for me", run: skipDouble } };
      if (u.consentPage === 1) {
        if (capabilities?.elevenlabs === false) return { label: "Continue with text only", enabled: true, run: () => finishConsent(true) };
        return { label: "Allow voice cloning", enabled: !!bestVoiceRecording() && !recorder, reason: recorder ? "Stop recording first." : "Record or choose a voice sample first.", run: () => { cs.voiceCloning = true; travel(() => { u.consentPage = 2; render(); }); }, alt: { label: "Use text only", run: () => finishConsent(true) } };
      }
      if (!cs.voiceCloning || capabilities?.did === false) return { label: "Meet your double", enabled: true, run: () => { setFace(false); finishConsent(); } };
      const noFace = { label: "Continue without a face", run: () => { setFace(false); finishConsent(); } };
      if (!s.supplied.portrait || u.retakingPortrait) return { label: "Allow animation", enabled: false, reason: "Take your portrait first, or continue without a face.", alt: noFace };
      if (!u.portraitConfirmed) return { label: "Use this portrait", enabled: true, run: () => { u.portraitConfirmed = true; acknowledge = ""; render(); }, alt: noFace };
      return { label: "Allow animation and meet your double", enabled: true, run: () => { cs.faceAnimation = true; finishConsent(); }, alt: noFace };
    }
    if (stage === 1) {
      if (u.describing) return { label: "Continue", enabled: !!s.supplied.imageDescription?.trim(), reason: "Describe the image in a few words, or skip this step.", run: () => move("continue") };
      if (!s.supplied.image) return { label: "Continue", enabled: false, reason: cameraStream ? "Take the photo, or choose a file instead." : "Choose an image, describe one, or skip this step." };
      if (!s.photoConfirmed) return { label: "Use this image", enabled: true, run: () => { s.photoConfirmed = true; room.react("confirm"); travel(() => render()); } };
      if (c.image?.status === "reading") return { label: "Continue without waiting", enabled: true, run: () => { c.image.status = "skipped"; move("continue"); } };
      return { label: "Continue", enabled: true, run: () => move("continue") };
    }
    if (stage === 2) {
      const m = moment("story");
      if (m.status !== "asking") return momentForward("story", "Continue", () => move("continue"));
      if (s.supplied.audio && !s.audioConfirmed) return { label: "Use this recording", enabled: !recorder, reason: "Stop recording first.", run: confirmStory };
      const transcribing = activeOperations.has("transcription"), text = s.supplied.transcript.trim();
      if (!text && s.audioConfirmed && !transcribing && !recorder) return { label: "Continue", enabled: true, run: () => move("continue") };
      return { label: "Send", enabled: !!text && !recorder && !transcribing, reason: recorder ? "Stop recording first." : transcribing ? "Turning your recording into words…" : "Speak or write a few words, or skip.", run: () => send("story") };
    }
    if (stage === 3) {
      if (s.questionIndex < questions.length) {
        const a = s.supplied.answers[s.questionIndex], m = moment(a.id);
        const nextLabel = s.questionIndex === questions.length - 1 ? "Continue" : "Next situation";
        if (m.status !== "asking") return momentForward(a.id, nextLabel, nextQuestion);
        const transcribing = activeOperations.has("transcription");
        return { label: "Send", enabled: !!a.text.trim() && !recorder && !transcribing,
          reason: recorder ? "Stop recording first." : transcribing ? "Turning your recording into words…" : a.audio ? "Type your answer, or skip this situation." : "Answer by voice or text, or skip this situation.",
          run: () => send(a.id) };
      }
      if (c.detour) {
        const p = s.inferred.profile, count = profileReviewCount(p), page = s.ui.profilePage;
        if (s.ui.correctingInferenceId) return { label: "Keep correction and continue", enabled: true, run: () => { saveInferenceCorrection(); nextProfilePage(); } };
        if (p && page < count - 1) return { label: page === 0 ? "Review each part" : "Next", enabled: true, run: nextProfilePage };
        return { label: "Back to the conversation", enabled: true, run: () => travel(() => { c.detour = false; render(); }, -1) };
      }
      if (c.s3 === "reading") return { label: "Continue without waiting", enabled: true, run: () => { if (c.synthesis) c.synthesis.status = "skipped"; travel(() => { c.s3 = "closing"; render(); }); } };
      if (c.s3 === "tension") return { label: "Continue", enabled: true, run: () => travel(() => { c.s3 = "tension-ask"; render(); }) };
      if (c.s3 === "tension-ask") return { label: "Continue to Stage 4", enabled: !!c.tension?.choice, reason: "Choose one, or continue without explaining.", run: toStage4,
        alt: c.tension?.choice ? null : { label: "Continue without explaining", run: () => { c.tension.choice = "skip"; toStage4(); } } };
      return { label: "Continue to Stage 4", enabled: true, run: toStage4 };
    }
    if (stage === 4) {
      const p = u.s4Pred, ready = p?.status === "ready" && s.predicted.predictions[0]?.predicted_response;
      if (u.s4 === "situation") {
        if (!p || p.status === "preparing") return { label: "Preparing a prediction…", enabled: false, reason: "", alt: { label: "Answer without a prediction", run: answerWithoutPrediction } };
        return { label: ready ? "What would you actually say?" : "Answer it", enabled: true, run: () => travel(() => { u.s4 = "answer"; render(); }) };
      }
      if (u.s4 === "answer") {
        const transcribing = activeOperations.has("transcription");
        return { label: "Send", enabled: !!s.predicted.participantAnswers[0]?.text?.trim() && !recorder && !transcribing,
          reason: recorder ? "Stop recording first." : transcribing ? "Turning your recording into words…" : "Give your answer by voice or text, or skip.",
          run: () => { room.react("answer"); if (ready) travel(() => { u.s4 = "compare"; s.ui.predictionCompared = true; render(); }); else enterCheckpoint(); } };
      }
      return { label: "Continue", enabled: true, run: enterCheckpoint };
    }
    if (stage === 5) {
      const item = s.generated.proxyResponses[0], flow = u.s5, loading = loadingMedia();
      if (!s.consent.proxyResponse) return { label: "Continue to Stage 6", enabled: true, run: () => move("skip") };
      if (item && u.proxyView === "review") {
        if (s.ui.correctingProxy) return { label: "Keep correction", enabled: true, run: saveProxyCorrection };
        return { label: "Continue to Stage 6", enabled: true, run: () => move("continue") };
      }
      if (!item) return loading || (flow && !flow.done) ? { label: "Your double is writing…", enabled: false, reason: "" } : { label: "Continue to Stage 6", enabled: true, run: () => move("continue") };
      // Long waits offer a way on at once; the stable footer keeps the same controls in the same place.
      const waited = loading ? Date.now() - (s.operations[loading]?.updatedAt || Date.now()) : 0;
      if (loading === "elevenlabs") return { label: "Waiting for the voice…", enabled: false, reason: "", alt: waited > 8000 ? { label: "Continue with text", run: () => continueWith("text") } : null };
      if (loading === "did") return { label: "Waiting for the animation…", enabled: false, reason: "", alt: waited > 8000 ? { label: "Continue with audio", run: () => continueWith("audio") } : null };
      return { label: "Which part could have come from you?", enabled: true, run: () => travel(() => { u.proxyView = "review"; render(); }) };
    }
    const item = s.generated.simulation;
    if (u.simulationStep === "final") return { label: "Finish", enabled: !!s.feedback.feelsLikeYou, reason: "Choose an answer first, or finish without this.", run: () => move("continue") };
    if (!item) return { label: "Writing…", enabled: false, reason: "" };
    if (u.simulationRevision !== revision()) return { label: "Write it again", enabled: !busy, run: () => { s.generated.simulation = null; u.s6 = null; render(); } };
    if (u.simulationStep === "intro") return { label: "Show me", enabled: true, run: () => travel(() => { u.simulationStep = "scene"; room.react("reveal"); render(); }) };
    return { label: "Does this still feel like you?", enabled: true, run: () => travel(() => { u.simulationStep = "final"; render(); }) };
  }
  let currentForward = null;
  function syncForward() {
    const f = forward();
    currentForward = f;
    forwardButton.hidden = !f;
    forwardHint.classList.remove("is-error");
    if (!f) { forwardHint.textContent = ""; forwardAlt.hidden = true; return; }
    const enabled = f.enabled && !transitioning;
    if (forwardButton.textContent !== f.label) forwardButton.textContent = f.label;
    forwardButton.disabled = !enabled;
    forwardButton.setAttribute("aria-disabled", String(!enabled));
    forwardHint.textContent = !f.enabled && f.reason ? f.reason : "";
    forwardAlt.hidden = !f.alt;
    if (f.alt) { if (forwardAlt.textContent !== f.alt.label) forwardAlt.textContent = f.alt.label; forwardAlt.disabled = transitioning || !!recorder; }
  }
  function skipLabel() {
    const s = sessionState, stage = s.currentStage;
    if (atCheckpoint()) return "Skip Stage 5";
    return ({ 1: "Continue without an image", 2: "Skip this step", 3: s.questionIndex < questions.length ? "Skip this situation" : "Skip to Stage 4", 4: "Skip this stage", 5: "Skip to Stage 6", 6: "Finish without this" })[stage] || "Skip";
  }
  // A second click on a selected choice takes it back; written explanations are kept as drafts.
  function undoChoice(button) {
    const s = sessionState, u = ui(), old = button.dataset.action, v6 = button.dataset.v6;
    if (old === "review-inference") {
      if (s.ui.correctingInferenceId === button.dataset.id) s.ui.correctingInferenceId = "";
      else s.inferred.participantFeedback = s.inferred.participantFeedback.filter(f => f.id !== button.dataset.id);
    } else if (old === "rate-prediction") s.predicted.comparisons = [{ rating: "", explanation: s.predicted.comparisons[0]?.explanation || "" }];
    else if (["review-proxy", "reject-proxy", "correct-proxy"].includes(old)) {
      if (old === "correct-proxy" && s.ui.correctingProxy) s.ui.correctingProxy = false;
      else s.generated.proxyResponses[0].feedback = "";
    } else if (v6 === "review-uncertainty") { const reply = replyFor(unknownsOf(s.inferred.profile)[Number(button.dataset.index)]); if (reply) reply.verdict = ""; }
    else if (v6 === "react") { const sp = u.conv.speculations[button.dataset.key]; if (sp) sp.reaction = ""; }
    else if (v6 === "tension-choice") { if (u.conv.tension) u.conv.tension.choice = ""; }
    else if (v6 === "mark-sentence") { const x = s.generated.proxyResponses[0]?.sentences?.[Number(button.dataset.index)]; if (x) x.mark = ""; }
    else if (v6 === "feedback-answer") { if (!["sending", "sent"].includes(u.feedback.state)) delete u.feedback.answers[button.dataset.q]; }
    else if (v6 === "wrong-part") s.feedback.wrongParts = (s.feedback.wrongParts || []).filter(p => p !== button.dataset.value);
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
    if (!s.generated.proxyResponses.length) u.s5 = null;
    travel(() => { u.checkpoint = false; u.proxyView = "response"; render(); }, 1, markerFor(5));
  }
  function enterCheckpoint() {
    travel(() => { if (busy) cancelActiveOperations(); sessionState.currentStage = 5; Object.assign(ui(), { checkpoint: true, consentPage: 0, messageSeen: false }); render(); }, 1, { num: "05", title: "THRESHOLD" });
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
  // Going back inside a conversational moment: from a response or a follow-up to your answer.
  function backWithinMoment(key) {
    const m = moment(key);
    if (m.status === "asking") return false;
    if (m.status === "thinking" || m.status === "followThinking") m.ticket++;
    travel(() => { m.status = m.status === "responded" && m.followUp && !m.followUp.declined ? "following" : m.status === "followThinking" ? "following" : "asking"; render(); }, -1);
    return true;
  }
  window.move = direction => {
    const s = sessionState, u = ui(), c = u.conv;
    if (s.ended || transitioning) return;
    if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
    if (!s.started) { if (direction === "continue") begin(); return; }
    if (s.finished) { if (direction === "back") travel(() => base.move("back"), -1, markerFor(6)); return; }
    const stage = s.currentStage;
    if (atCheckpoint()) {
      if (direction === "skip") return skipDouble();
      if (direction === "back") {
        const leaving = !u.messageSeen;
        return travel(() => { if (u.consentPage > 0) u.consentPage--; else if (u.messageSeen) u.messageSeen = false; else { u.checkpoint = false; s.currentStage = 4; } render(); }, -1, leaving ? markerFor(4) : null);
      }
      return;
    }
    if (direction === "back") {
      if (stage === 1 && u.describing) return travel(() => { u.describing = false; render(); }, -1);
      if (stage === 2 && backWithinMoment("story")) return;
      if (stage === 3) {
        if (s.questionIndex < questions.length) {
          if (backWithinMoment(`question_${s.questionIndex + 1}`)) return;
          if (s.questionIndex > 0) return travel(() => { s.questionIndex--; render(); }, -1);
          return travel(() => { s.currentStage = 2; render(); }, -1, markerFor(2));
        }
        if (c.detour) return travel(() => { if (s.ui.profilePage > 0) s.ui.profilePage--; else c.detour = false; render(); }, -1);
        if (c.s3 === "tension-ask") return travel(() => { c.s3 = "tension"; render(); }, -1);
        if (c.s3 === "reading" && c.synthesis) c.synthesis.status = "skipped";
        return travel(() => { s.questionIndex = questions.length - 1; render(); }, -1);
      }
      if (stage === 4) {
        if (u.s4 === "compare") return travel(() => { u.s4 = "answer"; s.ui.predictionCompared = false; render(); }, -1);
        if (u.s4 === "answer") return travel(() => { u.s4 = "situation"; render(); }, -1);
        return travel(() => { s.currentStage = 3; s.questionIndex = questions.length; render(); }, -1, markerFor(3));
      }
      if (stage === 5 && u.proxyView === "review") return travel(() => { u.proxyView = "response"; render(); }, -1);
      if (stage === 5) return travel(() => { if (busy) cancelActiveOperations(); u.checkpoint = true; u.messageSeen = true; u.consentPage = 2; render(); }, -1, { num: "05", title: "THRESHOLD" });
      if (stage === 6) {
        const steps = ["intro", "scene", "final"], index = steps.indexOf(u.simulationStep);
        if (index > 0 && s.generated.simulation) return travel(() => { u.simulationStep = steps[index - 1]; render(); }, -1);
        return travel(() => { s.currentStage = 5; u.proxyView = s.generated.proxyResponses.length ? "review" : "response"; render(); }, -1, markerFor(5));
      }
    }
    if (direction === "skip") {
      if (stage === 2 && ["thinking", "followThinking"].includes(moment("story").status)) stopWaiting("story");
      if (stage === 3 && s.questionIndex < questions.length) { const key = `question_${s.questionIndex + 1}`; if (moment(key).status !== "asking") stopWaiting(key); return nextQuestion(); }
      if (stage === 3) return toStage4();
      if (stage === 4) { if (u.s4Pred?.status === "preparing") { u.s4Pred.status = "skipped"; u.s4Pred.cancel?.(); } return enterCheckpoint(); }
    }
    if (stage === 1 && direction !== "back" && c.image?.status === "reading") c.image.status = "skipped";
    if (stage === 4 && direction !== "back") return enterCheckpoint();
    const changesStage = direction === "back" ? stage > 1 : stage < 6;
    const blocked = direction === "continue" && (stage === 1 && s.supplied.image && !s.photoConfirmed || stage === 2 && s.supplied.audio && !s.audioConfirmed);
    if (blocked) return base.move(direction);
    travel(() => base.move(direction), direction === "back" ? -1 : 1, changesStage ? markerFor(stage + (direction === "back" ? -1 : 1)) : null);
  };
  function begin() {
    music.unlock();
    travel(() => { sessionState.started = true; sessionState.currentStage = 1; render(); }, 1, markerFor(1));
  }

  /* ---------- render wrapper ---------- */
  function screenKey() {
    const s = sessionState, u = ui(), c = u.conv, key = s.currentStage === 2 ? "story" : `question_${s.questionIndex + 1}`;
    return [s.started, s.ended, s.finished, s.currentStage, s.questionIndex, s.ui.profilePage, s.predictionShown, u.checkpoint, u.messageSeen, u.consentPage, u.simulationStep, u.proxyView, u.s4, u.s4Pred?.status, u.describing,
      c.image?.status, c.moments[key]?.status, c.s3, c.detour, !!s.generated.proxyResponses.length, !!s.generated.simulation, !!s.inferred.profile].join("|");
  }
  // Re-rendering replaces nodes; return keyboard focus to the equivalent control.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !stageElement.contains(el)) return null;
    if (el.id) return { selector: `#${CSS.escape(el.id)}`, start: el.selectionStart, end: el.selectionEnd };
    if (el.tagName === "SUMMARY") { const keep = el.parentElement?.dataset?.keep; return keep ? { selector: `details[data-keep="${CSS.escape(keep)}"] > summary` } : null; }
    const keys = ["action", "v6", "verdict", "value", "id", "operation", "q", "key", "index"].filter(k => el.dataset?.[k]).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join("");
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
      if (pos === 4.5) { s.currentStage = 5; Object.assign(u, { checkpoint: true, consentPage: 0, messageSeen: false }); }
      else {
        u.checkpoint = false; s.currentStage = pos;
        if (pos === 3) { s.questionIndex = u.conv.synthesis ? questions.length : 0; s.ui.profilePage = 0; u.conv.detour = false; if (u.conv.s3 === "reading") u.conv.s3 = "closing"; }
        // Stage 5 opens on the double only once its permissions were answered; otherwise on the threshold.
        if (pos === 5) { if (s.consent.proxyResponse || s.generated.proxyResponses.length) u.proxyView = "response"; else Object.assign(u, { checkpoint: true, consentPage: 0, messageSeen: false }); }
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
    stageElement.querySelectorAll("textarea[id]").forEach(f => { if (["inferenceCorrection", "proxyCorrection", "sentenceEdit"].includes(f.id)) drafts.set(f.id, f.value); });
    if (stageElement.contains(presenceDock)) dockHome.append(presenceDock);
    const oldCapture = document.getElementById("cameraVideo");
    if (oldCapture) { oldCapture.pause(); oldCapture.srcObject = null; oldCapture.load(); }
    base.render();
    if (s.ended) stageElement.innerHTML = pausedScreen();
    restoreMedia(media);
    stageElement.querySelectorAll("details[data-keep]").forEach(d => { if (keptOpen.has(d.dataset.keep)) d.open = true; });
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
    backButton.disabled = s.ended || !s.started || (!s.finished && s.currentStage === 1 && !atCheckpoint() && !u.describing);
    skipButton.textContent = skipLabel();
    skipButton.disabled = s.ended || s.finished || !s.started || (s.currentStage === 6 && !!s.feedback.feelsLikeYou);
    document.getElementById("recordingIndicator").hidden = !recorder;
    room.setScene(s.started && !s.finished ? s.currentStage : s.finished ? 6 : 0,
      s.currentStage === 4 ? u.s4Pred?.status === "ready" : s.currentStage === 5 && !u.checkpoint && !!s.generated.proxyResponses.length, atCheckpoint());
    room.setRecordingStream(recorder ? micStream : null);
    music.setActive(s.started && !s.ended && !s.finished);
    music.duck("recording", !!recorder);
    for (const [id, value] of drafts) { const f = document.getElementById(id); if (f && !f.value) f.value = value; }
    if (focusAfterRender) { const f = document.getElementById(focusAfterRender); focusAfterRender = ""; f?.focus({ preventScroll: false }); }
    else if (focus) { const f = stageElement.querySelector(focus.selector); if (f) { f.focus({ preventScroll: true }); try { if (focus.start != null) f.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } } }
    if (cameraStream) { const v = document.getElementById("cameraVideo"); if (v && v.srcObject !== cameraStream) { v.srcObject = cameraStream; v.play().catch(() => {}); } }
    acknowledge = "";
    // Each stage starts its own work as soon as it is on screen; nothing waits for a button press.
    maybeReadImage(); maybePredict(); maybeStartDouble(); maybeStartScene();
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
    document.querySelectorAll(".elapsed[data-since]").forEach(el => { el.textContent = since(Number(el.dataset.since)); });
    // Long-wait choices appear without re-rendering the screen being read.
    if (sessionState.currentStage === 5 && loadingMedia() && !transitioning) syncForward();
  }, 1000);

  /* ---------- events ---------- */
  function storedAccessCode() { try { return sessionStorage.getItem("another-me-access") || ""; } catch { return ""; } }
  document.addEventListener("toggle", event => {
    const d = event.target;
    if (d?.matches?.("details[data-keep]")) d.open ? keptOpen.add(d.dataset.keep) : keptOpen.delete(d.dataset.keep);
  }, true);
  document.addEventListener("input", event => {
    const s = sessionState, u = ui(), c = u.conv, id = event.target.id;
    if (id === "accessCode") { try { sessionStorage.setItem("another-me-access", event.target.value.trim()); } catch { /* kept for this page only */ } }
    if (id === "imageDescription") s.supplied.imageDescription = event.target.value;
    if (id === "followText") {
      const key = s.currentStage === 2 ? "story" : `question_${s.questionIndex + 1}`, m = c.moments[key];
      if (m?.followUp) { m.followUp.text = event.target.value; m.followUp.origin = "typed"; }
    }
    if (id === "reactionExplanation") { const sp = c.speculations[event.target.dataset.key]; if (sp) sp.explanation = event.target.value; }
    if (id === "tensionExplanation" && c.tension) c.tension.explanation = event.target.value;
    if (id === "fbUnclear") u.feedback.comments.unclear_label = event.target.value;
    if (id === "fbComment") u.feedback.comments.comment = event.target.value;
    if (["fbUnclear", "fbComment"].includes(id)) { const send = stageElement.querySelector('[data-v6="send-feedback"]'); if (send && u.feedback.state !== "sending") send.disabled = !feedbackHasContent() || appConfig.serverless; }
    if (["inferenceCorrection", "proxyCorrection", "sentenceEdit"].includes(id)) drafts.set(id, event.target.value);
    if (id === "uncertaintyExplanation" && s.inferred.profile) {
      const text = unknownsOf(s.inferred.profile)[Number(event.target.dataset.index)];
      if (text) {
        let reply = replyFor(text);
        if (!reply) { reply = { text, verdict: "", explanation: "" }; uncertaintyReplies().push(reply); }
        reply.explanation = event.target.value;
        if (!reply.verdict && event.target.value.trim()) reply.verdict = "explained";
        u.simulationRevision = "";
      }
    }
    syncForward();
  });
  document.addEventListener("change", event => {
    if (event.target.id === "voiceSample") { sessionState.ui.selectedVoiceTarget = event.target.value; clearProxyMedia(); render(); }
    if (event.target.id === "fbBoundary") { ui().feedback.boundary = event.target.value; render(); }
  });
  document.addEventListener("click", async event => {
    const button = event.target.closest("button,[data-action],summary");
    if (!button) return;
    const s = sessionState, u = ui(), c = u.conv, action = button.dataset.v6, old = button.dataset.action;
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
        if (!s.started || sessionState !== s) { drafts.clear(); revealedPrompts.clear(); keptOpen.clear(); lastScreenKey = ""; room.reset(); render(); }
      }
      return;
    }
    if (old === "allow-transcription" && s.currentStage === 2 && s.supplied.audio) s.audioConfirmed = true;
    if (button.classList.contains("choice") && button.getAttribute("aria-pressed") === "true") {
      event.preventDefault(); event.stopImmediatePropagation(); undoChoice(button); render(); return;
    }
    if (old === "review-inference" && button.dataset.verdict !== "corrected") s.ui.correctingInferenceId = "";
    if (["review-proxy", "reject-proxy"].includes(old)) s.ui.correctingProxy = false;
    if (old === "review-inference") { acknowledge = button.dataset.id; if (button.dataset.verdict === "corrected") focusAfterRender = "inferenceCorrection"; else room.react("revise"); }
    if (old === "save-inference-correction") { event.stopImmediatePropagation(); acknowledge = s.ui.correctingInferenceId; const before = document.getElementById("inferenceCorrection")?.value?.trim(); if (!before) return status("Write your correction first, or cancel.", "error"); saveInferenceCorrection(); render(); return; }
    if (old === "cancel-inference-correction") drafts.delete("inferenceCorrection");
    if (["review-proxy", "reject-proxy"].includes(old)) { acknowledge = "proxy"; room.react(old === "reject-proxy" ? "reject" : "revise"); }
    if (old === "correct-proxy") focusAfterRender = "proxyCorrection";
    if (old === "save-proxy-correction") { event.stopImmediatePropagation(); return saveProxyCorrection(); }
    if (old === "cancel-proxy-correction") drafts.delete("proxyCorrection");
    if (old === "delete-proxy") { u.proxyView = "response"; u.s5 = { startedAt: Date.now(), retried: true, choice: "", done: true, deleted: true }; }
    if (old === "confirm-image") room.react("confirm");
    if (old === "resume") queueMicrotask(() => { lastScreenKey = ""; });
    if (old === "retake" || old === "delete-image") c.image = null;
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
    if (action === "describe-image") { if (cameraStream) { stopCamera(); s.consent.cameraPresence = false; } u.describing = true; focusAfterRender = "imageDescription"; return travel(() => render()); }
    if (action === "stop-describing") return travel(() => { u.describing = false; render(); }, -1);
    if (action === "permissions") { if (busy) cancelActiveOperations(); return travel(() => { u.checkpoint = true; u.messageSeen = true; u.consentPage = 0; render(); }, -1, { num: "05", title: "THRESHOLD" }); }
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
    if (action === "react") {
      const sp = c.speculations[button.dataset.key];
      if (!sp) return;
      sp.reaction = button.dataset.value; acknowledge = `sp:${button.dataset.key}`; u.simulationRevision = "";
      room.react(sp.reaction === "isnt" ? "reject" : "revise");
      focusAfterRender = "reactionExplanation"; render(); return;
    }
    if (action === "tension-choice") { if (c.tension) { c.tension.choice = button.dataset.value; focusAfterRender = "tensionExplanation"; } render(); return; }
    if (action === "detour") { if (!s.inferred.profile && !activeOperations.has("identity") && readableAnswers().some(a => a.id.startsWith("question_"))) void generateProfile(); return travel(() => { c.detour = true; s.ui.profilePage = 0; render(); }); }
    if (action === "retry-prediction") { if (s.predicted.participantAnswers[0]?.text?.trim()) return; u.s4Pred = null; render(); return; }
    if (action === "standard-voice") {
      const item = s.generated.proxyResponses[0];
      if (!item || !("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const speech = new SpeechSynthesisUtterance(ProxyText.clean(item.text));
      speech.onend = speech.onerror = () => music.duck("voice", false);
      music.duck("voice", true); s.consent.standardAudio = true; speechSynthesis.speak(speech); return;
    }
    if (action === "mark-sentence") { const x = sentencesOf(s.generated.proxyResponses[0])[Number(button.dataset.index)]; if (x) x.mark = button.dataset.value; room.react(x?.mark === "never" ? "reject" : "revise"); render(); return; }
    if (action === "edit-sentence") { u.editingSentence = Number(button.dataset.index); drafts.delete("sentenceEdit"); focusAfterRender = "sentenceEdit"; render(); return; }
    if (action === "save-sentence") {
      const x = sentencesOf(s.generated.proxyResponses[0])[Number(button.dataset.index)], value = document.getElementById("sentenceEdit")?.value?.trim();
      if (x) x.edit = value && value !== x.text ? value : "";
      u.editingSentence = null; drafts.delete("sentenceEdit"); acknowledge = "proxy"; render(); return;
    }
    if (action === "cancel-sentence") { u.editingSentence = null; drafts.delete("sentenceEdit"); render(); return; }
    if (action === "wrong-part") { const list = s.feedback.wrongParts ||= []; if (!list.includes(button.dataset.value)) list.push(button.dataset.value); render(); return; }
    if (action === "feedback-answer") { if (!["sending", "sent"].includes(u.feedback.state)) { u.feedback.answers[button.dataset.q] = button.dataset.value; if (u.feedback.state === "unavailable") u.feedback.state = "idle"; } render(); return; }
    if (action === "send-feedback") return sendFeedback();
    if (action === "download-feedback") return downloadFeedback();
    if (action === "delete-conv") return deleteConversationItem(button.dataset.key);
    if (action === "review-uncertainty") {
      const text = unknownsOf(s.inferred.profile)[Number(button.dataset.index)];
      if (!text) return;
      let reply = replyFor(text);
      if (!reply) { reply = { text, verdict: "", explanation: document.getElementById("uncertaintyExplanation")?.value || "" }; uncertaintyReplies().push(reply); }
      reply.verdict = button.dataset.value; acknowledge = `u:${text}`; room.react(button.dataset.value === "explained" ? "revise" : "reject");
      if (button.dataset.value === "explained") focusAfterRender = "uncertaintyExplanation";
      render(); return;
    }
    if (action === "delete-uncertainty") {
      sessionState.inferred.uncertaintyFeedback = uncertaintyReplies().filter((r, i) => i !== Number(button.dataset.index));
      renderData(); render(); return;
    }
    if (action === "delete-simulation") {
      if (activeOperations.has("fiction")) cancelActiveOperations();
      s.generated.simulation = null; s.generated.simulationContext = null; u.simulationFeedback = {}; u.simulationStep = "intro"; s.ui.fictionAnswered = false;
      // Deleting from the data view keeps it deleted; on the stage it is written again from current answers.
      u.s6 = dialog.open ? { startedAt: Date.now(), done: true, fallback: false } : null;
      room.react("reject"); render(); if (dialog.open) renderData(); return;
    }
    if (action === "delete-clone-sample") { setRecording("clone-sample", null); s.ui.selectedVoiceTarget = ""; renderData(); render(); }
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.getElementById("sessionMenu").open = false;
  });
  let resizeTimer = 0;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!transitioning) render(); }, 150); });
  addEventListener("pagehide", () => { cancelTransition(); room.dispose(); music.setActive(false); });
  if (appConfig.serverless) capabilities = { openai: false, elevenlabs: false, did: false, accessCode: false, demo: true };
  else fetch(apiUrl("/api/capabilities"), { headers: apiHeaders() }).then(r => r.ok ? r.json() : null).then(value => { capabilities = value; render(); }).catch(() => {});

  /* ---------- stale-build protection: an old tab says so instead of silently lagging ---------- */
  const buildNotice = document.getElementById("buildNotice");
  async function checkBuild() {
    try {
      const html = await (await fetch(location.pathname, { cache: "no-store" })).text();
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

  if (developerMode) window.__v6 = { room, ui, conv, state: ui, simInput, forward, render, music, getSession: () => sessionState, build: BUILD };
  room.reduce(room.reduced);
  render();
})();
