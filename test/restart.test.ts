import assert from "node:assert/strict";
import { test } from "node:test";
import { RestartPolicy } from "../src/main/restart.ts";

test("crashes restart with a growing delay, then give up until the window has passed", () => {
  const policy = new RestartPolicy({ maxCrashes: 3, windowMs: 60_000 });
  assert.equal(policy.crashed(0), 1000);
  assert.equal(policy.crashed(5_000), 2000);
  assert.equal(policy.crashed(10_000), 3000);
  assert.equal(policy.crashed(20_000), null, "a fourth crash within the window gives up");
  // Once the earlier crashes are older than the window, a new crash is restarted again.
  assert.equal(policy.crashed(90_000), 1000);
});
