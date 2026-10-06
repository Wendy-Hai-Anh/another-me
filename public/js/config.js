"use strict";

// Where the live AI server is. This is the only file to edit when publishing.
//   ""                                   -> the same address as this page (local `npm start`)
//   "https://another-me-api.onrender.com" -> a separately hosted server (used only on GitHub Pages)
// On GitHub Pages with no apiBase, the experience runs as a labelled demonstration:
// simulated AI text, typed answers, nothing sent anywhere.
(function () {
  const config = {
    apiBase: "https://another-me-api.onrender.com"
  };
  const staticHost = /\.github\.io$/i.test(location.hostname);
  // The hosted server is only for the published site; a local npm start always uses its own server.
  config.apiBase = staticHost ? config.apiBase.replace(/\/+$/, "") : "";
  config.serverless = staticHost && !config.apiBase;
  window.ANOTHER_ME_CONFIG = Object.freeze(config);
})();
