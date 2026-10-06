const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "another-me-feedback-"));
process.env.FEEDBACK_DIR = dir;
process.env.FEEDBACK_WEBHOOK_URL = "";
process.env.OPENAI_API_KEY = "";
const feedback = require("../server/feedback-store.cjs");
const server = require("../server/index.cjs");
const record = (id, extra = {}) => ({ submission_id: id, version: "v6-test", answers: { distinguish_sources: "Yes", boundary_stage: "I CAN BE YOU" }, comments: { comment: "Synthetic comment." }, ...extra });

test("feedback is stored once, with only answers, comments and version", async () => {
  const first = await feedback.store(record("synthetic-0001"));
  assert.deepEqual(first, { stored: true, duplicate: false, mode: "disk" });
  const again = await feedback.store(record("synthetic-0001"));
  assert.equal(again.duplicate, true);
  const lines = fs.readFileSync(path.join(dir, "feedback.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(saved).sort(), ["answers", "comments", "received_at", "submission_id", "version"]);
  assert.equal(saved.answers.boundary_stage, "I CAN BE YOU");
});

test("unknown questions, unknown answers and empty forms are refused", async () => {
  await assert.rejects(feedback.store(record("synthetic-0002", { answers: { favourite_colour: "Yes" } })), error => error.statusCode === 400);
  await assert.rejects(feedback.store(record("synthetic-0003", { answers: { in_control: "Maybe" } })), error => error.statusCode === 400);
  await assert.rejects(feedback.store({ submission_id: "synthetic-0004", version: "v6-test", answers: {}, comments: {} }), error => error.statusCode === 400);
  await assert.rejects(feedback.store(record("x")), error => error.statusCode === 400);
});

test("a failing webhook is reported as a failure, never as stored", async () => {
  const sink = http.createServer((request, response) => { request.resume(); response.writeHead(500).end(); });
  await new Promise(resolve => sink.listen(0, "127.0.0.1", resolve));
  process.env.FEEDBACK_WEBHOOK_URL = `http://127.0.0.1:${sink.address().port}/`;
  try {
    await assert.rejects(feedback.store(record("synthetic-0005")), error => error.code === "feedback_store_failed");
    // The failed id is not remembered, so a later retry can still be stored.
    process.env.FEEDBACK_WEBHOOK_URL = "";
    assert.equal((await feedback.store(record("synthetic-0005"))).duplicate, false);
  } finally { process.env.FEEDBACK_WEBHOOK_URL = ""; await new Promise(resolve => sink.close(resolve)); }
});

test("the feedback route stores and the export needs its own token", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sent = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record("synthetic-0006")) });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).stored, true);
    const bad = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submission_id: "synthetic-0007" }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/feedback/export`)).status, 401);
    process.env.FEEDBACK_EXPORT_TOKEN = "synthetic-export-token";
    const exported = await fetch(`${base}/api/feedback/export`, { headers: { Authorization: "Bearer synthetic-export-token" } });
    assert.equal(exported.status, 200);
    assert.match(await exported.text(), /synthetic-0006/);
  } finally { delete process.env.FEEDBACK_EXPORT_TOKEN; await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
