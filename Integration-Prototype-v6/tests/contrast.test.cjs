const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "..", "v6.css"), "utf8");
const variable = name => css.match(new RegExp(`--${name}:(#[0-9a-f]{6})`, "i"))[1];
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
test("enabled text and source-label palette exceeds 4.5:1 against UI and brightest atmosphere surfaces", () => {
  for (const foreground of ["fg", "muted", "cyan", "pink", "violet"]) {
    for (const background of [variable("bg"), variable("surface"), "#27182d", "#211333", "#172132"]) {
      assert(contrast(variable(foreground), background) >= 4.5, `${foreground} on ${background}`);
    }
  }
  assert(contrast("#111720", variable("cyan")) >= 4.5);
  assert(contrast("#baaec6", "#181421") >= 4.5);
  assert(contrast(variable("line"), variable("surface")) >= 3);
});
