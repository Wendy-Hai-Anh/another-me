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
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "motion.js"), "utf8"), ctx);
  const room = new ctx.DigitalRoom({ getContext: () => null });
  const targetListeners = new Map();
  const target = { addEventListener(type, callback) { targetListeners.set(type, callback); } };
  return { room, target, targetListeners, listeners, callbacks, doc };
}
test("tunnel supports reversible touch and ignores browser zoom gestures", () => {
  const h = harness(); let prevented = false;
  h.room.enter(h.target, () => {});
  const target = { closest: () => null };
  h.targetListeners.get("touchstart")({ touches: [{ clientY: 600 }], target });
  h.targetListeners.get("touchmove")({ touches: [{ clientY: 400 }], preventDefault() { prevented = true; } });
  assert(prevented); assert.equal(h.room.targetDepth, .11);
  h.targetListeners.get("touchmove")({ touches: [{ clientY: 600 }], preventDefault() {} });
  assert.equal(h.room.targetDepth, 0);
  h.targetListeners.get("wheel")({ ctrlKey: true, target, deltaY: 1000, preventDefault() { throw new Error("Must not capture zoom"); } });
  assert.equal(h.room.targetDepth, 0);
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
test("leaving or deleting entrance aborts gesture handlers and resets state", () => {
  const h = harness(); h.room.enter(h.target, () => {});
  const signal = h.room.inputAbort.signal;
  h.room.targetDepth = .6; h.room.pathVisible = true;
  h.room.reset();
  assert.equal(signal.aborted, true);
  assert.equal(h.room.tunnel, false); assert.equal(h.room.targetDepth, 0); assert.equal(h.room.pathVisible, false);
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

test("full depth completes once and detaches entrance; rejecting a path fades its opacity", () => {
  const h = harness(); let completed = 0;
  h.room.enter(h.target, () => completed++);
  const signal = h.room.inputAbort.signal;
  h.room.targetDepth = 1;
  const tick = time => { h.callbacks.delete(h.room.frameId); h.room.frame(time); };
  for (let time = 32; time < 2000; time += 32) tick(time);
  assert.equal(completed, 1); assert.equal(signal.aborted, true);
  h.room.react("reveal"); tick(2048); tick(2080);
  const before = h.room.pathOpacity;
  assert(before > 0);
  h.room.react("reject"); tick(2112);
  assert(h.room.pathOpacity > 0 && h.room.pathOpacity < before);
  h.room.dispose();
});
