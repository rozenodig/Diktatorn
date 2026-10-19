import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, parseSettings, SettingsStore } from "../src/main/settings.ts";

test("invalid or unknown values fall back to the default, valid ones are kept", () => {
  const parsed = parseSettings({
    hotkey: "capsLock",
    microphoneId: "",
    languageMode: "sv",
    swedishModel: "kb-whisper-large",
    smartCleanup: "yes",
    appearance: "sepia",
    theme: "pink",
  });
  assert.deepEqual(parsed, { ...DEFAULT_SETTINGS, languageMode: "sv", swedishModel: "kb-whisper-large" });
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.equal(parseSettings({ microphoneId: "abc123" }).microphoneId, "abc123");
});

test("the store starts from defaults without a file, saves atomically and reloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diktatorn-settings-"));
  try {
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path);
    assert.deepEqual(await store.load(), DEFAULT_SETTINGS);

    const updated = await store.update({ hotkey: "rightOption", languageMode: "en", appearance: "dark" });
    assert.equal(updated.hotkey, "rightOption");
    assert.equal(updated.appearance, "dark");
    assert.deepEqual(readdirSync(dir), ["settings.json"], "no temporary file is left behind");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).languageMode, "en");

    // An invalid patch value is ignored, not saved.
    assert.equal((await store.update({ hotkey: "f13" as never })).hotkey, "rightOption");
    assert.equal((await new SettingsStore(path).load()).hotkey, "rightOption");

    writeFileSync(path, "{ not json");
    assert.deepEqual(await new SettingsStore(path).load(), DEFAULT_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
