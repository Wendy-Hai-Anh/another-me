"use strict";

const stages = [
  ["I SEE YOU", "Curiosity", "Begin with one meaningful image."],
  ["I LISTEN TO YOU", "Delight", "Tell the story the image cannot show."],
  ["I THINK I KNOW YOU", "Recognition", "Three questions, one at a time."],
  ["I CAN PREDICT YOU", "Uncanniness", "See a prediction before giving your own answer."],
  ["I CAN BE YOU", "Discomfort", "Decide whether the system may speak on your behalf."],
  ["I DON’T NEED YOU", "Doubt", "See a clearly fictional memory the system invented."]
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
const stageElement = document.getElementById("stage");
const statusElement = document.getElementById("status");
const dialog = document.getElementById("dataDialog");
const dataContent = document.getElementById("dataContent");
const mockMode = new URLSearchParams(location.search).get("mode") === "mock";
const forcedFailure = new URLSearchParams(location.search).get("fail") || "";

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
    feedback: {}, currentStage: 1, questionIndex: 0, predictionShown: false,
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
function intro() {
  const [title, emotion, description] = stages[sessionState.currentStage - 1];
  return `<p class="stage-kicker">STAGE ${sessionState.currentStage} / 6 · ${emotion.toUpperCase()}</p><h2 class="stage-title">${title}</h2><p>${description}</p><p class="small">${mockMode ? "MOCK MODE — AI interpretations are simulated. Audio is sent to OpenAI only if you explicitly allow transcription." : "REAL MODE — OpenAI requests use server-side credentials; mock fallback is available."}</p>`;
}
function render() {
  document.getElementById("progressName").textContent = `Stage ${sessionState.currentStage} of 6`;
  document.getElementById("progressEmotion").textContent = stages[sessionState.currentStage - 1][1];
  document.getElementById("progressSteps").innerHTML = stages.map((item, index) =>
    `<li class="${index + 1 < sessionState.currentStage ? "done" : index + 1 === sessionState.currentStage ? "current" : ""}" aria-label="Stage ${index + 1}: ${item[0]}">${index + 1}</li>`).join("");
  const stage = sessionState.currentStage;
  stageElement.innerHTML = sessionState.ended
    ? `<h2 class="stage-title">Experience paused</h2><p>Your temporary data is still in memory. Resume or delete the session.</p>${buttons([["resume", "Resume"], ["delete-session", "Delete Session", "danger"]])}`
    : intro() + [renderImage, renderAudio, renderQuestions, renderPrediction, renderProxy, renderFiction][stage - 1]();
  document.querySelector('[data-action="back"]').disabled = stage === 1 || sessionState.ended;
  document.querySelector('[data-action="continue"]').disabled = sessionState.ended || busy || sessionState.finished;
  document.querySelector('[data-action="skip"]').disabled = sessionState.ended || busy || sessionState.finished;
  document.querySelector('[data-action="continue"]').textContent = stage === 6 ? "Finish" : "Continue";
  if (cameraStream) {
    const video = document.getElementById("cameraVideo");
    if (video) { video.srcObject = cameraStream; video.play().catch(() => status("Camera is loading. If it does not start, try again.", "error")); }
  }
  if (recordTimer) updateRecordClock();
}

function renderImage() {
  const image = sessionState.supplied.image;
  return `<div class="notice">Choose one meaningful image. It can show a person, place, object or moment. It is kept only for this session. No personality claims are made from appearance.</div>
    ${image ? `<div class="card">${source("supplied", "IMAGE")}<img class="media" src="${image.url}" alt="Your supplied image"><p class="small">${sessionState.photoConfirmed ? "Image confirmed." : "Review this image, then confirm it."}</p></div>` : ""}
    ${cameraStream ? `<div class="card"><p>Camera starting or ready. The preview is mirrored.</p><video id="cameraVideo" class="media camera" autoplay muted playsinline></video>${buttons([["capture", "Take Photo", "primary"], ["camera-off", "Turn Off Camera"]])}</div>` : ""}
    ${!cameraStream ? `<div class="controls"><label class="file-button">Upload Image <input id="imageInput" type="file" accept="image/*"></label>
      <button type="button" data-action="camera-consent">${sessionState.consent.photoCapture ? "Enable Camera" : "Use Webcam"}</button></div>` : ""}
    ${!sessionState.consent.photoCapture && !cameraStream ? `<div class="disclosure"><p>Camera permission is requested only after you choose to allow it. The photograph stays in browser memory unless you later give separate permission for D-ID facial animation.</p>${buttons([["allow-camera", "Allow Camera Capture"]])}</div>` : ""}
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
  return `<div class="disclosure"><strong>The next content is invented.</strong> The system will create something you never provided. It is fictional and based on incomplete information.
    ${!sessionState.consent.fictionalGeneration ? buttons([["allow-fiction", "Allow Fictional Generation", "primary"]]) : ""}</div>
    ${sessionState.consent.fictionalGeneration && !item ? buttons([["generate-fiction", "Generate Fictional Memory", "primary", busy], ["mock-fiction", "Use Mock Fiction"]]) : ""}
    ${item ? `<article class="output">${source("invented", sessionState.generated.fictionMode === "mock" ? "MOCK" : "")}<p class="warning">FICTIONAL AI-GENERATED CONTENT</p><p>${escapeHtml(item.text)}</p><p>This did not come from your memory or previous answers. The invented detail is not a verified fact.</p>
      <p class="small">Based on fragments from: ${escapeHtml(item.evidence_ids.join(", ") || "limited input")}. Confidence: low. This is fictional, not a prediction of a real memory.</p>
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
  return { text: "This is what I think you would do. I would ask why the decision was made without me, explain what I would have chosen, and decide whether the outcome could still be changed. I might appreciate the intention, but I would want my choices to remain mine. This mock response cannot know my real reaction.",
    evidence_ids: evidence, confidence_label: "low", feedback: "", correction: "" };
}
function mockFiction(answers) {
  const candidates = ["a blue paper ticket tucked in a coat pocket", "a brass key wrapped in yellow thread", "a handwritten receipt from a midnight cafe"];
  const suppliedText = answers.map(item => item.answer.toLowerCase()).join(" ");
  const detail = candidates.find(value => !suppliedText.includes(value.toLowerCase())) || "an invented, unverified detail";
  const fragment = value => value && (value.length > 50 ? `${value.slice(0, 50).replace(/\s+\S*$/, "").trim()}…` : value);
  const story = fragment(answers.find(item => item.id === "image_story")?.answer);
  const question = fragment(answers.find(item => item.id.startsWith("question_"))?.answer);
  const fragments = [story, question].filter(Boolean).map(value => `"${value}"`).join(" and ");
  return { text: `I remember noticing ${detail} before anyone else arrived. ${fragments ? `The scene seemed connected to ${fragments}, although I could not explain why.` : "The place felt familiar even though no real location had been supplied."} I decided to keep the detail to myself and walked away before the light changed. This entire scene is a mock fictional construction, not a real memory.`,
    invented_detail: detail, evidence_ids: answers.map(item => item.id) };
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
}
async function callApi(path, payload, format = "json") {
  const controller = new AbortController();
  inFlight.add(controller);
  try {
    const response = await fetch(path, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": format === "audio" ? payload.type : "application/json" },
      body: format === "audio" ? payload : JSON.stringify(payload)
    }).catch(() => { throw new Error("Cannot reach the integration server. Start it and open http://127.0.0.1:4180/ in the same browser."); });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || (response.status === 404 ? "Transcription route not found. Open the integration server at http://127.0.0.1:4180/ instead of another preview." : `Server returned ${response.status}.`));
    }
    return format === "audio" ? response.text() : response.json();
  } finally { inFlight.delete(controller); }
}
async function callBinaryApi(path, payload, contentType) {
  const controller = new AbortController();
  inFlight.add(controller);
  try {
    const response = await fetch(path, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": contentType }, body: payload
    }).catch(() => { throw new Error("Cannot reach the integration media server at http://127.0.0.1:4180/."); });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Media server returned ${response.status}.`);
    }
    return response.blob();
  } finally { inFlight.delete(controller); }
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
  return text.startsWith(framing) ? text.slice(framing.length) : text;
}
async function operation(message, fn, fallback) {
  if (busy) return;
  busy = true;
  const ticket = generation;
  render(); status(message);
  try {
    const result = await fn();
    if (ticket !== generation) return;
    status("Ready. Review the result before continuing.", "success");
    return result;
  } catch (error) {
    if (ticket !== generation) return;
    status(`${error.message} ${fallback}`, "error");
  } finally {
    if (ticket === generation) { busy = false; render(); }
  }
}
async function generateProfile() {
  const answers = readableAnswers();
  await operation("Building a temporary identity profile...", async () => {
    if (forcedFailure === "openai") throw new Error("Simulated OpenAI analysis failure.");
    const useMock = mockMode || !answers.length;
    const profile = useMock ? mockProfile(answers) : (await callApi("/api/profile", { answers })).profile;
    if (!profile || !Array.isArray(profile.inferred_information) || !Array.isArray(profile.supplied_information)) throw new Error("Invalid profile response.");
    sessionState.inferred.profile = profile;
    sessionState.inferred.mode = useMock ? "mock" : "real";
    sessionState.inferred.participantFeedback = [];
    sessionState.questionIndex = questions.length;
  }, "You can retry or continue with the mock fallback.");
}
async function generatePrediction() {
  const answers = readableAnswers();
  await operation("Preparing a prediction before your answer appears...", async () => {
    if (forcedFailure === "openai") throw new Error("Simulated OpenAI generation failure.");
    const useMock = mockMode || !sessionState.inferred.profile || !answers.length;
    const prediction = useMock
      ? mockPrediction(answers)
      : (await callApi("/api/predict", { answers, profile: sessionState.inferred.profile, target_question: dilemma })).prediction;
    if (!prediction || prediction.target_question !== dilemma) throw new Error("Invalid prediction response.");
    sessionState.predicted.predictions = [prediction];
    sessionState.predicted.mode = useMock ? "mock" : "real";
    sessionState.predictionShown = true;
  }, "Retry or choose the mock prediction.");
}
async function generateProxy() {
  if (!sessionState.consent.proxyResponse) return status("Allow the proxy response first.", "error");
  const answers = readableAnswers();
  const completed = await operation("Creating a response on your behalf...", async () => {
    if (forcedFailure === "openai") throw new Error("Simulated OpenAI generation failure.");
    const useMock = mockMode || !answers.length;
    const result = useMock ? mockProxy(answers)
      : (await callApi("/api/proxy", { answers, question: proxyQuestion, context: identityContext() })).response;
    if (!result?.text?.startsWith("This is what I think you would do. I would")) throw new Error("Invalid first-person proxy response.");
    clearProxyMedia();
    sessionState.generated.proxyResponses = [{ ...result, feedback: "", correction: "" }];
    sessionState.generated.proxyMode = useMock ? "mock" : "real";
    return true;
  }, "Use the mock text fallback.");
  if (completed && sessionState.consent.voiceCloning) await generateProxyMedia();
}
async function generateProxyMedia() {
  const item = sessionState.generated.proxyResponses[0];
  const sample = bestVoiceRecording();
  if (!item) return status("Generate the first-person response before creating media.", "error");
  if (!sessionState.consent.voiceCloning) return status("Allow ElevenLabs voice cloning first.", "error");
  if (!sample) return status("Record a voice answer in Stage 2 or 3 before cloning.", "error");
  await operation("Creating a temporary voice clone and first-person speech...", async () => {
    const media = sessionState.generated.proxyMedia;
    media.error = "";
    if (!media.audio) {
      if (forcedFailure === "elevenlabs") throw new Error("Simulated ElevenLabs failure.");
      const speech = await callBinaryApi(`/api/cloned-speech?text=${encodeURIComponent(proxySpeechText(item.text))}`, sample.blob, sample.type);
      media.audio = { blob: speech, url: URL.createObjectURL(speech), type: "audio/mpeg" };
      media.presentation = "cloned-audio";
    }
    if (sessionState.consent.faceAnimation && sessionState.supplied.image) {
      try {
        if (forcedFailure === "did") throw new Error("Simulated D-ID failure.");
        const image = sessionState.supplied.image.blob;
        const video = await callBinaryApi("/api/talking-avatar", JSON.stringify({
          image_type: image.type || "image/jpeg", image_base64: await blobToBase64(image),
          audio_type: "audio/mpeg", audio_base64: await blobToBase64(media.audio.blob)
        }), "application/json");
        revoke(media.video);
        media.video = { blob: video, url: URL.createObjectURL(video), type: "video/mp4" };
        media.presentation = "talking-avatar";
      } catch (error) {
        media.error = `${error.message} The temporary cloned audio remains available.`;
        throw error;
      }
    }
    return true;
  }, "The response remains available as text, and completed cloned audio is preserved for playback.");
}
async function generateFiction() {
  if (!sessionState.consent.fictionalGeneration) return status("Allow fictional generation first.", "error");
  const answers = readableAnswers();
  await operation("Creating clearly fictional content...", async () => {
    if (forcedFailure === "openai") throw new Error("Simulated OpenAI generation failure.");
    const useMock = mockMode || !answers.length;
    const result = useMock ? mockFiction(answers)
      : (await callApi("/api/fiction", { answers, context: identityContext() })).fiction;
    if (!result?.text?.startsWith("I remember") || !result.invented_detail) throw new Error("Invalid fictional response.");
    sessionState.generated.fictionalContent = [result];
    sessionState.generated.fictionMode = useMock ? "mock" : "real";
  }, "Use the mock fictional fallback.");
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
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) return status("Camera access needs HTTPS or localhost and a supported browser.", "error");
  if (cameraStream || busy) return;
  busy = true; status("Waiting for camera permission and preview...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
    if (sessionState.currentStage !== 1 || sessionState.ended) { stream.getTracks().forEach(track => track.stop()); return; }
    cameraStream = stream; render(); status("Camera ready. Preview is mirrored.", "success");
  } catch (error) {
    status(error.name === "NotAllowedError" ? "Camera permission denied. Upload an image or continue without one."
      : error.name === "NotFoundError" ? "No camera detected. Upload an image or continue without one."
      : error.name === "NotReadableError" ? "Camera is already in use. Close other camera apps and retry."
      : "Camera could not start. Upload an image or continue without one.", "error");
  } finally { busy = false; }
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
  stopCamera(); invalidateAnalysis(); render(); status("Mirrored photograph captured. Confirm or retake it.", "success");
}
function clearImage() {
  revoke(sessionState.supplied.image); sessionState.supplied.image = null;
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
  invalidateAnalysis();
}
async function startRecording() {
  if (recorder || busy) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return status("Microphone recording needs HTTPS or localhost and MediaRecorder support.", "error");
  const target = sessionState.currentStage === 2 ? "story" : sessionState.currentStage === 3 ? sessionState.supplied.answers[sessionState.questionIndex]?.id : null;
  if (!target) return;
  busy = true; status("Waiting for microphone permission...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (sessionState.ended || ![2, 3].includes(sessionState.currentStage)) { stream.getTracks().forEach(track => track.stop()); return; }
    micStream = stream;
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunks = []; recordTarget = target;
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || "" });
      recorder = null; chunks = []; recordTarget = null; stopMicTracks();
      if (blob.size) {
        setRecording(target, { blob, url: URL.createObjectURL(blob), type: blob.type });
        status(target === "story" ? "Recording ready. Listen and confirm it before transcription." : "Voice answer recorded. Transcribing it for the profile...", "success");
      } else status("Recording was empty. Try recording again.", "error");
      render();
      if (blob.size && target !== "story" && sessionState.consent.transcription) void transcribeCurrent(target);
    };
    recorder.onerror = () => { stopRecorder(true); render(); status("Recording failed. Try recording again.", "error"); };
    recorder.start(250); sessionState.consent.audioRecording = true;
    recordStart = Date.now(); recordTimer = setInterval(updateRecordClock, 250); recordLimit = setTimeout(() => stopRecorder(), 60_000);
    render(); status("Recording. Stop when finished; the 60-second limit is automatic.", "success");
  } catch (error) {
    stopMicTracks(); recorder = null;
    status(error.name === "NotAllowedError" ? "Microphone permission denied. Allow it in your browser settings and retry."
      : error.name === "NotFoundError" ? "No microphone found. Connect one and retry."
      : "Microphone unavailable. Check your device and retry.", "error");
  } finally { busy = false; }
}
async function transcribeCurrent(target = sessionState.currentStage === 2 ? "story" : sessionState.supplied.answers[sessionState.questionIndex]?.id) {
  const recording = recordingFor(target);
  if (!sessionState.consent.transcription || !recording?.blob) return status("Confirm transcription permission and record audio first.", "error");
  if (target === "story" && !sessionState.audioConfirmed) return status("Listen to and confirm the recording before transcription.", "error");
  await operation("Transcribing your recording...", async () => {
    if (forcedFailure === "transcription") throw new Error("Simulated transcription failure.");
    const transcript = (await callApi("/api/transcribe", recording.blob, "audio")).trim();
    if (!transcript) throw new Error("No speech was detected.");
    if (target === "story") { sessionState.supplied.transcript = transcript; sessionState.supplied.transcriptOrigin = "transcribed"; }
    else { const answer = sessionState.supplied.answers.find(row => row.id === target); answer.text = transcript; answer.textOrigin = "transcribed"; }
    invalidateAnalysis();
  }, "Your recording is still here. Retry transcription; it has not been counted as skipped.");
}

