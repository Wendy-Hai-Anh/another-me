const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
// Checksums of the read-only references (archive and D:\files) so accidental edits are noticed.
const root = path.join(__dirname, "..", "..");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "docs", "reference-baseline.json"), "utf8").replace(/^\uFEFF/, ""));
const mismatches = baseline.filter(item => !fs.existsSync(item.path) || crypto.createHash("sha256").update(fs.readFileSync(item.path)).digest("hex").toUpperCase() !== item.sha256);
console.log(JSON.stringify({ checked: baseline.length, unchanged: baseline.length - mismatches.length, mismatches: mismatches.map(item => item.path) }, null, 2));
if (mismatches.length) process.exitCode = 1;
