const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "v6.css"), "utf8");
// Deep theme is :root; the cream theme is the intro / Stage 1-2 override block.
const deep = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
const lightStart = css.indexOf('body[data-depth="opening"],body[data-depth="1"],body[data-depth="2"]{');
const cream = css.slice(lightStart, css.indexOf("}", lightStart));
const variable = (block, name) => block.match(new RegExp(`--${name}:(#[0-9a-f]{6})`, "i"))[1];
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const [name, block, atmosphere] of [["deep", deep, ["#2e2a6c", "#1b2046", "#1a1c4a", "#1f1548", "#32246c", "#1d0b29", "#2e103c", "#272a5e", "#2e225c", "#2f1640", "#0a0310", "#07051e"]], ["cream", cream, ["#fffdf6", "#f7f4e8", "#f3eae3", "#dbd8ef", "#f3f2fc", "#f5f4fb", "#cccaea"]]]) {
  test(`${name} theme: text and source-label colours exceed 4.5:1 on UI and brightest atmosphere surfaces`, () => {
    for (const foreground of ["fg", "muted", "accent", "supplied", "inferred", "generated", "warn"]) {
      for (const background of [variable(block, "bg"), variable(block, "surface"), variable(block, "field"), ...atmosphere]) {
        assert(contrast(variable(block, foreground), background) >= 4.5, `${name}: ${foreground} on ${background}`);
      }
    }
    assert(contrast(variable(block, "action-ink"), variable(block, "action")) >= 4.5, `${name}: primary button`);
    assert(contrast(variable(block, "placeholder"), variable(block, "field")) >= 4.5, `${name}: placeholder`);
    assert(contrast(variable(block, "line"), variable(block, "surface")) >= 3, `${name}: line`);
  });
}
