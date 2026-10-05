const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const installDeviceFixture = require("./device-fixture.cjs");
const base = process.env.TEST_URL || "http://127.0.0.1:4187";
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const results = [];

async function singleScreen(page, name, selectors) {
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __v6.getPageCount()), 1, `${name}: extra panel`);
  assert.equal(await page.locator("#panelPager").isVisible(), false, `${name}: nested pager`);
  for (const selector of selectors) assert(await page.locator(selector).first().isVisible(), `${name}: missing ${selector}`);
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("#stage"), box = main.getBoundingClientRect();
    const elements = [...main.querySelectorAll("h2,h3,p,button,input,select,textarea,audio,img,video,label,summary")].filter(e => e.checkVisibility());
    return elements.filter(e => {
      const r = e.getBoundingClientRect();
      return r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1;
    }).map(e => ({ tag: e.tagName, text: e.textContent.slice(0, 60), rect: e.getBoundingClientRect().toJSON(), main: box.toJSON() }));
  });
  if (overflow.length) await page.screenshot({ path: path.join(artifacts, "panel-fix-overflow.png") });
  assert.deepEqual(overflow, [], name);
}
async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await installDeviceFixture(page);
  await page.route("**/api/**", route => route.fulfill({ status: route.request().url().endsWith("/api/capabilities") ? 200 : 503, json: { openai: true, elevenlabs: true, did: true } }));
  try {
    for (const size of [{ width: 1900, height: 850 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(size);
      await page.goto(`${base}/?mode=mock&dev=1`);
      await page.evaluate(() => __v6.room.reduce(true));
      await singleScreen(page, `${size.width}: opening`, [".opening-title", '[data-v6="begin"]']);
      if (size.width === 1900) await page.screenshot({ path: path.join(artifacts, "fixed-opening.png") });
      await page.locator('[data-v6="begin"]').click();
      assert.equal(await page.getByRole("button", { name: "Skip animation", exact: true }).count(), 0);
      assert.match(await page.locator(".tunnel-copy h2").innerText(), /Venture/);
      await page.locator('[data-v6="enter"]').click();
      for (const stage of [2, 3, 4]) {
        await page.evaluate(stage => { sessionState.currentStage = stage; sessionState.questionIndex = 0; render(); }, stage);
        await singleScreen(page, `${size.width}: prompt ${stage}`, [".spoken-prompt", stage === 4 ? '.navigation [data-forward-action="predict"]' : ".input-choice"]);
        const words = await page.locator(".spoken-prompt").evaluate(e => ({ expected: e.dataset.promptText, actual: e.querySelector(".prompt-letters").textContent }));
        assert.equal(words.actual, words.expected, "Animated words retain all spaces");
      }
      if (size.width >= 1280) {
        await page.locator('.navigation [data-forward-action="predict"]').click();
        await singleScreen(page, "Prediction plus response choices", [".prediction-line", ".input-choice"]);
        await page.locator('[data-action="switch-input"][data-mode="type"]').click();
        await singleScreen(page, "Prediction plus typed response", [".prediction-line", "#actualAnswer", '.navigation [data-forward-action="compare-prediction"]']);
      }
      for (const sample of [false, true]) {
        await page.evaluate(sample => {
          sessionState.currentStage = 5; __v6.state().checkpoint = true; __v6.state().consentPage = 0;
          sessionState.supplied.cloneSample = sample ? { blob: new Blob(["test"], { type: "audio/webm" }), url: URL.createObjectURL(new Blob(["test"])) } : null;
          sessionState.ui.selectedVoiceTarget = sample ? "clone-sample" : ""; render();
        }, sample);
        for (const [step, permission] of ["proxyResponse", "voiceCloning", "faceAnimation"].entries()) {
          if (step) await page.locator('[data-v6="consent-next"]').click();
          await singleScreen(page, `${size.width}: permission ${step}, sample ${sample}`, [`.scene-line`, `[data-consent="${permission}"]`, step === 2 ? '[data-v6="consent-finish"]' : '[data-v6="consent-next"]', ...(step === 1 ? ['[data-action="start-recording"]'] : []), ...(step === 2 ? ['[data-v6="take-portrait"]', '[data-v6="camera-switch"]'] : [])]);
          assert.equal(await page.locator("dialog[open]").count(), 0);
          if (size.width === 1900 && sample) await page.screenshot({ path: path.join(artifacts, `fixed-permission-${step + 1}.png`) });
        }
      }
      results.push(`${size.width}x${size.height}: Begin/question CTAs stay with prompts; spaces intact; exactly three consent screens with and without a sample`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { __v6.state().consentPage = 1; render(); });
    await page.locator('[data-action="start-recording"]').click();
    await page.waitForFunction(() => !!recorder);
    await singleScreen(page, "Voice permission while recording", ['[data-consent="voiceCloning"]', '[data-action="stop-recording"]']);
    await page.waitForTimeout(400);
    await page.locator('[data-action="stop-recording"]').click();
    await page.waitForFunction(() => !recorder);
    assert.equal(await page.evaluate(() => sessionState.ui.selectedVoiceTarget), "clone-sample");
    await singleScreen(page, "Voice permission after recording", ["#voiceSample", "audio", '[data-v6="consent-next"]']);
    await page.locator('[data-v6="consent-next"]').click();
    await page.locator('[data-v6="camera-switch"]').click();
    await page.waitForFunction(() => document.getElementById("presenceVideo")?.videoWidth > 0);
    await singleScreen(page, "Portrait live capture", ['[data-consent="faceAnimation"]', "video", '[data-v6="take-portrait"]']);
    assert(await page.locator("#presenceVideo").evaluate(e => Math.abs(e.getBoundingClientRect().width - e.getBoundingClientRect().height) < 1), "Portrait preview stays square");
    await page.locator('[data-v6="take-portrait"]').click();
    await page.waitForFunction(() => !!sessionState.supplied.portrait);
    await singleScreen(page, "Portrait confirmation", ["img.setup-portrait", '[data-v6="confirm-portrait"]']);
    assert.equal(await page.locator("video:visible").count(), 0);
    await page.locator('[data-v6="confirm-portrait"]').click();
    assert(await page.evaluate(() => __v6.state().portraitConfirmed));
    await page.setViewportSize({ width: 360, height: 640 });
    await singleScreen(page, "Small-phone confirmed portrait", ["img.setup-portrait", '[data-v6="confirm-portrait"]', '[data-v6="retake-portrait"]', '[data-v6="camera-switch"]']);
    await page.locator('[data-v6="retake-portrait"]').click();
    await page.waitForFunction(() => document.getElementById("presenceVideo")?.videoWidth > 0);
    await singleScreen(page, "Portrait retake", ["video", '[data-v6="take-portrait"]']);
    assert.equal(await page.locator("img.setup-portrait:visible").count(), 0);
    results.push("Phone: record/playback on voice panel; camera/capture/confirmation/retake on portrait panel, one preview only");
    await page.locator('[data-v6="camera-switch"]').click();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => __anotherMeDev.setScenario("camera", "permission-denial"));
    await page.locator('[data-v6="camera-switch"]').click();
    await page.waitForFunction(() => sessionState.operations.camera.state === "error");
    await singleScreen(page, "Portrait permission denied", ['[data-consent="faceAnimation"]', '[data-v6="camera-switch"]', '[data-v6="consent-finish"]']);
    results.push("Phone: permission-denied recovery does not obscure portrait consent or navigation");
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(path.join(artifacts, "panel-fix-results.json"), JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(results.join("\n"));
}
run().catch(e => { console.error(e); process.exitCode = 1; });
