// Release build. Packages the app with Electron Packager, copies the native helpers into
// Contents/MacOS, turns off the Electron switches that would let other code run with Diktatorn's
// permissions, signs everything with the release certificate (see create-signing-identity.sh)
// and writes build/release/Diktatorn-<version>-arm64.dmg plus its SHA-256.
// Usage: npm run package. DIKTATORN_SIGN_IDENTITY overrides the certificate name.
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { packager } from "@electron/packager";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "build", "release");
const HELPERS = ["diktatorn-helper", "diktatorn-asr", "diktatorn-llm"];
const BUNDLE_ID = "com.rozenodigital.diktatorn";
const IDENTITY = process.env.DIKTATORN_SIGN_IDENTITY ?? "Diktatorn Code Signing";
const ENTITLEMENTS = join(ROOT, "scripts", "entitlements.plist");
/** Everything the packaged app reads at runtime; nothing else in the checkout is copied. */
const KEEP = [
  "/package.json",
  "/dist/main",
  "/dist/preload",
  "/dist/renderer",
  "/dist/shared",
  "/assets/icon.png",
  "/assets/trayTemplate.png",
  "/assets/trayTemplate@2x.png",
];

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });

for (const name of HELPERS) {
  if (!existsSync(join(ROOT, "build", "bin", name))) throw new Error(`build/bin/${name} is missing; run npm run build:native`);
}

rmSync(OUT, { recursive: true, force: true });
const [outDir] = await packager({
  dir: ROOT,
  out: OUT,
  name: "Diktatorn",
  platform: "darwin",
  arch: "arm64",
  appBundleId: BUNDLE_ID,
  appCategoryType: "public.app-category.productivity",
  appCopyright: "Copyright © 2026 Hugo Rosenö. GPL-3.0-only.",
  icon: join(ROOT, "assets", "Diktatorn.icns"),
  asar: true,
  prune: true,
  ignore: (path) => !(path === "" || KEEP.some((keep) => path === keep || path.startsWith(`${keep}/`) || keep.startsWith(`${path}/`))),
  usageDescription: {
    Microphone: "Diktatorn listens only while you hold the dictation key, and everything it hears stays on your Mac.",
  },
  extendInfo: { LSMinimumSystemVersion: "14.0" },
});
if (!outDir) throw new Error("Electron Packager produced no app");
const app = join(outDir, "Diktatorn.app");
const contents = join(app, "Contents");

for (const name of HELPERS) cpSync(join(ROOT, "build", "bin", name), join(contents, "MacOS", name));

// Third-party notices for what the app ships: Electron (and Chromium), and whisper.cpp and llama.cpp,
// which are linked into the speech and language-model processes.
const licenses = join(contents, "Resources", "licenses");
mkdirSync(licenses);
cpSync(join(ROOT, "LICENSE"), join(licenses, "Diktatorn-LICENSE"));
cpSync(join(outDir, "LICENSE"), join(licenses, "Electron-LICENSE"));
cpSync(join(outDir, "LICENSES.chromium.html"), join(licenses, "LICENSES.chromium.html"));
cpSync(join(ROOT, "native", "vendor", "whisper.cpp", "LICENSE"), join(licenses, "whisper.cpp-LICENSE"));
cpSync(join(ROOT, "native", "vendor", "llama.cpp", "LICENSE"), join(licenses, "llama.cpp-LICENSE"));
cpSync(join(ROOT, "assets", "THIRD-PARTY-NOTICES.txt"), join(licenses, "THIRD-PARTY-NOTICES.txt"));

