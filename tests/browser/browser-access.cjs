const assert = require("node:assert/strict");
const { chromium } = require("playwright");
process.env.ACCESS_CODE = "synthetic-access-test";
process.env.OPENAI_API_KEY = "";
process.env.ELEVENLABS_API_KEY = "";
process.env.DID_API_KEY = "";
const server = require("../../server/index.cjs");

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const blockedStorage of [false, true]) {
      const page = await browser.newPage({ viewport: blockedStorage ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
      const errors = [], paidRequests = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", req => { if (req.method() === "POST") paidRequests.push(req.url()); });
      if (blockedStorage) await page.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
        Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
      });
      let first = true;
      await page.route("**/api/capabilities", route => {
        if (first) { first = false; return route.abort(); }
        return route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/?dev=1`);
      await page.locator("#accessCode").waitFor();
      await page.evaluate(() => __v6.room.reduce(true));
      const enter = page.locator('[data-v6="begin"]');
      await enter.click();
      await page.waitForFunction(() => document.getElementById("accessStatus").textContent.includes("Enter the researcher's"));
      assert.equal(await page.evaluate(() => sessionState.started), false);
      await page.locator("#accessCode").fill("incorrect");
      await enter.click();
      await page.waitForFunction(() => document.getElementById("accessStatus").textContent.includes("not accepted"));
      assert.equal(await page.evaluate(() => sessionState.started), false);
      await page.locator("#accessCode").fill("synthetic-access-test");
      await enter.click();
      await page.waitForFunction(() => sessionState.started);
      assert.equal(await page.evaluate(() => apiHeaders()["X-Access-Code"]), "synthetic-access-test");
      await page.evaluate(() => {
        sessionState.supplied.transcript = "Synthetic answer retained";
        responseFailure({ status: 401 }, "Access needed", "access_code_required");
      });
      assert(await page.locator("#accessDialog").isVisible());
      await page.locator("#recoveryAccessCode").fill("synthetic-access-test");
      await page.locator('#accessForm [type="submit"]').click();
      await page.waitForFunction(() => document.getElementById("accessRecoveryStatus").textContent.includes("Nothing has been uploaded"));
      await page.locator('[data-v6="close-access"]').click();
      assert.equal(await page.evaluate(() => sessionState.supplied.transcript), "Synthetic answer retained");
      assert.deepEqual(paidRequests, []);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${blockedStorage ? "phone / blocked storage" : "desktop / storage available"}: initial capabilities failure, empty/wrong/valid codes, recovery, preserved input, no paid requests`);
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
