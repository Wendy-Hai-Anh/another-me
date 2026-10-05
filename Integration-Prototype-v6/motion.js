"use strict";

// One renderer owns the atmosphere; it never requests devices or reads participant text.
// Geometry is adapted from the Neon Tunnel study: receding rings, longitudinal edges, light
// streaks and a dark core. Early depths are round, faint and slow (human); deeper stages
// become hexagonal, denser and more enclosed (synthetic). At rest the tunnel stays quiet so
// text is readable; stage passages and the entrance "bloom" into saturated, shifting colour.
const ROOM_PROFILES = [
  // ring: line opacity, hex: polygon-ness, streak: particle opacity, edge: longitudinal lines,
  // drift: idle travel speed, core: centre radius, spin: ring rotation per depth unit,
  // dark: 0 = the cream human surface (intro, Stages 1-2), 1 = the deep purple model space
  // core: reach of the hole as a fraction of the half-diagonal (it grows until it consumes the screen),
  // glow: how bright a passage may bloom (dimmer the deeper you go)
  { ring: .16, hex: 0, streak: 0, edge: 0, drift: .08, core: .1, spin: 0, dark: 0, glow: 1 },          // opening
  { ring: .13, hex: 0, streak: 0, edge: 0, drift: .12, core: .1, spin: 0, dark: 0, glow: 1 },          // 1 I see you
  { ring: .17, hex: .15, streak: .12, edge: .05, drift: .16, core: .12, spin: .01, dark: .15, glow: 1 }, // 2 I listen
  { ring: .22, hex: .45, streak: .28, edge: .18, drift: .2, core: .24, spin: .025, dark: 1, glow: .95 },  // 3 the hole appears
  { ring: .27, hex: .7, streak: .4, edge: .3, drift: .24, core: .46, spin: .04, dark: 1, glow: .8 },     // 4 it widens
  { ring: .33, hex: .9, streak: .5, edge: .42, drift: .2, core: .86, spin: .05, dark: 1, glow: .62 },    // 5 almost everything
  { ring: .4, hex: 1, streak: .6, edge: .55, drift: .26, core: 1.45, spin: .06, dark: 1, glow: .46 },    // 6 consumed
  { ring: .28, hex: .8, streak: .1, edge: .3, drift: .05, core: .7, spin: .02, dark: 1, glow: .7 }       // threshold (checkpoint)
];
const ROOM_KEYS = ["ring", "hex", "streak", "edge", "drift", "core", "spin", "dark", "glow"];
// One analogous arc of the colour wheel: rose-pink -> violet -> indigo -> cyan-blue. Green is kept out of
// the atmosphere (it is only the "supplied by you" status colour), so the passage never clashes.
const ARC = [[227, 61, 150], [150, 92, 214], [84, 96, 206], [88, 196, 222]];
// On the light stages the same arc is dusty and deeper so it reads on cream without glare.
const ARC_LIGHT = [[53, 37, 90], [178, 84, 140], [126, 92, 190], [86, 100, 176]];
const INK = [53, 37, 90];
// Background (centre, middle, edge) per stage: the hue walks cream -> blush -> lilac, then turns dark blue
// at Stage 3 and sinks toward indigo-night. Matches the per-stage --bg values in v6.css.
const ROOM_BG = [
  [[255, 252, 244], [247, 244, 232], [214, 196, 200]], // opening, warm cream
  [[253, 248, 243], [243, 234, 227], [214, 196, 212]], // 1 blush cream
  [[243, 242, 252], [219, 216, 239], [204, 202, 234]], // 2 light periwinkle-lilac
  [[46, 42, 108], [27, 32, 70], [10, 11, 36]],        // 3 dark blue with a violet heart
  [[36, 42, 104], [26, 28, 74], [9, 10, 32]],         // 4 indigo
  [[50, 36, 108], [31, 21, 72], [11, 7, 30]],         // 5 deep violet
  [[46, 16, 60], [29, 11, 41], [10, 3, 16]],          // 6 swallowed: very dark purple-pink
  [[50, 36, 108], [31, 21, 72], [11, 7, 30]]          // threshold
];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;

