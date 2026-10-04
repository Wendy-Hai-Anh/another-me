"use strict";

// One renderer owns the atmosphere; it never requests devices or reads participant text.
class DigitalRoom {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.stage = 0;
    this.depth = this.targetDepth = 0;
    this.tunnel = false;
    this.paused = false;
    this.disposed = false;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    this.onPreference = event => this.reduce(event.matches);
    this.motionPreference.addEventListener("change", this.onPreference);
    this.eventStrength = 0;
    this.pathVisible = false;
    this.pathOpacity = 0;
    this.doubleVisible = false;
    this.doubleAmount = 0;
    this.sceneBlend = 1;
    this.previousScene = null;
    this.journey = null;
    this.nodes = 0;
    this.frameId = 0;
    this.last = 0;
    this.audio = null;
    this.abort = new AbortController();
    addEventListener("resize", () => this.resize(), { signal: this.abort.signal });
    document.addEventListener("visibilitychange", () => document.hidden ? this.pause() : this.resume(), { signal: this.abort.signal });
    this.resize();
    this.schedule();
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2400000 / (this.width * this.height)));
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.previousScene = null; this.sceneBlend = 1;
    this.paint(performance.now());
  }
  reduce(value) {
    this.reduced = value;
    document.body.classList.toggle("reduced-motion", value);
    document.getElementById("motionToggle")?.setAttribute("aria-pressed", String(value));
    if (value) { cancelAnimationFrame(this.frameId); this.frameId = 0; this.journey = null; this.sceneBlend = 1; this.previousScene = null; this.pathOpacity = +this.pathVisible; this.doubleAmount = +this.doubleVisible; }
    else this.schedule();
    this.paint(performance.now());
  }
  setScene(stage, doubleVisible = false) {
    if (stage !== this.stage && !this.reduced && this.context) {
      const snapshot = document.createElement("canvas");
      snapshot.width = this.canvas.width; snapshot.height = this.canvas.height;
      snapshot.getContext("2d").drawImage(this.canvas, 0, 0);
      this.previousScene = snapshot; this.sceneBlend = 0;
    }
    this.stage = stage; this.doubleVisible = doubleVisible;
    if (this.reduced) this.doubleAmount = +doubleVisible;
    this.paint(performance.now()); this.schedule();
  }
  react(event) {
    this.eventStrength = 1;
    if (event === "answer") this.nodes = Math.min(this.nodes + 1, 6);
    if (event === "revise") this.nodes = Math.max(1, this.nodes - 1);
    if (event === "reveal") this.pathVisible = true;
    if (event === "reject") this.pathVisible = false;
    if (this.reduced) this.pathOpacity = +this.pathVisible;
    this.paint(performance.now());
  }
  travel(direction = 1) {
    if (this.reduced || this.disposed) return;
    this.journey = { direction: direction < 0 ? -1 : 1, progress: 0 };
    this.schedule();
  }
  cancelTravel() { this.journey = null; this.paint(performance.now()); }
  enter(target, done) {
    this.leaveTunnel();
    this.tunnel = true;
    this.depth = this.targetDepth = 0;
    this.entryDone = done;
    this.inputAbort = new AbortController();
    const signal = this.inputAbort.signal;
    const adjust = amount => {
      if (this.reduced) return;
      this.targetDepth = Math.max(0, Math.min(1, this.targetDepth + Math.max(-.11, Math.min(.11, amount))));
      this.schedule();
    };
    target.addEventListener("wheel", event => {
      if (event.ctrlKey || event.metaKey || event.target.closest("button,input,textarea,select,dialog")) return;
      event.preventDefault();
      adjust(event.deltaY * (event.deltaMode === 1 ? 15 : event.deltaMode === 2 ? 400 : 1) / 2000);
    }, { passive: false, signal });
    let touchY = null;
    target.addEventListener("touchstart", event => { if (event.touches.length === 1 && !event.target.closest("button,input,textarea,select,dialog")) touchY = event.touches[0].clientY; }, { passive: true, signal });
    target.addEventListener("touchmove", event => {
      if (touchY === null || event.touches.length !== 1) return;
      event.preventDefault();
      const y = event.touches[0].clientY;
      adjust((touchY - y) / 950); touchY = y;
    }, { passive: false, signal });
    target.addEventListener("touchend", () => { touchY = null; }, { signal });
    document.addEventListener("keydown", event => {
      if (event.target.closest("input,textarea,select,button,dialog") || event.ctrlKey || event.metaKey) return;
      const step = ({ ArrowDown: .09, PageDown: .18, ArrowUp: -.09, PageUp: -.18 })[event.key];
      if (step !== undefined) { event.preventDefault(); adjust(step); }
    }, { signal });
    this.paint(performance.now()); this.schedule();
  }
  leaveTunnel() {
    if (this.tunnel && !this.reduced && this.context) {
      const snapshot = document.createElement("canvas");
      snapshot.width = this.canvas.width; snapshot.height = this.canvas.height;
      snapshot.getContext("2d").drawImage(this.canvas, 0, 0);
      this.previousScene = snapshot; this.sceneBlend = 0;
    }
    this.inputAbort?.abort(); this.inputAbort = null; this.tunnel = false; this.entryDone = null;
  }
  async setRecordingStream(stream) {
    if (this.audio?.stream === stream) return;
    this.audio?.source.disconnect();
    this.audio?.context.close().catch(() => {});
    this.audio = null;
    if (!stream || this.disposed) return;
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = context.createAnalyser(); analyser.fftSize = 256;
      const source = context.createMediaStreamSource(stream); source.connect(analyser);
      this.audio = { context, source, analyser, data: new Uint8Array(256), stream };
    } catch { /* Recording still works when audio visualization is unavailable. */ }
  }
  volume() {
    if (!this.audio || this.reduced) return 0;
    const { analyser, data } = this.audio;
    analyser.getByteTimeDomainData(data);
    return Math.min(1, Math.sqrt(data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / data.length) * 4);
  }
  schedule() {
    if (!this.frameId && !this.paused && !this.reduced && !this.disposed) this.frameId = requestAnimationFrame(time => this.frame(time));
  }
  frame(time) {
    this.frameId = 0;
    if (this.paused || this.disposed) return;
    if (time - this.last >= 32) {
      const dt = Math.min((time - this.last) / 1000 || .032, .07); this.last = time;
      this.depth += (this.targetDepth - this.depth) * (1 - Math.exp(-dt * 7));
      this.eventStrength = Math.max(0, this.eventStrength - dt * .42);
      this.sceneBlend = Math.min(1, this.sceneBlend + dt / .9);
      if (this.sceneBlend === 1) this.previousScene = null;
      this.pathOpacity += (+this.pathVisible - this.pathOpacity) * (1 - Math.exp(-dt * 4));
      this.doubleAmount += (+this.doubleVisible - this.doubleAmount) * (1 - Math.exp(-dt * 4));
      if (this.journey) {
        this.journey.progress = Math.min(1, this.journey.progress + dt / .9);
        if (this.journey.progress === 1) this.journey = null;
      }
      this.paint(time);
      if (this.tunnel && this.targetDepth >= 1 && this.depth > .996) {
        const done = this.entryDone; this.leaveTunnel(); done?.();
      }
    }
    this.schedule();
  }
  paint(now) {
    const ctx = this.context;
    if (!ctx) return;
    const w = this.width, h = this.height, cx = w * .51, cy = h * .47;
    const time = this.reduced ? 0 : now / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#110e1b"; ctx.fillRect(0, 0, w, h);
    const colors = ["#aa83ed", "#8ce7ed", "#f4a3c5"];
    if (this.tunnel) {
      const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * .7);
      glow.addColorStop(0, "#05040b"); glow.addColorStop(.35, "#211333"); glow.addColorStop(1, "#110e1b");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      for (let ring = 0; ring < 21; ring++) {
        const z = (ring / 21 + this.depth * 2.6) % 1;
        const size = 12 + Math.pow(z, 2.9) * Math.max(w, h) * .94;
        ctx.globalAlpha = .12 + z * .42;
        ctx.strokeStyle = colors[ring % 3]; ctx.lineWidth = ring % 3 === 0 ? 2 : 1;
        const step = Math.max(3, Math.min(12, size / 16));
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const angle = i / 64 * Math.PI * 2;
          const x = Math.round((cx + Math.cos(angle) * size) / step) * step;
          const y = Math.round((cy + Math.sin(angle) * size * .69) / step) * step;
          if (!i) ctx.moveTo(x, y); else { const a = (i - 1) / 64 * Math.PI * 2; ctx.lineTo(x, Math.round((cy + Math.sin(a) * size * .69) / step) * step); ctx.lineTo(x, y); }
        }
        ctx.closePath(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const meter = document.getElementById("tunnelDepth");
      if (meter) meter.style.width = `${this.depth * 100}%`;
    } else {
      const glow = ctx.createRadialGradient(w * .77, h * .4, 0, w * .77, h * .4, w * .7);
      glow.addColorStop(0, this.stage >= 4 ? "#27182d" : "#172132"); glow.addColorStop(1, "#110e1b");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = .18; ctx.strokeStyle = colors[this.stage === 1 ? 1 : Math.max(0, this.stage - 1) % 3]; ctx.lineWidth = 1;
      const drift = this.reduced ? 0 : Math.sin(time * .22) * 6;
      for (let i = 0; i < 4; i++) {
        const size = Math.min(w, h) * (.28 + i * .1) + drift + this.eventStrength * 24;
        const x = w * .83 - size / 2, y = cy - size / 2;
        ctx.strokeRect(x, y, size, size);
        if (this.stage >= 4 && this.doubleAmount > .01) {
          ctx.globalAlpha = .18 * this.doubleAmount;
          const separation = (this.stage === 5 ? 42 : 18) + i * 7;
          ctx.strokeRect(x - separation * this.doubleAmount, y + 10 * this.doubleAmount, size, size);
          ctx.globalAlpha = .18;
        }
      }
      if (this.stage === 3) {
        for (let i = 0; i < 7 + this.nodes; i++) {
          const x = w * (.64 + (i % 4) * .09), y = h * (.23 + Math.floor(i / 4) * .16);
          ctx.fillStyle = colors[1]; ctx.fillRect(x, y, 4, 4);
          if (i) { ctx.beginPath(); ctx.moveTo(w * .72, h * .5); ctx.lineTo(x, y); ctx.stroke(); }
        }
      }
      if (this.stage === 6 && this.pathOpacity > .01) {
        ctx.globalAlpha = .42 * this.pathOpacity; ctx.strokeStyle = colors[2]; ctx.beginPath();
        ctx.moveTo(w * .62, h * .8); ctx.lineTo(w * .7, h * .6); ctx.lineTo(w * .89, h * .58); ctx.lineTo(w * .87, h * .21); ctx.stroke();
      }
      const volume = this.volume();
      if (volume) {
        ctx.globalAlpha = .38; ctx.strokeStyle = colors[1]; ctx.beginPath();
        for (let x = 0; x < w; x += 8) { const y = h * .83 + Math.sin(x * .02 + time * 3) * volume * 45; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const density = w < 600 ? 22 : 48;
    for (let i = 0; i < density; i++) {
      const x = ((i * 167.31 + 30) % w), y = ((i * 83.43 + 41) % h);
      ctx.fillStyle = i % 3 ? "#9edee52c" : "#d4b4ff35"; ctx.fillRect(x, y, 2, 2);
    }
    if (this.previousScene && this.sceneBlend < 1) {
      ctx.globalAlpha = 1 - this.sceneBlend;
      ctx.drawImage(this.previousScene, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    // Travel is a short, input-free passage through the same room, not another entrance.
    if (this.journey && !this.tunnel) {
      const { direction, progress } = this.journey;
      const ease = progress * progress * (3 - 2 * progress);
      const envelope = Math.sin(progress * Math.PI) ** 2;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const z = (i / 9 + direction * ease * .38 + 1) % 1;
        const size = Math.max(w, h) * (.12 + z * z * .9);
        const centerY = h * .5 - direction * (ease - .5) * h * .45;
        ctx.globalAlpha = envelope * (.08 + z * .18);
        ctx.strokeStyle = colors[i % colors.length];
        ctx.strokeRect(w * .52 - size, centerY - size * .58, size * 2, size * 1.16);
      }
      ctx.globalAlpha = 1;
    }
  }
  pause() { this.paused = true; cancelAnimationFrame(this.frameId); this.frameId = 0; }
  resume() { this.paused = false; this.last = performance.now(); this.schedule(); }
  reset() { this.leaveTunnel(); this.journey = null; this.nodes = 0; this.pathVisible = false; this.pathOpacity = 0; this.doubleVisible = false; this.doubleAmount = 0; this.depth = this.targetDepth = 0; this.eventStrength = 0; this.setRecordingStream(null); this.setScene(0); this.previousScene = null; this.sceneBlend = 1; this.paint(performance.now()); }
  dispose() { this.disposed = true; this.journey = null; this.pause(); this.leaveTunnel(); this.abort.abort(); this.motionPreference.removeEventListener("change", this.onPreference); this.setRecordingStream(null); }
}
window.DigitalRoom = DigitalRoom;
