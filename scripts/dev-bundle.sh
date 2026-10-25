#!/usr/bin/env bash
# Makes build/Diktatorn.app: a local copy of the Electron runtime with Diktatorn's name and
# bundle identifier, so the Dock, the menu bar and the permission prompts say Diktatorn during
# development. The copy is ad-hoc signed, like the runtime it comes from. It is only rebuilt
# when the Electron version changes, because macOS ties granted permissions to the signed
# bundle and a rebuilt bundle has to be granted them again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/electron/dist/Electron.app"
DEST="$ROOT/build/Diktatorn.app"
STAMP="$ROOT/build/Diktatorn.app.electron-version"
VERSION="$(node -p 'require("electron/package.json").version')"

if [ -d "$DEST" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$VERSION" ]; then
  exit 0
fi

echo "build/Diktatorn.app: creating from Electron $VERSION"
# Electron has no install script; its runtime is downloaded (checksum-verified, cached in
# ~/Library/Caches/electron) on first use. Copying dist/ directly skips that, so fetch it here.
node "$ROOT/node_modules/electron/install.js"
rm -rf "$DEST"
mkdir -p "$ROOT/build"
ditto "$SRC" "$DEST"
PLIST="$DEST/Contents/Info.plist"
plutil -replace CFBundleName -string "Diktatorn" "$PLIST"
plutil -replace CFBundleDisplayName -string "Diktatorn" "$PLIST"
plutil -replace CFBundleIdentifier -string "com.rozenodigital.diktatorn" "$PLIST"
plutil -replace NSMicrophoneUsageDescription -string "Diktatorn listens only while you hold the dictation key, and everything it hears stays on your Mac." "$PLIST"
codesign --force --deep --sign - "$DEST" 2>/dev/null
echo "$VERSION" >"$STAMP"
