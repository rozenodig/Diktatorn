import assert from "node:assert/strict";
import { test } from "node:test";
import { PushToTalk } from "../src/main/ptt.ts";

function run(events: [string, number][], minHoldMs = 150) {
  const ptt = new PushToTalk({ minHoldMs });
  return events.map(([e, t]) => (e === "down" ? ptt.fnDown(t) : e === "up" ? ptt.fnUp(t) : ptt.chord(t)));
}

test("hold then release starts and stops a recording", () => {
  assert.deepEqual(run([["down", 0], ["up", 900]]), ["start", "stop"]);
});

test("a tap shorter than the minimum hold is discarded", () => {
  assert.deepEqual(run([["down", 0], ["up", 100]]), ["start", "cancel"]);
});

test("pressing another key while fn is held cancels (fn used as a modifier)", () => {
  assert.deepEqual(run([["down", 0], ["chord", 300], ["up", 900]]), ["start", "cancel", "none"]);
});

test("repeated downs and stray ups are ignored", () => {
  assert.deepEqual(run([["up", 0], ["down", 10], ["down", 20], ["up", 500]]), ["none", "start", "none", "stop"]);
});
