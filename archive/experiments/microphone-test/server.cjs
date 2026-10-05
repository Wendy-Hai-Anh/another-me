const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const OpenAI = require("openai").default;
const { toFile } = require("openai");

require("dotenv").config({
  path: path.resolve(__dirname, "..", "..", "..", ".env.local"),
  quiet: true
});

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.MICROPHONE_TEST_PORT || "4173", 10);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 45_000;
const PAGE_PATH = path.join(__dirname, "index.html");
const AUDIO_FILE_NAMES = new Map([
  ["audio/webm", "recording.webm"],
  ["audio/ogg", "recording.ogg"],
  ["audio/mp4", "recording.m4a"],
  ["audio/mpeg", "recording.mp3"],
  ["audio/wav", "recording.wav"],
  ["audio/x-wav", "recording.wav"],
  ["audio/aac", "recording.aac"],
  ["audio/flac", "recording.flac"]
]);

function setPrivateResponseHeaders(response, contentType) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", contentType);
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendError(response, statusCode, code, message) {
  setPrivateResponseHeaders(response, "application/json; charset=utf-8");
  response.writeHead(statusCode);
  response.end(JSON.stringify({ code, error: message }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let exceededLimit = false;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        exceededLimit = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceededLimit) {
        const error = new Error("Recording exceeds the request limit.");
        error.code = "RECORDING_TOO_LARGE";
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.on("aborted", () => reject(new Error("Request was aborted.")));
    request.on("error", reject);
  });
}

async function transcribe(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendError(response, 503, "missing_api_key", "OPENAI_API_KEY is not configured on the server.");
    return;
  }

  const contentType = (request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  const fileName = AUDIO_FILE_NAMES.get(contentType);
  if (!fileName) {
    sendError(response, 415, "unsupported_audio_format", "The submitted audio format is not supported.");
    return;
  }

  try {
    const audioBuffer = await readRequestBody(request);
    if (!audioBuffer.length) {
      sendError(response, 400, "empty_recording", "The submitted recording is empty.");
      return;
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 45_000
    });
    const file = await toFile(audioBuffer, fileName, { type: contentType });
    const result = await client.audio.transcriptions.create({
      file,
      model: "gpt-transcribe"
    }, {
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)
    });
    const transcript = (result.text || "").trim();

    if (!transcript) {
      sendError(response, 422, "no_speech_detected", "No speech was detected in the recording.");
      return;
    }

    setPrivateResponseHeaders(response, "text/plain; charset=utf-8");
    response.writeHead(200);
    response.end(transcript);
  } catch (error) {
    if (error.code === "RECORDING_TOO_LARGE") {
      sendError(response, 413, "recording_too_large", "The submitted recording is too large.");
      return;
    }

    console.error(
      `[transcription] ${error.name || "Error"} status=${error.status || "unknown"} code=${error.code || "unknown"}`
    );

    if (error.status === 400) {
      sendError(response, 422, "invalid_recording", "The transcription service could not decode the recording.");
      return;
    }

    if (error.status === 401 || error.status === 403) {
      sendError(response, 502, "invalid_api_key", "The transcription service rejected the server credentials.");
      return;
    }

    if (error.status === 429) {
      sendError(response, 503, "openai_quota_exceeded", "The transcription service rejected the request because quota is unavailable.");
      return;
    }

    if (
      error.name === "AbortError" ||
      error.name === "APIConnectionError" ||
      error.name === "APIConnectionTimeoutError" ||
      error.name === "APIUserAbortError"
    ) {
      sendError(response, 504, "openai_network_failure", "The server could not reach the transcription service.");
      return;
    }

    sendError(response, 502, "openai_api_failure", "The transcription service could not process the recording.");
  }
}

async function servePage(request, response) {
  try {
    const page = await fs.readFile(PAGE_PATH);
    setPrivateResponseHeaders(response, "text/html; charset=utf-8");
    response.writeHead(200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.end(page);
  } catch {
    sendError(response, 500, "page_unavailable", "The microphone test page could not be loaded.");
  }
}

const server = http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`).pathname;
  } catch {
    sendError(response, 400, "invalid_request", "The request URL is invalid.");
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/" || pathname === "/index.html")) {
    await servePage(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/transcribe") {
    await transcribe(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  sendError(response, 404, "not_found", "Not found.");
});

server.listen(PORT, HOST, () => {
  console.log(`Microphone test running at http://${HOST}:${PORT}`);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
