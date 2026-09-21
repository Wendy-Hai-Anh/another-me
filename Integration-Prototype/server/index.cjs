const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
const keyWasProvided = Object.hasOwn(process.env, "OPENAI_API_KEY");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
// Reuse the repository's existing server-only configuration without copying a secret.
if (!keyWasProvided && !process.env.OPENAI_API_KEY) dotenv.config({ path: path.join(root, "..", ".env.local"), quiet: true });
const adapter = require("./openai-adapter.cjs");
const { validateParticipantAnswers } = require("./schemas.cjs");

const host = "127.0.0.1";
const port = Number(process.env.INTEGRATION_PORT ?? 4180);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]]
]);
const maxJson = 64 * 1024;
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
async function jsonBody(request) {
  const data = await body(request, maxJson);
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request."), { statusCode: 400 }); }
}
function requireAnswers(answers) {
  const problems = validateParticipantAnswers(answers);
  if (problems.length) throw Object.assign(new Error("Participant answers are invalid."), { statusCode: 400 });
}
function safeError(error) {
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
    if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (request.method !== "POST" || !["/api/transcribe","/api/profile","/api/predict","/api/proxy","/api/fiction"].includes(url.pathname)) { json(response, 404, { error: "Not found." }); return; }
    if (request.headers.origin && request.headers.origin !== `http://${host}:${port}`) { json(response, 403, { error: "Cross-origin requests are not allowed." }); return; }
    if (url.pathname === "/api/transcribe") {
      const type = (request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
      if (!adapter.audioNames.has(type)) { json(response, 415, { error: "Unsupported audio format." }); return; }
      const transcript = await adapter.transcribe(await body(request, maxAudio), type);
      headers(response, "text/plain; charset=utf-8"); response.writeHead(200).end(transcript); return;
    }
    const input = await jsonBody(request);
    requireAnswers(input.answers);
    if (url.pathname === "/api/profile") { const result = await adapter.createIdentityProfile(input.answers); json(response, 200, { profile: result.data }); return; }
    if (url.pathname === "/api/predict") {
      if (typeof input.target_question !== "string" || !input.target_question.trim()) throw Object.assign(new Error("A target question is required."), { statusCode: 400 });
      const result = await adapter.createPrediction({ answers: input.answers, profile: input.profile, targetQuestion: input.target_question });
      json(response, 200, { prediction: result.data }); return;
    }
    if (url.pathname === "/api/proxy") { json(response, 200, { response: await adapter.generate("proxy", input.answers, input.question) }); return; }
    if (url.pathname === "/api/fiction") { json(response, 200, { fiction: await adapter.generate("fiction", input.answers, "Invent a clearly fictional hypothetical memory.") }); return; }
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
