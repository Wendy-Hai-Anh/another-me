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
const firstImpression = { observation: "I can see a bare desk.", interpretation: "You might want people to see you as someone in control." };
const replyInput = (moves, moment = "story") => ({ moment, question: story.question, answers: [story], allowed_moves: moves, image_reading: moment === "story" ? firstImpression : null });
const plain = (move, text, first_impression = "not_addressed") => ({ move, text, about: "", inferred: "", unknown: "", evidence: [], first_impression });

test("an interpretation must quote the participant exactly and stay tentative", async () => {
  const good = { move: "interpret", about: "habit", text: "You might be someone who works best once panic arrives, and who lets things slide until then.", inferred: "I read the late hour as pressure.", unknown: "How often this happens.", evidence: [{ source_id: "image_story", quote: "You'd think I'm disciplined" }], first_impression: "partly_supported" };
  const result = await conversation.reply(replyInput(["acknowledge", "interpret"]), { client: fakeClient(good) });
  assert.equal(result.move, "interpret");
  assert.equal(result.evidence[0].quote, "You'd think I'm disciplined");

  // An invented quote is sent back once with the reason, then refused.
  const invented = { ...good, evidence: [{ source_id: "image_story", quote: "I am always calm under pressure" }] };
  const client = fakeClient(invented, invented);
  await assert.rejects(conversation.reply(replyInput(["acknowledge", "interpret"]), { client }), error => error.code === "invalid_model_output");
  assert.match(client.requests[1].input, /must be copied exactly/);
});

test("Stage 2 can revise the first impression in plain words, and says how the story relates to it", async () => {
  const revised = { move: "interpret", about: "behaviour", text: "I read the image as a need for control. Your words make me think you may tend to leave things late and then rescue them alone.", inferred: "I set the tidy desk against the panic you describe.", unknown: "Whether this happens often.", evidence: [{ source_id: "image_story", quote: "I only work like that when I panic" }], first_impression: "revised" };
  assert.equal((await conversation.reply(replyInput(["acknowledge", "interpret"]), { client: fakeClient(revised) })).first_impression, "revised");
  // The story must say how it bears on the first impression; other moments must not.
  const missing = { ...revised, first_impression: "not_applicable" };
  await assert.rejects(conversation.reply(replyInput(["acknowledge", "interpret"]), { client: fakeClient(missing, missing) }));
  const question = { id: "question_1", question: "Q1", answer: "I would say it's fine and wait." };
  const leaking = plain("acknowledge", "You'd keep it short and wait for them.", "revised");
  await assert.rejects(conversation.reply({ moment: "question_1", question: "Q1", answers: [question], allowed_moves: ["acknowledge"] }, { client: fakeClient(leaking, leaking) }));
  const ok = plain("acknowledge", "You'd keep it short and wait for them.", "not_applicable");
  assert.equal((await conversation.reply({ moment: "question_1", question: "Q1", answers: [question], allowed_moves: ["acknowledge"] }, { client: fakeClient(ok) })).move, "acknowledge");
});

test("follow-ups are one specific question; acknowledgements ask nothing", async () => {
  const generic = plain("follow_up", "Can you tell me more?");
  await assert.rejects(conversation.reply(replyInput(["acknowledge", "follow_up"]), { client: fakeClient(generic, generic) }));
  const specific = plain("follow_up", "What were you panicking about that night?");
  assert.equal((await conversation.reply(replyInput(["acknowledge", "follow_up"]), { client: fakeClient(specific) })).move, "follow_up");
  const asking = plain("acknowledge", "You work late when you panic?");
  await assert.rejects(conversation.reply(replyInput(["acknowledge"]), { client: fakeClient(asking, asking) }));
  // A move the request did not allow is rejected by the schema enum.
  const client = fakeClient(plain("acknowledge", "You keep that desk for the hard nights."));
  await conversation.reply(replyInput(["acknowledge"]), { client });
  assert.deepEqual(client.requests[0].text.format.schema.properties.move.enum, ["acknowledge"]);
});

test("a Stage 2 interpretation is an assumption about the person, never their answer said back", async () => {
  const tired = { id: "image_story", question: story.question, answer: "I'm tired because of pulling an all-nighter" };
  const input = { moment: "story", question: story.question, answers: [tired], allowed_moves: ["acknowledge", "interpret"], image_reading: firstImpression };
  const summary = { move: "interpret", about: "", text: "I wonder if your words suggest it was simply about being exhausted after staying up all night.", inferred: "x", unknown: "y", evidence: [{ source_id: "image_story", quote: "pulling an all-nighter" }], first_impression: "revised" };
  const client = fakeClient(summary, summary);
  await assert.rejects(conversation.reply(input, { client }));
  assert.match(client.requests[1].input, /guess about them as a person/);
  const assumption = { ...summary, about: "routine", text: "You might be someone who runs on deadlines, leaving things until the pressure makes them urgent and then pushing through alone." };
  assert.equal((await conversation.reply(input, { client: fakeClient(assumption) })).about, "routine");
});

