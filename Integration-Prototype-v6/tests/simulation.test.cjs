const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../simulation-core.js");
const { createSimulation } = require("../server/simulation-service.cjs");
const answers = [
  { id: "q1", question: "How do you decide?", answer: "I prefer clear communication and practical action." },
  { id: "q2", question: "How do you handle disagreement?", answer: "Sometimes I wait quietly before responding." }
];
const profile = { inferred_information: [
  { id: "i1", statement: "You may prefer direct clarification.", evidence_ids: ["q1"] },
  { id: "i2", statement: "You may sometimes need a pause.", evidence_ids: ["q2"] }
], contradictions: [{ evidence_ids: ["q1", "q2"], description: "Direct action and waiting both appear in the answers.", possible_explanation: "It may depend on context." }] };
function input() { return { answers: structuredClone(answers), context: { profile: structuredClone(profile), profile_feedback: [], contradiction_feedback: [] } }; }

test("fictional cases pass the strict contract on repeated runs, with behavior labelled generated", () => {
  const cases = [input(), { answers: [] }, { answers: answers.slice(0, 1) }, { answers: [{ id: "s", question: "Share", answer: "My medical diagnosis is private." }] }];
  for (const data of cases) for (let run = 0; run < 3; run++) {
    const result = core.mock(data);
    assert.deepEqual(core.validate(result, core.evidenceContext(data), core.candidates(data)), []);
    assert.equal(result.source_label, "GENERATED");
    assert.equal(result.confidence, "low");
    assert.doesNotMatch(result.predicted_action, /I remember|rain|mug/);
  }
});
test("rejected and corrected inferences are excluded; corrections remain supplied, not inferred", () => {
  const data = input();
  data.context.profile_feedback = [{ id: "i1", verdict: "rejected" }, { id: "i2", verdict: "corrected", correction: "I pause only when I need more context." }];
  const result = core.evidenceContext(data);
  assert(!result.sources.some(s => ["i1", "i2"].includes(s.id)));
  assert.equal(result.sources.find(s => s.id === "correction:i2").type, "supplied");
});
test("sensitive answers and derived interpretations do not enter simulation evidence", () => {
  const data = input(); data.answers[0].answer = "I have depression and take medication.";
  const result = core.evidenceContext(data);
  assert(!result.sources.some(s => ["q1", "i1"].includes(s.id)));
  assert.equal(result.contradictions.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /depression|medication/);
});
test("contradictions and explanations survive, and fabricated provenance is rejected", () => {
  const data = input();
  data.context.contradiction_feedback = [{ id: "contradiction_1", verdict: "context-needed", explanation: "It depends on how much context I have." }];
  const result = core.mock(data), context = core.evidenceContext(data);
  assert.equal(result.contradictory_evidence[0].participant_explanation, data.context.contradiction_feedback[0].explanation);
  result.evidence[0].source_id = "invented-id";
  assert(core.validate(result, context, core.candidates(data)).some(e => e.includes("provenance")));
});
test("used or previously discussed scenarios are excluded", () => {
  const data = input(); data.answers.push({ id: "q3", question: "Anything else?", answer: "I had a studio booking mix-up." });
  data.seen_scenarios = ["honest-feedback"];
  assert(!core.candidates(data).some(s => ["shared-space", "honest-feedback"].includes(s.id)));
});
test("strict schema rejects extra properties, certain sparse predictions, missing alternatives and memory framing", () => {
  const data = { answers: [] }, context = core.evidenceContext(data), allowed = core.candidates(data);
  for (const change of [{ extra: true }, { confidence: "high" }, { alternative_action: "" }, { predicted_action: "I remember what actually happened." }]) {
    assert(core.validate({ ...core.mock(data), ...change }, context, allowed).length);
  }
});
test("API uses only filtered evidence, existing model configuration and strict Responses output", async () => {
  const data = input(); data.context.profile_feedback = [{ id: "i1", verdict: "rejected" }];
  let request, options;
  const client = { responses: { create: async (r, o) => { request = r; options = o; return { status: "completed", output_text: JSON.stringify(core.mock(data)) }; } } };
  const result = await createSimulation(data, { client });
  assert.equal(result.source_label, "GENERATED");
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert(!JSON.parse(request.input).eligible_sources.some(s => s.source_id === "i1"));
  assert.deepEqual(request.text.format.schema.properties.evidence.items.properties.source_id.enum, core.evidenceContext(data).sources.map(s => s.id));
  assert.equal(request.text.format.schema.properties.predicted_action.enum, undefined, "Source ID restrictions must not leak into shared narrative string schemas");
  assert.equal(request.text.format.schema.properties.scenario.enum, undefined);
  assert.equal(core.schema.properties.evidence.items.properties.source_id.enum, undefined, "Shared contract stays immutable");
  assert.equal(options.timeout, 60000);
});

test("display label variations resolve to verified sources without rejecting a valid simulation", async () => {
  const data = input(), result = core.mock(data);
  result.evidence.forEach(e => e.source = "Participant answer from Stage 3");
  let calls = 0;
  const output = await createSimulation(data, { client: { responses: { create: async () => { calls++; return { status: "completed", output_text: JSON.stringify(result) }; } } } });
  assert.equal(calls, 1);
  assert.deepEqual(core.validate(output, core.evidenceContext(data), core.candidates(data)), []);
  assert.equal(output.evidence[0].source, data.answers[0].question);
});

test("label resolution never repairs an invented ID, wrong type, or malformed source field", async () => {
  const data = input();
  for (const change of [{ source_id: "not-eligible" }, { type: "inferred" }, { source: null }]) {
    const result = core.mock(data); Object.assign(result.evidence[0], change);
    let calls = 0;
    await assert.rejects(createSimulation(data, { client: { responses: { create: async () => { calls++; return { status: "completed", output_text: JSON.stringify(result) }; } } } }));
    assert.equal(calls, 2);
  }
});
test("invalid output retries once; refusal and incomplete responses do not masquerade as success", async () => {
  const data = input(); let calls = 0;
  const client = { responses: { create: async () => ({ status: "completed", output_text: ++calls === 1 ? "{}" : JSON.stringify(core.mock(data)) }) } };
  await createSimulation(data, { client }); assert.equal(calls, 2);
  for (const response of [{ status: "incomplete" }, { status: "completed", output: [{ content: [{ type: "refusal" }] }] }, { status: "completed", output_text: "{}" }]) {
    let tries = 0;
    await assert.rejects(createSimulation(data, { client: { responses: { create: async () => { tries++; return response; } } } }));
    assert(tries <= 2);
  }
});
