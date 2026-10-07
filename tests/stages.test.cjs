const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePrediction } = require("../server/schemas.cjs");
const core = require("../shared/simulation-core.js");
const proxyText = require("../shared/proxy-text.js");

const answers = [
  { id: "question_1", question: "Q1", answer: "Keeping your word is everything to me." },
  { id: "question_3", question: "Q3", answer: "A promotion is worth more than a speech." },
  { id: "question_2", question: "Q2", answer: "I would talk to them afterwards." }
];
const profile = { generated_assumptions: [], contradictions: [{ evidence_ids: ["question_1", "question_3"], description: "Promises matter, yet work comes first.", possible_explanation: "" }] };
const prediction = extra => ({
  target_question: "What would you say to them?", predicted_response: "Go to the interview. I'll manage the slides myself.",
  evidence_ids: ["question_3"], conflicting_evidence_ids: [], assumptions_used: [],
  confidence_score: 0.55, confidence_label: "medium", uncertainty_statement: "Based on limited information, this may be wrong.",
  alternative_possible_response: null, should_ask_participant_instead: false, source_label: "AI prediction", ...extra
});

test("a Stage 4 prediction may lean on both sides of a contradiction only as a low-confidence guess", () => {
  assert.deepEqual(validatePrediction(prediction(), answers, profile), []);
  assert.deepEqual(validatePrediction(prediction({ conflicting_evidence_ids: ["question_1"] }), answers, profile), []);
  const both = validatePrediction(prediction({ evidence_ids: ["question_1", "question_3"] }), answers, profile);
  assert.match(both.join(" "), /both sides of a recorded contradiction/);
  assert.deepEqual(validatePrediction(prediction({ evidence_ids: ["question_1", "question_3"], confidence_score: 0.3, confidence_label: "low" }), answers, profile), []);
  assert.match(validatePrediction(prediction({ conflicting_evidence_ids: ["question_3"] }), answers, profile).join(" "), /must not repeat/);
  assert.match(validatePrediction(prediction({ conflicting_evidence_ids: ["question_9"] }), answers, profile).join(" "), /unknown answer ID/);
});

test("Stage 6 always uses the overlooked-helper situation, and its demonstration is valid and labelled", () => {
  const input = { scenario: "overlooked-helper", answers: [{ id: "question_1", question: "Q1", answer: "I would wait quietly and think." }], seen_scenarios: ["overlooked-helper"] };
  const choices = core.candidates(input);
  assert.deepEqual(choices.map(s => s.id), ["overlooked-helper"]);
  const mock = core.mock(input);
  assert.equal(mock.scenario, core.fixed["overlooked-helper"].scenario);
  assert.deepEqual(core.validate(mock, core.evidenceContext(input), choices), []);
  assert.match(mock.uncertainty_statement, /rule-based demonstration/);
  // Without the fixed id the older pool still works (earlier prototypes and tests rely on it).
  assert.ok(core.candidates({ answers: [] }).every(s => core.pool.includes(s)));
});

test("new conversation answer ids are never read aloud by the double", () => {
  for (const id of ["question_1_followup", "story_followup", "reaction_story", "correction_synthesis", "tension_explanation", "review_explanation", "review_clarification"]) {
    assert.equal(proxyText.hasReferences(`As I said in ${id}, I would help.`), true, id);
  }
  assert.equal(proxyText.hasReferences("I can help for an hour on Saturday."), false);
});