test("interpretations never name diagnoses, percentages or certainty", async () => {
  const unsafe = { move: "interpret", about: "personality", text: "You may have anxiety, 80% likely.", inferred: "x", unknown: "y", evidence: [{ source_id: "image_story", quote: "I panic" }], first_impression: "revised" };
  await assert.rejects(conversation.reply(replyInput(["interpret"]), { client: fakeClient(unsafe, unsafe) }));
});

const answers = [
  { id: "question_1", question: "Q1", answer: "Keeping your word is everything to me." },
  { id: "question_3", question: "Q3", answer: "A promotion is worth more than a speech." }
];
const tensionOutput = {
  difference_check: { first: { source_id: "question_1", quote: "Keeping your word is everything to me." }, second: { source_id: "question_3", quote: "A promotion is worth more than a speech." }, real_difference: true, explained_by_their_words: false },
  contradiction: { present: true, first: { source_id: "question_1", quote: "Keeping your word is everything to me." }, second: { source_id: "question_3", quote: "A promotion is worth more than a speech." },
    comparison: "You said keeping your word is everything to you. But you would miss a promised speech for a possible promotion.", question: "What makes those two promises different for you?" },
  uncertainty: { present: true, about: "x", question: "y?" },
  interpretation: { offer: true, claim: "You may be ambitious.", inferred: "x", unknown: "y", evidence: [{ source_id: "question_3", quote: "A promotion is worth more" }] },
  closing: "That is all three."
};

test("a fair tension replaces the bold reading and the open question", async () => {
  const result = await conversation.synthesise({ answers }, { client: fakeClient(tensionOutput) });
  assert.equal(result.contradiction.present, true);
  assert.equal(result.interpretation.offer, false);
  assert.equal(result.uncertainty.present, false);
  // Both excerpts must come from two different answers.
  const same = { ...tensionOutput, contradiction: { ...tensionOutput.contradiction, second: tensionOutput.contradiction.first } };
  await assert.rejects(conversation.synthesise({ answers }, { client: fakeClient(same, same) }));
  // A difference is never called hypocrisy, and it ends in one clear question.
  const judging = { ...tensionOutput, contradiction: { ...tensionOutput.contradiction, comparison: "That seems hypocritical." } };
  await assert.rejects(conversation.synthesise({ answers }, { client: fakeClient(judging, judging) }));
  const twoQuestions = { ...tensionOutput, contradiction: { ...tensionOutput.contradiction, question: "Why? And what changed?" } };
  await assert.rejects(conversation.synthesise({ answers }, { client: fakeClient(twoQuestions, twoQuestions) }));
});

test("without a tension, one genuine open question may be raised, or nothing at all", async () => {
  const none = { present: false, first: { source_id: "", quote: "" }, second: { source_id: "", quote: "" }, comparison: "", question: "" };
  const noDifference = { first: { source_id: "", quote: "" }, second: { source_id: "", quote: "" }, real_difference: false, explained_by_their_words: false };
  const open = { difference_check: noDifference, contradiction: none, uncertainty: { present: true, about: "Your answers say what you would do, not what it would cost you.", question: "Which of these choices would cost you the most?" }, interpretation: { offer: false, claim: "", inferred: "", unknown: "", evidence: [] }, closing: "That is all three." };
  assert.equal((await conversation.synthesise({ answers }, { client: fakeClient(open) })).uncertainty.present, true);
  const nothing = { ...open, uncertainty: { present: false, about: "", question: "" } };
  const result = await conversation.synthesise({ answers }, { client: fakeClient(nothing) });
  assert.equal(result.contradiction.present || result.uncertainty.present, false);
  // A real, unexplained difference cannot be softened into a pattern or a vague question.
  const softened = { ...open, difference_check: tensionOutput.difference_check };
  await assert.rejects(conversation.synthesise({ answers }, { client: fakeClient(softened, softened) }));
});

const review = extra => ({ kind: "tension", comparison: tensionOutput.contradiction.comparison, question: tensionOutput.contradiction.question, excerpts: [tensionOutput.contradiction.first, tensionOutput.contradiction.second], answers, response: "A speech is a promise to one person on one day; a client meeting can happen again.", misunderstood: false, allow_clarify: true, ...extra });

test("the review acknowledges how the reading changed, from the participant's own explanation", async () => {
  const ack = { move: "acknowledge", text: "So your distinction is about whether the moment can happen again, rather than treating every promise the same.", resolution: "context_dependent", understanding: "Promises tied to one-off moments come first for you." };
  assert.equal((await conversation.reviewReply(review(), { client: fakeClient(ack) })).resolution, "context_dependent");
  // One clarification is possible only when allowed.
  const clarify = { move: "clarify", text: "Would a meeting that could not be repeated change your answer?", resolution: "still_open", understanding: "" };
  assert.equal((await conversation.reviewReply(review(), { client: fakeClient(clarify) })).move, "clarify");
  const client = fakeClient(ack);
  await conversation.reviewReply(review({ allow_clarify: false }), { client });
  assert.deepEqual(client.requests[0].text.format.schema.properties.move.enum, ["acknowledge"]);
});

