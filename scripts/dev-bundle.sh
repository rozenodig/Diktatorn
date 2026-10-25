#!/usr/bin/env bash
# Makes build/Diktatorn.app: a local copy of the Electron runtime called "Diktatorn Dev", so the
# Dock, the menu bar and the permission prompts name it during development. It has its own bundle
# identifier: this copy runs any app directory it is given, so it must never satisfy the
# permissions people grant the released app. It is signed with the release certificate when this
# Mac has it (see create-signing-identity.sh), so its permissions survive rebuilds. Otherwise it
# is ad-hoc signed, like the runtime it comes from; macOS then ties the permissions to this one
# build, so the bundle is only rebuilt when the Electron version changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/electron/dist/Electron.app"
DEST="$ROOT/build/Diktatorn.app"
STAMP="$ROOT/build/Diktatorn.app.electron-version"
VERSION="$(node -p 'require("electron/package.json").version')"
BUNDLE_ID="com.rozenodigital.diktatorn.dev"
IDENTITY="${DIKTATORN_SIGN_IDENTITY:-Diktatorn Code Signing}"
SIGN_ERROR=""

# Signs with the certificate if it is there; codesign stops before touching the bundle if not.
sign_with_certificate() {
  if ! SIGN_ERROR="$(codesign --force --deep --sign "$IDENTITY" "$DEST" 2>&1)"; then return 1; fi
  echo "$VERSION $BUNDLE_ID certificate" >"$STAMP"
  echo "build/Diktatorn.app: signed with \"$IDENTITY\""
}

if [ -d "$DEST" ]; then
  case "$(cat "$STAMP" 2>/dev/null)" in
    "$VERSION $BUNDLE_ID certificate") exit 0 ;;
    "$VERSION $BUNDLE_ID ad-hoc") sign_with_certificate || true; exit 0 ;;
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
plutil -replace CFBundleName -string "Diktatorn Dev" "$PLIST"
plutil -replace CFBundleDisplayName -string "Diktatorn Dev" "$PLIST"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace NSMicrophoneUsageDescription -string "Diktatorn listens only while you hold the dictation key, and everything it hears stays on your Mac." "$PLIST"
if ! sign_with_certificate; then
  codesign --force --deep --sign - "$DEST" 2>/dev/null
  echo "$VERSION $BUNDLE_ID ad-hoc" >"$STAMP"
  echo "build/Diktatorn.app: ad-hoc signed, so its permissions last until it is rebuilt (\"$IDENTITY\": ${SIGN_ERROR##*: })"
fi
