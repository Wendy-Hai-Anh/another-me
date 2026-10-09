const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OPENAI_API_KEY = "";
const voices = require("../server/voices.cjs");
const conversation = require("../server/conversation-service.cjs");
const { SIMULATION_PROMPT } = require("../server/simulation-service.cjs");
const proxyText = require("../shared/proxy-text.js");

function fakeClient(...outputs) {
  const requests = [];
  return { requests, responses: { create: async request => { requests.push(request); return { status: "completed", output: [], output_text: JSON.stringify(outputs.shift()) }; } } };
}
const answers = [
  { id: "question_1", question: "Friend cancels for a date", answer: "I'd say it's fine at first, but I wouldn't be the one arranging the next plan. Maybe I'd tell them it stung." },
  { id: "question_2", question: "Teammate claims the idea", answer: "I wouldn't interrupt. Afterwards I'd ask them to email the assessor so everyone is credited." },
  { id: "question_3", question: "Wedding or pitch", answer: "I'd go to the wedding because I promised, and I'd ask my manager if I could support the pitch remotely beforehand." }
];

test("every request carries exactly one speaker mode, and the narrator's personality never reaches the double", () => {
  assert.throws(() => voices.compose({ speaker: "both", task: "x" }));
  for (const prompt of [conversation.REPLY_PROMPT, conversation.SYNTHESIS_PROMPT, conversation.REVIEW_PROMPT, conversation.IMAGE_PROMPT, conversation.COMMENTARY_PROMPT, conversation.INFERENCE_PROMPT]) {
    assert.match(prompt, /Speaker mode: system_interpreter/);
    assert.doesNotMatch(prompt, /Speaker mode: participant_double/);
  }
  assert.match(SIMULATION_PROMPT, /Speaker mode: participant_double/);
  assert.doesNotMatch(SIMULATION_PROMPT, /You are Another Me|provocative|bossy/);
  const prediction = voices.compose({ speaker: voices.SPEAKERS.DOUBLE, task: require("../server/prompts.cjs").PREDICTION_PROMPT });
  assert.doesNotMatch(prediction, /You are Another Me|provocative|bossy/);
});

test("the double's style is measured only from the participant's own words, never from AI output", () => {
  const withAi = [...answers,
    { id: "reaction_story", question: "The AI suggested: \"You want control.\" Does that fit?", answer: "That fits." },
    { id: "stage5_never", question: "Lines from the AI double's reply that I would never say", answer: "\"Absolutely not, you should have asked me first.\"" }];
  const style = voices.demonstratedStyle(withAi);
  assert.equal(style.answers_measured, 3);
  assert.ok(style.softeners_or_hedges >= 1);
  assert.ok(!style.short_phrases_of_theirs.some(p => /Absolutely not|That fits/.test(p)));
  // New answer ids are never read aloud by the double.
  for (const id of ["stage4_answer", "stage4_correction", "stage5_correction", "stage5_never"]) assert.equal(proxyText.hasReferences(`As in ${id}, I would help.`), true, id);
});

const inference = (claims, extra = {}) => ({
  observations: { values: ["keeping promises"], avoids: ["public correction"], under_pressure: "softens first", negotiation: "asks for small concessions", context_shifts: [], tensions: ["wants credit, avoids asking"], corrected: [] },
  lenses: { mbti: [{ dimension: "E-I", lean: "insufficient_evidence", evidence_ids: [] }], riasec: [{ category: "E", lean: "unknown", evidence_ids: [] }] },
  evidence_limited: false,
  inferences: claims.map(([claim, ids, strength = "moderate", role = "values"]) => ({ claim, role, evidence_ids: ids, evidence_strength: strength })),
  ...extra
});

test("the portrait before Stage 6: three to five traceable sentences, no types or scores, internal lenses stay on the server", async () => {
  const good = inference([
    ["I think you need people to know they can rely on you.", ["question_3"]],
    ["You let the cancellation go, but you quietly stop making the next plan.", ["question_1"], "moderate", "avoids"],
    ["You want the credit fixed without being the one who caused a scene.", ["question_2"], "moderate", "tension"],
    ["My read? You keep promises partly so nobody can call you unreliable.", ["question_1", "question_3"], "strong", "underneath"]
  ]);
  const result = await conversation.inferenceSequence({ answers }, { client: fakeClient(good) });
  assert.equal(result.inferences.length, 4);
  assert.deepEqual(Object.keys(result).sort(), ["evidence_limited", "inferences"]);
  assert.ok(result.inferences.every(i => i.status === "tentative" && Array.isArray(i.evidenceRefs)));
  assert.equal(JSON.stringify(result).includes("lenses"), false);

  const typed = inference([["You are clearly an INFJ who protects harmony.", ["question_1"]], ["You want the credit fixed quietly.", ["question_2"]], ["You keep promises when you made them a year ago.", ["question_3"]]]);
  await assert.rejects(conversation.inferenceSequence({ answers }, { client: fakeClient(typed, typed) }));
  const flattering = inference([["You are kind but strong when it counts most.", ["question_1"]], ["You want the credit fixed quietly afterwards.", ["question_2"]], ["You keep the promises you made a year ago.", ["question_3"]]]);
  await assert.rejects(conversation.inferenceSequence({ answers }, { client: fakeClient(flattering, flattering) }));
  const untraced = inference([["You need people to rely on you.", []], ["You want credit fixed quietly afterwards.", ["question_2"]], ["You keep promises you made a year ago.", ["question_3"]]]);
  await assert.rejects(conversation.inferenceSequence({ answers }, { client: fakeClient(untraced, untraced) }));
  const forcedLean = { ...good, lenses: { mbti: [{ dimension: "E-I", lean: "T", evidence_ids: [] }], riasec: [] } };
  await assert.rejects(conversation.inferenceSequence({ answers }, { client: fakeClient(forcedLean, forcedLean) }));
});

