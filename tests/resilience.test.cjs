const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "public", "js", "script.js"), "utf8");

function harness({ search = "?dev=1", fetchMode = "success" } = {}) {
  const elements = new Map();
  const stopped = [];
  const errors = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: "", textContent: "", className: "", disabled: false, value: "", open: false,
      hidden: false, dataset: {}, videoWidth: 320, videoHeight: 240, srcObject: null,
      play: async () => {}, focus() {}, close() { this.open = false; }, showModal() { this.open = true; },
      removeAttribute(name) { if (name === "data-state") delete this.dataset.state; }
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
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      });
    }
  }
  const context = vm.createContext({
    document, Blob, URL, URLSearchParams, AbortController, MediaRecorder: Recorder, FileReader: Reader,
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search, hostname: "127.0.0.1" }, isSecureContext: true,
    __ANOTHER_ME_TIMEOUTS__: {
      camera: 20, microphone: 20, transcription: 20, identity: 20, prediction: 20,
      proxy: 20, fiction: 20, elevenlabs: 20, did: 20
    },
    confirm: () => true, prompt: () => "Participant correction",
    navigator: {
      onLine: true,
      mediaDevices: { getUserMedia: async constraints => ({
        getTracks: () => [{ stop() { stopped.push(constraints.video ? "camera" : "microphone"); } }]
      }) }
    },
    speechSynthesis: { cancel() {}, speak() {} }, SpeechSynthesisUtterance: class {},
    fetch: async url => {
      if (fetchMode === "rate-limit") return { ok: false, status: 429, json: async () => ({ error: "Rate limit reached." }) };
      if (fetchMode === "empty") return { ok: true, status: 200, json: async () => ({}) };
      if (String(url).startsWith("/api/cloned-speech")) return { ok: true, status: 200, blob: async () => new Blob(["audio"], { type: "audio/mpeg" }) };
      if (url === "/api/talking-avatar") return { ok: true, status: 200, blob: async () => new Blob(["video"], { type: "video/mp4" }) };
      return { ok: false, status: 503, json: async () => ({ error: "Service unavailable." }) };
    }
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(script, context, { filename: "script.js" });
  vm.runInContext("sessionState.started = true; render()", context);
  return { run: expression => vm.runInContext(expression, context), context, elements, stopped, errors };
}

test("operation registry begins idle and exposes configurable service timeouts", () => {
  const h = harness();
  assert.deepEqual([...h.run("new Set(Object.values(sessionState.operations).map(item => item.state))")], ["idle"]);
  assert.equal(h.run("__anotherMeDev.timeoutValues().did"), 20);
  assert.equal(h.run("operationDefinitions.did.timeoutMs"), 480_000);
});

test("loading blocks duplicate work and becomes success", async () => {
  const h = harness();
  h.context.testCalls = 0;
  const pending = h.run(`runOperation("identity", () => new Promise(resolve => {
    globalThis.testCalls += 1; globalThis.finishTestOperation = () => resolve(true);
  }))`);
  await Promise.resolve();
  assert.equal(h.run("sessionState.operations.identity.state"), "loading");
  await h.run("runOperation('identity', async () => { globalThis.testCalls += 1; return true; })");
  assert.equal(h.context.testCalls, 1);
  h.context.finishTestOperation();
  await pending;
  assert.equal(h.run("sessionState.operations.identity.state"), "success");
});

test("slow-response simulation completes without becoming a timeout", async () => {
  const h = harness();
  h.run(`__anotherMeDev.setScenario("identity", "slow-response")`);
  await h.run("runOperation('identity', async () => true)");
  assert.equal(h.run("sessionState.operations.identity.state"), "success");
});

test("timeout preserves participant input and offers recovery controls", async () => {
  const h = harness();
  h.run(`sessionState.currentStage = 2; sessionState.supplied.transcript = "Keep this answer";
    __anotherMeDev.setScenario("transcription", "timeout")`);
  await h.run("runOperation('transcription', async () => true)");
  assert.equal(h.run("sessionState.operations.transcription.state"), "timeout");
  assert.equal(h.run("sessionState.supplied.transcript"), "Keep this answer");
  assert.match(h.elements.get("operationStatus").innerHTML, /Try Again/);
  assert.match(h.elements.get("operationStatus").innerHTML, /Use Fallback/);
  assert.match(h.elements.get("operationStatus").innerHTML, /Skip This Step/);
});

