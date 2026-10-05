const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const core = require("../../shared/simulation-core.js");
const base = process.env.TEST_URL || "http://127.0.0.1:4187";
const results = [];
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const requests = [], errors = [];
  let scenario = "success", pending = 0;
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === "/api/capabilities") return route.fulfill({ json: { openai: true, elevenlabs: true, did: true } });
    requests.push(endpoint);
    if (scenario === "offline" || endpoint === "/api/talking-avatar" && scenario === "did-failure" || endpoint === "/api/cloned-speech" && scenario === "voice-failure") return route.fulfill({ status: 503, json: { error: "Synthetic service unavailable" } });
    if (endpoint === "/api/simulation") {
      const input = route.request().postDataJSON();
      if (scenario === "slow") { pending++; await new Promise(r => setTimeout(r, 600)); }
      return route.fulfill({ json: { simulation: core.mock(input) } }).catch(() => {});
    }
    if (endpoint === "/api/transcribe") return route.fulfill({ contentType: "text/plain", body: "I prefer clear communication and practical results." });
    if (endpoint === "/api/cloned-speech") return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("synthetic audio for request/state test") });
    if (endpoint === "/api/talking-avatar") return route.fulfill({ contentType: "video/mp4", body: Buffer.from("synthetic video for request/state test") });
    return route.fulfill({ status: 503, json: { error: "No synthetic fixture for this route" } });
  });
  try {
    await page.goto(`${base}/?dev=1`);
    await page.evaluate(() => {
      __v6.room.reduce(true); sessionState.started = true;
      sessionState.supplied.answers.forEach((a, i) => a.text = ["I act directly to clarify confusion.", "Sometimes I wait quietly before responding.", "I adapt my response to the context."][i]);
      sessionState.inferred.profile = mockProfile(readableAnswers());
      sessionState.inferred.profile.contradictions = [{ evidence_ids: ["question_1", "question_2"], description: "Direct action and waiting both appear.", possible_explanation: "Different situations may call for different choices." }];
      sessionState.questionIndex = 3; sessionState.currentStage = 3; sessionState.ui.profilePage = 2; render();
    });
    await reveal(page, "#contradictionExplanation");
    await page.locator("#contradictionExplanation").fill("I wait only when the facts are unclear.");
    await click(page, '[data-action="review-contradiction"][data-verdict="context-needed"]');
    assert.equal(await page.evaluate(() => sessionState.inferred.contradictionFeedback[0].explanation), "I wait only when the facts are unclear.");
    await page.evaluate(() => { sessionState.currentStage = 6; sessionState.consent.fictionalGeneration = true; render(); });
    await click(page, '[data-v6="generate-simulation"]');
    await page.waitForFunction(() => !!sessionState.generated.simulation);
    assert.equal(await page.evaluate(() => sessionState.generated.simulation.contradictory_evidence.length), 1);
    await click(page, '[data-v6="reveal-simulation"]');
    await click(page, '[data-v6="simulation-evidence"]');
    assert.equal(await page.locator("#readerDialog").isVisible(), true);
    await assertFits(page, "#readerContent", "#readerPager");
    await page.locator('[data-v6="close-reader"]').click();
    await page.evaluate(() => { sessionState.inferred.participantFeedback.push({ id: "inference_1", verdict: "rejected", correction: "" }); render(); });
    assert.match(await page.locator("#stage").innerText(), /no longer current/);
    results.push("Contradiction explanation preserved; paginated evidence; rejection invalidates earlier simulation");

    scenario = "offline";
    const before = await page.evaluate(() => JSON.stringify(sessionState.supplied.answers));
    await click(page, '[data-v6="generate-simulation"]');
    await page.waitForFunction(() => sessionState.operations.fiction.state === "error");
    assert.equal(await page.evaluate(() => JSON.stringify(sessionState.supplied.answers)), before);
    await page.locator('[data-action="use-operation-fallback"][data-operation="fiction"]').click();
    await page.waitForFunction(() => __v6.state().simulationMode === "mock");
    results.push("OpenAI failure retains inputs and existing result; explicit mock fallback succeeds");
    await page.evaluate(() => { __anotherMeDev.setScenario("fiction", "timeout"); window.__ANOTHER_ME_TIMEOUTS__ = { fiction: 60 }; });
    await page.evaluate(() => generateFiction());
    assert.equal(await page.evaluate(() => sessionState.operations.fiction.state), "timeout");
    assert.equal(await page.evaluate(() => JSON.stringify(sessionState.supplied.answers)), before);
    await page.evaluate(() => { __anotherMeDev.clearScenario("fiction"); window.__ANOTHER_ME_TIMEOUTS__ = {}; });
    scenario = "slow";
    await page.evaluate(() => { void generateFiction(); void generateFiction(); });
    await page.waitForFunction(() => sessionState.operations.fiction.state === "success");
    assert.equal(pending, 1);
    results.push("Timeout retains input; repeated generation clicks produce one request");

    await page.evaluate(() => { sessionState.currentStage = 2; sessionState.ui.inputMode.story = "speak"; __anotherMeDev.setScenario("microphone", "permission-denial"); render(); });
    await click(page, '[data-action="start-recording"]');
    await page.waitForFunction(() => sessionState.operations.microphone.errorCode === "permission_denied");
    await page.locator('[data-action="use-operation-fallback"][data-operation="microphone"]').click();
    await reveal(page, "#storyText");
    assert.equal(await page.locator("#storyText").isVisible(), true);
    await page.evaluate(() => { __anotherMeDev.clearScenario("microphone"); __anotherMeDev.setScenario("camera", "permission-denial"); });
    await page.locator('[data-v6="camera-switch"]').click();
    await page.waitForFunction(() => sessionState.operations.camera.errorCode === "permission_denied");
    assert.equal(await page.locator('[data-v6="camera-switch"]').isVisible(), true);
    results.push("Microphone/camera denial retains typed fallback and usable camera switch");

    scenario = "offline";
    await page.evaluate(() => {
      sessionState.currentStage = 3; sessionState.questionIndex = 0; sessionState.consent.transcription = true;
      sessionState.supplied.answers[0].audio = { blob: new Blob(["synthetic"], { type: "audio/webm" }), type: "audio/webm", url: URL.createObjectURL(new Blob(["synthetic"])) };
      render();
    });
    await page.evaluate(() => transcribeCurrent("question_1"));
    assert.equal(await page.evaluate(() => !!sessionState.supplied.answers[0].audio), true);
    scenario = "success";
    await page.evaluate(() => transcribeCurrent("question_1"));
    assert.match(await page.evaluate(() => sessionState.supplied.answers[0].text), /clear communication/);
    results.push("Transcription failure preserves recording; retry writes spoken answer into identity input");

    await page.evaluate(() => { sessionState.currentStage = 5; __v6.state().checkpoint = true; __v6.state().consentPage = 0; render(); });
    await reveal(page, '[data-consent="proxyResponse"]');
    await page.locator('[data-consent="proxyResponse"]').check();
    await click(page, '[data-v6="consent-next"]');
    await reveal(page, '[data-consent="voiceCloning"]');
    await page.locator('[data-consent="voiceCloning"]').check();
    await click(page, '[data-v6="consent-next"]');
    assert.equal(await page.evaluate(() => sessionState.consent.faceAnimation), false);
    await reveal(page, '[data-consent="faceAnimation"]');
    await page.locator('[data-consent="faceAnimation"]').check();
    await click(page, '[data-v6="consent-finish"]');
    assert.equal(await page.evaluate(() => __v6.state().checkpoint), true);
    await page.evaluate(() => {
      sessionState.supplied.portrait = { blob: new Blob(["portrait"], { type: "image/jpeg" }), url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='teal'/></svg>" };
      __v6.state().portraitConfirmed = true;
      sessionState.generated.proxyResponses = [{ text: "This is what I think you would do. I would ask for a conversation.", evidence_ids: ["question_1"], confidence_label: "low" }]; render();
    });
    await click(page, '[data-v6="consent-finish"]');
    scenario = "voice-failure";
    await page.evaluate(() => generateProxyMedia());
    assert.equal(await page.evaluate(() => sessionState.generated.proxyMedia.presentation), "text");
    scenario = "did-failure";
    await page.evaluate(() => generateProxyMedia());
    assert.equal(await page.evaluate(() => sessionState.generated.proxyMedia.presentation), "cloned-audio");
    assert.equal(await page.evaluate(() => !!sessionState.generated.proxyMedia.audio), true);
    scenario = "success";
    await page.evaluate(() => generateProxyMedia());
    assert.equal(await page.evaluate(() => sessionState.generated.proxyMedia.presentation), "talking-avatar");
    assert(requests.includes("/api/cloned-speech") && requests.includes("/api/talking-avatar"));
    results.push("Independent consent checkpoint; missing portrait blocked; voice failure retains text; D-ID failure retains audio; mocked media success");

    const callsBeforeConsent = requests.length;
    for (let combination = 0; combination < 8; combination++) {
      await page.evaluate(bits => {
        sessionState.currentStage = 5; __v6.state().checkpoint = true; __v6.state().consentPage = 2;
        sessionState.consent.proxyResponse = !!(bits & 4); sessionState.consent.voiceCloning = !!(bits & 2); sessionState.consent.faceAnimation = !!(bits & 1); render();
      }, combination);
      await click(page, '[data-v6="consent-finish"]');
      const allowed = !!(combination & 4) && (!(combination & 1) || !!(combination & 2));
      assert.equal(await page.evaluate(() => __v6.state().checkpoint), !allowed, `Consent combination ${combination}`);
    }
    assert.equal(requests.length, callsBeforeConsent, "Consent alone must never start provider generation");
    await page.evaluate(() => {
      window.savedTestRecording = sessionState.supplied.answers[0].audio;
      sessionState.supplied.answers[0].audio = null;
      sessionState.consent.proxyResponse = true; sessionState.consent.voiceCloning = true; sessionState.consent.faceAnimation = false;
      __v6.state().checkpoint = true; __v6.state().consentPage = 2; render();
    });
    await click(page, '[data-v6="consent-finish"]');
    assert.equal(await page.evaluate(() => __v6.state().checkpoint && __v6.state().consentPage === 1), true);
    await page.evaluate(() => { sessionState.supplied.answers[0].audio = window.savedTestRecording; delete window.savedTestRecording; });
    results.push("All eight proxy/voice/face consent combinations; no automatic generation; missing voice sample returns to setup");

    await page.evaluate(() => {
      sessionState.currentStage = 5; __v6.state().checkpoint = false;
      sessionState.generated.proxyResponses[0].text = "This is a long synthetic response for readable pagination. ".repeat(80); render();
    });
    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForTimeout(150);
    await assertFits(page, "#stage", "#panelPager");
    await page.locator('[data-action="view-data"]').click();
    await page.waitForTimeout(100);
    await assertFits(page, "#dataContent", "#dataPager");
    await page.locator('[data-action="close-data"]').click();
    results.push("Long AI result and My Data remain readable in paginated 640x360 viewport (200% desktop layout equivalent)");
    page.on("dialog", d => d.accept());
    await page.evaluate(() => { sessionState.currentStage = 6; sessionState.consent.fictionalGeneration = true; render(); });
    scenario = "slow";
    await page.evaluate(() => { void generateFiction(); });
    await page.locator('[data-action="delete-session"]').click();
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => sessionState.generated.simulation || null), null);
    assert.equal(await page.evaluate(() => sessionState.started), false);
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push("Delete during generation prevents late output restoring personal data; no JavaScript errors");
  } finally {
    fs.writeFileSync(path.join(artifacts, "recovery-results.json"), JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(results.join("\n"));
}
async function reveal(page, selector) {
  for (let i = 0; i < 80; i++) {
    if (await page.locator(selector).first().isVisible()) return;
    const next = page.locator('.navigation [data-forward-action="read-next"]');
    if (!(await next.count()) || !(await next.isEnabled())) throw new Error(`Not reachable: ${selector}`);
    await next.click();
  }
}
async function click(page, selector) { await reveal(page, selector); await page.locator(`${selector}:visible`).first().click(); await page.waitForTimeout(120); }
async function assertFits(page, selector, pager) {
  for (let i = 0; i < 150; i++) {
    const bad = await page.locator(selector).evaluate(container => {
      const sheet = container.querySelector('.flow-sheet:not([hidden])');
      const r = container.getBoundingClientRect();
      return !sheet || sheet.scrollHeight > sheet.clientHeight + 1 || [...sheet.children].filter(e => e.checkVisibility()).some(e => e.getBoundingClientRect().bottom > r.bottom + 1);
    });
    if (bad) {
      console.log(JSON.stringify(await page.locator(selector).evaluate(c => ({ height: c.clientHeight, rect: c.getBoundingClientRect().toJSON(), sheetCount: c.children.length, sheets: [...c.children].filter(s => !s.hidden).map(s => ({ height: s.clientHeight, scroll: s.scrollHeight, rect: s.getBoundingClientRect().toJSON(), nodes: [...s.children].map(e => ({ text: e.textContent.slice(0, 55), bottom: e.getBoundingClientRect().bottom })) })) })), null, 2));
      await page.screenshot({ path: path.join(artifacts, "recovery-overflow.png") });
    }
    assert.equal(bad, false, `Overflow in ${selector}`);
    const next = page.locator(pager === "#panelPager" ? '.navigation [data-forward-action="read-next"]' : `${pager} [data-page="next"]`);
    if (!(await next.count()) || !(await next.isEnabled())) return;
    await next.click();
  }
  throw new Error("Excessive panel count");
}
run().catch(e => { console.error(e); process.exitCode = 1; });
