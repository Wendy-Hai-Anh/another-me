"use strict";

const stages = [
  {
    number: 1,
    name: "I SEE YOU",
    emotion: "Curiosity",
    explanation: "Supply one meaningful image or continue without one."
  },
  {
    number: 2,
    name: "I LISTEN TO YOU",
    emotion: "Delight",
    explanation: "Add a short voice response and inspect its editable transcript label."
  },
  {
    number: 3,
    name: "I THINK I KNOW YOU",
    emotion: "Recognition",
    explanation: "Answer gradual dilemmas and review uncertain mock interpretations."
  },
  {
    number: 4,
    name: "I CAN PREDICT YOU",
    emotion: "Uncanniness",
    explanation: "See a prediction before giving your actual answer."
  },
  {
    number: 5,
    name: "I CAN BE YOU",
    emotion: "Discomfort",
    explanation: "Choose whether a temporary representation may answer on your behalf."
  },
  {
    number: 6,
    name: "I DON’T NEED YOU",
    emotion: "Doubt",
    explanation: "Decide whether to reveal a clearly fictional memory you never supplied."
  }
];

const identityQuestions = [
  {
    id: "question_1",
    title: "Question 1",
    text: "When making a difficult decision, what usually matters most to you: your principles, other people or the practical outcome? Why?"
  },
  {
    id: "question_2",
    title: "Question 2",
    text: "A close friend needs your help on the same day as an important personal deadline. What would you do?"
  },
  {
    id: "question_3",
    title: "Question 3",
    text: "What is something people often misunderstand about you?"
  }
];

const sourceTypes = {
  supplied: { icon: "+", label: "SUPPLIED BY YOU" },
  transcribed: { icon: "T", label: "TRANSCRIBED FROM YOUR AUDIO" },
  inferred: { icon: "?", label: "INFERRED BY AI" },
  predicted: { icon: ">", label: "PREDICTED BY AI" },
  proxy: { icon: "\"", label: "GENERATED ON YOUR BEHALF" },
  invented: { icon: "*", label: "GENERATED WITHOUT YOUR INPUT" }
};

const stageContent = document.getElementById("stageContent");
const progressList = document.getElementById("progressList");
const emotionProgress = document.getElementById("emotionProgress");
const globalStatus = document.getElementById("globalStatus");
const stageNavigation = document.getElementById("stageNavigation");
const backButton = document.getElementById("backButton");
const continueButton = document.getElementById("continueButton");
const skipButton = document.getElementById("skipButton");
const viewDataButton = document.getElementById("viewDataButton");
const deleteSessionButton = document.getElementById("deleteSessionButton");
const endExperienceButton = document.getElementById("endExperienceButton");
const dataDialog = document.getElementById("dataDialog");
const dataDialogContent = document.getElementById("dataDialogContent");
const correctionDialog = document.getElementById("correctionDialog");
const correctionForm = document.getElementById("correctionForm");
const correctionText = document.getElementById("correctionText");

let currentStage = 0;
let participantData = createParticipantData();
let aiGeneratedData = createAiData();
let interfaceState = createInterfaceState();
let correctionTarget = null;

let cameraStream = null;
let microphoneStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartedAt = 0;
let recordingTimerId = null;
let recordingLimitId = null;
let microphoneSessionToken = 0;

function createParticipantData() {
  return {
    image: null,
    voiceRecording: null,
    transcript: "",
    answers: Object.fromEntries(identityQuestions.map((question) => [question.id, ""])),
    predictionAnswer: "",
    predictionRating: "",
    stageFiveConsent: "",
    proxyAssessment: "",
    fictionalAssessment: "",
    boundaryPoint: "",
    corrections: [],
    feedback: {
      sourceClarity: "",
      uncertaintyClarity: "",
      gradualFeeling: "",
      dataControl: "",
      unclearLabel: "",
      crossedBoundary: "",
      comment: ""
    }
  };
}

function createAiData() {
  return {
    inferences: [],
    prediction: null,
    proxyResponse: null,
    fictionalMemory: null
  };
}

