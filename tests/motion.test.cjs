const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function harness() {
  const elements = new Map(), listeners = new Map(), callbacks = new Map();
  let next = 1;
  const doc = {
    hidden: false, body: { classList: { toggle() {} } },
    getElementById(id) { if (!elements.has(id)) elements.set(id, { style: {}, setAttribute() {} }); return elements.get(id); },
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const ctx = { console, document: doc, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, AbortController, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {},
    requestAnimationFrame(callback) { const id = next++; callbacks.set(id, callback); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); }
  };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", "motion.js"), "utf8"), ctx);
  const room = new ctx.DigitalRoom({ getContext: () => null });
  const targetListeners = new Map();
  const target = { addEventListener(type, callback) { targetListeners.set(type, callback); } };
  return { room, target, targetListeners, listeners, callbacks, doc };
}
test("the atmosphere installs no scroll, wheel or touch handlers; progression is never gesture-driven", () => {
  const h = harness();
  assert.equal(h.listeners.has("wheel"), false); assert.equal(h.listeners.has("touchmove"), false);
  assert.equal(typeof h.room.enter, "undefined");
  h.room.dispose();
});
test("hidden tab pauses the only animation loop; reduced motion remains static", () => {
  const h = harness(); assert.equal(h.callbacks.size, 1);
  h.doc.hidden = true; h.listeners.get("visibilitychange")(); assert.equal(h.callbacks.size, 0);
  h.doc.hidden = false; h.listeners.get("visibilitychange")(); assert.equal(h.callbacks.size, 1);
  h.room.reduce(true); assert.equal(h.callbacks.size, 0);
  h.room.setScene(5); assert.equal(h.callbacks.size, 0);
  h.room.dispose();
});
test("reset clears depth state, the revealed path and any passage", () => {
  const h = harness();
  h.room.react("reveal"); h.room.travel(1);
  h.room.reset();
  assert.equal(h.room.pathVisible, false); assert.equal(h.room.journey, null); assert.equal(h.room.stage, 0);
  h.room.dispose();
});

test("directional passage uses one loop, no gesture handlers, and cancels safely", () => {
  const h = harness();
  h.room.travel(1); assert.equal(h.room.journey.direction, 1);
  assert.equal(h.callbacks.size, 1); assert.equal(h.room.inputAbort, undefined);
  h.room.travel(-1); assert.equal(h.room.journey.direction, -1);
  h.room.pause(); h.room.frame(64); assert.equal(h.room.journey.progress, 0);
  h.room.resume();
  for (let time = 96; time < 1200; time += 32) { h.callbacks.delete(h.room.frameId); h.room.frame(time); }
  assert.equal(h.room.journey, null); assert.equal(h.callbacks.size, 1);
  h.room.travel(); h.room.cancelTravel(); assert.equal(h.room.journey, null);
  h.room.travel(); h.room.reduce(true); assert.equal(h.room.journey, null);
  h.room.travel(); assert.equal(h.room.journey, null);
  h.room.reduce(false); h.room.travel(); h.room.reset(); assert.equal(h.room.journey, null);
  h.room.dispose();
});

test("stage profiles deepen gradually and rejecting a path fades its opacity", () => {
  const h = harness();
  const tick = time => { h.callbacks.delete(h.room.frameId); h.room.frame(time); };
  h.room.setScene(6);
  for (let time = 32; time < 4000; time += 32) tick(time);
  assert(h.room.look.hex > .9 && h.room.look.ring > .3);
  h.room.react("reveal"); tick(4032); tick(4064);
  const before = h.room.pathOpacity;
  assert(before > 0);
  h.room.react("reject"); tick(4096);
  assert(h.room.pathOpacity > 0 && h.room.pathOpacity < before);
  h.room.dispose();
});
