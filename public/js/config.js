"use strict";

// Where the live AI server is. This is the only file to edit when publishing.
//   ""                                   -> the same address as this page (local `npm start`)
//   "https://another-me-api.onrender.com" -> a separately hosted server (for the GitHub Pages site)
// On GitHub Pages with no apiBase, the experience runs as a labelled demonstration:
// simulated AI text, typed answers, nothing sent anywhere.
(function () {
  const config = {
    apiBase: ""
  };
  const staticHost = /\.github\.io$/i.test(location.hostname);
  config.apiBase = config.apiBase.replace(/\/+$/, "");
  config.serverless = staticHost && !config.apiBase;
  window.ANOTHER_ME_CONFIG = Object.freeze(config);
})();
