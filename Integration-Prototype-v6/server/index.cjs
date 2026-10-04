const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
// Reuse missing server-only credentials without copying secrets into this folder.
dotenv.config({ path: path.join(root, "..", ".env.local"), quiet: true, override: false });
const adapter = require("./openai-adapter.cjs");
const media = require("./media-service.cjs");
const proxyText = require("../proxy-text.js");
const { createSimulation } = require("./simulation-service.cjs");
const { validateParticipantAnswers } = require("./schemas.cjs");
const { safeError, diagnosticCode } = require("./safe-errors.cjs");

const host = "127.0.0.1";
const port = Number(process.env.INTEGRATION_PORT ?? 4187);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/resilience.css", ["resilience.css", "text/css; charset=utf-8"]],
  ["/experience.css", ["experience.css", "text/css; charset=utf-8"]],
  ["/scene.css", ["scene.css", "text/css; charset=utf-8"]],
  ["/immersive.css", ["immersive.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/immersive.js", ["immersive.js", "text/javascript; charset=utf-8"]],
  ["/v6.css", ["v6.css", "text/css; charset=utf-8"]],
  ["/v6.js", ["v6.js", "text/javascript; charset=utf-8"]],
  ["/motion.js", ["motion.js", "text/javascript; charset=utf-8"]],
  ["/proxy-text.js", ["proxy-text.js", "text/javascript; charset=utf-8"]],
  ["/simulation-core.js", ["simulation-core.js", "text/javascript; charset=utf-8"]]
]);
const maxJson = 64 * 1024;
const maxMediaJson = 24 * 1024 * 1024;
const maxAudio = 25 * 1024 * 1024;
function headers(response, contentType) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Type", contentType);
}
function json(response, code, data) { headers(response, "application/json; charset=utf-8"); response.writeHead(code).end(JSON.stringify(data)); }
function body(request, limit) {
  return new Promise((resolve, reject) => {
    let total = 0; let tooLarge = false; const chunks = [];
    request.on("data", chunk => {
      total += chunk.length;
      if (total > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    request.on("end", () => tooLarge ? reject(Object.assign(new Error("Request is too large."), { statusCode: 413 })) : resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
async function jsonBody(request, limit = maxJson) {
  const data = await body(request, limit);
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request."), { statusCode: 400 }); }
}
function base64Buffer(value, label, limit) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Object.assign(new Error(`${label} is invalid.`), { statusCode: 400 });
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length || buffer.length > limit) throw Object.assign(new Error(`${label} is empty or too large.`), { statusCode: 413 });
  return buffer;
}
function requireAnswers(answers) {
  const problems = validateParticipantAnswers(answers);
  if (problems.length) throw Object.assign(new Error("Participant answers are invalid."), { statusCode: 400 });
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (["GET", "HEAD"].includes(request.method) && assets.has(url.pathname)) {
      const [name, type] = assets.get(url.pathname);
      const file = await fs.readFile(path.join(root, name));
      headers(response, type); response.writeHead(200).end(request.method === "HEAD" ? undefined : file); return;
    }
    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      json(response, 200, {
        openai: Boolean(process.env.OPENAI_API_KEY),
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
        did: Boolean(process.env.DID_API_KEY)
      }); return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (request.method !== "POST" || !["/api/transcribe","/api/profile","/api/predict","/api/proxy","/api/fiction","/api/simulation","/api/cloned-speech","/api/talking-avatar"].includes(url.pathname)) { json(response, 404, { error: "Not found." }); return; }
    if (request.headers.origin && request.headers.origin !== `http://${host}:${port}`) { json(response, 403, { error: "Cross-origin requests are not allowed." }); return; }
    if (url.pathname === "/api/transcribe") {
      const type = (request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
      if (!adapter.audioNames.has(type)) { json(response, 415, { error: "Unsupported audio format." }); return; }
      const transcript = await adapter.transcribe(await body(request, maxAudio), type);
      headers(response, "text/plain; charset=utf-8"); response.writeHead(200).end(transcript); return;
    }
    if (url.pathname === "/api/cloned-speech") {
      const type = (request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
      if (!media.audioExtensions.has(type)) { json(response, 415, { error: "Unsupported voice-sample format." }); return; }
      let script;
      try { script = proxyText.forSpeech(url.searchParams.get("text") || ""); }
      catch (error) { throw Object.assign(error, { statusCode: 422 }); }
      const speech = await media.createClonedSpeech(await body(request, maxAudio), type, script);
      headers(response, "audio/mpeg"); response.writeHead(200).end(speech); return;
    }
    if (url.pathname === "/api/talking-avatar") {
      const input = await jsonBody(request, maxMediaJson);
      if (!media.imageExtensions.has(input.image_type) || input.audio_type !== "audio/mpeg") { json(response, 415, { error: "Unsupported avatar image or audio format." }); return; }
      const image = base64Buffer(input.image_base64, "Avatar image", 10 * 1024 * 1024);
      const audio = base64Buffer(input.audio_base64, "Avatar audio", 6 * 1024 * 1024);
      const video = await media.createTalkingAvatar(image, input.image_type, audio, input.audio_type);
      headers(response, "video/mp4"); response.writeHead(200).end(video); return;
    }
    const input = await jsonBody(request);
    if (url.pathname === "/api/simulation") {
      if (!input || !Array.isArray(input.answers) || input.answers.length > 12 || !input.answers.every(a => a && typeof a.id === "string" && typeof a.answer === "string" && a.answer.length <= 4000)
        || input.context && (typeof input.context !== "object" || Array.isArray(input.context))
        || [input.context?.profile_feedback, input.context?.contradiction_feedback, input.context?.profile?.inferred_information, input.context?.profile?.contradictions, input.seen_scenarios, input.discussed_questions].some(value => value !== undefined && !Array.isArray(value))) {
        json(response, 400, { error: "Please review your answers before generating a simulation." }); return;
      }
      const lists = input.context || {};
      const invalidRows = [lists.profile_feedback, lists.contradiction_feedback, lists.profile?.inferred_information, lists.profile?.contradictions]
        .some(rows => rows && (rows.length > 40 || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))));
      const invalidStrings = [input.seen_scenarios, input.discussed_questions]
        .some(rows => rows && (rows.length > 40 || rows.some(row => typeof row !== "string" || row.length > 4000)));
      if (invalidRows || invalidStrings) { json(response, 400, { error: "Please review your profile before generating a simulation." }); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 150_000);
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.on("close", cancel);
      try { json(response, 200, { simulation: await createSimulation(input, { signal: controller.signal }) }); }
      catch (error) {
        if (controller.signal.aborted) throw Object.assign(new Error("Simulation timed out."), { statusCode: 504, publicMessage: "The hypothetical simulation took too long. Your earlier information is unchanged; you can retry or skip." });
        throw error;
      }
      finally { clearTimeout(timer); response.off("close", cancel); }
      return;
    }
    requireAnswers(input.answers);
    if (url.pathname === "/api/profile") {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.on("close", cancel);
      try {
        const result = await adapter.createIdentityProfile(input.answers, { signal: controller.signal });
        if (!response.destroyed) json(response, 200, { profile: result.data });
      } catch (error) {
        if (timedOut) throw Object.assign(new Error("Profile deadline reached."), { code: "timeout", statusCode: 504 });
        throw error;
      } finally { clearTimeout(timer); response.off("close", cancel); }
      return;
    }
    if (url.pathname === "/api/predict") {
      if (typeof input.target_question !== "string" || !input.target_question.trim()) throw Object.assign(new Error("A target question is required."), { statusCode: 400 });
      const result = await adapter.createPrediction({ answers: input.answers, profile: input.profile, targetQuestion: input.target_question });
      json(response, 200, { prediction: result.data }); return;
    }
    if (url.pathname === "/api/proxy") { json(response, 200, { response: await adapter.generate("proxy", input.answers, input.question, input.context) }); return; }
    if (url.pathname === "/api/fiction") { json(response, 200, { fiction: await adapter.generate("fiction", input.answers, "Invent a clearly fictional hypothetical memory.", input.context) }); return; }
  } catch (error) {
    const [code, message] = safeError(error);
    const diagnostic = diagnosticCode(error);
    const provider = ["D-ID", "ElevenLabs"].includes(error.provider) ? error.provider : "OpenAI";
    console.error(`[integration-api] ${diagnostic} provider=${provider} status=${code}`);
    if (!response.destroyed) json(response, code, { error: message, code: diagnostic, provider });
  }
});
if (require.main === module) {
  server.listen(port, host, () => console.log(`Integration prototype: http://${host}:${port}/`));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
module.exports = server;
