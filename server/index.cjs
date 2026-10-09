const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
const adapter = require("./openai-adapter.cjs");
const media = require("./media-service.cjs");
const proxyText = require("../shared/proxy-text.js");
const { createSimulation } = require("./simulation-service.cjs");
const conversation = require("./conversation-service.cjs");
const { SPEAKERS } = require("./voices.cjs");
const feedback = require("./feedback-store.cjs");
const handoff = require("./phone-handoff.cjs");
const { validateParticipantAnswers } = require("./schemas.cjs");
const { safeError, diagnosticCode } = require("./safe-errors.cjs");

// Locally: 127.0.0.1:4187. On a host that sets PORT (Render, Railway, Fly), listen on all interfaces.
const port = Number(process.env.PORT ?? process.env.INTEGRATION_PORT ?? 4187);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
// The published site (e.g. https://<user>.github.io) may call this server; nothing else may.
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim().replace(/\/$/, "")).filter(Boolean));
const accessCode = process.env.ACCESS_CODE || "";
// Paid providers sit behind these routes, so every visitor gets a budget.
const limits = {
  requests: { max: Number(process.env.REQUESTS_PER_10_MIN || 40), windowMs: 10 * 60_000, routes: null },
  media: { max: Number(process.env.MEDIA_PER_HOUR || 4), windowMs: 60 * 60_000, routes: new Set(["/api/cloned-speech", "/api/talking-avatar"]) },
  mediaDaily: { max: Number(process.env.MEDIA_PER_DAY || 40), windowMs: 24 * 60 * 60_000, routes: new Set(["/api/cloned-speech", "/api/talking-avatar"]), global: true },
  feedback: { max: Number(process.env.FEEDBACK_PER_HOUR || 10), windowMs: 60 * 60_000, routes: new Set(["/api/feedback"]) },
  // Phone photo handoff: the screen long-polls (about one request every 20 s); the phone sends at most a few photos.
  handoffPoll: { max: 300, windowMs: 10 * 60_000, routes: new Set(["/api/handoff/wait", "/api/handoff/status", "/api/handoff/cancel"]) },
  handoffPhoto: { max: 20, windowMs: 10 * 60_000, routes: new Set(["/api/handoff/photo"]) }
};
const hits = new Map();
function overLimit(ip, pathname) {
  const now = Date.now();
  for (const [name, rule] of Object.entries(limits)) {
    if (rule.routes && !rule.routes.has(pathname)) continue;
    // Feedback has its own small budget and does not use up the experience's request budget.
    if (!rule.routes && (pathname === "/api/feedback" || pathname.startsWith("/api/handoff/"))) continue;
    const key = rule.global ? name : `${name}:${ip}`;
    const recent = (hits.get(key) || []).filter(time => now - time < rule.windowMs);
    if (recent.length >= rule.max) { hits.set(key, recent); return true; }
    recent.push(now); hits.set(key, recent);
  }
  return false;
}
function originAllowed(origin, request) {
  if (!origin) return true;
  let parsed; try { parsed = new URL(origin); } catch { return false; }
  // Same server (the page it serves itself), local development, or an explicitly listed site.
  return parsed.host === request.headers.host || ["127.0.0.1", "localhost"].includes(parsed.hostname) && !process.env.PORT || allowedOrigins.has(parsed.origin);
}
function corsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin || !originAllowed(origin, request)) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Access-Code");
  response.setHeader("Access-Control-Max-Age", "600");
}
function codeMatches(given) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(accessCode);
  return a.length === b.length && require("node:crypto").timingSafeEqual(a, b);
}
// Only these files are ever served: the page from public/, and the two modules shared with the server.
const html = "text/html; charset=utf-8", css = "text/css; charset=utf-8", js = "text/javascript; charset=utf-8";
const assets = new Map([
  ["/", ["public/index.html", html]],
  ["/index.html", ["public/index.html", html]],
  ["/css/v6.css", ["public/css/v6.css", css]],
  ["/js/config.js", ["public/js/config.js", js]],
  ["/js/script.js", ["public/js/script.js", js]],
  ["/js/v6.js", ["public/js/v6.js", js]],
  ["/js/motion.js", ["public/js/motion.js", js]],
  ["/js/music.js", ["public/js/music.js", js]],
  ["/js/proxy-text.js", ["shared/proxy-text.js", js]],
  ["/js/simulation-core.js", ["shared/simulation-core.js", js]],
  // Background music: four tracks, played alternately.
  ...["digital-breathing", "sparse-piano-motif", "digital-breathing-2", "sparse-piano-motif-2"].map(name => [`/audio/${name}.mp3`, [`public/audio/${name}.mp3`, "audio/mpeg"]])
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
    corsHeaders(request, response);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      response.writeHead(originAllowed(request.headers.origin, request) ? 204 : 403).end(); return;
    }
    if (["GET", "HEAD"].includes(request.method) && assets.has(url.pathname)) {
      const [name, type] = assets.get(url.pathname);
      let file;
      try { file = await fs.readFile(path.join(root, name)); }
      catch (error) { if (error.code === "ENOENT") { json(response, 404, { error: "Not found." }); return; } throw error; }
      headers(response, type);
      if (type === "audio/mpeg") {
        // Music is large and never changes within a build; let the browser keep it and seek in it.
        response.setHeader("Cache-Control", "public, max-age=86400");
        response.setHeader("Accept-Ranges", "bytes");
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, file.length - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
          if (start > end || start >= file.length) { response.setHeader("Content-Range", `bytes */${file.length}`); response.writeHead(416).end(); return; }
          response.setHeader("Content-Range", `bytes ${start}-${end}/${file.length}`);
          response.writeHead(206).end(request.method === "HEAD" ? undefined : file.subarray(start, end + 1)); return;
        }
      }
      response.writeHead(200).end(request.method === "HEAD" ? undefined : file); return;
    }
    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      json(response, 200, {
        openai: Boolean(process.env.OPENAI_API_KEY),
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
        did: Boolean(process.env.DID_API_KEY),
        accessCode: Boolean(accessCode),
        feedback: feedback.mode(),
        phoneUpload: true
      }); return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    // Phone photo handoff: the page the phone opens from the QR code, and the routes that carry one photo to the screen.
    const phonePage = /^\/phone\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
    if (["GET", "HEAD"].includes(request.method) && (phonePage || url.pathname === "/phone/phone.js")) {
      const [name, type] = phonePage ? ["server/phone/index.html", html] : ["server/phone/phone.js", js];
      headers(response, type);
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Frame-Options", "DENY");
      response.writeHead(200).end(request.method === "HEAD" ? undefined : await fs.readFile(path.join(root, name))); return;
    }
    const handoffRoute = /^\/api\/handoff(?:\/([A-Za-z0-9_-]{22})\/(wait|status|cancel|photo))?$/.exec(url.pathname);
    if (handoffRoute) {
      const [, id, action] = handoffRoute;
      const expected = { undefined: "POST", wait: "GET", status: "GET", cancel: "POST", photo: "POST" }[action];
      if (request.method !== expected) { json(response, 405, { error: "Method not allowed." }); return; }
      if (!originAllowed(request.headers.origin, request)) { json(response, 403, { error: "This site is not allowed to use the server.", code: "origin_not_allowed" }); return; }
      // Only the screen needs the access code; the phone holds the one-time code instead.
      if (!action && accessCode && !codeMatches(request.headers["x-access-code"])) { json(response, 401, { error: "An access code is needed to use the live AI. Ask the researcher for it.", code: "access_code_required" }); return; }
      const ip = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() || request.socket.remoteAddress || "unknown";
      if (overLimit(ip, action ? `/api/handoff/${action}` : "/api/handoff")) { json(response, 429, { error: "Too many requests from this device. Wait a few minutes, then try again.", code: "rate_limit" }); return; }
      if (!action) { json(response, 200, handoff.create(request, host)); return; }
      if (action === "status") { json(response, 200, handoff.status(id)); return; }
      if (action === "cancel") { handoff.cancel(id); response.writeHead(204).end(); return; }
      if (action === "photo") {
        if ((request.headers["content-type"] || "").split(";", 1)[0].toLowerCase() !== "image/jpeg") { json(response, 415, { error: "That photo couldn't be sent. Try another one." }); return; }
        handoff.upload(id, await body(request, handoff.MAX_PHOTO_BYTES));
        json(response, 200, { status: "sent" }); return;
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      response.on("close", cancel);
      try {
        const result = await handoff.wait(id, 20_000, controller.signal);
        if (response.destroyed) return;
        if (result.status === "ready") { headers(response, "image/jpeg"); response.writeHead(200).end(result.photo); return; }
        if (result.status === "waiting") { response.writeHead(204).end(); return; }
        json(response, 410, { error: "This phone code has expired.", code: "handoff_gone" }); return;
      } finally { response.off("close", cancel); }
    }
    // The researcher downloads stored feedback with a separate token; it is never shown to participants.
    if (request.method === "GET" && url.pathname === "/api/feedback/export") {
      const token = process.env.FEEDBACK_EXPORT_TOKEN || "";
      const given = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token || Buffer.byteLength(given) !== Buffer.byteLength(token) || !require("node:crypto").timingSafeEqual(Buffer.from(given), Buffer.from(token))) { json(response, 401, { error: "Not allowed." }); return; }
      headers(response, "application/x-ndjson; charset=utf-8"); response.writeHead(200).end(await feedback.exportAll()); return;
    }
    if (request.method !== "POST" || !["/api/transcribe","/api/profile","/api/predict","/api/proxy","/api/fiction","/api/simulation","/api/cloned-speech","/api/talking-avatar","/api/image-reading","/api/reply","/api/synthesis","/api/review","/api/commentary","/api/inference","/api/feedback"].includes(url.pathname)) { json(response, 404, { error: "Not found." }); return; }
    if (!originAllowed(request.headers.origin, request)) { json(response, 403, { error: "This site is not allowed to use the server.", code: "origin_not_allowed" }); return; }
    // Feedback is optional and free to store, so it does not need the AI access code.
    if (accessCode && url.pathname !== "/api/feedback" && !codeMatches(request.headers["x-access-code"])) { json(response, 401, { error: "An access code is needed to use the live AI. Ask the researcher for it.", code: "access_code_required" }); return; }
    const ip = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() || request.socket.remoteAddress || "unknown";
    if (overLimit(ip, url.pathname)) { json(response, 429, { error: "Too many requests from this device. Wait a few minutes, then try again.", code: "rate_limit" }); return; }
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
    // Short conversational calls: the client gives up quickly and falls back; the server stops when it does.
    const withCancel = async work => {
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.on("close", cancel);
      try { return await work(controller.signal); } finally { response.off("close", cancel); }
    };
    if (url.pathname === "/api/image-reading") {
      const input = await jsonBody(request, 6 * 1024 * 1024);
      json(response, 200, { reading: await withCancel(signal => conversation.readImage(input, { signal })) }); return;
    }
    const input = await jsonBody(request);
    if (url.pathname === "/api/feedback") { json(response, 200, await withCancel(signal => feedback.store(input, { signal }))); return; }
    // Speaking about the participant: the system interpreter.
    if (url.pathname === "/api/reply") { json(response, 200, { speaker: SPEAKERS.SYSTEM, reply: await withCancel(signal => conversation.reply(input, { signal })) }); return; }
    if (url.pathname === "/api/synthesis") { json(response, 200, { speaker: SPEAKERS.SYSTEM, synthesis: await withCancel(signal => conversation.synthesise(input, { signal })) }); return; }
    if (url.pathname === "/api/review") { json(response, 200, { speaker: SPEAKERS.SYSTEM, review: await withCancel(signal => conversation.reviewReply(input, { signal })) }); return; }
    if (url.pathname === "/api/commentary") { json(response, 200, { speaker: SPEAKERS.SYSTEM, commentary: await withCancel(signal => conversation.commentary(input, { signal })) }); return; }
    if (url.pathname === "/api/inference") { json(response, 200, { speaker: SPEAKERS.SYSTEM, ...(await withCancel(signal => conversation.inferenceSequence(input, { signal }))) }); return; }
    if (url.pathname === "/api/simulation") {
      if (!input || !Array.isArray(input.answers) || input.answers.length > 20 || !input.answers.every(a => a && typeof a.id === "string" && typeof a.answer === "string" && a.answer.length <= 4000)
        || input.context && (typeof input.context !== "object" || Array.isArray(input.context))
        || [input.context?.profile_feedback, input.context?.contradiction_feedback, input.context?.profile?.inferred_information, input.context?.profile?.contradictions, input.context?.rejected_interpretations, input.seen_scenarios, input.discussed_questions].some(value => value !== undefined && !Array.isArray(value))
        || (input.context?.rejected_interpretations || []).some(r => typeof r !== "string" || r.length > 400)) {
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
      try { json(response, 200, { speaker: SPEAKERS.DOUBLE, simulation: await createSimulation(input, { signal: controller.signal }) }); }
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
        const rejected = Array.isArray(input.rejected_interpretations) ? input.rejected_interpretations.filter(r => typeof r === "string" && r.length <= 400).slice(0, 6) : [];
        const result = await adapter.createIdentityProfile(input.answers, { signal: controller.signal, rejected });
        if (!response.destroyed) json(response, 200, { profile: result.data });
      } catch (error) {
        if (timedOut) throw Object.assign(new Error("Profile deadline reached."), { code: "timeout", statusCode: 504 });
        throw error;
      } finally { clearTimeout(timer); response.off("close", cancel); }
      return;
    }
    if (url.pathname === "/api/predict") {
      if (typeof input.target_question !== "string" || !input.target_question.trim()) throw Object.assign(new Error("A target question is required."), { statusCode: 400 });
      // The double predicts before the participant answers: their own Stage 4 (or later) answers must never be in the request.
      if (input.answers.some(answer => /^stage[45]_/.test(answer?.id || ""))) throw Object.assign(new Error("The prediction cannot use the participant's own answer to this situation."), { statusCode: 400, code: "prediction_leak" });
      const result = await adapter.createPrediction({ answers: input.answers, profile: input.profile, targetQuestion: input.target_question });
      json(response, 200, { speaker: SPEAKERS.DOUBLE, prediction: result.data }); return;
    }
    if (url.pathname === "/api/proxy") { json(response, 200, { speaker: SPEAKERS.DOUBLE, response: await adapter.generate("proxy", input.answers, input.question, input.context) }); return; }
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
  server.listen(port, host, () => console.log(`Another Me server: http://${host}:${port}/${allowedOrigins.size ? ` (also serving ${[...allowedOrigins].join(", ")})` : ""}${accessCode ? " · access code on" : ""}`));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
module.exports = server;
