import assert from "node:assert/strict";
import { test } from "node:test";
import { planInsertion } from "../src/main/apps.ts";

test("default apps get a trailing space so consecutive dictations stay separated", () => {
  const plan = planInsertion("Hej på dig.", "com.apple.TextEdit");
  assert.deepEqual(plan, { text: "Hej på dig. ", kind: "default", restoreDelayMs: 400 });
});

test("terminals get no trailing space and never a newline, so nothing executes", () => {
  const plan = planInsertion("git status\n", "com.apple.Terminal");
  assert.equal(plan?.text, "git status");
  assert.equal(plan?.kind, "terminal");
  assert.equal(planInsertion("echo a\necho b", "com.googlecode.iterm2")?.text, "echo a echo b");
});

test("terminals get no control characters, so text can't end a bracketed paste or run a command", () => {
  // Esc [201~ ends a bracketed paste; a lone carriage return runs the line like a newline.
  assert.equal(planInsertion("ls\x1b[201~\rwhoami", "com.apple.Terminal")?.text, "ls[201~ whoami");
  assert.equal(planInsertion("git\tstatus\r\n", "com.mitchellh.ghostty")?.text, "git status");
});

test("other apps keep newlines but lose every other control character", () => {
  // An app such as VS Code can have a terminal inside it, where Esc would end a bracketed paste too.
  assert.equal(planInsertion("Hej\x1b då\r\nVi ses\x07", "com.microsoft.VSCode")?.text, "Hej då\nVi ses ");
});

test("Electron and Chromium apps wait longer before the clipboard is restored", () => {
  for (const id of ["com.microsoft.VSCode", "com.tinyspeck.slackmacgap", "com.google.Chrome"]) {
    const plan = planInsertion("text", id);
    assert.equal(plan?.kind, "chromium", id);
    assert.ok((plan?.restoreDelayMs ?? 0) > planInsertion("text", "com.apple.TextEdit")!.restoreDelayMs);
  }
});

test("empty or whitespace-only text is not inserted; unknown app uses defaults", () => {
  assert.equal(planInsertion("   ", "com.apple.TextEdit"), null);
  assert.equal(planInsertion("hej", null)?.kind, "default");
});
