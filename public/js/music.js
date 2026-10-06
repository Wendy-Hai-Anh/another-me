"use strict";

// Background music: the four supplied tracks, played alternately (breathing, piano, breathing, piano)
// with a slow crossfade. It starts only after the participant interacts, stays quiet, ducks under
// recordings and the double's voice, never switches itself back on, and fails silently.
(() => {
  const TRACKS = ["audio/digital-breathing.mp3", "audio/sparse-piano-motif.mp3", "audio/digital-breathing-2.mp3", "audio/sparse-piano-motif-2.mp3"];
  const VOLUME = 0.14, CROSSFADE_MS = 5000, STOP_FADE_MS = 1200, TICK_MS = 100, KEY = "another-me-music";
  // How far each reason lowers the music: silent while recording, low under media playback (speech) or a standard voice (voice).
  const DUCK = { recording: 0, speech: 0.28, voice: 0.28 };
  const toggle = document.getElementById("musicToggle");
  const players = [], ducks = new Set(), speaking = new Set();
  let wanted = read() !== "off", unlocked = false, active = false, broken = false;
  let current = null, index = 0, failures = 0, level = 1, timer = 0;

  function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
  function write(value) { try { localStorage.setItem(KEY, value); } catch { /* the choice still holds for this page */ } }
  const target = () => { let factor = 1; for (const reason of ducks) factor = Math.min(factor, DUCK[reason] ?? 1); return factor; };

  function drop(player) {
    const at = players.indexOf(player);
    if (at >= 0) players.splice(at, 1);
    player.el.pause(); player.el.removeAttribute("src"); player.el.load();
    if (current === player) current = null;
  }
  function start(i) {
    const el = new Audio(TRACKS[i % TRACKS.length]);
    el.preload = "auto"; el.volume = 0;
    const player = { el, fade: 0, rate: TICK_MS / CROSSFADE_MS, failed: false };
    const fail = () => {
      if (player.failed) return;
      player.failed = true; failures += 1; drop(player);
      // A missing or broken file is skipped; if nothing will load, the music simply stays silent.
      if (failures >= TRACKS.length) { broken = true; paint(); return; }
      if (shouldPlay() && !current) { index += 1; current = start(index); }
    };
    el.addEventListener("error", fail, { once: true });
    el.addEventListener("playing", () => { failures = 0; }, { once: true });
    el.addEventListener("ended", () => drop(player), { once: true });
    el.play().catch(error => { if (error?.name === "NotAllowedError") { unlocked = false; drop(player); } else fail(); });
    players.push(player);
    ensureTicker();
    return player;
  }
  function shouldPlay() { return wanted && unlocked && active && !broken; }
  function tick() {
    level += (target() - level) * 0.3;
    for (const player of [...players]) {
      player.fade = Math.max(0, Math.min(1, player.fade + player.rate));
      player.el.volume = Math.max(0, Math.min(1, VOLUME * player.fade * level));
      if (player.rate < 0 && player.fade <= 0) drop(player);
    }
    for (const el of speaking) if (el.paused || el.ended || !el.isConnected) speaking.delete(el);
    if (!speaking.size) ducks.delete("speech");
    // Near the end of a track the next one fades in while this one fades out.
    const el = current?.el;
    if (el && !el.paused && Number.isFinite(el.duration) && el.duration - el.currentTime < CROSSFADE_MS / 1000) {
      current.rate = -TICK_MS / CROSSFADE_MS;
      index += 1; current = start(index);
    }
    if (!players.length) { clearInterval(timer); timer = 0; }
  }
  function ensureTicker() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function sync() {
    if (shouldPlay() && !current) current = start(index);
    if (!shouldPlay() && players.length) {
      players.forEach(player => { player.rate = -TICK_MS / STOP_FADE_MS; });
      current = null; ensureTicker();
    }
    paint();
  }
  function paint() {
    if (!toggle) return;
    toggle.setAttribute("aria-checked", String(wanted));
    toggle.textContent = `Music ${wanted ? "on" : "off"}`;
    toggle.title = broken ? "The music could not be loaded, so nothing is playing." : "";
  }
  toggle?.addEventListener("click", () => {
    wanted = !wanted;
    write(wanted ? "on" : "off");
    // The click is itself the interaction that lets audio start.
    if (wanted) unlocked = true;
    sync();
  });
  // Other audio and video on the page (the double's voice, recordings played back) lower the music.
  document.addEventListener("play", event => {
    if (event.target instanceof HTMLMediaElement) { speaking.add(event.target); ducks.add("speech"); }
  }, true);
  ["pause", "ended", "emptied"].forEach(type => document.addEventListener(type, event => {
    speaking.delete(event.target);
    if (!speaking.size) ducks.delete("speech");
  }, true));
  addEventListener("pagehide", () => { active = false; players.slice().forEach(drop); });

  window.AnotherMeMusic = {
    unlock() { unlocked = true; sync(); },
    setActive(value) { if (active !== !!value) { active = !!value; sync(); } },
    duck(reason, on) { if (on) ducks.add(reason); else ducks.delete(reason); if (players.length) ensureTicker(); },
    state: () => ({ wanted, unlocked, active, broken, playing: players.filter(p => !p.el.paused).map(p => p.el.src.split("/").pop()), ducks: [...ducks], volume: current?.el.volume ?? 0 })
  };
  paint();
})();
