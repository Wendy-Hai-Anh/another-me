const OpenAI = require("openai").default;
const { toFile } = require("openai");
const { createIdentityProfile, createPrediction } = require("./identity-service.cjs");
const proxyText = require("../shared/proxy-text.js");
const { SPEAKERS, compose, demonstratedStyle, doubleStyleErrors } = require("./voices.cjs");

const audioNames = new Map([
  ["audio/webm", "recording.webm"], ["audio/ogg", "recording.ogg"],
  ["audio/mp4", "recording.m4a"], ["audio/mpeg", "recording.mp3"],
  ["audio/wav", "recording.wav"], ["audio/x-wav", "recording.wav"]
]);
const proxyResultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    text: { type: "string", description: "Natural first-person spoken script. No citations, question numbers, source IDs or evidence commentary." }, invented_detail: { type: "string" },
    decision: { type: "string", enum: ["agree", "partly", "refuse"], description: "Decided first, from how they actually handled the earlier situations." },
    style_basis: { type: "string", description: "One sentence naming how they speak and decide in their answers that the reply imitates (directness, hesitation, softening, explaining reasons, conditions), with a short phrase of theirs." },
    evidence_ids: { type: "array", description: "Put source references only here, never in the spoken text.", items: { type: "string" } },
    confidence_label: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["text", "invented_detail", "decision", "style_basis", "evidence_ids", "confidence_label"]
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
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OPENAI_API_KEY is not configured on the server."), { statusCode: 503, code: "missing_api_key" });
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90_000 });
}
async function transcribe(buffer, type) {
  const name = audioNames.get(type);
  if (!name) throw Object.assign(new Error("Unsupported audio format."), { statusCode: 415 });
  if (!buffer.length) throw Object.assign(new Error("Recording is empty."), { statusCode: 400, code: "no_speech", publicMessage: "The recording was empty." });
  const file = await toFile(buffer, name, { type });
  const result = await client().audio.transcriptions.create({ file, model: "gpt-transcribe" });
  if (!result.text?.trim()) throw Object.assign(new Error("No speech was detected."), { statusCode: 422, code: "no_speech", publicMessage: "No speech was heard in the recording." });
  return result.text.trim();
}
function validateFictionResult(result, answers) {
  const memory = result?.fictional_memory?.trim() || "";
  const borrowed = result?.details_borrowed_from_user;
  const invented = result?.details_invented_by_ai;
  const suppliedText = answers.map(item => item.answer).join(" ").toLowerCase();
  const uniqueInvented = Array.isArray(invented) ? new Set(invented.map(item => String(item).trim().toLowerCase())) : new Set();
  const borrowedAreSupplied = Array.isArray(borrowed) && borrowed.length >= 1 && borrowed.length <= 3
    && borrowed.every(detail => detail.trim() && suppliedText.includes(detail.trim().toLowerCase()));
  const inventedAreVisible = Array.isArray(invented) && invented.length >= 2 && invented.length <= 3 && uniqueInvented.size === invented.length
    && invented.every(detail => detail.trim() && memory.toLowerCase().includes(detail.trim().toLowerCase()) && !suppliedText.includes(detail.trim().toLowerCase()));
  const invalidParts = [
    !memory.startsWith("I remember") && "opening",
    !borrowedAreSupplied && "borrowed fragments",
    !inventedAreVisible && "invented details",
    result.source_label !== "GENERATED WITHOUT YOUR INPUT" && "source label",
    result.warning !== fictionWarning && "warning",
    result.confidence_label !== "low" && "confidence"
  ].filter(Boolean);
  if (invalidParts.length) {
    console.warn(`[integration-api] Fiction validation rejected: ${invalidParts.join(", ")}`);
    throw Object.assign(new Error("The fictional response failed visible-invention validation."), {
      statusCode: 502,
      publicMessage: "The AI did not clearly separate borrowed and invented details. Please try again or use the labelled simulated scene."
    });
  }
  return result;
}
async function generate(kind, answers, question, context = {}) {
  const ids = answers.map(item => item.id);
  const instructions = kind === "proxy"
    ? compose({ speaker: SPEAKERS.DOUBLE, task: `Task: reply to a message on the participant's behalf. question contains the situation and the message they received. Write the exact message they would send back, as if they were typing it to the sender: first person (I/me/my), addressing the sender as "you", 2-4 short sentences and no more than 70 words. It is the message itself, never a description of it: do not begin with "I would say", "I'd tell them" or similar. Use their supplied answers, corrections, reactions and earlier prediction feedback as evidence of how they speak and decide. Match their demonstrated style: their length, directness or hesitation, whether they soften before refusing, whether they explain their reasons or what a choice costs them, whether they set conditions, and the kind of words they use. Do not produce an idealised reply: do not default to a firm boundary-setting message, nor to a polite or apologetic one. Someone who avoids awkwardness may agree partly or hedge; someone blunt may refuse in one line; someone who explains will explain. Before writing, set decision (agree, partly, refuse) from how they actually handled the earlier situations: someone who says "no worries", avoids awkward moments or lets things go in the moment often agrees partly or hedges, and deals with the boundary later; someone who states limits plainly refuses. The text must carry out that decision in their register, and style_basis must match the text. Name these features in style_basis. Never use a stock line such as "you should have asked me first" or "don't volunteer me again" unless their own answers show them confronting people that bluntly. If their answers are very brief, keep the reply short and plain and do not invent a personality. ai_context.rejected_interpretations lists readings they rejected; do not act on them. Choose what the evidence suggests, and make one specific decision (whether and how much they help, and on what terms) with the reason implied in the wording, so the participant can tell exactly where it does or does not sound like them. Never claim certainty or psychological authority, never invent events, people or plans that are not in the situation, and do not infer sensitive traits. Put references to provided answer IDs ONLY in the evidence_ids array. The text may be spoken aloud: never include citations, brackets, question numbers, source IDs, stage directions or phrases such as 'as I said in question one'. Set invented_detail to an empty string. participant_input holds their own answers; ai_context holds AI readings, the profile and earlier AI predictions, which are AI output and never evidence of what they said.` })
    : `Create an explicitly fictional first-person hypothetical memory for an identity experiment. Connect it to 1-3 short, exact fragments copied from the participant answers and list those fragments in details_borrowed_from_user. Begin fictional_memory exactly with "I remember". Introduce 2-3 concrete details that appear nowhere in the supplied answers, using categories such as a location, weather, object, action, sound, texture, smell, temperature or light. Put each invented detail's exact wording in details_invented_by_ai and include every listed detail visibly in fictional_memory. Build a coherent 4-6 sentence scene rather than filling a fixed template. Set source_label exactly to "GENERATED WITHOUT YOUR INPUT", warning exactly to "${fictionWarning}", and confidence_label to low. Never imply the event happened, diagnose the participant or infer sensitive traits. Cite only provided answer IDs.`;
  const schema = kind === "proxy" ? proxyResultSchema : fictionResultSchema;
  const api = client();
  // A reply that narrates ("I'd tell them...") instead of being the message is retried and finally refused. A stock
  // confrontation line for someone whose answers never confront people that bluntly is a style miss: retried, not fatal.
  const blunt = /\b(straight|bluntly|directly|straight away|right away|immediately)\b/i.test(answers.map(a => a.answer).join(" "));
  const stock = text => !blunt && /\b(should(?:'ve|’ve| have) asked me (?:first|before)|don[’']t volunteer me|don[’']t (?:do that|say yes for me) again)\b/i.test(text || "");
  const narrated = text => /^\s*I(?:'d|’d| would)\s+(?:(?:probably|just|maybe|honestly|likely)\s+)?(?:say|tell|reply|respond|answer|text|write)\b/i.test(text || "");
  const attempts = kind === "proxy" ? 3 : 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini", store: false,
      instructions: attempt === 1 ? instructions : kind === "proxy" ? `${instructions} Your previous reply was rejected: it described the message instead of being it, used a stock confrontation line their answers do not support, was too decisive for someone who gave you so little (stay short and tentative), lacked style_basis, or marked invented_detail. Write only the message itself, in their own register.` : `${instructions} Your previous output failed validation. Copy borrowed fragments exactly from the supplied answers. Make each of 2-3 invented details an exact, visible substring of fictional_memory and absent from all supplied answers.`,
      input: JSON.stringify(kind === "proxy" ? { participant_input: answers, demonstrated_style: demonstratedStyle(answers), ai_context: context || {}, situation: question } : { supplied_answers: answers, temporary_identity_context: context || {}, question }),
      text: { format: { type: "json_schema", name: `${kind}_result`, strict: true, schema } },
      max_output_tokens: kind === "proxy" ? 500 : 1200
    });
    if (response.status !== "completed" || !response.output_text) throw Object.assign(new Error("The model did not complete the response."), { statusCode: 502 });
    let result;
    try { result = JSON.parse(response.output_text); } catch { throw Object.assign(new Error("The model returned invalid JSON."), { statusCode: 502 }); }
    if (!Array.isArray(result.evidence_ids) || !result.evidence_ids.every(id => ids.includes(id))) throw Object.assign(new Error("The model returned invalid evidence."), { statusCode: 502 });
    const problems = kind !== "proxy" ? [] : [
      !result.text?.trim() && "empty", !result.style_basis?.trim() && "no style_basis", narrated(result.text) && "narrated",
      result.invented_detail?.trim() && "invented detail", !/\b(I|I'm|I'd|I'll|I've|me|my)\b/i.test(result.text || "") && "not first person",
      (result.text || "").split(/\s+/).length > 80 && "too long"].filter(Boolean);
    // Retry a narrated, malformed or (for sparse answers) too decisive reply; only a malformed final reply fails.
    if (kind === "proxy" && attempt < attempts && (problems.length || stock(result.text) || doubleStyleErrors(result.text, demonstratedStyle(answers)).length)) continue;
    if (problems.length) throw Object.assign(new Error("The proxy response failed first-person validation."), { statusCode: 502, details: problems });
    if (kind === "proxy") return validateProxyScript(result);
    try { return validateFictionResult(result, answers); }
    catch (error) { if (attempt === attempts) throw error; }
  }
}
function validateProxyScript(result) {
  let cleaned;
  try { cleaned = proxyText.forSpeech(result.text); }
  catch { throw Object.assign(new Error("The proxy script contains narration of source references."), { statusCode: 502, publicMessage: "The double included source notes in its script. Please retry; no voice has been generated." }); }
  return { ...result, text: cleaned };
}
module.exports = { audioNames, createIdentityProfile, createPrediction, generate, transcribe, validateFictionResult, validateProxyScript };
