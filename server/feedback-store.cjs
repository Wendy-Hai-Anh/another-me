"use strict";

// Optional participant feedback about the prototype. Only question ids, chosen answers, short comments
// and the prototype version are kept: never images, voice, answers to the experience or profiles.
// Storage: FEEDBACK_WEBHOOK_URL (e.g. a Google Apps Script or form endpoint) when set, otherwise
// newline-delimited JSON in FEEDBACK_DIR (default data/feedback). Success is reported only after the
// configured store accepted the record.
const fs = require("node:fs/promises");
const path = require("node:path");

const QUESTIONS = {
  distinguish_sources: ["Yes", "Partly", "No"],
  uncertainty_clear: ["Yes", "Partly", "No"],
  gradually_personal: ["Yes", "Partly", "No"],
  in_control: ["Yes", "Partly", "No"],
  boundary_stage: ["I SEE YOU", "I LISTEN TO YOU", "I THINK I KNOW YOU", "I CAN PREDICT YOU", "I CAN BE YOU", "I DON’T NEED YOU", "It never felt like me", "It still feels like me", "I am unsure"]
};
const COMMENTS = ["unclear_label", "comment"];
const root = path.resolve(__dirname, "..");
const directory = () => path.resolve(root, process.env.FEEDBACK_DIR || path.join("data", "feedback"));
const file = () => path.join(directory(), "feedback.jsonl");
const seen = new Map();

function mode() { return process.env.FEEDBACK_WEBHOOK_URL ? "webhook" : process.env.FEEDBACK_DISABLED === "1" ? "off" : "disk"; }
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400, publicMessage: message }); }

function clean(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Feedback is missing.");
  const id = String(input.submission_id || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw invalid("Feedback needs a submission id.");
  const version = String(input.version || "").slice(0, 64);
  if (!/^[\w.-]{1,64}$/.test(version)) throw invalid("Feedback needs the prototype version.");
  const answers = {};
  for (const [key, value] of Object.entries(input.answers || {})) {
    if (!QUESTIONS[key]) throw invalid(`Unknown feedback question: ${key.slice(0, 40)}.`);
    if (value === "" || value === null) continue;
    if (!QUESTIONS[key].includes(value)) throw invalid(`Unknown answer for ${key}.`);
    answers[key] = value;
  }
  const comments = {};
  for (const [key, value] of Object.entries(input.comments || {})) {
    if (!COMMENTS.includes(key)) throw invalid(`Unknown comment field: ${key.slice(0, 40)}.`);
    if (typeof value !== "string" || value.length > 2000) throw invalid("A comment is too long (2000 characters at most).");
    if (value.trim()) comments[key] = value.trim();
  }
  if (!Object.keys(answers).length && !Object.keys(comments).length) throw invalid("Choose at least one answer or write a comment.");
  return { submission_id: id, version, answers, comments };
}

async function forward(record, signal) {
  const response = await fetch(process.env.FEEDBACK_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record), signal
  });
  if (!response.ok) throw Object.assign(new Error("Feedback store rejected the record."), { statusCode: 502, code: "feedback_store_failed", publicMessage: "The feedback store did not accept it. Your answers are still in the form." });
}

async function store(input, { signal } = {}) {
  const record = clean(input);
  if (seen.has(record.submission_id)) return { stored: true, duplicate: true, mode: mode() };
  if (mode() === "off") throw Object.assign(new Error("Feedback storage is switched off."), { statusCode: 503, code: "feedback_not_configured", publicMessage: "Feedback storage is not set up on this server." });
  const stamped = { received_at: new Date().toISOString(), ...record };
  try {
    if (mode() === "webhook") await forward(stamped, signal);
    else {
      await fs.mkdir(directory(), { recursive: true });
      await fs.appendFile(file(), `${JSON.stringify(stamped)}\n`, "utf8");
    }
  } catch (error) {
    if (error.publicMessage) throw error;
    throw Object.assign(new Error("Feedback could not be stored."), { statusCode: 502, code: "feedback_store_failed", publicMessage: "The feedback could not be stored. Your answers are still in the form." });
  }
  seen.set(record.submission_id, Date.now());
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
  return { stored: true, duplicate: false, mode: mode() };
}

async function exportAll() {
  try { return await fs.readFile(file(), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

module.exports = { QUESTIONS, mode, store, exportAll, clean };