class DigitalRoom {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.stage = 0;
    this.threshold = false;
    this.look = { ...ROOM_PROFILES[0] };
    this.bg = ROOM_BG[0].map(c => [...c]);
    this.position = 0;
    this.paused = false;
    this.disposed = false;
    this.motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.motionPreference.matches;
    this.onPreference = event => this.reduce(event.matches);
    this.motionPreference.addEventListener("change", this.onPreference);
    this.eventStrength = 0;
    this.pathVisible = false;
    this.pathOpacity = 0;
    this.doubleVisible = false;
    this.doubleAmount = 0;
    this.journey = null;
    this.burst = 0;
    this.nodes = 0;
    this.frameId = 0;
    this.last = 0;
    this.audio = null;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.particles = Array.from({ length: 180 }, (_, i) => ({
      angle: (i * 2.399963) % (Math.PI * 2), radius: .3 + ((i * 7919) % 100) / 100 * 1.35, z: (i * 37.7) % 70, bright: i % 9 === 0
    }));
    this.abort = new AbortController();
    const signal = this.abort.signal;
    addEventListener("resize", () => this.resize(), { signal });
    addEventListener("pointermove", event => {
      this.pointer.tx = event.clientX / (innerWidth || 1) - .5;
      this.pointer.ty = event.clientY / (innerHeight || 1) - .5;
    }, { signal, passive: true });
    document.addEventListener("visibilitychange", () => document.hidden ? this.pause() : this.resume(), { signal });
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
    this.paint(performance.now());
  }
  targetBg() { return ROOM_BG[this.threshold ? 7 : Math.max(0, Math.min(6, this.stage))]; }
  target() { return ROOM_PROFILES[this.threshold ? 7 : Math.max(0, Math.min(6, this.stage))]; }
  reduce(value) {
    this.reduced = value;
    document.body.classList.toggle("reduced-motion", value);
    document.getElementById("motionToggle")?.setAttribute("aria-pressed", String(value));
    if (value) {
      cancelAnimationFrame(this.frameId); this.frameId = 0; this.journey = null;
      this.look = { ...this.target() }; this.bg = this.targetBg().map(c => [...c]);
      this.pathOpacity = +this.pathVisible; this.doubleAmount = +this.doubleVisible;
    } else this.schedule();
    this.paint(performance.now());
  }
  setScene(stage, doubleVisible = false, threshold = false) {
    this.stage = stage; this.doubleVisible = doubleVisible; this.threshold = threshold;
    if (this.reduced) { this.look = { ...this.target() }; this.bg = this.targetBg().map(c => [...c]); this.doubleAmount = +doubleVisible; }
    this.paint(performance.now()); this.schedule();
  }
  react(event) {
    this.eventStrength = 1;
    if (event === "answer") this.nodes = Math.min(this.nodes + 1, 6);
    if (event === "revise") this.nodes = Math.max(1, this.nodes - 1);
    if (event === "reveal") this.pathVisible = true;
    if (event === "reject") this.pathVisible = false;
    if (this.reduced) this.pathOpacity = +this.pathVisible;
    this.paint(performance.now()); this.schedule();
  }
  // Forward travel moves deeper into the tunnel; Back retreats. Duration matches the UI passage.
  // { burst, duration } turns a passage into a colour bloom that peaks in its middle.
  // complexity (0-1) layers the passage: 0 is a plain tunnel rush; each step adds colour flow, the
  // hexagon, a spiral roll, a counter-rotating inner tunnel, shockwaves and colour split; at 1 the rush
  // stops dead for a held breath and a single heartbeat pulse before the next stage appears.
  travel(direction = 1, strength = 1, { burst = false, duration = .9, complexity = 0 } = {}) {
    if (this.reduced || this.disposed) return;
    const c = Math.max(0, Math.min(1, complexity));
    this.journey = { direction: direction < 0 ? -1 : 1, progress: 0, strength: Math.max(.3, Math.min(2, strength)), burst, duration: Math.max(.3, duration), complexity: c, hold: c > .85 ? .22 : 0 };
    this.schedule();
  }
  cancelTravel() { this.journey = null; this.burst = 0; this.passage = null; this.paint(performance.now()); }
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
  // Raw time-domain samples for the recorder's waveform; null when unavailable.
  waveform() {
    if (!this.audio) return null;
    this.audio.analyser.getByteTimeDomainData(this.audio.data);
    return this.audio.data;
  }
  volume() {
    if (!this.audio || this.reduced) return 0;
    const data = this.waveform();
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
      const goal = this.target(), ease = 1 - Math.exp(-dt * 1.6);
      for (const key of ROOM_KEYS) this.look[key] += (goal[key] - this.look[key]) * ease;
      const bgGoal = this.targetBg(), bgEase = 1 - Math.exp(-dt * 2.2);
      this.bg.forEach((stop, i) => stop.forEach((v, k) => { stop[k] = v + (bgGoal[i][k] - v) * bgEase; }));
      this.eventStrength = Math.max(0, this.eventStrength - dt * .6);
      this.pathOpacity += (+this.pathVisible - this.pathOpacity) * (1 - Math.exp(-dt * 4));
      this.doubleAmount += (+this.doubleVisible - this.doubleAmount) * (1 - Math.exp(-dt * 2.5));
      let speed = this.look.drift;
      let burst = 0;
      if (this.journey) {
        const j = this.journey, c = j.complexity;
        j.progress = Math.min(1, j.progress + dt / j.duration);
        // "run" covers the rush; the deepest passage reserves its last part for a held breath.
        const run = Math.min(1, j.progress / (1 - j.hold)), wave = Math.sin(run * Math.PI);
        const envelope = wave ** 2;
        speed += j.direction * envelope * 9 * j.strength * (.7 + .8 * c);
        if (j.burst) burst = Math.min(1, wave * 1.35) * (.35 + .65 * c);
        // From Stage 4 on the view starts to roll, harder each stage.
        this.roll = (this.roll || 0) + dt * j.direction * envelope * c * c * 2.6;
        this.passage = { c, p: j.progress, fx: wave, hold: j.hold, run, dir: j.direction };
        if (j.progress === 1) { this.journey = null; this.passage = null; }
      } else this.roll = (this.roll || 0) * Math.exp(-dt * 1.6);
      this.burst += (burst - this.burst) * (1 - Math.exp(-dt * 9));
      this.speed = speed;
      this.position += speed * dt;
      this.pointer.x += (this.pointer.tx - this.pointer.x) * .05;
      this.pointer.y += (this.pointer.ty - this.pointer.y) * .05;
      this.paint(time);
    }
    this.schedule();
  }
  paint(now) {
    const ctx = this.context;
    if (!ctx) return;
    const w = this.width, h = this.height, look = this.look;
    const time = this.reduced ? 0 : now / 1000;
    const travelling = !!this.journey && !this.reduced;
    // Short trails only while travelling, so stillness stays crisp.
    ctx.globalCompositeOperation = "source-over";
    const burst = this.reduced ? 0 : this.burst;
    const dark = Math.max(0, Math.min(1, look.dark));
    // Cream on the human surface, deep purple in the model space; edges always fade outward.
    const [centre, mid, edge] = this.bg.map(c => c.map(Math.round));
    if (travelling) { ctx.fillStyle = rgba(mid, .42 - burst * .2); ctx.fillRect(0, 0, w, h); }
    else {
      const bg = ctx.createRadialGradient(w * .5, h * .48, 0, w * .5, h * .48, Math.max(w, h) * .75);
      bg.addColorStop(0, rgba(centre, 1)); bg.addColorStop(.55, rgba(mid, 1)); bg.addColorStop(1, rgba(edge, 1));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    }
    // At rest: quiet mood-board lines (dark type joins them on cream). Blooming: colours flow
    // continuously through green, pink, cyan and violet along the tunnel.
    const palette = dark > .5 ? ARC : ARC_LIGHT;
    const lightBoost = 1 + (1 - dark) * .6;
    const colour = (i, alpha, d = 0) => {
      if (burst < .02) return rgba(palette[i % palette.length], alpha * lightBoost);
      // The first passages stay in one colour; flowing colour arrives with complexity.
      if (cx_ < .15) return rgba(palette[2], alpha * lightBoost);
      // Glide back and forth along the arc (never wrapping across the wheel) for a smooth gradient.
      const span = palette.length - 1, wave = (i * .23 + time * .7 + d * .035) % (span * 2);
      const t = wave > span ? span * 2 - wave : wave, k = Math.min(span - 1, Math.floor(t));
      const c = mixRgb(palette[k], palette[k + 1], t - k);
      if (dark <= .5) return rgba(c, alpha * lightBoost);
      const lit = mixRgb(c, [255, 255, 255], burst * .18 * look.glow).map(v => v * (.55 + .45 * look.glow));
      return rgba(lit, alpha);
    };
    const glowMode = dark > .5 ? "lighter" : "source-over";
    const focal = Math.max(w, h * .75) * .55;
    const px = this.pointer.x * .5, py = this.pointer.y * .35;
    const cx = w * .5, cy = h * .48;
    const roll = this.reduced ? 0 : this.roll || 0, cr = Math.cos(roll), sr = Math.sin(roll);
    const project = (x, y, d) => { const s = focal / d, X = (x + px) * s, Y = (y + py) * s * .82; return [cx + X * cr - Y * sr, cy + X * sr + Y * cr]; };
    const pass = this.reduced ? null : this.passage, cx_ = pass ? pass.c : 0, fx = pass ? pass.fx : 0;
    const layer = (from, to = 1) => Math.max(0, Math.min(1, (cx_ - from) / (to - from)));
    const depth = 64, spacing = 3.2, radius = 1.7;
    const pulse = this.volume() * .18 + this.eventStrength * .06;
    // Radius of the morphing ring at angle a: a circle that sharpens into a hexagon with depth.
    const shape = a => {
      const sector = Math.PI / 3, local = ((a % sector) + sector) % sector - sector / 2;
      const hexR = Math.cos(sector / 2) / Math.cos(local);
      return 1 + (hexR - 1) * Math.max(look.hex, burst * .7 * layer(.25, .5));
    };
    const ringCount = Math.ceil(depth / spacing);
    const twist = fx * layer(.5) * .1 * (pass ? pass.dir : 1);
    const drawTunnel = (offset, alphaScale, scale = 1, spinSign = 1, tint = null) => {
      for (let i = 0; i < ringCount; i++) {
        const d = ((i * spacing - this.position) % depth + depth) % depth + .01;
        if (d < .6) continue;
        const fade = Math.pow(1 - d / depth, 1.5) * Math.min(1, (d - .6) / 1.8);
        const alpha = Math.min(1, fade * (look.ring + burst * .95 * look.glow) * alphaScale * (1 + this.eventStrength * .5));
        if (alpha < .004) continue;
        const rot = spinSign * (look.spin * (this.position + d) + twist * d);
        const r = radius * scale * (1 + (d < 10 ? pulse : 0));
        ctx.beginPath();
        for (let k = 0; k <= 48; k++) {
          const a = rot + k / 48 * Math.PI * 2, rr = r * shape(a - rot);
          const [x, y] = project(Math.cos(a) * rr + offset, Math.sin(a) * rr, d);
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.lineWidth = Math.min(2.2, 1.4 / Math.sqrt(d / 3)) * (1 + burst * .8);
        if (burst > .05 && cx_ > .3) {
          // A soft, wide glow pass under the crisp line while blooming.
          ctx.save(); ctx.globalCompositeOperation = glowMode;
          ctx.strokeStyle = colour(i, alpha * .22, d); ctx.lineWidth *= 5; ctx.stroke(); ctx.restore();
        }
        ctx.strokeStyle = tint ? rgba(tint, alpha) : colour(i, alpha, d);
        ctx.stroke();
        // Longitudinal edges connect hexagon vertices to the next ring as the space becomes synthetic.
        if (!tint && look.edge + burst * layer(.25) > .01) {
          const d2 = d + spacing, rot2 = spinSign * (look.spin * (this.position + d2) + twist * d2);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = rot + k / 6 * Math.PI * 2, a2 = rot2 + k / 6 * Math.PI * 2;
            const [x1, y1] = project(Math.cos(a) * r + offset, Math.sin(a) * r, d);
            const [x2, y2] = project(Math.cos(a2) * radius * scale + offset, Math.sin(a2) * radius * scale, d2);
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          }
          ctx.strokeStyle = colour(i + 1, alpha * Math.min(1, look.edge + burst * .6 * layer(.25)), d);
          ctx.lineWidth = .8; ctx.stroke();
        }
      }
    };
    // The hole: a deep tint of this stage's own colour (never flat black) with a long, smooth falloff.
    // It sits beneath the rings, so the tunnel stays visible even when the hole fills the screen.
    const reach = Math.hypot(w, h) / 2 * look.core * (1 - burst * .5);
    if (reach > 2) {
      const coreRgb = dark > .5 ? mixRgb(edge, [0, 0, 0], .35) : [255, 253, 246];
      const depthA = dark > .5 ? .86 : .7, hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
      [[0, 1], [.22, .94], [.42, .76], [.6, .5], [.78, .22], [.9, .07], [1, 0]].forEach(([at, k]) => hole.addColorStop(at, rgba(coreRgb, depthA * k)));
      ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.fill();
    }
    drawTunnel(0, 1);
    if (pass && dark > .5) {
      // Stage 5+: a smaller tunnel turning the other way inside the first.
      if (layer(.45) > 0) drawTunnel(0, .7 * fx * layer(.45), .56, -1);
      // Stage 5+: the tunnel splits into rose and cyan ghosts at the peak of the rush.
      const split = layer(.6);
      if (split > 0) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        drawTunnel(-.16 * fx * split, .32 * fx * split, 1, 1, ARC[0]);
        drawTunnel(.16 * fx * split, .32 * fx * split, 1, 1, ARC[3]);
        ctx.restore();
      }
    }
    // The digital double appears as a second, offset tunnel that converges into presence.
    if (this.doubleAmount > .01 && this.stage >= 4) {
      const offset = (this.stage >= 5 ? .14 : .42) * (1.15 - this.doubleAmount * .5);
      drawTunnel(offset, .55 * this.doubleAmount);
    }
    // Data traces: sparse streaks travelling toward the viewer, longer while moving.
    if (look.streak + burst > .01) {
      const length = .4 + Math.min(5, Math.abs(this.speed || 0)) * (.9 + burst * .6);
      if (burst > .05) ctx.globalCompositeOperation = glowMode;
      ctx.lineCap = "round";
      const count = pass ? Math.floor(this.particles.length * (.15 + .85 * cx_)) : this.particles.length;
      for (const p of this.particles.slice(0, count)) {
        const d = ((p.z - this.position * 1.4) % 70 + 70) % 70 + .01;
        if (d < .5) continue;
        const a = p.angle + this.position * .02;
        const x = Math.cos(a) * p.radius, y = Math.sin(a) * p.radius;
        const [ax, ay] = project(x, y, d), [bx, by] = project(x, y, Math.min(70, d + length));
        const alpha = Math.pow(1 - d / 70, 1.3) * Math.min(1, (d - .5) / 2) * Math.min(1, look.streak + burst) * (p.bright ? .9 : .5);
        ctx.strokeStyle = p.bright ? rgba(dark > .5 ? [247, 244, 232] : INK, alpha) : colour(Math.round(p.angle * 3), alpha, d);
        ctx.lineWidth = (p.bright ? 1.4 : .9) * (1 + burst * .6);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    // Stage 3 interpretation: a few nodes that gather (answers) or loosen (corrections).
    if (this.stage === 3 && this.nodes) {
      for (let i = 0; i < this.nodes; i++) {
        const a = i / this.nodes * Math.PI * 2 + time * .05, [x, y] = project(Math.cos(a) * .9, Math.sin(a) * .9, 14);
        ctx.fillStyle = rgba(ARC[3], .45); ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    // Stage 6: once revealed, one path is traced from the viewer into the centre.
    if (this.stage === 6 && this.pathOpacity > .01) {
      ctx.beginPath();
      for (let d = 2; d < 40; d += 2) {
        const a = Math.PI * .75 + d * .06, [x, y] = project(Math.cos(a) * radius * .96, Math.sin(a) * radius * .96, d);
        d === 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(ARC[0], .55 * this.pathOpacity); ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (pass && layer(.55) > 0) {
      const reachMax = Math.hypot(w, h) / 2 * 1.15, k = layer(.55);
      const waves = [[.22, .26], [.42, .26], [.62, .26]];
      if (pass.hold) waves.push([1 - pass.hold + .02, pass.hold * .95]); // the heartbeat, slow and single
      ctx.save(); ctx.globalCompositeOperation = dark > .5 ? "lighter" : "source-over";
      waves.forEach(([start, length], n) => {
        const age = (pass.p - start) / length;
        if (age <= 0 || age >= 1) return;
        const heart = n === 3, grow = 1 - (1 - age) ** 3;
        ctx.beginPath();
        for (let q = 0; q <= 60; q++) {
          const a = q / 60 * Math.PI * 2 + roll, rr = grow * reachMax * shape(a);
          q ? ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .82) : ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .82);
        }
        ctx.strokeStyle = rgba(heart ? [255, 236, 244] : ARC[n % ARC.length], (1 - age) ** 1.5 * (heart ? .55 : .42) * k);
        ctx.lineWidth = (heart ? 3 : 1.5) + 6 * (1 - age); ctx.stroke();
      });
      ctx.restore();
      // The breath: the rush stops, the space dims and waits, then the stage resolves.
      if (pass.hold && pass.p > 1 - pass.hold) {
        const still = Math.sin((pass.p - (1 - pass.hold)) / pass.hold * Math.PI);
        ctx.fillStyle = rgba(mixRgb(edge, [0, 0, 0], .3), .45 * still); ctx.fillRect(0, 0, w, h);
        const beat = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * .18);
        beat.addColorStop(0, rgba([255, 214, 232], .35 * still)); beat.addColorStop(1, rgba([255, 214, 232], 0));
        ctx.fillStyle = beat; ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * .18, 0, Math.PI * 2); ctx.fill();
      }
    }
    // While blooming, the vanishing point opens into light: the portal the participant falls through.
    if (burst > .02) {
      const bloom = Math.min(w, h) * (.12 + burst * .22) * (.6 + .4 * look.glow) * (.5 + .5 * cx_), g = (dark > .5 ? look.glow : 1) * (cx_ < .15 ? .35 : 1);
      const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, bloom);
      // Warm light at the core against the cool arc: cream is the complement of indigo.
      light.addColorStop(0, rgba([255, 250, 238], .8 * burst * g * g));
      light.addColorStop(.3, rgba(dark > .5 ? ARC[0] : [240, 196, 200], .4 * burst * g));
      light.addColorStop(.65, rgba(dark > .5 ? ARC[2] : [196, 186, 232], .22 * burst * g));
      light.addColorStop(1, rgba(mid, 0));
      ctx.save(); ctx.globalCompositeOperation = glowMode; ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(cx, cy, bloom, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  pause() { this.paused = true; cancelAnimationFrame(this.frameId); this.frameId = 0; }
  resume() { this.paused = false; this.last = performance.now(); this.schedule(); }
  reset() {
    this.journey = null; this.passage = null; this.roll = 0; this.burst = 0; this.nodes = 0; this.pathVisible = false; this.pathOpacity = 0;
    this.doubleVisible = false; this.doubleAmount = 0; this.eventStrength = 0; this.threshold = false;
    this.setRecordingStream(null); this.setScene(0); this.look = { ...ROOM_PROFILES[0] }; this.bg = ROOM_BG[0].map(c => [...c]);
    this.paint(performance.now());
  }
  dispose() {
    this.disposed = true; this.journey = null; this.pause(); this.abort.abort();
    this.motionPreference.removeEventListener("change", this.onPreference); this.setRecordingStream(null);
  }
}
window.DigitalRoom = DigitalRoom;