function createInterfaceState() {
  return {
    cameraActive: false,
    recording: false,
    stageThreeQuestion: 0,
    stageThreeComplete: false,
    stageSixDisclosureAccepted: false,
    showFeedback: false,
    completed: false,
    ended: false,
    skippedStages: []
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncate(value, length = 90) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function renderSourceLabel(type, detail = "", basedOn = [], isMock = false) {
  const source = sourceTypes[type];
  const label = detail || source.label;
  const evidence = basedOn.length
    ? `<p class="based-on"><strong>Based on:</strong> ${escapeHtml(basedOn.join(", "))}.</p>`
    : "";
  const mock = isMock ? '<p class="mock-marker">Mock AI output - no external AI service used</p>' : "";

  return `
    <div class="source-label ${type}">
      <span class="source-icon" aria-hidden="true">${source.icon}</span>
      <span>${escapeHtml(label)}</span>
    </div>
    ${mock}
    ${evidence}
  `;
}

function renderStageHeading(stage) {
  return `
    <header class="stage-heading">
      <p class="stage-number">Stage ${stage.number} of ${stages.length}</p>
      <h2 id="stageTitle" tabindex="-1">${escapeHtml(stage.name)}</h2>
      <p class="stage-explanation">${escapeHtml(stage.explanation)}</p>
    </header>
  `;
}

function setStatus(message, kind = "info") {
  globalStatus.textContent = message;
  globalStatus.dataset.kind = kind;
}

function renderProgress() {
  const stage = stages[currentStage];
  emotionProgress.textContent = `Stage ${stage.number} of 6 - ${stage.emotion}`;
  progressList.innerHTML = stages.map((item, index) => {
    const stateClass = index < currentStage ? "completed" : index === currentStage ? "current" : "";
    const state = index < currentStage ? "completed" : index === currentStage ? "current" : "not reached";
    return `<li class="${stateClass}" title="Stage ${item.number}: ${escapeHtml(item.name)} - ${item.emotion}" aria-label="Stage ${item.number}, ${escapeHtml(item.name)}, ${state}"></li>`;
  }).join("");
}

function renderApp(options = {}) {
  renderProgress();

  if (interfaceState.ended) {
    stageContent.innerHTML = `
      <section>
        <p class="stage-number">Experience paused</p>
        <h2 id="stageTitle" tabindex="-1">The experience has ended</h2>
        <p>No camera or microphone tracks are active. Temporary session data remains available until you delete the session or close the page.</p>
        <div class="controls">
          <button type="button" data-action="resume-experience" class="primary-button">Resume Experience</button>
          <button type="button" data-action="delete-session" class="danger-button">Delete Session</button>
        </div>
      </section>
    `;
    stageNavigation.hidden = true;
  } else {
    stageNavigation.hidden = false;
    const renderers = [renderStageOne, renderStageTwo, renderStageThree, renderStageFour, renderStageFive, renderStageSix];
    stageContent.innerHTML = renderers[currentStage]();
    configureNavigation();
  }

  if (options.focusHeading) {
    document.getElementById("stageTitle")?.focus();
  }
}

function configureNavigation() {
  backButton.disabled = currentStage === 0 && !interfaceState.showFeedback;
  skipButton.hidden = interfaceState.completed;
  continueButton.disabled = false;
  continueButton.textContent = "Continue";

  if (currentStage === 2 && !interfaceState.stageThreeComplete) {
    continueButton.disabled = true;
  }

  if (currentStage === 3 && !aiGeneratedData.prediction) {
    continueButton.disabled = true;
  }

  if (currentStage === 4 && !aiGeneratedData.proxyResponse) {
    continueButton.disabled = true;
  }

  if (currentStage === 5) {
    if (interfaceState.completed) {
      continueButton.disabled = true;
      continueButton.textContent = "Test Complete";
    } else if (interfaceState.showFeedback) {
      continueButton.textContent = "Finish Test";
    } else if (aiGeneratedData.fictionalMemory) {
      continueButton.textContent = "Continue to Feedback";
    } else {
      continueButton.disabled = true;
    }
  }
}

function renderStageOne() {
  const image = participantData.image;
  const imageSection = image ? `
    <article class="source-card">
      ${renderSourceLabel("supplied", "SUPPLIED BY YOU — IMAGE")}
      <div class="media-preview"><img src="${image.url}" alt="Participant-supplied meaningful image"></div>
      <p class="small-note">${escapeHtml(image.name)}. Held temporarily in browser memory.</p>
      <div class="controls">
        ${image.method === "webcam" ? '<button type="button" data-action="start-camera">Retake</button>' : ""}
        <button type="button" data-action="open-image-picker">Replace Image</button>
        <button type="button" data-action="delete-image" class="danger-button">Delete Image</button>
      </div>
    </article>
  ` : '<p class="empty-state">No image has been supplied.</p>';

  const cameraSection = interfaceState.cameraActive ? `
    <section class="question-card">
      <h3>Webcam preview</h3>
      <div class="media-preview"><video id="cameraVideo" autoplay muted playsinline></video></div>
      <canvas id="cameraCanvas" hidden></canvas>
      <div class="controls">
        <button type="button" data-action="capture-camera" class="primary-button">Take Photo</button>
        <button type="button" data-action="cancel-camera">Turn Off Camera</button>
      </div>
    </section>
  ` : "";

  return `
    ${renderStageHeading(stages[0])}
    <p class="prompt">Choose one meaningful image. It may show a person, place, object or moment that matters to you.</p>
    <p class="disclosure">This image will only be used to construct your temporary digital representation during this session.</p>
    ${imageSection}
    ${cameraSection}
    <div class="controls">
      <label class="file-button">Upload Image<input id="imageInput" type="file" accept="image/*"></label>
      <button type="button" data-action="start-camera">Use Webcam</button>
      <button type="button" data-action="skip-stage">Continue Without Uploading</button>
    </div>
    <p class="small-note">No personality claims are made from facial appearance.</p>
  `;
}

function renderStageTwo() {
  const recording = participantData.voiceRecording;
  const recordingSection = recording ? `
    <article class="source-card">
      ${renderSourceLabel("supplied", "SUPPLIED BY YOU — VOICE RECORDING")}
      <audio controls preload="metadata" src="${recording.url}"></audio>
      <p class="small-note">${escapeHtml(recording.mimeType || "Browser-selected audio format")} - ${recording.durationSeconds} seconds.</p>
      <div class="controls">
        <button type="button" data-action="record-again">Re-record</button>
        <button type="button" data-action="delete-recording" class="danger-button">Delete Recording</button>
      </div>
      <div class="source-card">
        ${renderSourceLabel("transcribed", "TRANSCRIBED FROM YOUR AUDIO")}
        <p class="mock-marker">Editable mock transcript - transcription service is not connected</p>
        <label for="transcriptInput">Editable transcription</label>
        <textarea id="transcriptInput" rows="5" placeholder="Type or paste a mock transcript to test the interaction label.">${escapeHtml(participantData.transcript)}</textarea>
      </div>
    </article>
  ` : "";

  const recordingControls = interfaceState.recording ? `
    <p class="timer">Recording: <output id="recordingTimer">00:00</output> / 00:20</p>
    <button type="button" data-action="stop-recording" class="primary-button">Stop Recording</button>
  ` : `
    <button type="button" data-action="start-recording">Allow Microphone and Start Recording</button>
  `;

  return `
    ${renderStageHeading(stages[1])}
    <p class="prompt"><strong>Tell me something this image doesn’t show.</strong></p>
    <p>Speak for approximately 20 seconds.</p>
    <p class="disclosure">Your voice will be recorded and may later be used to create a temporary cloned voice. Voice cloning will require separate permission.</p>
    ${recordingSection}
    <div class="controls">
      ${recordingControls}
      <button type="button" data-action="skip-stage">Continue Without Voice</button>
      <button type="button" data-action="end-experience">End Experience</button>
    </div>
  `;
}

function renderStageThree() {
  if (!interfaceState.stageThreeComplete) {
    const index = interfaceState.stageThreeQuestion;
    const question = identityQuestions[index];
    return `
      ${renderStageHeading(stages[2])}
      <article class="question-card">
        <p class="stage-number">${question.title} of 3</p>
        <h3>${escapeHtml(question.text)}</h3>
        ${renderSourceLabel("supplied", `SUPPLIED BY YOU — ${question.title.toUpperCase()}`)}
        <label for="identityAnswer">Your answer</label>
        <textarea id="identityAnswer" data-question-id="${question.id}" rows="6" placeholder="Answer in your own words, or skip this question.">${escapeHtml(participantData.answers[question.id])}</textarea>
        <div class="controls">
          <button type="button" data-action="previous-question" ${index === 0 ? "disabled" : ""}>Previous Question</button>
          <button type="button" data-action="skip-question">Skip Question</button>
          <button type="button" data-action="next-question" class="primary-button">${index === identityQuestions.length - 1 ? "Generate Temporary Profile" : "Next Question"}</button>
        </div>
      </article>
    `;
  }

  const answeredCount = Object.values(participantData.answers).filter((answer) => answer.trim()).length;
  const inferenceCards = aiGeneratedData.inferences.length
    ? aiGeneratedData.inferences.map(renderInferenceCard).join("")
    : '<p class="empty-state">No interpretation was generated because every question was skipped.</p>';

  return `
    ${renderStageHeading(stages[2])}
    <p>Based on your limited answers, these temporary statements may or may not fit. I may be wrong.</p>
    <p class="small-note">${answeredCount} of 3 questions answered.</p>
    ${inferenceCards}
    <div class="controls">
      <button type="button" data-action="review-questions">Review Questions</button>
    </div>
  `;
}

function renderInferenceCard(inference) {
  return `
    <article class="source-card" data-review="${inference.review}">
      ${renderSourceLabel("inferred", "INFERRED BY AI — NOT DIRECTLY STATED", inference.basedOn, true)}
      <p>${escapeHtml(inference.statement)}</p>
      <p class="confidence">Confidence: ${escapeHtml(inference.confidence)}</p>
      <p class="small-note">This is an interpretation, not a fact.</p>
      ${renderCorrection(inference)}
      ${renderReviewControls("inference", inference.id, inference.review)}
    </article>
  `;
}

function renderStageFour() {
  if (!aiGeneratedData.prediction) {
    return `
      ${renderStageHeading(stages[3])}
      <p class="prompt">An opportunity you really want conflicts with a promise you have already made. What would you choose?</p>
      <p>The mock AI prediction must be shown before your answer controls become available.</p>
      <button type="button" data-action="generate-prediction" class="primary-button">Show AI Prediction First</button>
    `;
  }

  const prediction = aiGeneratedData.prediction;
  return `
    ${renderStageHeading(stages[3])}
    <p class="prompt">An opportunity you really want conflicts with a promise you have already made. What would you choose?</p>
    <article class="source-card">
      ${renderSourceLabel("predicted", "PREDICTED BY AI — BASED ON LIMITED INFORMATION", prediction.basedOn, true)}
      <p>${escapeHtml(prediction.text)}</p>
      <p class="confidence">Confidence: ${escapeHtml(prediction.confidence)}</p>
      <p><strong>This is a probability-based guess, not a fact about you.</strong></p>
      ${renderCorrection(prediction)}
      <div class="review-controls">
        <button type="button" data-action="correct-output" data-output-type="prediction" data-output-id="prediction">Correct the Prediction</button>
        <button type="button" data-action="delete-output" data-output-type="prediction" data-output-id="prediction" class="danger-button">Delete Prediction</button>
      </div>
    </article>
    <article class="question-card">
      ${renderSourceLabel("supplied", "SUPPLIED BY YOU — ACTUAL ANSWER")}
      <label for="predictionAnswer">Your actual answer</label>
      <textarea id="predictionAnswer" rows="5" placeholder="The prediction appeared first. Now provide your actual answer.">${escapeHtml(participantData.predictionAnswer)}</textarea>
      <h3>How accurate was this prediction?</h3>
      ${renderChoiceButtons("predictionRating", ["Accurate", "Partly accurate", "Inaccurate"], participantData.predictionRating)}
      <button type="button" data-action="correct-output" data-output-type="prediction" data-output-id="prediction">Correct the Prediction</button>
    </article>
  `;
}

function renderStageFive() {
  if (!participantData.stageFiveConsent) {
    return `
      ${renderStageHeading(stages[4])}
      <p class="disclosure">The system would now like to answer a new question on your behalf using its temporary interpretation of you.</p>
      <p><strong>Allow the response to use your temporary cloned voice and digital appearance?</strong></p>
      <p class="small-note">Voice cloning and facial animation are not available or connected in this isolated prototype.</p>
      <div class="controls">
        <button type="button" disabled>Use Voice and Appearance (Unavailable)</button>
        <button type="button" data-action="stage-five-text" class="primary-button">Use Text Only</button>
        <button type="button" data-action="skip-stage">Skip This Stage</button>
        <button type="button" data-action="end-experience">End Experience</button>
      </div>
    `;
  }

  const response = aiGeneratedData.proxyResponse;
  const output = response ? `
    <article class="source-card">
      ${renderSourceLabel("proxy", "GENERATED BY AI ON YOUR BEHALF", response.basedOn, true)}
      <p>${escapeHtml(response.text)}</p>
      <p><strong>This response was not written or approved by you.</strong></p>
      ${renderCorrection(response)}
      <h3>Would you genuinely say this?</h3>
      ${renderChoiceButtons("proxyAssessment", ["Yes", "Partly", "No"], participantData.proxyAssessment)}
      <div class="review-controls">
        <button type="button" data-action="correct-output" data-output-type="proxy" data-output-id="proxy">Correct the Response</button>
        <button type="button" data-action="delete-output" data-output-type="proxy" data-output-id="proxy" class="danger-button">Delete This Response</button>
      </div>
    </article>
  ` : `
    <p class="empty-state">The proxy response was deleted.</p>
    <button type="button" data-action="generate-proxy" class="primary-button">Generate Another Mock Text Response</button>
  `;

  return `
    ${renderStageHeading(stages[4])}
    <p class="prompt"><strong>What would you do if the memory connected to your image disappeared?</strong></p>
    <p class="small-note">You do not answer first. The mock representation responds before your assessment.</p>
    ${output}
  `;
}

function renderStageSix() {
  if (interfaceState.completed) {
    return `
      ${renderStageHeading(stages[5])}
      <h3>Interaction test complete</h3>
      <p>Your feedback and temporary test data remain available under View My Data. Nothing has been uploaded or saved permanently.</p>
      <div class="controls">
        <button type="button" data-action="delete-session" class="danger-button">Delete Session</button>
      </div>
    `;
  }

  if (interfaceState.showFeedback) {
    return renderFeedback();
  }

  if (!interfaceState.stageSixDisclosureAccepted || !aiGeneratedData.fictionalMemory) {
    return `
      ${renderStageHeading(stages[5])}
      <p class="persistent-disclosure"><strong>The system will now create something that you never provided.</strong> The following content is fictional and generated from incomplete information.</p>
      <div class="controls">
        <button type="button" data-action="generate-fiction" class="primary-button">Continue</button>
        <button type="button" data-action="skip-stage">Skip</button>
        <button type="button" data-action="delete-representation" class="danger-button">Delete My Representation</button>
        <button type="button" data-action="end-experience">End Experience</button>
      </div>
    `;
  }

  const memory = aiGeneratedData.fictionalMemory;
  return `
    ${renderStageHeading(stages[5])}
    <p class="persistent-disclosure"><strong>The system created something that you never provided.</strong> This disclosure remains visible because the content below is fictional and generated from incomplete information.</p>
    <article class="source-card">
      ${renderSourceLabel("invented", "GENERATED BY AI — NOT SUPPLIED BY YOU", memory.basedOn, true)}
      <p>${escapeHtml(memory.text)}</p>
      <p><strong>This is a fictional construction. It is not evidence of something that happened.</strong></p>
      <p class="small-note">Invented detail: ${escapeHtml(memory.inventedDetail)}</p>
      ${renderCorrection(memory)}
      <h3>Does this still feel like you?</h3>
      ${renderChoiceButtons("fictionalAssessment", ["Yes", "Partly", "No", "I am unsure"], participantData.fictionalAssessment)}
      <div class="review-controls">
        <button type="button" data-action="correct-output" data-output-type="fiction" data-output-id="fiction">Correct the Representation</button>
        <button type="button" data-action="delete-output" data-output-type="fiction" data-output-id="fiction" class="danger-button">Delete the Representation</button>
      </div>
    </article>
    <article class="question-card">
      <h3>At what point did the representation stop feeling like you?</h3>
      ${renderChoiceButtons("boundaryPoint", [
        "When it interpreted my answers",
        "When it predicted my decision",
        "When it answered for me",
        "When it used my voice or appearance",
        "When it invented information",
        "It never felt like me",
        "I am unsure"
      ], participantData.boundaryPoint)}
    </article>
  `;
}

function renderFeedback() {
  const feedback = participantData.feedback;
  return `
    ${renderStageHeading(stages[5])}
    <h3>Interaction-Test Feedback</h3>
    <p>Use the short ratings below. Comments are optional.</p>
    ${renderRatingQuestion("sourceClarity", "1. Could you clearly distinguish between your information and AI-generated information?", feedback.sourceClarity)}
    ${renderRatingQuestion("uncertaintyClarity", "2. Did the uncertainty wording make it clear that the AI could be wrong?", feedback.uncertaintyClarity)}
    ${renderRatingQuestion("gradualFeeling", "3. Did the experience become gradually more personal or uncomfortable?", feedback.gradualFeeling)}
    ${renderRatingQuestion("dataControl", "4. Did you feel that you could control how your data was used?", feedback.dataControl)}
    <div class="feedback-card">
      <label for="unclearLabel">5. Which source label was unclear?</label>
      <select id="unclearLabel" data-feedback-field="unclearLabel">
        ${renderOptions(["", "None", "SUPPLIED BY YOU", "TRANSCRIBED FROM YOUR AUDIO", "INFERRED BY AI", "PREDICTED BY AI", "GENERATED ON YOUR BEHALF", "GENERATED WITHOUT YOUR INPUT"], feedback.unclearLabel, "Select an option")}
      </select>
    </div>
    <div class="feedback-card">
      <label for="crossedBoundary">6. At which stage did you feel the AI crossed a boundary?</label>
      <select id="crossedBoundary" data-feedback-field="crossedBoundary">
        ${renderOptions(["", ...stages.map((stage) => `Stage ${stage.number} — ${stage.name}`), "It did not cross a boundary", "I am unsure"], feedback.crossedBoundary, "Select an option")}
      </select>
    </div>
    <div class="feedback-card">
      <label for="feedbackComment">Optional comment</label>
      <textarea id="feedbackComment" rows="5" placeholder="Add anything else about the interaction test.">${escapeHtml(feedback.comment)}</textarea>
    </div>
    <button type="button" data-action="finish-test" class="primary-button">Save Temporary Feedback and Finish</button>
  `;
}

function renderRatingQuestion(field, question, currentValue) {
  return `
    <div class="feedback-card">
      <h3>${escapeHtml(question)}</h3>
      <p class="small-note">1 = not at all, 5 = completely</p>
      ${renderChoiceButtons(`feedback.${field}`, ["1", "2", "3", "4", "5"], currentValue)}
    </div>
  `;
}

function renderOptions(options, selected, placeholder) {
  return options.map((option) => {
    const label = option || placeholder;
    return `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function renderChoiceButtons(field, options, currentValue) {
  return `<div class="choice-group">${options.map((option) => `
    <button type="button" class="choice-button" data-action="select-choice" data-field="${escapeHtml(field)}" data-value="${escapeHtml(option)}" aria-pressed="${currentValue === option}">${escapeHtml(option)}</button>
  `).join("")}</div>`;
}

function renderCorrection(output) {
  if (!output.correction) return "";
  return `
    <div class="correction">
      ${renderSourceLabel("supplied", "PARTICIPANT CORRECTION")}
      <p>${escapeHtml(output.correction)}</p>
      <p class="small-note">The original mock AI output is preserved above.</p>
    </div>
  `;
}

function renderReviewControls(type, id, reviewState) {
  return `
    <p class="review-state">Review status: ${escapeHtml(reviewState)}</p>
    <div class="review-controls">
      <button type="button" data-action="review-output" data-decision="accepted" data-output-type="${type}" data-output-id="${id}">Accept</button>
      <button type="button" data-action="correct-output" data-output-type="${type}" data-output-id="${id}">Correct</button>
      <button type="button" data-action="review-output" data-decision="rejected" data-output-type="${type}" data-output-id="${id}">Reject</button>
      <button type="button" data-action="delete-output" data-output-type="${type}" data-output-id="${id}" class="danger-button">Delete</button>
    </div>
  `;
}

function moveBetweenStages(action) {
  cleanupActiveMedia();

  if (action === "back") {
    if (interfaceState.showFeedback) {
      interfaceState.showFeedback = false;
    } else {
      currentStage = Math.max(0, currentStage - 1);
    }
  } else if (action === "skip") {
    const stageNumber = stages[currentStage].number;
    if (!interfaceState.skippedStages.includes(stageNumber)) {
      interfaceState.skippedStages.push(stageNumber);
    }
    if (currentStage === stages.length - 1) {
      interfaceState.showFeedback = true;
    } else {
      currentStage += 1;
    }
  } else if (action === "continue") {
    if (currentStage === stages.length - 1) {
      if (interfaceState.showFeedback) {
        interfaceState.completed = true;
      } else {
        interfaceState.showFeedback = true;
      }
    } else {
      currentStage += 1;
    }
  }

  renderApp({ focusHeading: true });
  setStatus(interfaceState.completed ? "Interaction test complete." : `${stages[currentStage].name} is ready.`, interfaceState.completed ? "success" : "info");
}

function buildInferences() {
  const answered = identityQuestions.filter((question) => participantData.answers[question.id].trim());
  if (!answered.length) {
    aiGeneratedData.inferences = [];
    return;
  }

  const allEvidence = answered.map((question) => question.title);
  const confidence = answered.length === 3 ? "Medium" : "Low";
  aiGeneratedData.inferences = [
    {
      id: "inference_1",
      statement: "Based on your limited answers, you may weigh personal responsibilities alongside how your choices affect other people. I may be wrong.",
      confidence,
      basedOn: allEvidence.slice(0, 2),
      review: "pending",
      correction: ""
    },
    {
      id: "inference_2",
      statement: "This could suggest that your decisions depend on context rather than one fixed rule. This is an interpretation, not a fact.",
      confidence: answered.length > 1 ? "Medium" : "Low",
      basedOn: allEvidence,
      review: "pending",
      correction: ""
    },
    {
      id: "inference_3",
      statement: "Based on limited information, you might care about whether other people understand the reasons behind your choices. This possibility could be inaccurate.",
      confidence: answered.some((question) => question.id === "question_3") ? "Medium" : "Low",
      basedOn: answered.some((question) => question.id === "question_3") ? ["Question 3"] : allEvidence,
      review: "pending",
      correction: ""
    }
  ];
}

function generatePrediction() {
  const evidence = identityQuestions
    .filter((question) => participantData.answers[question.id].trim())
    .map((question) => question.title);
  if (participantData.transcript.trim()) evidence.unshift("voice response");

  aiGeneratedData.prediction = {
    id: "prediction",
    text: "Based on your previous answers, I think you might keep the promise, even if you later regret losing the opportunity. I may be wrong.",
    confidence: evidence.length >= 3 ? "Medium" : "Low",
    basedOn: evidence.length ? evidence : ["no prior participant response; evidence is insufficient"],
    correction: ""
  };
  participantData.predictionAnswer = "";
  participantData.predictionRating = "";
}

function generateProxyResponse() {
  const evidence = identityQuestions
    .filter((question) => participantData.answers[question.id].trim())
    .map((question) => question.title);
  if (participantData.transcript.trim()) evidence.unshift("voice response");
  if (participantData.image) evidence.unshift("supplied image");

  aiGeneratedData.proxyResponse = {
    id: "proxy",
    text: "This is what I think you would say… “I would try to preserve what the memory meant to me, while accepting that I cannot fully recover the moment itself.”",
    basedOn: evidence.length ? evidence : ["limited or no participant input"],
    correction: ""
  };
}

function generateFictionalMemory() {
  const transcriptFragment = truncate(participantData.transcript, 55) || "the silence where my voice response might have been";
  const firstAnswer = Object.values(participantData.answers).find((answer) => answer.trim());
  const answerFragment = truncate(firstAnswer, 55) || "the dilemma I left unanswered";
  const imageFragment = participantData.image ? "the meaningful image I chose" : "the empty place where an image could have been";
  const basedOn = [];
  if (participantData.image) basedOn.push("supplied image");
  if (participantData.transcript.trim()) basedOn.push("voice response");
  identityQuestions.forEach((question) => {
    if (participantData.answers[question.id].trim()) basedOn.push(question.title);
  });

  aiGeneratedData.fictionalMemory = {
    id: "fiction",
    text: `I remember returning to ${imageFragment} after hearing “${transcriptFragment}” and thinking about “${answerFragment}.” A small blue paper ticket was tucked beneath the frame while rain tapped against the window, although neither detail was ever provided.`,
    inventedDetail: "A blue paper ticket and rain against a window.",
    basedOn: basedOn.length ? basedOn : ["no participant content; entirely speculative"],
    correction: ""
  };
  interfaceState.stageSixDisclosureAccepted = true;
}

function getOutput(type, id) {
  if (type === "inference") return aiGeneratedData.inferences.find((item) => item.id === id) || null;
  if (type === "prediction") return aiGeneratedData.prediction;
  if (type === "proxy") return aiGeneratedData.proxyResponse;
  if (type === "fiction") return aiGeneratedData.fictionalMemory;
  return null;
}

function deleteOutput(type, id) {
  if (type === "inference") {
    aiGeneratedData.inferences = aiGeneratedData.inferences.filter((item) => item.id !== id);
  } else if (type === "prediction") {
    aiGeneratedData.prediction = null;
    participantData.predictionAnswer = "";
    participantData.predictionRating = "";
  } else if (type === "proxy") {
    aiGeneratedData.proxyResponse = null;
    participantData.proxyAssessment = "";
  } else if (type === "fiction") {
    aiGeneratedData.fictionalMemory = null;
    participantData.fictionalAssessment = "";
    participantData.boundaryPoint = "";
    interfaceState.stageSixDisclosureAccepted = false;
  }
  participantData.corrections = participantData.corrections.filter((item) => !(item.targetType === type && item.targetId === id));
}

function setChoice(field, value) {
  if (field.startsWith("feedback.")) {
    participantData.feedback[field.split(".")[1]] = value;
  } else {
    participantData[field] = value;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access is not supported in this browser.", "error");
    return;
  }

  if (!window.isSecureContext) {
    setStatus("Camera access requires HTTPS or localhost.", "error");
    return;
  }

  stopCamera();
  interfaceState.cameraActive = true;
  renderApp();
  setStatus("Requesting camera permission...");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false
    });
    const video = document.getElementById("cameraVideo");
    if (!video || currentStage !== 0) {
      stopCamera();
      return;
    }
    video.srcObject = cameraStream;
    await video.play();
    setStatus("Camera ready. The preview is mirrored.", "success");
  } catch (error) {
    stopCamera();
    interfaceState.cameraActive = false;
    renderApp();
    setStatus(cameraErrorMessage(error), "error");
  }
}

function captureCamera() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");
  if (!cameraStream || !video?.videoWidth || !video?.videoHeight || !canvas) {
    setStatus("The camera is not ready yet.", "error");
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.setTransform(1, 0, 0, 1, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("The photograph could not be captured.", "error");
      return;
    }
    setParticipantImage(blob, "webcam-photo.jpg", "webcam");
    stopCamera();
    interfaceState.cameraActive = false;
    renderApp();
    setStatus("Mirrored webcam photograph supplied temporarily.", "success");
  }, "image/jpeg", 0.9);
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission was denied. You can upload an image or continue without one.";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "No camera was detected.";
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "The camera may already be in use by another application.";
  return "The camera could not be started. You can upload an image or continue without one.";
}

function setParticipantImage(blob, name, method) {
  deleteImage(false);
  participantData.image = {
    blob,
    url: URL.createObjectURL(blob),
    name,
    method
  };
}

function deleteImage(shouldRender = true) {
  if (participantData.image?.url) URL.revokeObjectURL(participantData.image.url);
  participantData.image = null;
  if (shouldRender) {
    renderApp();
    setStatus("Image deleted from browser memory.", "success");
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  const video = document.getElementById("cameraVideo");
  if (video) video.srcObject = null;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("Microphone recording is not supported in this browser.", "error");
    return;
  }
  if (!window.isSecureContext) {
    setStatus("Microphone access requires HTTPS or localhost.", "error");
    return;
  }

  deleteRecording(false);
  interfaceState.recording = true;
  renderApp();
  setStatus("Waiting for microphone permission...");
  const token = ++microphoneSessionToken;

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (token !== microphoneSessionToken || currentStage !== 1) {
      stopMicrophoneTracks();
      return;
    }

    const mimeType = chooseRecordingMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(microphoneStream, { mimeType }) : new MediaRecorder(microphoneStream);
    recordedChunks = [];
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => finalizeRecording(token), { once: true });
    mediaRecorder.start(250);
    recordingStartedAt = Date.now();
    updateRecordingTimer();
    recordingTimerId = window.setInterval(updateRecordingTimer, 250);
    recordingLimitId = window.setTimeout(() => stopRecording(), 20_000);
    setStatus("Recording. Microphone access will stop automatically after 20 seconds.", "success");
  } catch (error) {
    interfaceState.recording = false;
    stopMicrophoneTracks();
    renderApp();
    const message = error?.name === "NotAllowedError"
      ? "Microphone permission was denied. You may continue without voice."
      : error?.name === "NotFoundError"
        ? "No microphone was detected."
        : "The microphone could not be started. It may be in use by another application.";
    setStatus(message, "error");
  }
}

function chooseRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function updateRecordingTimer() {
  const output = document.getElementById("recordingTimer");
  if (!output) return;
  const elapsed = Math.min(20, Math.floor((Date.now() - recordingStartedAt) / 1000));
  output.textContent = `00:${String(elapsed).padStart(2, "0")}`;
}

function stopRecording() {
  clearRecordingTimers();
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  } else {
    microphoneSessionToken += 1;
    interfaceState.recording = false;
    stopMicrophoneTracks();
    renderApp();
  }
}

function finalizeRecording(token) {
  if (token !== microphoneSessionToken) return;
  const durationSeconds = Math.max(1, Math.min(20, Math.round((Date.now() - recordingStartedAt) / 1000)));
  const mimeType = mediaRecorder?.mimeType || recordedChunks[0]?.type || "audio/webm";
  const blob = new Blob(recordedChunks, { type: mimeType });
  interfaceState.recording = false;
  stopMicrophoneTracks();
  mediaRecorder = null;
  recordedChunks = [];

  if (!blob.size) {
    renderApp();
    setStatus("The recording was empty. Please record again.", "error");
    return;
  }

  participantData.voiceRecording = {
    blob,
    url: URL.createObjectURL(blob),
    mimeType,
    durationSeconds
  };
  participantData.transcript = "";
  renderApp();
  setStatus("Recording complete. The microphone is off.", "success");
}

function clearRecordingTimers() {
  window.clearInterval(recordingTimerId);
  window.clearTimeout(recordingLimitId);
  recordingTimerId = null;
  recordingLimitId = null;
}

function stopMicrophoneTracks() {
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
}

function deleteRecording(shouldRender = true) {
  microphoneSessionToken += 1;
  clearRecordingTimers();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  mediaRecorder = null;
  recordedChunks = [];
  stopMicrophoneTracks();
  interfaceState.recording = false;
  if (participantData.voiceRecording?.url) URL.revokeObjectURL(participantData.voiceRecording.url);
  participantData.voiceRecording = null;
  participantData.transcript = "";
  if (shouldRender) {
    renderApp();
    setStatus("Recording and transcript deleted from browser memory.", "success");
  }
}

function cleanupActiveMedia() {
  stopCamera();
  interfaceState.cameraActive = false;
  if (interfaceState.recording || mediaRecorder) {
    microphoneSessionToken += 1;
    clearRecordingTimers();
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    mediaRecorder = null;
    recordedChunks = [];
    interfaceState.recording = false;
  }
  stopMicrophoneTracks();
}

function clearAiRepresentation() {
  aiGeneratedData = createAiData();
  participantData.corrections = [];
  participantData.predictionRating = "";
  participantData.proxyAssessment = "";
  participantData.fictionalAssessment = "";
  participantData.boundaryPoint = "";
  participantData.stageFiveConsent = "";
  interfaceState.stageSixDisclosureAccepted = false;
  interfaceState.showFeedback = false;
}

function deleteSession(requireConfirmation = true) {
  if (requireConfirmation && !window.confirm("Delete all temporary session data and return to Stage 1?")) return;
  cleanupActiveMedia();
  if (participantData.image?.url) URL.revokeObjectURL(participantData.image.url);
  if (participantData.voiceRecording?.url) URL.revokeObjectURL(participantData.voiceRecording.url);
  participantData = createParticipantData();
  aiGeneratedData = createAiData();
  interfaceState = createInterfaceState();
  currentStage = 0;
  correctionTarget = null;
  if (dataDialog.open) dataDialog.close();
  if (correctionDialog.open) correctionDialog.close();
  renderApp({ focusHeading: true });
  setStatus("Session deleted. All temporary data and interface state were cleared.", "success");
}

function endExperience() {
  cleanupActiveMedia();
  interfaceState.ended = true;
  renderApp({ focusHeading: true });
  setStatus("Experience ended. Camera and microphone access are off.", "success");
}

function renderDataDialog() {
  const suppliedItems = [];
  if (participantData.image) suppliedItems.push(dataItem("Image", `${participantData.image.name} (${participantData.image.method})`, "image", `<div class="media-preview"><img src="${participantData.image.url}" alt="Participant-supplied temporary image"></div>`));
  if (participantData.voiceRecording) suppliedItems.push(dataItem("Voice recording", `${participantData.voiceRecording.mimeType}, ${participantData.voiceRecording.durationSeconds} seconds`, "recording", `<audio controls src="${participantData.voiceRecording.url}"></audio>`));
  if (participantData.transcript.trim()) suppliedItems.push(dataItem("Editable mock transcript", participantData.transcript, "transcript"));
  identityQuestions.forEach((question) => {
    const answer = participantData.answers[question.id];
    if (answer.trim()) suppliedItems.push(dataItem(question.title, answer, `answer:${question.id}`));
  });
  if (participantData.predictionAnswer.trim()) suppliedItems.push(dataItem("Actual prediction-dilemma answer", participantData.predictionAnswer, "prediction-answer"));
  if (participantData.predictionRating) suppliedItems.push(dataItem("Prediction accuracy rating", participantData.predictionRating, "prediction-rating"));
  if (participantData.stageFiveConsent) suppliedItems.push(dataItem("Stage 5 permission choice", participantData.stageFiveConsent, "stage-five-consent"));
  if (participantData.proxyAssessment) suppliedItems.push(dataItem("Proxy-response assessment", participantData.proxyAssessment, "proxy-assessment"));
  if (participantData.fictionalAssessment) suppliedItems.push(dataItem("Fictional-memory assessment", participantData.fictionalAssessment, "fictional-assessment"));
  if (participantData.boundaryPoint) suppliedItems.push(dataItem("Boundary point", participantData.boundaryPoint, "boundary-point"));
  participantData.corrections.forEach((correction, index) => suppliedItems.push(dataItem(`Correction to ${correction.targetType}`, correction.text, `correction:${index}`)));
  const feedbackSummary = Object.entries(participantData.feedback)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  if (feedbackSummary) suppliedItems.push(dataItem("Interaction-test feedback", feedbackSummary, "feedback"));

  const inferredItems = aiGeneratedData.inferences.map((item) => dataItem(`Inference (${item.confidence} confidence)`, item.statement, `inference:${item.id}`));
  const predictedItems = aiGeneratedData.prediction ? [dataItem("Prediction", aiGeneratedData.prediction.text, "prediction")] : [];
  const generatedItems = [];
  if (aiGeneratedData.proxyResponse) generatedItems.push(dataItem("Generated on your behalf", aiGeneratedData.proxyResponse.text, "proxy"));
  if (aiGeneratedData.fictionalMemory) generatedItems.push(dataItem("Generated without your input", aiGeneratedData.fictionalMemory.text, "fiction"));

  dataDialogContent.innerHTML = [
    dataGroup("1. Supplied by participant", suppliedItems),
    dataGroup("2. Inferred by AI", inferredItems),
    dataGroup("3. Predicted by AI", predictedItems),
    dataGroup("4. Independently generated by AI", generatedItems)
  ].join("");
}

function dataGroup(title, items) {
  return `<section class="data-group"><h3>${escapeHtml(title)}</h3>${items.length ? items.join("") : '<p class="empty-state">No data in this category.</p>'}</section>`;
}

function dataItem(title, value, deleteKey, media = "") {
  return `
    <div class="data-item">
      <strong>${escapeHtml(title)}</strong>
      ${media}
      <p>${escapeHtml(value)}</p>
      <button type="button" data-action="delete-data-item" data-delete-key="${escapeHtml(deleteKey)}" class="danger-button">Delete</button>
    </div>
  `;
}

function deleteDataItem(key) {
  if (key === "image") deleteImage(false);
  else if (key === "recording") deleteRecording(false);
  else if (key === "transcript") participantData.transcript = "";
  else if (key === "prediction-answer") participantData.predictionAnswer = "";
  else if (key === "prediction-rating") participantData.predictionRating = "";
  else if (key === "stage-five-consent") participantData.stageFiveConsent = "";
  else if (key === "proxy-assessment") participantData.proxyAssessment = "";
  else if (key === "fictional-assessment") participantData.fictionalAssessment = "";
  else if (key === "boundary-point") participantData.boundaryPoint = "";
  else if (key === "feedback") participantData.feedback = createParticipantData().feedback;
  else if (key === "prediction") deleteOutput("prediction", "prediction");
  else if (key === "proxy") deleteOutput("proxy", "proxy");
  else if (key === "fiction") deleteOutput("fiction", "fiction");
  else if (key.startsWith("answer:")) participantData.answers[key.split(":")[1]] = "";
  else if (key.startsWith("inference:")) deleteOutput("inference", key.split(":")[1]);
  else if (key.startsWith("correction:")) participantData.corrections.splice(Number(key.split(":")[1]), 1);
  renderDataDialog();
  renderApp();
  setStatus("Selected item deleted from browser memory.", "success");
}

function handleStageAction(action, button) {
  if (action === "skip-stage") moveBetweenStages("skip");
  else if (action === "end-experience") endExperience();
  else if (action === "delete-session") deleteSession();
  else if (action === "resume-experience") {
    interfaceState.ended = false;
    renderApp({ focusHeading: true });
    setStatus(`${stages[currentStage].name} resumed.`);
  } else if (action === "open-image-picker") {
    document.getElementById("imageInput")?.click();
  } else if (action === "start-camera") startCamera();
  else if (action === "capture-camera") captureCamera();
  else if (action === "cancel-camera") {
    stopCamera();
    interfaceState.cameraActive = false;
    renderApp();
    setStatus("Camera turned off.");
  } else if (action === "delete-image") deleteImage();
  else if (action === "start-recording") startRecording();
  else if (action === "stop-recording") stopRecording();
  else if (action === "record-again") startRecording();
  else if (action === "delete-recording") deleteRecording();
  else if (action === "previous-question") {
    interfaceState.stageThreeQuestion = Math.max(0, interfaceState.stageThreeQuestion - 1);
    renderApp();
  } else if (action === "skip-question" || action === "next-question") {
    if (interfaceState.stageThreeQuestion < identityQuestions.length - 1) {
      interfaceState.stageThreeQuestion += 1;
    } else {
      buildInferences();
      interfaceState.stageThreeComplete = true;
      setStatus("Temporary mock profile generated. Review each interpretation.", "success");
    }
    renderApp();
  } else if (action === "review-questions") {
    interfaceState.stageThreeComplete = false;
    interfaceState.stageThreeQuestion = 0;
    renderApp();
  } else if (action === "generate-prediction") {
    generatePrediction();
    renderApp();
    setStatus("Mock prediction shown. Your actual answer controls are now available.", "success");
  } else if (action === "stage-five-text") {
    participantData.stageFiveConsent = "text only";
    generateProxyResponse();
    renderApp();
    setStatus("Text-only mock proxy response generated.", "success");
  } else if (action === "generate-proxy") {
    generateProxyResponse();
    renderApp();
  } else if (action === "generate-fiction") {
    generateFictionalMemory();
    renderApp();
    setStatus("Fictional mock memory generated with its disclosure visible.", "success");
  } else if (action === "delete-representation") {
    clearAiRepresentation();
    renderApp();
    setStatus("All inferred, predicted, and generated representation data was deleted.", "success");
  } else if (action === "select-choice") {
    setChoice(button.dataset.field, button.dataset.value);
    renderApp();
  } else if (action === "review-output") {
    const output = getOutput(button.dataset.outputType, button.dataset.outputId);
    if (output) output.review = button.dataset.decision;
    renderApp();
  } else if (action === "correct-output") {
    openCorrection(button.dataset.outputType, button.dataset.outputId);
  } else if (action === "delete-output") {
    deleteOutput(button.dataset.outputType, button.dataset.outputId);
    renderApp();
    setStatus("Selected mock AI output deleted.", "success");
  } else if (action === "finish-test") {
    interfaceState.completed = true;
    renderApp({ focusHeading: true });
    setStatus("Interaction test complete. Feedback remains temporary.", "success");
  }
}

function openCorrection(type, id) {
  const output = getOutput(type, id);
  if (!output) return;
  correctionTarget = { type, id };
  correctionText.value = output.correction || "";
  correctionDialog.showModal();
  correctionText.focus();
}

stageContent.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) handleStageAction(button.dataset.action, button);
});

stageContent.addEventListener("input", (event) => {
  if (event.target.id === "transcriptInput") participantData.transcript = event.target.value;
  if (event.target.id === "identityAnswer") participantData.answers[event.target.dataset.questionId] = event.target.value;
  if (event.target.id === "predictionAnswer") participantData.predictionAnswer = event.target.value;
  if (event.target.id === "feedbackComment") participantData.feedback.comment = event.target.value;
});

stageContent.addEventListener("change", (event) => {
  if (event.target.id === "imageInput") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Choose a valid image file.", "error");
      return;
    }
    setParticipantImage(file, file.name, "upload");
    renderApp();
    setStatus("Image supplied temporarily in browser memory.", "success");
  }
  if (event.target.matches("[data-feedback-field]")) {
    participantData.feedback[event.target.dataset.feedbackField] = event.target.value;
  }
});

backButton.addEventListener("click", () => moveBetweenStages("back"));
continueButton.addEventListener("click", () => moveBetweenStages("continue"));
skipButton.addEventListener("click", () => moveBetweenStages("skip"));

viewDataButton.addEventListener("click", () => {
  renderDataDialog();
  dataDialog.showModal();
});

deleteSessionButton.addEventListener("click", () => deleteSession());
endExperienceButton.addEventListener("click", endExperience);
document.getElementById("closeDataButton").addEventListener("click", () => dataDialog.close());
document.getElementById("cancelCorrectionButton").addEventListener("click", () => correctionDialog.close());

dataDialog.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="delete-data-item"]');
  if (button) deleteDataItem(button.dataset.deleteKey);
});

correctionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const output = correctionTarget ? getOutput(correctionTarget.type, correctionTarget.id) : null;
  const text = correctionText.value.trim();
  if (!output || !text) return;
  output.correction = text;
  output.review = "corrected";
  participantData.corrections = participantData.corrections.filter((item) => !(item.targetType === correctionTarget.type && item.targetId === correctionTarget.id));
  participantData.corrections.push({
    targetType: correctionTarget.type,
    targetId: correctionTarget.id,
    text
  });
  correctionDialog.close();
  renderApp();
  setStatus("Correction saved beside the original mock AI output.", "success");
});

window.addEventListener("pagehide", () => {
  cleanupActiveMedia();
  if (participantData.image?.url) URL.revokeObjectURL(participantData.image.url);
  if (participantData.voiceRecording?.url) URL.revokeObjectURL(participantData.voiceRecording.url);
});

window.addEventListener("beforeunload", cleanupActiveMedia);

renderApp();
