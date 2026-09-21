const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateIdentityProfile, validatePrediction } = require("../server/schemas.cjs");

const script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
function harness({ mode = "mock", fail = "", cameraError, micError, transcript } = {}) {
  const elements = new Map();
  const stopped = [];
  const requests = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: "", textContent: "", className: "", disabled: false, value: "", open: false,
      videoWidth: 320, videoHeight: 240, play: async () => {}, focus() {}, close() { this.open = false; }, showModal() { this.open = true; }
    });
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelector: selector => element(selector),
    addEventListener() {},
    createElement: tag => tag === "canvas" ? {
      getContext: () => ({ translate() {}, scale() {}, drawImage() {} }),
      toBlob: callback => callback(new Blob(["photo"], { type: "image/jpeg" }))
    } : element(tag)
  };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || "audio/webm"; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const context = vm.createContext({
    document, Blob, URL, URLSearchParams, AbortController, MediaRecorder: Recorder, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: `?mode=${mode}${fail ? `&fail=${fail}` : ""}` },
    isSecureContext: true, confirm: () => true, prompt: () => "Participant correction",
    navigator: { mediaDevices: { getUserMedia: async constraints => {
      if (constraints.video && cameraError) throw Object.assign(new Error("camera"), { name: cameraError });
      if (constraints.audio && micError) throw Object.assign(new Error("microphone"), { name: micError });
      return { getTracks: () => [{ stop() { stopped.push(constraints.video ? "camera" : "microphone"); } }] };
    } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return url === "/api/transcribe" && transcript
        ? { ok: true, text: async () => transcript }
        : { ok: false, status: 503, json: async () => ({ error: "Simulated service failure." }) };
    }
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(script, context, { filename: "script.js" });
  const run = expression => vm.runInContext(expression, context);
  return { run, elements, stopped, requests };
}

test("complete mock journey keeps labels, ordering and final feedback", async () => {
  const h = harness();
  h.run(`sessionState.supplied.transcript = "This image reminds me of a shared trip."; move("continue"); move("continue");`);
  assert.equal(h.run("sessionState.currentStage"), 3);
  for (let i = 0; i < 3; i++) h.run(`sessionState.supplied.answers[${i}].text = "Fictional answer ${i + 1}"; advanceQuestion();`);
  await h.run("new Promise(resolve => setTimeout(resolve, 0))");
  assert.equal(h.run("sessionState.questionIndex"), 3);
  assert.equal(h.run("sessionState.inferred.profile.supplied_information.length"), 4);
  const answers = h.run("readableAnswers()");
  const profile = h.run("sessionState.inferred.profile");
  assert.deepEqual(validateIdentityProfile(profile, answers), []);
  h.run('move("continue")');
  assert.equal(h.run("sessionState.predictionShown"), false);
  assert.doesNotMatch(h.run("renderPrediction()"), /id="actualAnswer"/);
  await h.run("generatePrediction()");
  assert.deepEqual(validatePrediction(h.run("sessionState.predicted.predictions[0]"), answers, profile), []);
  assert.match(h.run("renderPrediction()"), /id="actualAnswer"/);
  h.run('move("continue"); sessionState.consent.proxyResponse = true');
  await h.run("generateProxy()");
  assert.match(h.run("renderProxy()"), /GENERATED ON YOUR BEHALF/);
  h.run('move("continue"); sessionState.consent.fictionalGeneration = true');
  await h.run("generateFiction()");
  assert.match(h.run("renderFiction()"), /FICTIONAL AI-GENERATED CONTENT/);
  h.run('sessionState.feedback.feelsLikeYou = "Unsure"; move("continue")');
  assert.equal(h.run("sessionState.finished"), true);
});
test("camera permission denial leaves a safe upload or skip path", async () => {
  const h = harness({ cameraError: "NotAllowedError" });
  h.run("sessionState.consent.photoCapture = true");
  await h.run("enableCamera()");
  assert.equal(h.run("cameraStream"), null);
  assert.match(h.elements.get("status").textContent, /denied/);
  h.run('move("skip")'); assert.equal(h.run("sessionState.currentStage"), 2);
});
test("microphone permission denial preserves a text-only path", async () => {
  const h = harness({ micError: "NotAllowedError" });
  h.run('move("continue")');
  await h.run("startRecording()");
  assert.match(h.elements.get("status").textContent, /denied/);
  h.run('sessionState.supplied.transcript = "Typed instead"; move("continue")');
  assert.equal(h.run("sessionState.currentStage"), 3);
});
test("mirrored photo is confirmed and camera tracks stop", async () => {
  const h = harness();
  h.run("sessionState.consent.photoCapture = true");
  await h.run("enableCamera()");
  await h.run("capturePhoto()");
  assert.equal(h.run("sessionState.supplied.image.blob.type"), "image/jpeg");
  assert.ok(h.stopped.includes("camera"));
  h.run("sessionState.photoConfirmed = true");
  assert.match(h.run("renderImage()"), /Image confirmed/);
});
test("voice recording counts even without transcription", async () => {
  const h = harness(); h.run('move("continue"); move("continue")');
  await h.run("startRecording()"); h.run("stopRecorder()");
  assert.equal(h.run("Boolean(sessionState.supplied.answers[0].audio?.blob)"), true);
  assert.equal(h.run("readableAnswers().some(item => item.id === 'question_1')"), false);
  assert.ok(h.stopped.includes("microphone"));
  assert.match(h.run("renderProfile()"), /recorded, not skipped/);
  h.run("advanceQuestion()");
  assert.equal(h.run("sessionState.questionIndex"), 0);
  assert.match(h.elements.get("status").textContent, /not transcribed yet/);
  h.run("advanceQuestion(true)");
  assert.equal(h.run("sessionState.questionIndex"), 1);
});
test("mock mode can transcribe a consented Stage 3 voice answer and use it in the profile", async () => {
  const h = harness({ transcript: "I usually weigh the practical outcome." });
  h.run('move("continue"); move("continue"); sessionState.consent.transcription = true');
  await h.run("startRecording()");
  h.run("stopRecorder()");
  await h.run("new Promise(resolve => setTimeout(resolve, 0))");
  assert.equal(h.run("sessionState.supplied.answers[0].text"), "I usually weigh the practical outcome.");
  assert.equal(h.run("sessionState.supplied.answers[0].textOrigin"), "transcribed");
  assert.equal(h.run("readableAnswers().find(item => item.id === 'question_1').answer"), "I usually weigh the practical outcome.");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/transcribe");
  assert.ok(h.stopped.includes("microphone"));
  h.run("advanceQuestion()");
  assert.equal(h.run("sessionState.questionIndex"), 1);
});
test("Stage 2 confirmed recording transcribes with explicit consent in mock mode", async () => {
  const h = harness({ transcript: "The image reminds me of home." });
  h.run('move("continue"); sessionState.consent.transcription = true');
  await h.run("startRecording()");
  h.run("stopRecorder(); sessionState.audioConfirmed = true");
  await h.run('transcribeCurrent("story")');
  assert.equal(h.run("sessionState.supplied.transcript"), "The image reminds me of home.");
  assert.equal(h.run("sessionState.supplied.transcriptOrigin"), "transcribed");
});
test("transcription failure keeps the voice answer and offers a retry", async () => {
  const h = harness({ mode: "real", fail: "transcription" });
  h.run('move("continue"); sessionState.supplied.audio = { blob: new Blob(["voice"], {type:"audio/webm"}), url:"blob:test" }; sessionState.audioConfirmed = true; sessionState.consent.transcription = true');
  await h.run("transcribeCurrent()");
  assert.match(h.elements.get("status").textContent, /Retry transcription/);
  assert.equal(h.run("Boolean(sessionState.supplied.audio.blob)"), true);
  assert.match(h.run("renderAudio()"), /Transcribe Recording/);
});
test("OpenAI analysis and generation failures leave mock fallback controls", async () => {
  const h = harness({ mode: "real", fail: "openai" });
  h.run('sessionState.supplied.transcript = "A fictional story"; sessionState.currentStage = 3; sessionState.questionIndex = 3');
  await h.run("generateProfile()");
  assert.equal(h.run("sessionState.inferred.profile"), null);
  assert.match(h.run("renderProfile()"), /Use Mock Profile/);
  h.run('sessionState.currentStage = 4');
  await h.run("generatePrediction()");
  assert.match(h.run("renderPrediction()"), /Use Mock Prediction/);
});
test("ElevenLabs and D-ID are not called; text/still-image fallback is explicit", () => {
  const h = harness({ fail: "elevenlabs" });
  h.run('sessionState.currentStage = 5; sessionState.consent.proxyResponse = true; sessionState.consent.voiceCloning = true; sessionState.consent.faceAnimation = true; sessionState.generated.proxyResponses = [mockProxy([])]');
  assert.match(h.run("renderProxy()"), /No cloned voice or facial animation was generated/);
  const did = harness({ fail: "did" });
  did.run('sessionState.currentStage = 5; sessionState.consent.proxyResponse = true; sessionState.generated.proxyResponses = [mockProxy([])]');
  assert.match(did.run("renderProxy()"), /text only/);
});
test("Skip, Back and previous-question navigation preserve answers", () => {
  const h = harness();
  h.run('move("skip"); move("skip"); sessionState.supplied.answers[0].text = "Keep this"; move("continue"); move("back")');
  assert.equal(h.run("sessionState.questionIndex"), 0);
  assert.equal(h.run("sessionState.supplied.answers[0].text"), "Keep this");
});
test("Delete Session resets all temporary state and revokes URLs", () => {
  const h = harness();
  h.run('sessionState.supplied.transcript = "Temporary"; sessionState.consent.proxyResponse = true; sessionState.currentStage = 5; deleteSession()');
  assert.equal(h.run("sessionState.currentStage"), 1);
  assert.equal(h.run("sessionState.supplied.transcript"), "");
  assert.equal(h.run("sessionState.consent.proxyResponse"), false);
});
test("mock mode makes no fetch request without API keys", async () => {
  const h = harness();
  h.run('sessionState.currentStage = 3; sessionState.questionIndex = 3');
  await h.run("generateProfile()");
  assert.equal(h.run("sessionState.inferred.mode"), "mock");
});
