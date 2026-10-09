"use strict";

// Phone-to-screen photo handoff. The laptop asks for a one-time code and shows it as a QR code; the participant's
// phone opens /phone/<code>, picks a photo from its own library, and sends a resized, re-encoded JPEG (no location
// or device metadata) here. The laptop collects it once. Photos are held in memory only, never written to disk,
// and deleted on collection, cancellation or expiry.

const crypto = require("node:crypto");
const os = require("node:os");
const qrcode = require("qrcode-generator");

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 100;            // open codes at once, across all visitors
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{22}$/;
const sessions = new Map();         // id -> { expiresAt, photo: Buffer|null, waiters: Set<fn> }

function sweep(now = Date.now()) {
  for (const [id, entry] of sessions) if (entry.expiresAt <= now) close(id);
}
function close(id) {
  const entry = sessions.get(id);
  if (!entry) return;
  sessions.delete(id);
  entry.photo = null;
  for (const wake of entry.waiters) wake();
}
setInterval(sweep, 60_000).unref();

// The address the phone should open. A loopback-only local server cannot be reached from a phone.
function phoneBase(request, boundHost) {
  if (process.env.PHONE_BASE_URL) return process.env.PHONE_BASE_URL.replace(/\/+$/, "");
  const hostHeader = String(request.headers.host || "");
  const hostname = hostHeader.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  if (!loopback) {
    const proto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (request.socket.encrypted ? "https" : "http");
    return `${proto}://${hostHeader}`;
  }
  if (boundHost !== "0.0.0.0") return null;
  const port = hostHeader.match(/:(\d+)$/)?.[1];
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
  return lan ? `http://${lan.address}${port ? `:${port}` : ""}` : null;
}

function qrMatrix(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return { size, rows: Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => (qr.isDark(r, c) ? "1" : "0")).join("")) };
}

function create(request, boundHost) {
  sweep();
  if (sessions.size >= MAX_PENDING) throw Object.assign(new Error("Too many open phone codes."), { statusCode: 503, publicMessage: "Phone upload is busy right now. Choose an image or use the camera instead." });
  const base = phoneBase(request, boundHost);
  if (!base) return { available: false, reason: "local_only" };
  const id = crypto.randomBytes(16).toString("base64url");
  const expiresAt = Date.now() + TTL_MS;
  sessions.set(id, { expiresAt, photo: null, waiters: new Set() });
  const url = `${base}/phone/${id}`;
  return { available: true, id, phone_url: url, expires_in_ms: TTL_MS, qr: qrMatrix(url) };
}

const isJpeg = buffer => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
// Strip every APP1..APP15 and COM segment (EXIF, XMP, comments). The phone page already re-encodes through a canvas,
// so this is a second guard against location or device metadata reaching the server's memory or the screen.
function stripJpegMetadata(buffer) {
  const parts = [buffer.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buffer.length && buffer[i] === 0xff) {
    const marker = buffer[i + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buffer.length) throw Object.assign(new Error("Malformed JPEG."), { statusCode: 400 });
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(buffer.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  parts.push(buffer.subarray(i));
  return Buffer.concat(parts);
}

function upload(id, buffer) {
  sweep();
  const entry = ID.test(id) ? sessions.get(id) : null;
  if (!entry) throw Object.assign(new Error("Unknown or expired phone code."), { statusCode: 410, publicMessage: "This code has expired. Ask for a new QR code on the screen." });
  if (entry.photo) throw Object.assign(new Error("A photo was already sent with this code."), { statusCode: 409, publicMessage: "A photo was already sent with this code. To send another, choose “New code” on the screen." });
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES || !isJpeg(buffer)) throw Object.assign(new Error("Invalid photo."), { statusCode: 415, publicMessage: "That photo couldn't be sent. Try another one." });
  entry.photo = stripJpegMetadata(buffer);
  for (const wake of entry.waiters) wake();
}

// Long-poll: resolves with the photo (and forgets it), "waiting" after holdMs, or "gone".
function wait(id, holdMs = 20_000, signal) {
  sweep();
  const entry = ID.test(id) ? sessions.get(id) : null;
  if (!entry) return Promise.resolve({ status: "gone" });
  const take = () => {
    const current = sessions.get(id);
    if (!current) return { status: "gone" };
    if (!current.photo) return null;
    const photo = current.photo;
    close(id);
    return { status: "ready", photo };
  };
  const now = take();
  if (now) return Promise.resolve(now);
  return new Promise(resolve => {
    let timer, settled = false;
    // Settle once, and leave the waiter list before taking the photo (taking it closes the code and wakes the rest).
    const settle = read => {
      if (settled) return;
      settled = true; clearTimeout(timer); entry.waiters.delete(wake); signal?.removeEventListener("abort", aborted);
      resolve(read());
    };
    const wake = () => settle(() => take() || { status: "waiting" });
    const aborted = () => settle(() => ({ status: "waiting" }));
    timer = setTimeout(() => settle(() => ({ status: "waiting" })), holdMs);
    entry.waiters.add(wake);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function cancel(id) { if (ID.test(id)) close(id); }
function status(id) {
  const entry = ID.test(id) ? sessions.get(id) : null;
  return entry ? { status: entry.photo ? "sent" : "waiting" } : { status: "gone" };
}

module.exports = { create, upload, wait, cancel, status, stripJpegMetadata, phoneBase, MAX_PHOTO_BYTES, TTL_MS, ID, _sessions: sessions };
