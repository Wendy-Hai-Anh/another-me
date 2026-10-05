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
    for (const asset of ["js/script.js", "js/v6.js", "css/v6.css", "js/motion.js", "js/proxy-text.js", "js/simulation-core.js"]) assert.equal((await fetch(`${base}/${asset}`)).status, 200);
    for (const hidden of ["script.js", "server/index.cjs", "shared/proxy-text.js", "package.json", "archive/media-samples/portrait.jpg"]) assert.equal((await fetch(`${base}/${hidden}`)).status, 404);
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
    assert.equal((await fetch(`${base}/server/index.cjs`)).status, 404);
    const capabilities = await (await fetch(`${base}/api/capabilities`)).json();
    assert.deepEqual(capabilities, { openai: false, elevenlabs: false, did: false });
    const transcribe = await fetch(`${base}/api/transcribe`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(transcribe.status, 503);
    const profile = await fetch(`${base}/api/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [{ id: "q1", question: "What?", answer: "Synthetic input" }] }) });
    assert.equal(profile.status, 503);
    const simulate = body => fetch(`${base}/api/simulation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    for (const body of [null, {}, { answers: [null] }, { answers: [{ id: "q1", answer: "x".repeat(4001) }] }, { answers: [], context: "invalid" }, { answers: [], seen_scenarios: "invalid" }, { answers: [], context: { profile_feedback: [null] } }, { answers: [], discussed_questions: [null] }]) {
      assert.equal((await simulate(body)).status, 400);
    }
    const simulation = await simulate({ answers: [] });
    assert.equal(simulation.status, 503);
    const safeMessage = await simulation.text();
    assert(!/sk-|stack|node_modules|OPENAI_API_KEY/.test(safeMessage));
    const clonedSpeech = await fetch(`${base}/api/cloned-speech?text=I%20would%20respond.`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(clonedSpeech.status, 503);
    const unsafeScript = await fetch(`${base}/api/cloned-speech?text=${encodeURIComponent("My answer to question one explains it.")}`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: "synthetic" });
    assert.equal(unsafeScript.status, 422, "Source narration is rejected before checking/calling the voice provider");
    const avatar = await fetch(`${base}/api/talking-avatar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_type: "image/jpeg", image_base64: Buffer.from("image").toString("base64"), audio_type: "audio/mpeg", audio_base64: Buffer.from("audio").toString("base64") }) });
    assert.equal(avatar.status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
