const test = require("node:test");
const assert = require("node:assert/strict");

process.env.OPENAI_API_KEY = "";
const server = require("../server/index.cjs");

test("server serves only integration assets and keeps secrets inaccessible", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Another Me/);
    assert.equal((await fetch(`${base}/script.js`)).status, 200);
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
    assert.equal((await fetch(`${base}/server/index.cjs`)).status, 404);
    const transcribe = await fetch(`${base}/api/transcribe`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(transcribe.status, 503);
    const profile = await fetch(`${base}/api/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [{ id: "q1", question: "What?", answer: "Synthetic input" }] }) });
    assert.equal(profile.status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
