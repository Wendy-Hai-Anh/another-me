const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(PROJECT_ROOT, "frontend", "index.html"), "utf8");
const script = fs.readFileSync(path.join(PROJECT_ROOT, "frontend", "scripts", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(PROJECT_ROOT, "frontend", "styles", "main.css"), "utf8");

test("frontend entry point uses the reorganized assets", () => {
  assert.match(html, /href="styles\/main\.css"/);
  assert.match(html, /src="scripts\/app\.js"/);
});

test("camera access prefers the user-facing camera without audio", () => {
  assert.match(script, /navigator\.mediaDevices\.getUserMedia\(\{[\s\S]*?facingMode:\s*\{\s*ideal:\s*"user"\s*\}[\s\S]*?audio:\s*false/);
  assert.match(script, /enableCameraButton[\s\S]*?addEventListener\("click",\s*enableCamera\)/);
});

test("preview and captured frame use the same mirrored orientation", () => {
  assert.match(styles, /\.camera-video\s*\{\s*transform:\s*scaleX\(-1\)/);
  assert.match(script, /context\.translate\(canvas\.width,\s*0\);[\s\S]*?context\.scale\(-1,\s*1\);[\s\S]*?context\.drawImage/);
});

test("capture produces an in-memory JPEG at 90 percent quality", () => {
  assert.match(script, /canvas\.toBlob\(resolve,\s*"image\/jpeg",\s*0\.9\)/);
  assert.match(script, /getPhotoBlob:\s*\(\)\s*=>\s*cameraState\.confirmed\s*\?\s*cameraState\.photoBlob\s*:\s*null/);
  assert.match(script, /another-me:photo-confirmed/);
});

test("camera tracks stop on controls, component removal, and page exit", () => {
  assert.match(script, /cameraState\.stream\.getTracks\(\)\.forEach\(\(track\)\s*=>\s*track\.stop\(\)\)/);
  assert.match(script, /window\.addEventListener\("pagehide",\s*stopCameraTracks\)/);
  assert.match(script, /window\.addEventListener\("beforeunload",\s*stopCameraTracks\)/);
  assert.match(script, /handleCameraComponentRemoved\(\)/);
});

test("camera errors and accessible responsive controls remain explicit", () => {
  for (const errorName of ["NotAllowedError", "NotFoundError", "NotReadableError", "TrackStartError"]) {
    assert.match(script, new RegExp(errorName));
  }

  assert.match(script, /Camera access requires HTTPS or localhost/);
  assert.match(styles, /\.camera-button:focus-visible/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});
