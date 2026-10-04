/* Another Me v5: scene director, atmosphere and hands-free voice.
   Loads after script.js (unchanged) and wraps its render pipeline. All questions, state, consent,
   operations and API calls still come from script.js. */
(() => {
  const $ = s => document.querySelector(s);
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const body = document.body, stageEl = $("#stage");

  /* 1. Sparse copy for the two screens the layer owns */
  window.renderOpening = () => `<section class="opening-screen" aria-labelledby="openingTitle">
    <h2 id="openingTitle" class="opening-title" data-words>How much of you can a system make?</h2>
    <p class="opening-lede beat">Ten minutes. A conversation, not a form.</p>
    <p class="opening-note beat">It will guess about you, and it may be wrong. Nothing is permanently stored. Delete the temporary session any time.</p>
    <div class="beat"><button type="button" data-action="continue" class="primary">Begin</button></div>
    <details class="quiet-details beat"><summary>Before you begin</summary><p>You can use an image, your voice, or text. Everything the system shows is labelled as Supplied (yours), Inferred (its guess) or Generated (made up). External AI services are only used after you agree at the step that needs them. You can skip, correct or stop at any time.</p></details>
  </section>`;
  window.intro = () => {
    const [title, feeling] = stages[sessionState.currentStage - 1];
    return `<p class="stage-kicker">${String(sessionState.currentStage).padStart(2, "0")} · ${feeling}</p><h2 class="stage-title">${title}</h2>`;
  };

  /* 2. Scene director: runs after every render */
  let lastSig = "";
  const sig = () => {
    const u = sessionState.ui, p = stageEl.querySelector("[data-prompt-key]");
    return [sessionState.started, sessionState.finished, sessionState.ended, sessionState.currentStage, sessionState.questionIndex, u.profilePage, u.predictionCompared, u.proxyReview, u.fictionReflection, u.fictionAnswered, !!sessionState.supplied.image, !!sessionState.supplied.audio, p?.dataset.promptKey].join("|");
  };
  const condense = el => {
    if (el.closest(".fold") || el.querySelector("button,input,label,textarea,audio,video,summary")) return;
    const t = el.textContent.trim();
    if (t.length < 120) return;
    const cut = t.search(/[.!?]\s/);
    const head = cut > 20 && cut < 110 ? t.slice(0, cut + 1) : t.slice(0, 80) + "…";
    const d = document.createElement("details");
    d.className = "fold";
    d.innerHTML = `<summary></summary><div></div>`;
    d.firstChild.textContent = head;
    d.lastChild.textContent = t.slice(head.length === t.length ? 0 : head.length).trim();
    el.replaceChildren(d);
  };
  const splitWords = el => {
    if (el.dataset.split) return; el.dataset.split = 1;
    const words = el.textContent.split(" ");
    el.setAttribute("aria-label", el.textContent);
    el.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true" style="--d:${i * 110}">${w}</span>`).join(" ");
  };
  const director = () => {
    const s = sessionState;
    body.dataset.stage = !s.started ? "opening" : s.finished ? "ending" : String(s.currentStage);
    stageEl.querySelectorAll(".notice,.disclosure,p.small,.inline-note").forEach(condense);
    stageEl.querySelectorAll("[data-words]").forEach(splitWords);
    const sg = sig(), fresh = sg !== lastSig; lastSig = sg;
    const beats = [...stageEl.querySelectorAll(":scope > *, :scope > section > *, :scope > section > div > *")]
      .filter((el, _, all) => !all.some(o => o !== el && el.contains(o) && !o.closest(".fold")) || el.matches(".prompt-surface"));
    let delay = .12;
    beats.forEach((el, i) => {
      if (el.matches(".opening-title") || el.closest(".beat")) return;
      el.classList.add("beat");
      if (!fresh || RM) { el.classList.add("seen"); return; }
      const interactive = el.matches("button,.controls,.choice-row,.input-choice,textarea,.recording-surface") || el.querySelector("button,textarea");
      el.style.setProperty("--delay", (i === 0 ? 0 : delay + (interactive ? .18 : 0)) + "s");
      if (i > 0) delay += .16;
    });
    if (!fresh) stageEl.querySelectorAll(".beat").forEach(b => b.classList.add("seen"));
    hands();
  };

  const baseRender = window.render;
  window.render = function () { baseRender.apply(this, arguments); director(); };

  /* 4. Hands-free voice: when on, the system speaks its question, then listens and stops on silence */
  const vt = $("#voiceToggle"); let hf = false, armedKey = "", ac = null, an = null, data = null, heard = false, lastVoice = 0;
  vt.onclick = () => { hf = !hf; vt.setAttribute("aria-pressed", hf); vt.textContent = "Hands-free voice: " + (hf ? "on" : "off"); if (hf) hands(); };
  function hands() {
    if (!hf) return;
    const p = stageEl.querySelector("[data-prompt-key]");
    const rec = stageEl.querySelector('[data-action="start-recording"]:not(:disabled)');
    if (!p || !rec || typeof recorder !== "undefined" && recorder) return;
    const key = p.dataset.promptKey + sig();
    if (key === armedKey) return;
    const wait = () => { if (!p.isConnected) return; if (!p.classList.contains("is-complete")) return setTimeout(wait, 250); armedKey = key; setTimeout(() => stageEl.querySelector('[data-action="start-recording"]:not(:disabled)')?.click(), 500); };
    wait();
  }
  function listen() {
    const on = typeof recorder !== "undefined" && recorder && typeof micStream !== "undefined" && micStream;
    if (!on) { if (an) { an = null; heard = false; } return 0; }
    if (!an) {
      try { ac = ac || new AudioContext(); const src = ac.createMediaStreamSource(micStream); an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); data = new Uint8Array(an.fftSize); heard = false; lastVoice = performance.now(); } catch { return 0; }
    }
    an.getByteTimeDomainData(data);
    let sum = 0; for (const v of data) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / data.length), now = performance.now();
    if (rms > .045) { heard = true; lastVoice = now; }
    if (hf && heard && now - lastVoice > 2200) { heard = false; stageEl.querySelector('[data-action="stop-recording"]')?.click(); }
    return rms;
  }

  /* 5. Atmosphere: warm paper to dark machine. Density, lines and the participant's own image grow with the stage. */
  const cv = $("#atmo"), cx = cv.getContext("2d"); let W, H, pts = [], mx = -999, my = -999, T = 0, ghost = null, ghostUrl = "";
  const targetT = () => !sessionState.started ? 0 : sessionState.finished ? .94 : [.04, .12, .28, .72, .87, 1][sessionState.currentStage - 1];
  const size = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  addEventListener("resize", size); size();
  addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; });
  for (let i = 0; i < 190; i++) pts.push({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00008, vy: (Math.random() - .5) * .00008 });
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  function frame(now) {
    T += (targetT() - T) * .02;
    const bg = mix([248, 245, 237], [11, 10, 18], T);
    const luminance = bg[0] * .2126 + bg[1] * .7152 + bg[2] * .0722;
    const darkRoom = luminance < 145;
    const fg = darkRoom ? [248, 245, 250] : [25, 22, 30];
    const muted = darkRoom ? [234, 229, 239] : [60, 54, 68];
    const accentProgress = Math.max(0, Math.min(1, darkRoom ? (T - .5) / .5 : T / .5));
    const acc = darkRoom
      ? mix([255, 202, 222], [129, 236, 240], accentProgress)
      : mix([126, 37, 82], [10, 104, 121], accentProgress);
    const r = body.style;
    r.setProperty("--t", T.toFixed(3));
    r.setProperty("--bg", `rgb(${bg})`);
    r.setProperty("--fg", `rgb(${fg})`);
    r.setProperty("--acc", `rgb(${acc})`);
    r.setProperty("--muted", `rgb(${muted})`);
    r.setProperty("--contrast-muted", `rgb(${muted})`);
    r.setProperty("--surface", darkRoom ? "rgba(21, 18, 29, .92)" : "rgba(252, 249, 242, .92)");
    cx.fillStyle = `rgb(${bg})`; cx.fillRect(0, 0, W, H);
    const url = sessionState.supplied.image?.url;
    if (url !== ghostUrl) { ghostUrl = url; ghost = null; if (url) { const im = new Image(); im.onload = () => ghost = im; im.src = url; } }
    if (ghost && T > .3) { /* the participant's image, sliced and displaced as the double takes space */
      const a = Math.min(.42, (T - .3) * .55), strips = 14, sw = Math.min(W * .42, 520), sh = sw * ghost.height / ghost.width, x0 = W - sw - W * .06, y0 = (H - sh) / 2;
      for (let i = 0; i < strips; i++) { const h = sh / strips, off = Math.sin(now / 1700 + i * .8) * (T - .3) * 38; cx.globalAlpha = a; cx.drawImage(ghost, 0, i * ghost.height / strips, ghost.width, ghost.height / strips, x0 + off, y0 + i * h, sw, h + 1); }
      cx.globalAlpha = 1;
    }
    const n = Math.floor(50 + T * 140), lvl = listen(), reach = 90 + T * 70;
    cx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; p.x = (p.x + p.vx * 16 + 1) % 1; p.y = (p.y + p.vy * 16 + 1) % 1;
      const x = p.x * W, y = p.y * H, dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
      cx.fillStyle = `rgba(${fg},${.25 + T * .35})`; cx.fillRect(x, y, 2, 2);
      if (d < 140) { p.x += dx / d * .0006; p.y += dy / d * .0006; }
      for (let j = i + 1; j < n; j += 3) { const q = pts[j], ex = x - q.x * W, ey = y - q.y * H, e = ex * ex + ey * ey; if (e < reach * reach) { cx.strokeStyle = `rgba(${acc},${(1 - Math.sqrt(e) / reach) * (.05 + T * .22)})`; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(q.x * W, q.y * H); cx.stroke(); } }
    }
    if (lvl) { /* live voice trace while the microphone is open */
      cx.strokeStyle = `rgb(${acc})`; cx.lineWidth = 2; cx.beginPath();
      for (let i = 0; i < data.length; i += 4) { const x = i / data.length * W, y = H * .5 + (data[i] - 128) / 128 * (60 + lvl * 600); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }
      cx.globalAlpha = .55; cx.stroke(); cx.globalAlpha = 1;
    }
    if (!RM || true) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.render();
})();
