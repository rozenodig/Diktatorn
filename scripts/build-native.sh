#!/usr/bin/env bash
# Builds the native pieces: whisper.cpp and llama.cpp (static, Metal) and the three Swift
# executables. Each of the two libraries bundles its own ggml, so they link into separate
# processes. Output: build/bin/diktatorn-helper, build/bin/diktatorn-asr, build/bin/diktatorn-llm
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_SRC="$ROOT/native/vendor/whisper.cpp"
WHISPER_BUILD="$ROOT/build/whisper"
LLAMA_SRC="$ROOT/native/vendor/llama.cpp"
LLAMA_BUILD="$ROOT/build/llama"
BIN="$ROOT/build/bin"
TARGET="arm64-apple-macos14.0"

for src in "$WHISPER_SRC" "$LLAMA_SRC"; do
  if [ ! -f "$src/CMakeLists.txt" ]; then
    echo "$(basename "$src") submodule missing; run: git submodule update --init --depth 1" >&2
    exit 1
  fi
done

echo "whisper.cpp: configure + build"
cmake -S "$WHISPER_SRC" -B "$WHISPER_BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_EXAMPLES=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF -Wno-author -Wno-deprecated >/dev/null
cmake --build "$WHISPER_BUILD" --config Release -j "$(sysctl -n hw.ncpu)" >/dev/null

echo "llama.cpp: configure + build"
cmake -S "$LLAMA_SRC" -B "$LLAMA_BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DLLAMA_BUILD_COMMON=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_TOOLS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=OFF \
  -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_OPENSSL=OFF -Wno-author -Wno-deprecated >/dev/null
cmake --build "$LLAMA_BUILD" --config Release --target llama -j "$(sysctl -n hw.ncpu)" >/dev/null

mkdir -p "$BIN"

echo "diktatorn-helper"
swiftc -O -target "$TARGET" -framework AppKit -framework ApplicationServices -framework IOKit \
  "$ROOT"/native/helper/*.swift -o "$BIN/diktatorn-helper"

echo "diktatorn-asr"
swiftc -O -target "$TARGET" \
  -import-objc-header "$ROOT/native/asr/whisper-bridge.h" \
  -Xcc -I"$WHISPER_SRC/include" -Xcc -I"$WHISPER_SRC/ggml/include" \
  -L"$WHISPER_BUILD/src" -L"$WHISPER_BUILD/ggml/src" \
  -L"$WHISPER_BUILD/ggml/src/ggml-metal" -L"$WHISPER_BUILD/ggml/src/ggml-blas" \
  -lwhisper -lggml -lggml-base -lggml-cpu -lggml-metal -lggml-blas -lc++ \
  -framework Foundation -framework Metal -framework MetalKit -framework Accelerate \
  "$ROOT/native/asr/Engine.swift" "$ROOT/native/asr/main.swift" -o "$BIN/diktatorn-asr"

echo "diktatorn-llm"
swiftc -O -target "$TARGET" \
  -import-objc-header "$ROOT/native/llm/llama-bridge.h" \
  -Xcc -I"$LLAMA_SRC/include" -Xcc -I"$LLAMA_SRC/ggml/include" \
  -L"$LLAMA_BUILD/src" -L"$LLAMA_BUILD/ggml/src" \
  -L"$LLAMA_BUILD/ggml/src/ggml-metal" -L"$LLAMA_BUILD/ggml/src/ggml-blas" \
  -lllama -lggml -lggml-base -lggml-cpu -lggml-metal -lggml-blas -lc++ \
  -framework Foundation -framework Metal -framework MetalKit -framework Accelerate \
  "$ROOT/native/llm/Engine.swift" "$ROOT/native/llm/main.swift" -o "$BIN/diktatorn-llm"

echo "built: $(ls "$BIN" | tr '\n' ' ')"
