const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_ROOT = path.resolve(__dirname, "..", "frontend");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  const relativePath = requestUrl.pathname === "/"
    ? "index.html"
    : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filePath = path.resolve(FRONTEND_ROOT, relativePath);
  const isInsideFrontend = filePath.startsWith(`${FRONTEND_ROOT}${path.sep}`);

  if (!isInsideFrontend) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(file);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`another-me is running at http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error(`Unable to start another-me: ${error.message}`);
  process.exitCode = 1;
});