test("'You misunderstood' is accepted without defending the reading, and nothing is called hypocrisy", async () => {
  const defended = { move: "acknowledge", text: "I still think the answers pull apart.", resolution: "still_open", understanding: "x" };
  await assert.rejects(conversation.reviewReply(review({ misunderstood: true, response: "" }), { client: fakeClient(defended, defended) }));
  const accepted = { move: "acknowledge", text: "Then I misread what you meant about the speech; I'll set that comparison aside.", resolution: "premise_rejected", understanding: "" };
  assert.equal((await conversation.reviewReply(review({ misunderstood: true, response: "" }), { client: fakeClient(accepted) })).resolution, "premise_rejected");
  const judging = { move: "acknowledge", text: "That sounds a little inconsistent, but fine.", resolution: "context_dependent", understanding: "x" };
  await assert.rejects(conversation.reviewReply(review(), { client: fakeClient(judging, judging) }));
  await assert.rejects(conversation.reviewReply(review({ response: "" }), { client: fakeClient(accepted) }), error => error.statusCode === 400);
});

test("image reading gives a stretched first impression traced to the scene, never to appearance", async () => {
  const tiny = Buffer.from("synthetic image bytes").toString("base64");
  const ok = { observation: "I can see a bare desk with everything squared to the edge.", interpretation: "You might want people to see you as someone who has everything under control, even when you don't.", basis: "the bare desk with everything squared to the edge", context: "clear" };
  const client = fakeClient(ok);
  assert.deepEqual(await conversation.readImage({ image_base64: tiny, image_type: "image/jpeg" }, { client }), ok);
  assert.equal(client.requests[0].input[0].content[1].type, "input_image");
  const untraced = { ...ok, basis: "" };
  await assert.rejects(conversation.readImage({ image_base64: tiny, image_type: "image/jpeg" }, { client: fakeClient(untraced, untraced) }));
  const face = { ...ok, interpretation: "Perhaps your smiling face shows you want approval." };
  await assert.rejects(conversation.readImage({ image_base64: tiny, image_type: "image/jpeg" }, { client: fakeClient(face, face) }));
  await assert.rejects(conversation.readImage({ image_base64: tiny, image_type: "image/gif" }, { client: fakeClient(ok) }), error => error.statusCode === 400);
});

test("conversation input is validated before any model call", async () => {
  const client = fakeClient();
  await assert.rejects(conversation.reply({ answers: [], allowed_moves: ["acknowledge"] }, { client }), error => error.statusCode === 400);
  await assert.rejects(conversation.reply({ answers: [story], allowed_moves: ["shout"] }, { client }), error => error.statusCode === 400);
  await assert.rejects(conversation.synthesise({ answers: [{ id: "Bad Id", question: "q", answer: "a" }] }, { client }), error => error.statusCode === 400);
  await assert.rejects(conversation.reviewReply({ kind: "argument", answers }, { client }), error => error.statusCode === 400);
  assert.equal(client.requests.length, 0);
});

test("brief answers are never stretched into a revision or a resolved tension", async () => {
  const brief = { id: "image_story", question: story.question, answer: "It's my desk." };
  const manufactured = { move: "acknowledge", text: "So it's just a desk to you, not about control.", about: "", inferred: "", unknown: "", evidence: [], first_impression: "revised" };
  await assert.rejects(conversation.reply({ moment: "story", question: story.question, answers: [brief], allowed_moves: ["acknowledge"], image_reading: firstImpression }, { client: fakeClient(manufactured, manufactured) }));
  const honest = { ...manufactured, text: "Your desk, then. I'll keep that as you said it.", first_impression: "not_addressed" };
  assert.equal((await conversation.reply({ moment: "story", question: story.question, answers: [brief], allowed_moves: ["acknowledge"], image_reading: firstImpression }, { client: fakeClient(honest) })).first_impression, "not_addressed");
  // Without a Stage 1 reading there is nothing to revise.
  const noImage = { ...honest, first_impression: "not_applicable" };
  assert.equal((await conversation.reply({ moment: "story", question: story.question, answers: [brief], allowed_moves: ["acknowledge"] }, { client: fakeClient(noImage) })).first_impression, "not_applicable");
  const supplied = { move: "acknowledge", text: "So the difference is pattern versus a one-off chance.", resolution: "context_dependent", understanding: "Patterns matter more than single events." };
  await assert.rejects(conversation.reviewReply(review({ response: "It's different." }), { client: fakeClient(supplied, supplied) }));
  const open = { move: "acknowledge", text: "You see the two situations as different. I'll keep that open rather than guess why.", resolution: "still_open", understanding: "They see the two situations as different." };
  assert.equal((await conversation.reviewReply(review({ response: "It's different." }), { client: fakeClient(open) })).resolution, "still_open");
});