function move(direction) {
  if (busy || sessionState.ended) return;
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
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
  if (busy) return;
  if (recorder) return status("Stop recording first so your voice answer is saved.", "error");
  const answer = sessionState.supplied.answers[sessionState.questionIndex];
  if (!skip && answer && !answer.text.trim()) return status(answer.audio
    ? "Your voice answer is saved but not transcribed yet. Retry transcription, or explicitly choose Skip Question."
    : "Answer by voice or text, or explicitly choose Skip Question.", "error");
  sessionState.questionIndex += 1;
  if (sessionState.questionIndex >= questions.length) { render(); generateProfile(); }
  else { render(); stageElement.focus(); }
}
function clearMedia() {
  generation += 1;
  inFlight.forEach(controller => controller.abort()); inFlight.clear();
  stopCamera(); stopRecorder(true); stopMicTracks();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  revoke(sessionState.supplied.image); revoke(sessionState.supplied.audio);
  sessionState.supplied.answers.forEach(answer => revoke(answer.audio));
  clearProxyMedia();
}
function stopActiveMedia() {
  generation += 1;
  inFlight.forEach(controller => controller.abort()); inFlight.clear();
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
    ...sessionState.generated.fictionalContent.map((item,index) => dataItem("Fictional content", item.text, `fiction:${index}`))
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
  else if (action === "close-data") dialog.close();
  else if (action === "delete-item") deleteItem(button.dataset.key);
  else if (action === "delete-session") deleteSession();
  else if (action === "end") { stopActiveMedia(); sessionState.ended = true; render(); status("Experience ended. Session data remains until you delete it or close the page."); }
  else if (action === "resume") { sessionState.ended = false; render(); }
  else if (["back","continue","skip"].includes(action)) move(action);
  else if (action === "camera-consent") status("Read the camera disclosure, then choose Allow Camera Capture.");
  else if (action === "allow-camera") { sessionState.consent.photoCapture = true; render(); enableCamera(); }
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
  else if (action === "mock-profile") { sessionState.inferred.profile = mockProfile(readableAnswers()); sessionState.inferred.mode = "mock"; sessionState.questionIndex = questions.length; render(); status("Clearly marked mock profile ready.", "success"); }
  else if (action === "predict") generatePrediction();
  else if (action === "mock-prediction") { sessionState.predicted.predictions = [mockPrediction(readableAnswers())]; sessionState.predicted.mode = "mock"; sessionState.predictionShown = true; render(); status("Mock prediction shown before your answer.", "success"); }
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
  else if (action === "mock-fiction") { sessionState.generated.fictionalContent = [mockFiction(readableAnswers())]; sessionState.generated.fictionMode = "mock"; render(); status("Mock fictional memory ready.", "success"); }
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
