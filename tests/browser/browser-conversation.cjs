const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const installDeviceFixture = require("./device-fixture.cjs");
const base = process.env.TEST_URL || "http://127.0.0.1:4187";
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
const next = '.navigation [data-action="continue"]';
async function fits(page, name) {
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __v6.getPageCount()), 1, `${name}: split task`);
  const bad = await page.evaluate(() => {
    const stage = document.getElementById("stage"), box = stage.getBoundingClientRect();
    return [...stage.querySelectorAll("h2,h3,p,button,textarea,audio,label,summary")].filter(e => e.checkVisibility() && !e.classList.contains("sr-only")).filter(e => {
      const r = e.getBoundingClientRect();
      return r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1;
    }).map(e => ({ tag: e.tagName, text: e.textContent.slice(0, 65), box: e.getBoundingClientRect().toJSON(), stage: box.toJSON() }));
  });
  if (bad.length) await page.screenshot({ path: path.join(artifacts, "conversation-overflow.png") });
  assert.deepEqual(bad, [], name);
  assert.equal(await page.locator('#stage [data-action="next-question"]:visible,#stage [data-action="next-profile-item"]:visible,#stage [data-action="profile-move-on"]:visible').count(), 0);
  assert(await page.locator(next).isVisible());
}
async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1840, height: 830 } });
  const errors = [], speech = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await installDeviceFixture(page);
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/capabilities") return route.fulfill({ json: { openai: true, elevenlabs: true, did: true } });
    if (url.pathname === "/api/transcribe") return route.fulfill({ contentType: "text/plain", body: "Usually the practical outcome matters, but I also listen to other people." });
    if (url.pathname === "/api/cloned-speech") { speech.push(url.searchParams.get("text")); return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("synthetic audio") }); }
    return route.fulfill({ status: 503, json: { error: "Synthetic offline response" } });
  });
  try {
    await page.goto(`${base}/?mode=mock&dev=1`);
    await page.evaluate(() => {
      __v6.room.reduce(true); sessionState.started = true; sessionState.currentStage = 3;
      sessionState.ui.inputMode.question_1 = "speak"; sessionState.consent.transcription = true; render();
    });
    await page.locator('[data-action="start-recording"]').click();
    await page.waitForFunction(() => !!recorder);
    assert(await page.locator(next).isDisabled());
    await page.waitForTimeout(400);
    await page.locator('[data-action="stop-recording"]').click();
    await page.waitForFunction(() => !!sessionState.supplied.answers[0].text && !busy);
    await fits(page, "Recorded answer and transcript");
    await page.locator("#questionText").fill("I balance practical outcomes with fairness.");
    assert(await page.locator(next).isEnabled());
    await page.locator(next).click();
    assert.equal(await page.evaluate(() => sessionState.questionIndex), 1);
    await page.locator('[data-action="back"]').click();
    assert.equal(await page.locator("#questionText").inputValue(), "I balance practical outcomes with fairness.");
    assert(await page.locator("audio").isVisible());
    results.push("One footer action advances a confirmed transcript; Back retains edited text and recording");
    for (const size of [{ width: 1840, height: 830 }, { width: 1280, height: 720 }, { width: 920, height: 415 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(size);
      await page.evaluate(() => { sessionState.questionIndex = 0; render(); });
      await fits(page, `${size.width}: recorded question`);
      if (size.width === 1840 || size.width === 360) await page.screenshot({ path: path.join(artifacts, `conversation-answer-${size.width}.png`) });
      await page.evaluate(() => {
        sessionState.consent.transcription = false;
        sessionState.supplied.answers[0].text = "";
        render();
      });
      await fits(page, `${size.width}: audio awaiting transcription consent`);
      assert(await page.locator('[data-action="allow-transcription"]').isVisible());
      await page.locator("#questionText").fill("");
      assert(await page.locator(next).isDisabled());
      await page.locator("#questionText").fill("I balance practical outcomes with fairness.");
      assert(await page.locator(next).isEnabled());
      await page.evaluate(() => { sessionState.consent.transcription = true; render(); });
      await page.evaluate(() => {
        sessionState.inferred.profile = mockProfile(readableAnswers());
        sessionState.inferred.profile.contradictions = [{ description: "You value practical outcomes, but also want other people's views to count. When they conflict, it is unclear which matters more to you.", evidence_ids: ["question_1"], possible_explanation: "The situation may change your priorities." }];
        sessionState.questionIndex = 3; sessionState.ui.profilePage = sessionState.inferred.profile.inferred_information.length + 1; render();
      });
      await fits(page, `${size.width}: contradiction conversation`);
      assert(await page.locator(".contradiction-description").isVisible());
      assert(await page.locator("#contradictionExplanation").isVisible());
      assert(await page.locator(".debate-reply .source-label").isVisible());
      await page.locator("#contradictionExplanation").fill("I decide based on the situation, not a fixed priority.");
      await page.locator('[data-verdict="not-a-contradiction"]').click();
      await fits(page, `${size.width}: contradiction response`);
      if (size.width === 1840 || size.width === 360) await page.screenshot({ path: path.join(artifacts, `conversation-debate-${size.width}.png`) });
      await page.locator(next).click();
      assert.equal(await page.evaluate(() => sessionState.currentStage), 4);
      assert.equal(await page.evaluate(() => sessionState.inferred.contradictionFeedback[0].verdict), "not-a-contradiction");
      await page.evaluate(() => { sessionState.currentStage = 3; render(); });
      results.push(`${size.width}x${size.height}: question/audio/transcript and contradiction/response share one frame`);
    }
    await page.evaluate(() => {
      window.longStatement = "You may choose practical results in one context, while giving other people more influence in another. ".repeat(12).trim();
      sessionState.inferred.profile.contradictions[0].description = window.longStatement;
      render();
    });
    const parts = [];
    for (let i = 0; i < 100; i++) {
      await fits(page, "Long statement with reply still visible");
      parts.push(await page.locator(".contradiction-description").innerText());
      assert(await page.locator("#contradictionExplanation").isVisible());
      const more = page.locator('[data-claim-page="next"]');
      if (!(await more.count()) || !(await more.isEnabled())) break;
      await more.click();
    }
    assert.equal(parts.join(" "), await page.evaluate(() => window.longStatement));
    assert.match(await page.locator("#contradictionExplanation").inputValue(), /situation/);
    results.push("Long contradiction turns within its claim pane; every word is reachable beside the unchanged reply");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { sessionState.currentStage = 4; render(); });
    await page.locator(next).click();
    await page.locator('[data-action="switch-input"][data-mode="type"]').click();
    await page.locator("#actualAnswer").fill("I would renegotiate the promise first.");
    assert.equal(await page.locator(next).getAttribute("data-forward-action"), "compare-prediction");
    assert.equal(await page.locator('#stage [data-action="compare-prediction"]:visible').count(), 0);
    await page.locator(next).click();
    assert.equal(await page.evaluate(() => sessionState.ui.predictionCompared), true);
    results.push("Stage 4 retains comparison/review sequence with one forward control");
    await page.evaluate(() => { sessionState.currentStage = 2; sessionState.supplied.transcript = "Keep my words."; __v6.room.reduce(false); render(); });
    await page.locator(next).click();
    assert.equal(await page.evaluate(() => __v6.room.journey.direction), 1);
    await page.waitForTimeout(1050);
    assert.equal(await page.evaluate(() => __v6.room.journey), null);
    await page.locator('[data-action="back"]').click();
    assert.equal(await page.evaluate(() => __v6.room.journey.direction), -1);
    await page.locator('.utility [data-action="end"]').click();
    assert.equal(await page.evaluate(() => __v6.room.journey), null);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => sessionState.ended), true);
    results.push("Forward descends, Back ascends, End cancels passage without losing inputs");
    await page.goto(`${base}/?dev=1`);
    await page.evaluate(() => {
      __v6.room.reduce(true); sessionState.started = true; sessionState.currentStage = 5; __v6.state().checkpoint = false;
      sessionState.consent.proxyResponse = true; sessionState.consent.voiceCloning = true;
      const blob = new Blob(["synthetic sample"], { type: "audio/webm" });
      sessionState.supplied.answers[0].audio = { blob, url: URL.createObjectURL(blob), type: "audio/webm" };
      sessionState.ui.selectedVoiceTarget = "question_1";
      sessionState.generated.proxyResponses = [{ text: "This is what I think you would do. I would ask to be consulted next time. [question_1, question_3]", evidence_ids: ["question_1", "question_3"], confidence_label: "low" }]; render();
    });
    assert.doesNotMatch(await page.locator("blockquote").innerText(), /question[_ ]/);
    await page.evaluate(() => generateProxyMedia());
    assert.equal(speech.length, 1); assert.equal(speech[0], "I would ask to be consulted next time.");
    assert.deepEqual(await page.evaluate(() => sessionState.generated.proxyResponses[0].evidence_ids), ["question_1", "question_3"]);
    results.push("Rendered and cloned-voice scripts exclude source IDs; evidence metadata is preserved (synthetic providers)");
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(path.join(artifacts, "conversation-results.json"), JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(results.join("\n"));
}
run().catch(e => { console.error(e); process.exitCode = 1; });
