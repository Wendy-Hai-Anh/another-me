const OpenAI = require("openai").default;
const { toFile } = require("openai");
const { createIdentityProfile, createPrediction } = require("./identity-service.cjs");

const audioNames = new Map([
  ["audio/webm", "recording.webm"], ["audio/ogg", "recording.ogg"],
  ["audio/mp4", "recording.m4a"], ["audio/mpeg", "recording.mp3"],
  ["audio/wav", "recording.wav"], ["audio/x-wav", "recording.wav"]
]);
const proxyResultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    text: { type: "string" }, invented_detail: { type: "string" },
    evidence_ids: { type: "array", items: { type: "string" } },
    confidence_label: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["text", "invented_detail", "evidence_ids", "confidence_label"]
};
const fictionWarning = "This is fictional and was not supplied by you.";
const fictionResultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    fictional_memory: { type: "string" },
    details_borrowed_from_user: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    details_invented_by_ai: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
    source_label: { type: "string", enum: ["GENERATED WITHOUT YOUR INPUT"] },
    warning: { type: "string", enum: [fictionWarning] },
    evidence_ids: { type: "array", items: { type: "string" } },
    confidence_label: { type: "string", enum: ["low"] }
  },
  required: ["fictional_memory", "details_borrowed_from_user", "details_invented_by_ai", "source_label", "warning", "evidence_ids", "confidence_label"]
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
function validateFictionResult(result, answers) {
  const memory = result?.fictional_memory?.trim() || "";
  const borrowed = result?.details_borrowed_from_user;
  const invented = result?.details_invented_by_ai;
  const suppliedText = answers.map(item => item.answer).join(" ").toLowerCase();
  const uniqueInvented = Array.isArray(invented) ? new Set(invented.map(item => String(item).trim().toLowerCase())) : new Set();
  const borrowedAreSupplied = Array.isArray(borrowed) && borrowed.length >= 1 && borrowed.length <= 3
    && borrowed.every(detail => detail.trim() && suppliedText.includes(detail.trim().toLowerCase()) && memory.toLowerCase().includes(detail.trim().toLowerCase()));
  const inventedAreVisible = Array.isArray(invented) && invented.length >= 2 && invented.length <= 3 && uniqueInvented.size === invented.length
    && invented.every(detail => detail.trim() && memory.toLowerCase().includes(detail.trim().toLowerCase()) && !suppliedText.includes(detail.trim().toLowerCase()));
  if (!memory.startsWith("I remember") || !borrowedAreSupplied || !inventedAreVisible
    || result.source_label !== "GENERATED WITHOUT YOUR INPUT" || result.warning !== fictionWarning || result.confidence_label !== "low") {
    throw Object.assign(new Error("The fictional response failed visible-invention validation."), { statusCode: 502 });
  }
  return result;
}
async function generate(kind, answers, question, context = {}) {
  const ids = answers.map(item => item.id);
  const instructions = kind === "proxy"
    ? `You are a deliberately uncertain first-person proxy in an identity experiment. Use the supplied answers, temporary profile, participant corrections, and earlier prediction feedback as evidence. Answer in 2-3 concise natural sentences and no more than 70 words, beginning exactly: "This is what I think you would do. I would". Continue speaking as the participant using I/me/my, not as an outside narrator. Make a specific choice and explain its reasoning; reflect tensions in the evidence instead of copying phrases into a template. Do not claim certainty or psychological authority. Cite only provided answer IDs. Do not infer sensitive traits. Set invented_detail to an empty string.`
    : `Create an explicitly fictional first-person hypothetical memory for an identity experiment. Connect it to 1-3 short, exact fragments copied from the participant answers and list those fragments in details_borrowed_from_user. Begin fictional_memory exactly with "I remember". Introduce 2-3 concrete details that appear nowhere in the supplied answers, using categories such as a location, weather, object, action, sound, texture, smell, temperature or light. Put each invented detail's exact wording in details_invented_by_ai and include every listed detail visibly in fictional_memory. Build a coherent 4-6 sentence scene rather than filling a fixed template. Set source_label exactly to "GENERATED WITHOUT YOUR INPUT", warning exactly to "${fictionWarning}", and confidence_label to low. Never imply the event happened, diagnose the participant or infer sensitive traits. Cite only provided answer IDs.`;
  const schema = kind === "proxy" ? proxyResultSchema : fictionResultSchema;
  const response = await client().responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini", store: false,
    instructions, input: JSON.stringify({ supplied_answers: answers, temporary_identity_context: context || {}, question }),
    text: { format: { type: "json_schema", name: `${kind}_result`, strict: true, schema } },
    max_output_tokens: kind === "proxy" ? 500 : 1200
  });
  if (response.status !== "completed" || !response.output_text) throw Object.assign(new Error("The model did not complete the response."), { statusCode: 502 });
  let result;
  try { result = JSON.parse(response.output_text); } catch { throw Object.assign(new Error("The model returned invalid JSON."), { statusCode: 502 }); }
  if (!Array.isArray(result.evidence_ids) || !result.evidence_ids.every(id => ids.includes(id))) throw Object.assign(new Error("The model returned invalid evidence."), { statusCode: 502 });
  if (kind === "proxy" && (!result.text?.startsWith("This is what I think you would do. I would") || result.invented_detail)) throw Object.assign(new Error("The proxy response failed first-person validation."), { statusCode: 502 });
  return kind === "fiction" ? validateFictionResult(result, answers) : result;
}
module.exports = { audioNames, createIdentityProfile, createPrediction, generate, transcribe, validateFictionResult };
