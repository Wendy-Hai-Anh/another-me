"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProxyText = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const id = "(?:questions?[_ -]*(?:[1-3]|one|two|three)|image[_ ]story|actual_prediction_answer|inference[_ -]*\\d+)";
  const list = `${id}(?:\\s*(?:,|;|and|&)\\s*(?:${id}|[1-3]))*`;
  const citation = new RegExp(`^[\\s]*(?:(?:based on|sources?|evidence|see)\\s*:?\\s*)?${list}[\\s.]*$`, "i");
  function clean(value) {
    return String(value || "")
      .replace(/\[([^\]]*)\]|\(([^)]*)\)/g, (whole, square, round) => citation.test(square ?? round) ? "" : whole)
      .replace(new RegExp(`[,;]?\\s*(?:based on|as (?:I|you) (?:said|mentioned) in|according to)\\s+(?:my |your )?${list}(?=[,.!?]|$)`, "gi"), "")
      .replace(/[ \t]+([,.!?])/g, "$1").replace(/\s+/g, " ").trim();
  }
  function hasReferences(value) { return new RegExp(`\\b${id}\\b`, "i").test(value); }
  function forSpeech(value) {
    const cleaned = clean(value);
    // Do not send a broken or reference-filled script to a paid voice provider.
    if (!cleaned || hasReferences(cleaned)) throw new Error("The double's script contains source notes. Generate a new response before creating its voice.");
    return cleaned;
  }
  return { clean, hasReferences, forSpeech };
});
