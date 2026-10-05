const test = require("node:test");
const assert = require("node:assert/strict");

process.env.OPENAI_API_KEY = "";
process.env.ELEVENLABS_API_KEY = "";
process.env.DID_API_KEY = "";
const server = require("../server/index.cjs");

test("server serves only integration assets and keeps secrets inaccessible", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Another Me/);
    assert.equal((await fetch(`${base}/script.js`)).status, 200);
    assert.equal((await fetch(`${base}/immersive.js`)).status, 200);
    assert.equal((await fetch(`${base}/resilience.css`)).status, 200);
    assert.equal((await fetch(`${base}/immersive.css`)).status, 200);
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
    assert.equal((await fetch(`${base}/server/index.cjs`)).status, 404);
    const capabilities = await (await fetch(`${base}/api/capabilities`)).json();
    assert.deepEqual(capabilities, { openai: false, elevenlabs: false, did: false });
    const transcribe = await fetch(`${base}/api/transcribe`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(transcribe.status, 503);
    const profile = await fetch(`${base}/api/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [{ id: "q1", question: "What?", answer: "Synthetic input" }] }) });
    assert.equal(profile.status, 503);
    const clonedSpeech = await fetch(`${base}/api/cloned-speech?text=I%20would%20respond.`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(clonedSpeech.status, 503);
    const avatar = await fetch(`${base}/api/talking-avatar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_type: "image/jpeg", image_base64: Buffer.from("image").toString("base64"), audio_type: "audio/mpeg", audio_base64: Buffer.from("audio").toString("base64") }) });
    assert.equal(avatar.status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
