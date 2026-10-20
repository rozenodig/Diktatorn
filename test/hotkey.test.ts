import assert from "node:assert/strict";
import { test } from "node:test";
import { Hotkey } from "../src/main/hotkey.ts";

type Step = ["down" | "up" | "chord" | "expire" | "escape", number];

function run(steps: Step[]) {
  const hk = new Hotkey({ minHoldMs: 150 });
  return steps.map(([e, t]) => {
    if (e === "down") return hk.down(t);
    if (e === "up") return hk.up(t);
    if (e === "chord") return hk.chord();
    if (e === "expire") return hk.expire();
    return hk.escape();
  });
}

test("hold then release is push-to-talk", () => {
  assert.deepEqual(run([["down", 0], ["up", 900]]), ["start", "stop"]);
});

test("a single short tap is discarded once the double-tap window expires", () => {
  assert.deepEqual(run([["down", 0], ["up", 100], ["expire", 400]]), ["start", "pending", "cancel"]);
});

test("double-tap enters hands-free; the next tap stops and transcribes", () => {
  assert.deepEqual(
    run([["down", 0], ["up", 80], ["down", 200], ["up", 280], ["down", 5000], ["up", 5100]]),
    ["start", "pending", "handsFree", "none", "none", "stop"],
  );
});

test("a stale expiry after entering hands-free does nothing", () => {
  assert.deepEqual(run([["down", 0], ["up", 80], ["down", 200], ["expire", 400]]), ["start", "pending", "handsFree", "none"]);
});

test("the hotkey used as a modifier cancels push-to-talk", () => {
  assert.deepEqual(run([["down", 0], ["chord", 300], ["up", 900]]), ["start", "cancel", "none"]);
});

test("the hotkey used as a modifier during hands-free does not stop it", () => {
  const steps: Step[] = [["down", 0], ["up", 80], ["down", 200], ["up", 280], ["down", 3000], ["chord", 3050], ["up", 3200]];
  assert.deepEqual(run(steps), ["start", "pending", "handsFree", "none", "none", "none", "none"]);
});

test("Esc cancels push-to-talk and hands-free, and is ignored when idle", () => {
  assert.deepEqual(run([["down", 0], ["escape", 500], ["up", 900]]), ["start", "cancel", "none"]);
  assert.deepEqual(run([["down", 0], ["up", 80], ["down", 200], ["up", 280], ["escape", 4000]]),
    ["start", "pending", "handsFree", "none", "cancel"]);
  assert.deepEqual(run([["escape", 0]]), ["none"]);
});

test("repeated downs and stray ups are ignored", () => {
  assert.deepEqual(run([["up", 0], ["down", 10], ["down", 20], ["up", 500]]), ["none", "start", "none", "stop"]);
});
