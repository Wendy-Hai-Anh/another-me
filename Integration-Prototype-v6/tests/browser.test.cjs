const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const installDeviceFixture = require("./device-fixture.cjs");

const base = process.env.TEST_URL || "http://127.0.0.1:4187";
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const report = [];
async function run() {
  const launch = () => chromium.launch({ channel: "msedge", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  let browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let paidCalls = 0;
    const intercept = route => {
      if (route.request().url().endsWith("/api/capabilities")) return route.fulfill({ json: { openai: true, elevenlabs: true, did: true } });
      paidCalls++;
      return route.fulfill({ status: 503, json: { error: "Synthetic offline response" } });
    };
    await page.route("**/api/**", intercept);
    await page.goto(`${base}/?mode=mock&dev=1`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(artifacts, "opening.png") });
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.locator('[data-v6="begin"]').click();
    await page.mouse.move(650, 430);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(350);
    const depth = await page.evaluate(() => __v6.room.targetDepth);
    assert(depth > 0 && depth <= .11);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => __v6.room.targetDepth)) < depth);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(artifacts, "tunnel.png") });
    assert.equal(await page.evaluate(() => !!cameraStream || !!micStream), false);
    await page.locator('[data-v6="enter"]').first().click();
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => sessionState.currentStage), 1);
    assert.equal(await page.evaluate(() => __v6.room.tunnel), false);
    await page.mouse.wheel(0, 2000);
    assert.equal(await page.evaluate(() => sessionState.currentStage), 1);
    report.push("Opening: forward/reverse wheel, keyboard, skip, no device requests, no wheel navigation after entry");
    await page.locator("#motionToggle").click();
    await page.locator('[data-action="skip"]').click();
    await page.waitForTimeout(120);
    await page.locator('[data-action="switch-input"][data-mode="type"]').click();
    await page.locator("#storyText").fill("I care about clear communication and practical solutions.");
    await page.locator('.navigation [data-action="continue"]').click();
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-action="switch-input"][data-mode="type"]').click();
      await page.locator("#questionText").fill(["I value practical results but also fairness.", "I explain my deadline and offer help afterwards.", "People sometimes mistake my quietness for indifference."][i]);
      await page.locator('.navigation [data-forward-action="next-question"]').click();
      await page.waitForTimeout(120);
    }
    while (await page.locator('.navigation [data-forward-action="next-profile-item"]').count()) { await page.locator('.navigation [data-forward-action="next-profile-item"]').click(); await page.waitForTimeout(60); }
    assert((await page.locator("#stage").innerText()).includes("No contradiction was identified"));
    await clickPaged(page, '[data-action="profile-move-on"]');
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#actualAnswer").count(), 0);
    await clickPaged(page, '[data-action="predict"]');
    await clickPaged(page, '[data-action="switch-input"][data-mode="type"]');
    await clickPaged(page, '#actualAnswer');
    await page.locator("#actualAnswer").fill("It depends on the importance of each commitment.");
    await clickPaged(page, '[data-action="compare-prediction"]');
    await clickPaged(page, '[data-action="rate-prediction"][data-value="Partly correct"]');
    await page.locator('.navigation [data-action="continue"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => __v6.state().checkpoint), true);
    await clickPaged(page, '[data-v6="text-only"]');
    await clickPaged(page, '[data-action="generate-proxy"]');
    await clickPaged(page, '[data-action="review-proxy"]');
    await page.screenshot({ path: path.join(artifacts, "double.png") });
    await page.locator('.navigation [data-action="continue"]').click();
    await clickPaged(page, '[data-v6="allow-simulation"]');
    assert.equal(await page.evaluate(() => __v6.state().simulationStep), "scenario");
    assert.equal(await page.locator("#stage").getByText("This is what I think you would do.", { exact: true }).count(), 0);
    await clickPaged(page, '[data-v6="reveal-simulation"]');
    await page.screenshot({ path: path.join(artifacts, "simulation.png") });
    await clickPaged(page, '[data-v6="judge-simulation"][data-value="Partly"]');
    await clickPaged(page, '[data-v6="simulation-reflect"]');
    await clickPaged(page, '[data-action="feedback-choice"][data-value="Unsure"]');
    await page.locator('.navigation [data-action="continue"]').click();
    assert.equal(await page.evaluate(() => sessionState.finished), true);
    assert.equal(paidCalls, 0);
    report.push("Complete six-stage text-only mock journey; prediction precedes answer; separate consent; simulation reveal; zero paid calls");

    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(size);
      for (const stage of [1, 2, 3, 4, 5, 6]) {
        await page.evaluate(stage => { sessionState.finished = false; sessionState.currentStage = stage; sessionState.questionIndex = 3; __v6.state().checkpoint = false; __v6.state().simulationStep = "scene"; render(); }, stage);
        await page.waitForTimeout(100);
        const count = await page.evaluate(() => __v6.getPageCount());
        for (let i = 0; i < count; i++) {
          const overflow = await page.evaluate(() => {
            const main = document.getElementById("stage"), sheet = main.querySelector('.flow-sheet:not([hidden])');
            const r = main.getBoundingClientRect(), body = document.documentElement;
            return { page: body.scrollHeight > innerHeight + 1 || body.scrollWidth > innerWidth + 1, sheet: sheet && sheet.scrollHeight > sheet.clientHeight + 1, bottom: r.bottom > innerHeight + 1, controls: [...(sheet?.querySelectorAll("button,textarea,select,audio") || [])].filter(e => e.checkVisibility()).some(e => e.getBoundingClientRect().bottom > r.bottom + 1), stage: sessionState.currentStage };
          });
          if (overflow.page || overflow.sheet || overflow.bottom || overflow.controls) {
            await page.screenshot({ path: path.join(artifacts, "overflow.png") });
            console.log(await page.evaluate(() => [...document.querySelector('#stage .flow-sheet:not([hidden])').children].map(e => ({ tag: e.tagName, text: e.textContent.slice(0, 70), y: e.getBoundingClientRect().y, bottom: e.getBoundingClientRect().bottom }))));
          }
          assert(!overflow.page && !overflow.sheet && !overflow.bottom && !overflow.controls, `${JSON.stringify(size)} page ${i}: ${JSON.stringify(overflow)}`);
          const next = page.locator('.navigation [data-forward-action="read-next"]');
          if (await next.count() && await next.isEnabled()) await next.click();
        }
      }
      report.push(`All six stages fit ${size.width}x${size.height} without page or reading-panel scrolling`);
    }
    // Isolate the browser's fake capture driver from the preceding viewport/resource stress test.
    await browser.close();
    browser = await launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", intercept);
    await installDeviceFixture(page);
    await page.goto(`${base}/?mode=mock&dev=1`);
    await page.evaluate(() => { __v6.room.reduce(true); sessionState.started = true; sessionState.currentStage = 2; sessionState.supplied.transcript = "Keep this answer during camera changes."; render(); });
    await page.locator('[data-v6="camera-switch"]').click();
    await page.waitForFunction(() => !!cameraStream && document.getElementById("presenceVideo")?.currentTime > .25);
    if (!(await page.locator("video#presenceVideo").count())) console.log(await page.evaluate(() => ({ op: sessionState.operations.camera, ended: sessionState.ended, started: sessionState.started, stage: sessionState.currentStage, camera: !!cameraStream })));
    assert.equal(await page.locator("video#presenceVideo").count(), 1);
    await page.locator('[data-v6="camera-switch"]').click();
    assert.equal(await page.locator('[data-v6="camera-switch"]').count(), 1);
    await page.locator('[data-v6="camera-switch"]').click();
    await page.waitForFunction(() => !!cameraStream && document.getElementById("presenceVideo")?.currentTime > .25).catch(async error => {
      console.log(await page.evaluate(() => ({ camera: !!cameraStream, operation: sessionState.operations.camera, active: [...activeOperations.keys()], consent: sessionState.consent.cameraPresence, stage: sessionState.currentStage, ended: sessionState.ended })));
      throw error;
    });
    assert.equal(await page.evaluate(() => !!cameraStream), true);
    assert.equal(await page.evaluate(() => sessionState.supplied.transcript), "Keep this answer during camera changes.");
    report.push("Controlled canvas MediaStream switches off and on again; square dock persists (not a physical-camera test)");
    await page.evaluate(() => { sessionState.currentStage = 1; render(); });
    await page.waitForFunction(() => document.getElementById("cameraVideo")?.videoWidth > 0);
    await clickPaged(page, '[data-action="capture"]');
    await page.waitForFunction(() => !!sessionState.supplied.image);
    assert.equal(await page.locator("video:visible").count(), 0);
    await clickPaged(page, '[data-action="confirm-image"]');
    assert.equal(await page.evaluate(() => sessionState.photoConfirmed), true);
    await clickPaged(page, '[data-action="retake"]');
    await page.waitForFunction(() => document.getElementById("cameraVideo")?.videoWidth > 0);
    assert.equal(await page.locator("video:visible").count(), 1);
    report.push("Capture, confirm and retake use one preview; captured image does not leave a second camera beneath it");
    await page.evaluate(() => { sessionState.currentStage = 2; sessionState.ui.inputMode.story = "speak"; render(); });
    await clickPaged(page, '[data-action="start-recording"]');
    await page.waitForFunction(() => !!recorder);
    assert.equal(await page.locator("#recordingIndicator").isVisible(), true);
    await page.waitForTimeout(1100);
    await clickPaged(page, '[data-action="stop-recording"]');
    await page.waitForFunction(() => !!sessionState.supplied.audio?.blob?.size && !recorder);
    await clickPaged(page, '[data-action="confirm-audio"]');
    assert.equal(await page.evaluate(() => sessionState.audioConfirmed), true);
    assert.equal(await page.evaluate(() => !!micStream), false);
    await page.evaluate(async () => { const player = document.querySelector('#stage audio'); await player.play(); player.pause(); });
    assert.equal(paidCalls, 0);
    report.push("Synthetic microphone recording, stop, confirmation and playback; recording indicator; no transcription without separate consent");
    page.on("dialog", dialog => dialog.accept());
    await page.locator('.utility [data-action="delete-session"]').click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => sessionState.started || !!cameraStream || !!micStream), false);
    assert.equal(await page.evaluate(() => __v6.state().entry), "title");
    assert.equal(errors.length, 0, errors.join("\n"));
    report.push("Delete Session clears state/devices and resets entrance; no browser JavaScript errors");
    await page.evaluate(() => __v6.room.reduce(false));
    await page.locator('[data-v6="begin"]').click();
    for (let i = 0; i < 12; i++) await page.keyboard.press("PageDown");
    await page.waitForFunction(() => sessionState.started && sessionState.currentStage === 1);
    await page.waitForTimeout(650);
    await page.locator('[data-action="skip"]').click();
    await page.waitForFunction(() => sessionState.currentStage === 2);
    await page.waitForTimeout(650);
    await page.locator('[data-action="back"]').click();
    await page.waitForFunction(() => sessionState.currentStage === 1);
    assert.equal(await page.evaluate(() => __v6.room.tunnel), false);
    report.push("Full-depth keyboard entrance completes; Back does not replay it after entry");
  } finally {
    fs.writeFileSync(path.join(artifacts, "browser-results.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(report.join("\n"));
}
async function clickPaged(page, selector) {
  for (let i = 0; i < 40; i++) {
    const action = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];
    const forward = page.locator(`.navigation [data-forward-action="${action}"]`);
    if (action && await forward.count()) { await forward.click(); await page.waitForTimeout(130); return; }
    const target = page.locator(`${selector}:visible`).first();
    if (await target.count()) { await target.click(); await page.waitForTimeout(130); return; }
    const next = page.locator('.navigation [data-forward-action="read-next"]');
    if (await next.count() && await next.isEnabled()) { await next.click(); continue; }
    throw new Error(`Could not find ${selector}: ${await page.locator("#stage").innerText()}`);
  }
  throw new Error(`Too many panels looking for ${selector}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
