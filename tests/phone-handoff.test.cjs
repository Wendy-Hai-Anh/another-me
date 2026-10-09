const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OPENAI_API_KEY = "";
const handoff = require("../server/phone-handoff.cjs");

// A tiny JPEG-shaped buffer: SOI, APP0 (JFIF), APP1 (EXIF with a location), a comment, SOS and image data, EOI.
function segment(marker, payload) {
  const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
}
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")),
  segment(0xe1, Buffer.from("Exif\0\0GPSLatitude 51.5074 GPSLongitude -0.1278 Model iPhone", "binary")),
  segment(0xfe, Buffer.from("taken at home")),
  segment(0xda, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
  Buffer.from([0x11, 0x22, 0x33, 0xff, 0xd9])
]);
const fakeRequest = host => ({ headers: { host }, socket: {} });

test("a phone code is one-time, carries one metadata-free photo to the screen, and is then forgotten", async () => {
  const code = handoff.create(fakeRequest("another-me-api.onrender.com"), "0.0.0.0");
  assert.equal(code.available, true);
  assert.match(code.phone_url, /^http:\/\/another-me-api\.onrender\.com\/phone\/[A-Za-z0-9_-]{22}$/);
  assert.equal(code.qr.rows.length, code.qr.size);
  assert.deepEqual(handoff.status(code.id), { status: "waiting" });

  const waiting = handoff.wait(code.id, 2_000);
  handoff.upload(code.id, jpeg);
  const result = await waiting;
  assert.equal(result.status, "ready");
  const text = result.photo.toString("binary");
  assert.doesNotMatch(text, /GPS|iPhone|taken at home/);
  assert.match(text, /JFIF/);
  assert.deepEqual([...result.photo.subarray(-2)], [0xff, 0xd9]);

  // Collected once: the photo and the code are gone from the server.
  assert.deepEqual(await handoff.wait(code.id, 10), { status: "gone" });
  assert.equal(handoff._sessions.has(code.id), false);
  assert.throws(() => handoff.upload(code.id, jpeg), error => error.statusCode === 410);
});

test("the phone cannot send twice, send something other than a JPEG, or use an unknown code", async () => {
  const code = handoff.create(fakeRequest("example.test"), "0.0.0.0");
  assert.throws(() => handoff.upload(code.id, Buffer.from("<svg onload=alert(1)>")), error => error.statusCode === 415);
  handoff.upload(code.id, jpeg);
  assert.throws(() => handoff.upload(code.id, jpeg), error => error.statusCode === 409);
  assert.throws(() => handoff.upload("not-a-real-code", jpeg), error => error.statusCode === 410);
  handoff.cancel(code.id);
  assert.deepEqual(handoff.status(code.id), { status: "gone" });
  assert.equal((await handoff.wait(code.id, 10)).status, "gone");
});

test("a loopback-only local server says phone upload is unavailable instead of showing an unreachable code", () => {
  assert.deepEqual(handoff.create(fakeRequest("127.0.0.1:4187"), "127.0.0.1"), { available: false, reason: "local_only" });
  process.env.PHONE_BASE_URL = "https://phone.example.test/";
  try { assert.match(handoff.create(fakeRequest("127.0.0.1:4187"), "127.0.0.1").phone_url, /^https:\/\/phone\.example\.test\/phone\//); }
  finally { delete process.env.PHONE_BASE_URL; }
});

test("over HTTP: the screen opens a code, the phone page and photo route work, and the screen collects the photo", async () => {
  process.env.PHONE_BASE_URL = "https://phone.example.test";
  const server = require("../server/index.cjs");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const code = await (await fetch(`${base}/api/handoff`, { method: "POST" })).json();
    assert.equal(code.available, true);
    const page = await fetch(`${base}/phone/${code.id}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Send a photo to the screen/);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(`${base}/phone/phone.js`)).status, 200);
    assert.equal((await fetch(`${base}/api/handoff/${code.id}/photo`, { method: "POST", headers: { "Content-Type": "image/png" }, body: jpeg })).status, 415);
    const sent = await fetch(`${base}/api/handoff/${code.id}/photo`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
    assert.equal(sent.status, 200);
    const collected = await fetch(`${base}/api/handoff/${code.id}/wait`);
    assert.equal(collected.status, 200);
    assert.equal(collected.headers.get("content-type"), "image/jpeg");
    assert.doesNotMatch(Buffer.from(await collected.arrayBuffer()).toString("binary"), /GPS/);
    assert.equal((await fetch(`${base}/api/handoff/${code.id}/wait`)).status, 410);
    assert.equal((await fetch(`${base}/api/handoff/${code.id}/wait`, { method: "POST" })).status, 405);
    const foreign = await fetch(`${base}/api/handoff`, { method: "POST", headers: { Origin: "https://elsewhere.example" } });
    assert.equal(foreign.status, 403);
  } finally {
    delete process.env.PHONE_BASE_URL;
    await new Promise(resolve => server.close(resolve));
  }
});