test("sparse evidence gives fewer readings and says so, instead of a generic portrait", async () => {
  const sparse = inference([["You keep your answers short, so I have very little to go on.", [], "limited", "limit"]], { evidence_limited: true });
  const result = await conversation.inferenceSequence({ answers: [{ id: "question_1", question: "Q", answer: "Fine." }] }, { client: fakeClient(sparse) });
  assert.equal(result.evidence_limited, true);
  assert.equal(result.inferences[0].role, "limit");
  const padded = inference([["You keep your answers short.", ["question_1"]]], { evidence_limited: true });
  await assert.rejects(conversation.inferenceSequence({ answers: [{ id: "question_1", question: "Q", answer: "Fine." }] }, { client: fakeClient(padded, padded) }));
});

test("Another Me's commentary speaks about the participant, never as them", async () => {
  const input = { situation: "Family savings", double_text: "I'd lend some of it, not most, and only with a written plan.", answers };
  const asDouble = { text: "I'd lend some of it and keep the rest.", evidence_ids: ["question_3"] };
  await assert.rejects(conversation.commentary(input, { client: fakeClient(asDouble, asDouble) }));
  const about = { text: "You call that a compromise. I think you're buying time before saying no.", evidence_ids: ["question_1"] };
  assert.equal((await conversation.commentary(input, { client: fakeClient(about) })).text, about.text);
});

test("the prediction route refuses the participant's own answer to the situation it predicts", async () => {
  const server = require("../server/index.cjs");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const leaked = await fetch(`${base}/api/predict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [...answers, { id: "stage4_answer", question: "Family", answer: "I'd refuse." }], profile: {}, target_question: "Family" }) });
    assert.equal(leaked.status, 400);
    assert.equal((await leaked.json()).code, "prediction_leak");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("with sparse answers the double stays short and tentative instead of inventing a decisive voice", () => {
  const sparse = voices.demonstratedStyle([{ id: "question_1", answer: "Fine, whatever." }, { id: "question_2", answer: "I'd say something. Or not." }, { id: "question_3", answer: "Wedding. Maybe pitch." }]);
  assert.equal(sparse.evidence_level, "sparse");
  assert.equal(voices.doubleStyleErrors("I'm not helping this weekend.", sparse).length, 1);
  assert.equal(voices.doubleStyleErrors("Maybe. I don't know.", sparse).length, 0);
  assert.equal(voices.demonstratedStyle(answers).evidence_level, "ok");
  assert.equal(voices.doubleStyleErrors("I'm not helping this weekend.", voices.demonstratedStyle(answers)).length, 0);
});

test("a participant who softens their own answers gets a double without ultimatums", () => {
  const hesitant = voices.demonstratedStyle([
    { id: "question_1", answer: "I'd probably say no worries, have fun, because I wouldn't want to make it weird. I think I'd wait for them to suggest the next plan." },
    { id: "question_2", answer: "I don't think I'd say anything in the moment. Afterwards I'd maybe message them." },
    { id: "question_3", answer: "I'd go to the wedding, I promised, and say I'm really sorry to my manager." }]);
  assert.equal(hesitant.manner, "hesitant");
  assert.equal(voices.doubleStyleErrors("If you keep pushing tonight, I’m going to end the conversation.", hesitant).length, 1);
  assert.equal(voices.doubleStyleErrors("I could probably give some of it, but I'd need it back by spring.", hesitant).length, 0);
  const direct = voices.demonstratedStyle([{ id: "question_1", answer: "I'd tell them straight: no. I won't keep evenings free." }, { id: "question_2", answer: "I'd step in right away and correct it." }, { id: "question_3", answer: "The pitch. I'd tell my friend directly." }]);
  assert.equal(direct.manner, "direct");
  assert.equal(voices.doubleStyleErrors("If you keep pushing tonight, I'm going to end the conversation.", direct).length, 0);
});
