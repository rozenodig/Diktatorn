#!/usr/bin/env bash
# Makes build/Diktatorn.app: a local copy of the Electron runtime with Diktatorn's name and
# bundle identifier, so the Dock, the menu bar and the permission prompts say Diktatorn during
# development. It is signed with the release certificate when this Mac has it (see
# create-signing-identity.sh), so it shares the installed app's permissions and keeps them when
# it is rebuilt. Otherwise it is ad-hoc signed, like the runtime it comes from; macOS then ties
# the permissions to this one build, so the bundle is only rebuilt when the Electron version
# changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/electron/dist/Electron.app"
DEST="$ROOT/build/Diktatorn.app"
STAMP="$ROOT/build/Diktatorn.app.electron-version"
VERSION="$(node -p 'require("electron/package.json").version')"
IDENTITY="${DIKTATORN_SIGN_IDENTITY:-Diktatorn Code Signing}"

# Signs with the certificate if it is there; codesign stops before touching the bundle if not.
sign_with_certificate() {
  codesign --force --deep --sign "$IDENTITY" "$DEST" 2>/dev/null && echo "$VERSION certificate" >"$STAMP"
}

if [ -d "$DEST" ]; then
  case "$(cat "$STAMP" 2>/dev/null)" in
    "$VERSION certificate") exit 0 ;;
    "$VERSION ad-hoc") sign_with_certificate || true; exit 0 ;;
  esac
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
sign_with_certificate || { codesign --force --deep --sign - "$DEST" 2>/dev/null && echo "$VERSION ad-hoc" >"$STAMP"; }
