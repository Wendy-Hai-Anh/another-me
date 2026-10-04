// Opt-in only: uses the running local backend and may incur OpenAI charges.
const fs = require("node:fs");
const path = require("node:path");
const core = require("../simulation-core.js");
if (!process.argv.includes("--live")) throw new Error("Pass --live to send this synthetic test to OpenAI.");
const input = {
  answers: [
    { id: "question_1", question: "What matters when deciding?", answer: "I usually value practical results and clear communication." },
    { id: "question_2", question: "How do you respond to disagreement?", answer: "I sometimes pause and collect more context before speaking." },
    { id: "question_3", question: "What do people misunderstand?", answer: "My quietness does not mean I am uninterested." }
  ],
  context: { profile: {
    inferred_information: [{ id: "inference_1", statement: "The participant may seek clarity before committing to a practical response.", evidence_ids: ["question_1", "question_2"] }],
    contradictions: [{ description: "Direct communication and a preference to pause can both influence the response.", evidence_ids: ["question_1", "question_2"] }]
  }, profile_feedback: [{ id: "inference_1", verdict: "accepted" }], contradiction_feedback: [{ id: "contradiction_1", verdict: "context-needed", explanation: "It depends on how clear the situation is." }] },
  discussed_questions: [], seen_scenarios: []
};
async function run() {
  if (process.argv.includes("--inspect")) {
    require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
    require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), quiet: true, override: false });
    const client = new (require("openai").default)({ maxRetries: 0, timeout: 60000 });
    const { createSimulation } = require("../server/simulation-service.cjs");
    const wrapped = { responses: { create: async (request, options) => {
      const response = await client.responses.create(request, options);
      console.log(JSON.stringify({ model: response.model, syntheticOutput: response.output_text }));
      return response;
    } } };
    await createSimulation(input, { client: wrapped });
    return;
  }
  const start = Date.now();
  const response = await fetch(`${process.env.TEST_URL || "http://127.0.0.1:4187"}/api/simulation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(155000) });
  const payload = await response.json();
  const errors = response.ok ? core.validate(payload.simulation, core.evidenceContext(input), core.candidates(input)) : [payload.error];
  const report = { timestamp: new Date().toISOString(), provider: "OpenAI via local v6 backend", syntheticInputOnly: true, status: response.status, seconds: (Date.now() - start) / 1000, errors, evidenceCount: payload.simulation?.evidence.length, confidence: payload.simulation?.confidence, contradictions: payload.simulation?.contradictory_evidence.length };
  fs.writeFileSync(path.join(__dirname, "artifacts", "simulation-live-panel-fix.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
