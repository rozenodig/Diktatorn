// Clipboard snapshot/restore of the native helper, run in dry-run mode (no Cmd+V) against a
// private named pasteboard, so it needs no permissions and never touches the user's clipboard.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonLinesProcess } from "../src/main/json-lines.ts";

const BIN = join(import.meta.dirname, "..", "build", "bin", "diktatorn-helper");
const skip = existsSync(BIN) ? false : "helper not built (npm run build:native)";
const PB = `diktatorn-test-${process.pid}`;

/** Runs AppKit through JavaScript for Automation against the test pasteboard. */
function jxa(body: string): string {
  const script = `ObjC.import('AppKit'); const pb = $.NSPasteboard.pasteboardWithName('${PB}'); ${body}`;
  return execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }).trim();
}
const setClipboard = (types: Record<string, string>) =>
  jxa(`pb.clearContents; ${Object.entries(types).map(([t, v]) => `pb.setStringForType($(${JSON.stringify(v)}), $(${JSON.stringify(t)}));`).join(" ")} ""`);
const readType = (type: string) => jxa(`const s = pb.stringForType($(${JSON.stringify(type)})); s.isNil() ? "<nil>" : ObjC.unwrap(s)`);

let helper: JsonLinesProcess;

before(async () => {
  if (skip) return;
  helper = new JsonLinesProcess("helper", BIN, { ...process.env, DIKTATORN_HELPER_NO_KEYS: "1" });
  await once(helper, "event");
});

after(() => {
  helper?.close();
  if (!skip) jxa("pb.releaseGlobally; ''");
});

const insert = (text: string, restoreDelayMs: number) =>
  helper.request("insert", { text, restoreDelayMs, dryRun: true, pasteboard: PB });

test("dictation is on the clipboard during the paste window, then every original type comes back", { skip }, async () => {
  setClipboard({ "public.utf8-plain-text": "original", "public.html": "<b>original</b>" });
  const pending = insert("dikterad text", 300);
  await sleep(100);
  assert.equal(readType("public.utf8-plain-text"), "dikterad text");
  const res = await pending;
  assert.equal(res.restored, true);
  assert.equal(readType("public.utf8-plain-text"), "original");
  assert.equal(readType("public.html"), "<b>original</b>");
});

test("a copy made during the paste window is kept, not overwritten", { skip }, async () => {
  setClipboard({ "public.utf8-plain-text": "original" });
  const pending = insert("dikterad text", 400);
  await sleep(100);
  setClipboard({ "public.utf8-plain-text": "user copy" });
  const res = await pending;
  assert.equal(res.restored, false);
  assert.match(String(res.note), /changed/);
  assert.equal(readType("public.utf8-plain-text"), "user copy");
});

test("password-manager (concealed) content is never put back", { skip }, async () => {
  setClipboard({ "public.utf8-plain-text": "hunter2", "org.nspasteboard.ConcealedType": "" });
  const res = await insert("dikterad text", 100);
  assert.equal(res.restored, false);
  assert.match(String(res.note), /concealed/);
  assert.notEqual(readType("public.utf8-plain-text"), "hunter2");
});

test("our own write is marked transient for clipboard managers", { skip }, async () => {
  setClipboard({ "public.utf8-plain-text": "original" });
  const pending = insert("dikterad text", 300);
  await sleep(100);
  assert.notEqual(readType("org.nspasteboard.TransientType"), "<nil>");
  await pending;
});

test("frontmost reports the active app", { skip }, async () => {
  const res = await helper.request("frontmost");
  assert.equal(typeof res.bundleId, "string");
});
