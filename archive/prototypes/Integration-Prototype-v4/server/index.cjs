const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
// Reuse missing server-only credentials without copying secrets into this folder.
dotenv.config({ path: path.join(root, "..", "..", "..", ".env.local"), quiet: true, override: false });
const adapter = require("./openai-adapter.cjs");
const media = require("./media-service.cjs");
const { validateParticipantAnswers } = require("./schemas.cjs");

const host = "127.0.0.1";
const port = Number(process.env.INTEGRATION_PORT ?? 4183);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/resilience.css", ["resilience.css", "text/css; charset=utf-8"]],
  ["/experience.css", ["experience.css", "text/css; charset=utf-8"]],
  ["/scene.css", ["scene.css", "text/css; charset=utf-8"]],
  ["/immersive.css", ["immersive.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/immersive.js", ["immersive.js", "text/javascript; charset=utf-8"]]
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
function safeError(error) {
  if (error.publicMessage) return [error.statusCode || 502, error.publicMessage];
  if (error.statusCode === 503 && !process.env.OPENAI_API_KEY) return [503, "OPENAI_API_KEY is missing on the integration server. Set it in the server environment or repository .env.local, then restart the server."];
  if (error.statusCode && error.statusCode < 500) return [error.statusCode, error.message];
  if (error.status === 401 || error.status === 403) return [503, "OpenAI rejected the server API key. Check its project access and restart the server."];
  if (error.status === 429) return [503, "OpenAI rate limit or quota reached. Check API billing and retry later."];
  if (error.status === 400 || error.status === 415) return [422, "OpenAI could not read this audio. Play it back, then record again in a supported format."];
  return [502, "OpenAI is unavailable. Check the server connection and retry the recording later."];
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
    if (request.method !== "POST" || !["/api/transcribe","/api/profile","/api/predict","/api/proxy","/api/fiction","/api/cloned-speech","/api/talking-avatar"].includes(url.pathname)) { json(response, 404, { error: "Not found." }); return; }
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
      const speech = await media.createClonedSpeech(await body(request, maxAudio), type, url.searchParams.get("text") || "");
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
    requireAnswers(input.answers);
    if (url.pathname === "/api/profile") { const result = await adapter.createIdentityProfile(input.answers); json(response, 200, { profile: result.data }); return; }
    if (url.pathname === "/api/predict") {
      if (typeof input.target_question !== "string" || !input.target_question.trim()) throw Object.assign(new Error("A target question is required."), { statusCode: 400 });
      const result = await adapter.createPrediction({ answers: input.answers, profile: input.profile, targetQuestion: input.target_question });
      json(response, 200, { prediction: result.data }); return;
    }
    if (url.pathname === "/api/proxy") { json(response, 200, { response: await adapter.generate("proxy", input.answers, input.question, input.context) }); return; }
    if (url.pathname === "/api/fiction") { json(response, 200, { fiction: await adapter.generate("fiction", input.answers, "Invent a clearly fictional hypothetical memory.", input.context) }); return; }
  } catch (error) {
    const [code, message] = safeError(error);
    console.error(`[integration-api] ${error.code || error.name || "error"} status=${code}`);
    json(response, code, { error: message });
  }
});
if (require.main === module) {
  server.listen(port, host, () => console.log(`Integration prototype: http://${host}:${port}/`));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
module.exports = server;
