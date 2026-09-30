const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFictionResult } = require("../server/openai-adapter.cjs");

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
