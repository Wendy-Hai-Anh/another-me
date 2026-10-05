const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFictionResult } = require("../server/openai-adapter.cjs");
const { validateProxyScript } = require("../server/openai-adapter.cjs");
const proxyText = require("../shared/proxy-text.js");

const answers = [
  { id: "image_story", question: "What does the image not show?", answer: "The flower reminds me to slow down." },
  { id: "question_1", question: "What matters?", answer: "I usually consider other people before deciding." }
];
const valid = {
  fictional_memory: "I remember carrying the flower into a quiet train station while rain struck the windows. A red scarf hung over a wooden chair. I thought about how I usually consider other people before deciding, although this event never happened.",
  details_borrowed_from_user: ["the flower", "I usually consider other people before deciding"],
  details_invented_by_ai: ["a quiet train station", "rain struck the windows", "A red scarf hung over a wooden chair"],
  source_label: "GENERATED WITHOUT YOUR INPUT",
  warning: "This is fictional and was not supplied by you.",
  evidence_ids: ["image_story", "question_1"],
  confidence_label: "low"
};

test("fiction validation accepts 2-3 visible details absent from participant answers", () => {
  assert.equal(validateFictionResult(valid, answers), valid);
});

test("fiction validation permits a paraphrased borrowed fragment while keeping inventions visible", () => {
  const paraphrased = {
    ...valid,
    fictional_memory: "I remember carrying the flower into a quiet train station while rain struck the windows. A red scarf hung over a wooden chair. I paused to consider the people waiting there, although this event never happened."
  };
  assert.equal(validateFictionResult(paraphrased, answers), paraphrased);
});

test("fiction validation rejects hidden, repeated or participant-supplied inventions", () => {
  assert.throws(() => validateFictionResult({ ...valid, details_invented_by_ai: ["a quiet train station"] }, answers));
  assert.throws(() => validateFictionResult({ ...valid, details_invented_by_ai: ["the flower", "rain struck the windows"] }, answers));
  assert.throws(() => validateFictionResult({ ...valid, details_invented_by_ai: ["a quiet train station", "a missing silver suitcase"] }, answers));
});

test("proxy citations stay in evidence metadata, not displayed or spoken words", () => {
  const script = "This is what I think you would do. I would ask to be consulted next time. [question_1, question_3]";
  const result = validateProxyScript({ text: script, evidence_ids: ["question_1", "question_3"] });
  assert.equal(result.text, "This is what I think you would do. I would ask to be consulted next time.");
  assert.deepEqual(result.evidence_ids, ["question_1", "question_3"]);
  assert.equal(proxyText.forSpeech(script), result.text);
  assert.equal(proxyText.clean("I would ask (based on question 1 and question 3)."), "I would ask.");
  assert.equal(proxyText.clean("I would ask, based on question one and question three."), "I would ask.");
  assert.equal(proxyText.clean("I would ask [politely] about the third option."), "I would ask [politely] about the third option.");
});
test("unresolved source narration is rejected before paid media generation", () => {
  assert.throws(() => proxyText.forSpeech("My answer to question one tells you I care."));
  assert.throws(() => validateProxyScript({ text: "I would quote question_2 here." }), /source references/);
  assert.throws(() => proxyText.forSpeech("[question_1]"));
});
