const OpenAI = require("openai").default;
const { toFile } = require("openai");
const { createIdentityProfile, createPrediction } = require("./identity-service.cjs");

const audioNames = new Map([
  ["audio/webm", "recording.webm"], ["audio/ogg", "recording.ogg"],
  ["audio/mp4", "recording.m4a"], ["audio/mpeg", "recording.mp3"],
  ["audio/wav", "recording.wav"], ["audio/x-wav", "recording.wav"]
]);
const resultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    text: { type: "string" }, invented_detail: { type: "string" },
    evidence_ids: { type: "array", items: { type: "string" } },
    confidence_label: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["text", "invented_detail", "evidence_ids", "confidence_label"]
};
function client() {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OPENAI_API_KEY is not configured on the server."), { statusCode: 503 });
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90_000 });
}
async function transcribe(buffer, type) {
  const name = audioNames.get(type);
  if (!name) throw Object.assign(new Error("Unsupported audio format."), { statusCode: 415 });
  if (!buffer.length) throw Object.assign(new Error("Recording is empty."), { statusCode: 400 });
  const file = await toFile(buffer, name, { type });
  const result = await client().audio.transcriptions.create({ file, model: "gpt-transcribe" });
  if (!result.text?.trim()) throw Object.assign(new Error("No speech was detected."), { statusCode: 422 });
  return result.text.trim();
}
async function generate(kind, answers, question) {
  const ids = answers.map(item => item.id);
  const instructions = kind === "proxy"
    ? `You are a deliberately uncertain proxy in an identity experiment. Answer the new situation in first person, beginning exactly: "This is what I think you would do." Do not claim to know the person. Cite only provided answer IDs. Keep it to 1-3 short sentences. Do not infer sensitive traits. Set invented_detail to an empty string and confidence_label to low.`
    : `Create an explicitly fictional hypothetical memory for an identity experiment. Begin exactly: "I remember". Include one ordinary invented detail absent from every supplied answer, and copy that detail into invented_detail. Never claim the event really happened. Cite only provided answer IDs; confidence_label must be low. Do not infer sensitive traits.`;
  const response = await client().responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini", store: false,
    instructions, input: JSON.stringify({ answers, question }),
    text: { format: { type: "json_schema", name: `${kind}_result`, strict: true, schema: resultSchema } },
    max_output_tokens: 700
  });
  if (response.status !== "completed" || !response.output_text) throw Object.assign(new Error("The model did not complete the response."), { statusCode: 502 });
  let result;
  try { result = JSON.parse(response.output_text); } catch { throw Object.assign(new Error("The model returned invalid JSON."), { statusCode: 502 }); }
  if (!result.text || !Array.isArray(result.evidence_ids) || !result.evidence_ids.every(id => ids.includes(id))) throw Object.assign(new Error("The model returned invalid evidence."), { statusCode: 502 });
  if (kind === "proxy" && (!result.text.startsWith("This is what I think you would do.") || result.invented_detail)) throw Object.assign(new Error("The proxy response failed validation."), { statusCode: 502 });
  if (kind === "fiction") {
    const detail = result.invented_detail?.trim();
    if (!result.text.startsWith("I remember") || !detail || !result.text.includes(detail) || answers.some(item => item.answer.toLowerCase().includes(detail.toLowerCase()))) throw Object.assign(new Error("The fictional response failed validation."), { statusCode: 502 });
  }
  return result;
}
module.exports = { audioNames, createIdentityProfile, createPrediction, generate, transcribe };
