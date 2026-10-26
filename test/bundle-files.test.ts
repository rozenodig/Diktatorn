import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isMachO, walk } from "../scripts/bundle-files.ts";

/** A framework laid out like Electron's: the real files under Versions/A, reached again through Versions/Current. */
function bundle(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "diktatorn-bundle-")));
  const framework = join(dir, "App.app", "Contents", "Frameworks", "Lib.framework");
  mkdirSync(join(framework, "Versions", "A"), { recursive: true });
  writeFileSync(join(framework, "Versions", "A", "Lib"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]));
  symlinkSync("A", join(framework, "Versions", "Current"));
  symlinkSync("Versions/Current/Lib", join(framework, "Lib"));
  return dir;
}

test("walk lists each file once, however many symlinks reach it", () => {
  const dir = bundle();
  try {
    const app = join(dir, "App.app");
    const lib = join(app, "Contents", "Frameworks", "Lib.framework", "Versions", "A", "Lib");
    assert.deepEqual(walk(app), [lib]);
    assert.ok(isMachO(lib));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walk refuses a symlink that leads out of the bundle", () => {
  const dir = bundle();
  try {
    const app = join(dir, "App.app");
    writeFileSync(join(dir, "outside"), "not part of the app");
    mkdirSync(join(dir, "outside-dir"));
    symlinkSync(join(dir, "outside"), join(app, "Contents", "file-link"));
    assert.throws(() => walk(app), /file-link/);
    rmSync(join(app, "Contents", "file-link"));
    symlinkSync("../../outside-dir", join(app, "Contents", "dir-link"));
    assert.throws(() => walk(app, true), /dir-link/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