test("network failure keeps the last valid profile and fallback is explicit", async () => {
  const h = harness();
  h.run(`sessionState.currentStage = 3; sessionState.questionIndex = 3;
    sessionState.inferred.profile = mockProfile([]); sessionState.inferred.mode = "real";
    __anotherMeDev.setScenario("identity", "network-error")`);
  const summary = h.run("sessionState.inferred.profile.profile_summary");
  await h.run("generateProfile()");
  assert.equal(h.run("sessionState.operations.identity.state"), "error");
  assert.equal(h.run("sessionState.inferred.profile.profile_summary"), summary);
  h.run("useOperationFallback('identity')");
  assert.equal(h.run("sessionState.operations.identity.state"), "fallback");
  assert.equal(h.run("sessionState.inferred.profile.profile_summary"), summary);
});

test("permission denial supports camera upload and microphone typed fallback", async () => {
  const h = harness();
  h.run(`sessionState.consent.photoCapture = true; __anotherMeDev.setScenario("camera", "permission-denial")`);
  await h.run("enableCamera()");
  assert.equal(h.run("sessionState.operations.camera.errorCode"), "permission_denied");
  h.run("useOperationFallback('camera')");
  assert.equal(h.run("sessionState.operations.camera.state"), "fallback");
  h.run(`sessionState.currentStage = 2; __anotherMeDev.clearScenario("camera"); __anotherMeDev.setScenario("microphone", "permission-denial")`);
  await h.run("startRecording()");
  assert.equal(h.run("sessionState.operations.microphone.errorCode"), "permission_denied");
  h.run("useOperationFallback('microphone')");
  assert.equal(h.run("sessionState.operations.microphone.state"), "fallback");
});

test("rate limit and empty API response are distinguished", async () => {
  const rate = harness({ search: "?dev=1", fetchMode: "rate-limit" });
  rate.run(`sessionState.currentStage = 3; sessionState.questionIndex = 3; sessionState.supplied.transcript = "Evidence"`);
  await rate.run("generateProfile()");
  assert.equal(rate.run("sessionState.operations.identity.errorCode"), "rate_limit");

  const empty = harness({ search: "?dev=1", fetchMode: "empty" });
  empty.run(`sessionState.currentStage = 3; sessionState.questionIndex = 3; sessionState.supplied.transcript = "Evidence"`);
  await empty.run("generateProfile()");
  assert.equal(empty.run("sessionState.operations.identity.errorCode"), "empty_response");
});

test("ElevenLabs and D-ID failures follow the required media fallback order", async () => {
  const h = harness();
  h.run(`sessionState.currentStage = 5; sessionState.consent.voiceCloning = true; sessionState.consent.faceAnimation = true;
    sessionState.supplied.audio = { blob: new Blob(["voice"], { type: "audio/webm" }), url: "blob:voice", type: "audio/webm" };
    sessionState.supplied.portrait = { blob: new Blob(["portrait"], { type: "image/jpeg" }), url: "blob:portrait", origin: "webcam" };
    sessionState.generated.proxyResponses = [mockProxy([])]; __anotherMeDev.setScenario("elevenlabs", "elevenlabs-failure")`);
  await h.run("generateProxyMedia()");
  assert.equal(h.run("sessionState.operations.elevenlabs.state"), "error");
  assert.equal(h.run("sessionState.generated.proxyMedia.presentation"), "text");
  h.run("useOperationFallback('elevenlabs'); __anotherMeDev.clearScenario('elevenlabs'); __anotherMeDev.setScenario('did', 'did-failure')");
  await h.run("generateProxyMedia()");
  assert.equal(h.run("sessionState.operations.elevenlabs.state"), "success");
  assert.equal(h.run("sessionState.operations.did.state"), "error");
  assert.equal(h.run("sessionState.generated.proxyMedia.presentation"), "cloned-audio");
  assert.equal(h.run("Boolean(sessionState.generated.proxyMedia.audio)"), true);
  h.run("useOperationFallback('did')");
  assert.equal(h.run("sessionState.operations.did.state"), "fallback");
});

test("complete media failure remains a text-only journey", async () => {
  const h = harness({ search: "?dev=1&simulate=complete-media-failure" });
  h.run(`sessionState.currentStage = 5; sessionState.consent.voiceCloning = true;
    sessionState.supplied.audio = { blob: new Blob(["voice"], { type: "audio/webm" }), url: "blob:voice", type: "audio/webm" };
    sessionState.generated.proxyResponses = [mockProxy([])]`);
  await h.run("generateProxyMedia()");
  assert.equal(h.run("sessionState.operations.elevenlabs.errorCode"), "media_failure");
  h.run("useOperationFallback('elevenlabs')");
  assert.equal(h.run("sessionState.generated.proxyMedia.presentation"), "text");
  assert.match(h.run("renderProxy()"), /generated text/);
});
