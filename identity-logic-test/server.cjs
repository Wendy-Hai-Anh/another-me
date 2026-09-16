const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const {
  IdentityLogicError,
  MODEL,
  createIdentityProfile,
  createPrediction
} = require("./identity-service.cjs");
const { publicTestCases } = require("./test-cases.cjs");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.IDENTITY_LOGIC_TEST_PORT || "4174", 10);
const MAX_BODY_BYTES = 64 * 1024;
const PAGE_PATH = path.join(__dirname, "index.html");

function setPrivateHeaders(response, contentType) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", contentType);
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response, statusCode, value) {
  setPrivateHeaders(response, "application/json; charset=utf-8");
  response.writeHead(statusCode);
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new IdentityLogicError("invalid_input", "The request body is too large.", 413));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new IdentityLogicError("invalid_input", "The request body must be valid JSON.", 400));
      }
    });
    request.on("aborted", () => reject(new IdentityLogicError("invalid_input", "The request was aborted.", 400)));
    request.on("error", reject);
  });
}

function sendHandledError(response, error) {
  const handled = error instanceof IdentityLogicError
    ? error
    : new IdentityLogicError("server_error", "The server could not complete the request.", 500);

  console.error(`[identity-logic] ${handled.code} status=${handled.statusCode}`);
  sendJson(response, handled.statusCode, {
    code: handled.code,
    error: handled.message,
    details: handled.details
  });
}

async function servePage(request, response) {
  try {
    const page = await fs.readFile(PAGE_PATH);
    setPrivateHeaders(response, "text/html; charset=utf-8");
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : page);
  } catch (error) {
    sendHandledError(response, error);
  }
}

async function handleProfile(request, response) {
  try {
    const body = await readJson(request);
    const result = await createIdentityProfile(body.answers);
    sendJson(response, 200, { profile: result.data, meta: result.meta });
  } catch (error) {
    sendHandledError(response, error);
  }
}

async function handlePrediction(request, response) {
  try {
    const body = await readJson(request);
    const result = await createPrediction({
      answers: body.answers,
      profile: body.profile,
      targetQuestion: body.target_question
    });
    sendJson(response, 200, { prediction: result.data, meta: result.meta });
  } catch (error) {
    sendHandledError(response, error);
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`).pathname;

  if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/" || pathname === "/index.html")) {
    await servePage(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/api/test-cases") {
    sendJson(response, 200, { test_cases: publicTestCases(), model: MODEL });
    return;
  }
  if (request.method === "POST" && pathname === "/api/profile") {
    await handleProfile(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/prediction") {
    await handlePrediction(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  sendJson(response, 404, { code: "not_found", error: "Not found.", details: [] });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing identity-logic server first.`);
  } else {
    console.error("The identity-logic server could not start.");
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Identity Logic Test running at http://${HOST}:${PORT}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
