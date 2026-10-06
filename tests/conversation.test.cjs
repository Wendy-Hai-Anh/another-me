const test = require("node:test");
const assert = require("node:assert/strict");
const conversation = require("../server/conversation-service.cjs");

// A stand-in for the Responses API: returns the queued outputs in order and records each request.
function fakeClient(...outputs) {
  const requests = [];
  return {
    requests,
    responses: { create: async request => { requests.push(request); const next = outputs.shift(); return { status: "completed", output: [], output_text: JSON.stringify(next) }; } }
  };
}
const story = { id: "image_story", question: "What would I misunderstand about you if this image were all I had?", answer: "It's my desk at 2am. You'd think I'm disciplined, but I only work like that when I panic." };
const replyInput = moves => ({ moment: "story", question: story.question, answers: [story], allowed_moves: moves });

test("an interpretation must quote the participant exactly and stay tentative", async () => {
  const good = { move: "interpret", text: "Perhaps the image would make you look steadier than you feel.", inferred: "I read the late hour as pressure.", unknown: "How often this happens.", evidence: [{ source_id: "image_story", quote: "You'd think I'm disciplined" }] };
  const result = await conversation.reply(replyInput(["acknowledge", "interpret"]), { client: fakeClient(good) });
  assert.equal(result.move, "interpret");
  assert.equal(result.evidence[0].quote, "You'd think I'm disciplined");

  // An invented quote is sent back once with the reason, then refused.
  const invented = { ...good, evidence: [{ source_id: "image_story", quote: "I am always calm under pressure" }] };
  const client = fakeClient(invented, invented);
  await assert.rejects(conversation.reply(replyInput(["acknowledge", "interpret"]), { client }), error => error.code === "invalid_model_output");
  assert.match(client.requests[1].input, /must be copied exactly/);
});

test("follow-ups are one specific question; acknowledgements ask nothing", async () => {
  const generic = { move: "follow_up", text: "Can you tell me more?", inferred: "", unknown: "", evidence: [] };
  await assert.rejects(conversation.reply(replyInput(["acknowledge", "follow_up"]), { client: fakeClient(generic, generic) }));
  const specific = { move: "follow_up", text: "What were you panicking about that night?", inferred: "", unknown: "", evidence: [] };
  assert.equal((await conversation.reply(replyInput(["acknowledge", "follow_up"]), { client: fakeClient(specific) })).move, "follow_up");
  const asking = { move: "acknowledge", text: "You work late when you panic?", inferred: "", unknown: "", evidence: [] };
  await assert.rejects(conversation.reply(replyInput(["acknowledge"]), { client: fakeClient(asking, asking) }));
  // A move the request did not allow is rejected by the schema enum.
  const client = fakeClient({ move: "acknowledge", text: "You keep that desk for the hard nights.", inferred: "", unknown: "", evidence: [] });
  await conversation.reply(replyInput(["acknowledge"]), { client });
  assert.deepEqual(client.requests[0].text.format.schema.properties.move.enum, ["acknowledge"]);
});

test("interpretations never name diagnoses, percentages or certainty", async () => {
  const unsafe = { move: "interpret", text: "You may have anxiety, 80% likely.", inferred: "x", unknown: "y", evidence: [{ source_id: "image_story", quote: "I panic" }] };
  await assert.rejects(conversation.reply(replyInput(["interpret"]), { client: fakeClient(unsafe, unsafe) }));
});

test("a visible tension replaces the bold interpretation", async () => {
  const answers = [
    { id: "question_1", question: "Q1", answer: "Keeping your word is everything to me." },
    { id: "question_3", question: "Q3", answer: "A promotion is worth more than a speech." }
  ];
  const output = {
    contradiction: { present: true, first: { source_id: "question_1", quote: "Keeping your word is everything to me." }, second: { source_id: "question_3", quote: "A promotion is worth more than a speech." }, tension: "You might hold others to promises while letting work come first for you." },
    interpretation: { offer: true, claim: "You may be ambitious.", inferred: "x", unknown: "y", evidence: [{ source_id: "question_3", quote: "A promotion is worth more" }] },
    closing: "That is all three."
  };
  const result = await conversation.synthesise({ answers }, { client: fakeClient(output) });
  assert.equal(result.contradiction.present, true);
  assert.equal(result.interpretation.offer, false);
  assert.equal(result.interpretation.claim, "");
  // Both excerpts must come from two different answers.
  const same = { ...output, contradiction: { ...output.contradiction, second: output.contradiction.first } };
  await assert.rejects(conversation.synthesise({ answers }, { client: fakeClient(same, same) }));
});

test("image reading describes the scene only and accepts small images", async () => {
  const tiny = Buffer.from("synthetic image bytes").toString("base64");
  const ok = { observation: "I can see a red door at the end of a path.", interpretation: "Perhaps this is a place you return to.", context: "clear" };
  const client = fakeClient(ok);
  assert.deepEqual(await conversation.readImage({ image_base64: tiny, image_type: "image/jpeg" }, { client }), ok);
  assert.equal(client.requests[0].input[0].content[1].type, "input_image");
  const face = { observation: "I can see a smiling face.", interpretation: "Perhaps you look happy.", context: "clear" };
  await assert.rejects(conversation.readImage({ image_base64: tiny, image_type: "image/jpeg" }, { client: fakeClient(face, face) }));
  await assert.rejects(conversation.readImage({ image_base64: tiny, image_type: "image/gif" }, { client: fakeClient(ok) }), error => error.statusCode === 400);
});

test("conversation input is validated before any model call", async () => {
  const client = fakeClient();
  await assert.rejects(conversation.reply({ answers: [], allowed_moves: ["acknowledge"] }, { client }), error => error.statusCode === 400);
  await assert.rejects(conversation.reply({ answers: [story], allowed_moves: ["shout"] }, { client }), error => error.statusCode === 400);
  await assert.rejects(conversation.synthesise({ answers: [{ id: "Bad Id", question: "q", answer: "a" }] }, { client }), error => error.statusCode === 400);
  assert.equal(client.requests.length, 0);
});
