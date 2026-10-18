#!/usr/bin/env bash
# Builds the native pieces: whisper.cpp (static, Metal) and the two Swift executables.
# Output: build/bin/diktatorn-keys, build/bin/diktatorn-asr
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_SRC="$ROOT/native/vendor/whisper.cpp"
WHISPER_BUILD="$ROOT/build/whisper"
BIN="$ROOT/build/bin"
TARGET="arm64-apple-macos14.0"

if [ ! -f "$WHISPER_SRC/CMakeLists.txt" ]; then
  echo "whisper.cpp submodule missing; run: git submodule update --init --depth 1" >&2
  exit 1
fi

echo "whisper.cpp: configure + build"
cmake -S "$WHISPER_SRC" -B "$WHISPER_BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_EXAMPLES=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF -Wno-dev -Wno-deprecated >/dev/null
cmake --build "$WHISPER_BUILD" --config Release -j "$(sysctl -n hw.ncpu)" >/dev/null

mkdir -p "$BIN"

echo "diktatorn-keys"
swiftc -O -target "$TARGET" -framework ApplicationServices \
  "$ROOT/native/keys/main.swift" -o "$BIN/diktatorn-keys"

echo "diktatorn-asr"
swiftc -O -target "$TARGET" \
  -import-objc-header "$ROOT/native/asr/whisper-bridge.h" \
  -Xcc -I"$WHISPER_SRC/include" -Xcc -I"$WHISPER_SRC/ggml/include" \
  -L"$WHISPER_BUILD/src" -L"$WHISPER_BUILD/ggml/src" \
  -L"$WHISPER_BUILD/ggml/src/ggml-metal" -L"$WHISPER_BUILD/ggml/src/ggml-blas" \
  -lwhisper -lggml -lggml-base -lggml-cpu -lggml-metal -lggml-blas -lc++ \
  -framework Foundation -framework Metal -framework MetalKit -framework Accelerate \
  "$ROOT/native/asr/Engine.swift" "$ROOT/native/asr/main.swift" -o "$BIN/diktatorn-asr"

echo "built: $(ls "$BIN" | tr '\n' ' ')"