// Without these, anyone who can start the app could run their own code inside it, with the
// Accessibility access the user gave Diktatorn: as plain Node, through NODE_OPTIONS or a
// debugger, or by editing the app's files.
await flipFuses(app, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

// Inside out: every executable and library, then the frameworks and Electron helper apps from the
// deepest up, then the app itself. codesign --deep would skip code outside the standard bundle
// locations, such as Electron's Libraries/*.dylib. The hardened runtime also stops DYLD_*
// variables from loading code.
const sign = (path: string, extra: string[] = []) =>
  run("codesign", ["--force", "--timestamp=none", "--options", "runtime", "--sign", IDENTITY, ...extra, path]);
console.log(`signing with "${IDENTITY}"`);
const files = walk(app);
const code = files.filter(isMachO);
for (const file of code) {
  // A helper's identifier is its file name, because Electron's helper apps already use BUNDLE_ID.helper.
  const helper = HELPERS.includes(basename(file)) && file.startsWith(join(contents, "MacOS"));
  sign(file, helper ? ["--identifier", `${BUNDLE_ID}.${basename(file)}`] : []);
}
const bundles = walk(join(contents, "Frameworks"), true)
  .filter((dir) => dir.endsWith(".framework") || dir.endsWith(".app"))
  .sort((a, b) => b.split("/").length - a.split("/").length);
for (const bundle of bundles) sign(bundle, bundle.endsWith(".app") ? ["--entitlements", ENTITLEMENTS] : []);
sign(app, ["--entitlements", ENTITLEMENTS]);
run("codesign", ["--verify", "--deep", "--strict", app]);
const unsigned = code.filter((file) => !signedByIdentity(file));
if (unsigned.length > 0) throw new Error(`not signed with "${IDENTITY}":\n${unsigned.join("\n")}`);

// A valid signature doesn't mean the app starts: the hardened runtime and the fuses are only
// enforced at launch. It must also refuse command-line switches, which no fuse covers.
const launch = (args: string[]) =>
  spawnSync(join(contents, "MacOS", "Diktatorn"), args, {
    env: { ...process.env, DIKTATORN_LAUNCH_CHECK: "1" },
    encoding: "utf8",
    timeout: 60_000,
  });
const check = launch([]);
if (check.status !== 0 || !check.stdout.includes("launch check: ok")) {
  throw new Error(`the signed app does not start (status ${check.status}):\n${check.stdout}${check.stderr}`);
}
const withSwitch = launch(["--remote-debugging-port=0"]);
if (withSwitch.status === 0 || withSwitch.stdout.includes("launch check: ok")) {
  throw new Error("the signed app starts with --remote-debugging-port, which would let other code use its permissions");
}
console.log("launch check: ok");

const dmg = join(OUT, `Diktatorn-${version}-arm64.dmg`);
const stage = join(OUT, "dmg");
mkdirSync(stage);
run("ditto", [app, join(stage, "Diktatorn.app")]);
symlinkSync("/Applications", join(stage, "Applications"));
run("hdiutil", ["create", "-quiet", "-volname", "Diktatorn", "-srcfolder", stage, "-format", "UDZO", "-ov", dmg]);
rmSync(stage, { recursive: true });
const sha = execFileSync("shasum", ["-a", "256", basename(dmg)], { cwd: OUT, encoding: "utf8" });
writeFileSync(`${dmg}.sha256`, sha);
console.log(`\n${dmg}\n${sha.trim()}`);

/** Real paths of the files (or directories) under `dir`, each once: frameworks reach the same files through Versions/Current symlinks. */
function walk(dir: string, directories = false): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (directories ? entry.isDirectory() : entry.isFile()) found.add(realpathSync(join(entry.parentPath, entry.name)));
  }
  return [...found];
}

function isMachO(file: string): boolean {
  const head = Buffer.alloc(4);
  const fd = openSync(file, "r");
  const bytes = readSync(fd, head, 0, 4, 0);
  closeSync(fd);
  return bytes === 4 && [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(head.readUInt32BE(0));
}

function signedByIdentity(file: string): boolean {
  // codesign prints the signature details on stderr.
  const { stderr } = spawnSync("codesign", ["-dvv", file], { encoding: "utf8" });
  return stderr.includes(`Authority=${IDENTITY}`);
}
