# Design decisions

Each entry records the choice, the alternatives that were considered, and why.

## 1. Native helper

**Choice:** A small Swift executable for OS integration, talking to Electron over stdio with one JSON message per line.

**Alternatives considered:** N-API add-on (Objective-C++), Rust (napi-rs).

**Rationale:** _TODO_

## 2. Key capture

**Choice:**
- Hold the dictation key = push-to-talk; double-tap it = hands-free toggle. Esc cancels.
- The key is fn by default, or a right-hand ⌥, ⌘ or ⌃ for keyboards without fn.
- An active CGEventTap, plus IOHID where fn is not reported.
- Permissions: Accessibility only. It also gives the helper keyboard access, so Input Monitoring isn't requested separately; macOS doesn't list Diktatorn under Input Monitoring, so a step there could never be completed.

**Alternatives considered:** CGEventTap only; Electron `globalShortcut` (no fn, no key-up).

**Rationale:** _TODO_

## 3. Audio capture and voice activity detection

**Choice:**
- Capture: `getUserMedia` in a hidden renderer, via an AudioWorklet at 16 kHz mono.
- Voice activity detection: whisper.cpp's built-in Silero, used only to trim silence and to skip empty recordings.

**Alternatives considered:** capture in the Swift helper (AVAudioEngine); a native Node audio module; Silero in the renderer; an energy gate.

**Rationale:** _TODO_

## 4. Speech-recognition runtime and models

**Choice:**
- Runtime: whisper.cpp (pinned release, Metal) inside a dedicated Swift process that keeps models loaded.
- Swedish model: kb-whisper-medium (q5_0).
- English model: whisper large-v3-turbo (q5_0).
- kb-whisper-large (q5_0) as an optional higher-accuracy model.

**Alternatives considered:** a Node binding for whisper.cpp in a utility process; the whisper.cpp HTTP server; WhisperKit (Core ML).

**Rationale:** _TODO_

## 5. Language handling

**Choice:** Automatic detection restricted to Swedish and English, routing to the Swedish or English model, with a manual override (Auto / Svenska / English).

**Alternatives considered:** a separate hotkey or setting per language; one model for everything.

**Rationale:** _TODO_

## 6. Text cleanup

**Choice:** a hybrid pipeline.
1. Conservative rules always run (unambiguous fillers, spacing, capitalisation).
2. An optional local LLM pass follows, accepted only if its output passes a deletion-only check. Otherwise the rule output is used. Each deleted run must also be fillers or a self-correction (a correction phrase plus the words it takes back); any other deleted words are kept.
3. Dictionary replacements are applied deterministically at the end. The same terms are passed to Whisper as a prompt.

Model runtime: Gemma 4 E2B (QAT, q4_0) in a dedicated Swift process that links a pinned llama.cpp release with Metal. It is part of the first-run download, and the pass can be switched off under Smart cleanup (on by default).

**Alternatives considered:** rules only; LLM only. For the runtime: node-llama-cpp in a utility process; Ollama. For enforcing deletion-only output: a grammar that only allows subsequences of the input during decoding.

**Rationale:** _TODO_

## 7. Insertion

**Choice:** Clipboard snapshot, then a synthetic Cmd+V, then a guarded clipboard restore, with a small per-app table: in terminals newlines become spaces, and Chromium and Electron apps get a longer restore delay.

**Alternatives considered:** setting the focused element's value through Accessibility; synthesizing keystrokes.

**Rationale:** _TODO_

## 8. Overlay

**Choice:** A click-through, non-focusable Electron panel shown without activation. A native non-activating panel is the fallback if the overlay ever needs to be clickable.

**Alternatives considered:** native non-activating `NSPanel` from the start; a clickable window that re-activates the previous app.

**Rationale:** _TODO_

## 9. Storage

**Choice:**
- JSON files for settings and the dictionary, written atomically.
- No history on disk: recent dictations are kept in memory for the current session only. No audio is stored, except benchmark takes recorded on purpose in a development build.

**Alternatives considered:** SQLite history (`node:sqlite`); JSONL history; SQLite for everything.

**Rationale:** _TODO_

## 10. Speech engine boundary

**Choice:**
- An utterance-level interface behind a process boundary: `ensureLoaded`, `speechSegments`, `detectLanguage`, `transcribe` and `close`.
- The engine provides mechanisms only. Policy (silence trimming, the empty-recording gate, language routing) lives in the caller.
- A future meeting mode reuses it by segmenting audio before calling `transcribe`.

**Alternatives considered:** a streaming session API; a local HTTP service.

**Rationale:** _TODO_

## 11. Packaging and signing

**Choice:**
- `npm run package`: Electron Packager, a `.dmg` made with `hdiutil`, and its SHA-256. Apple Silicon only.
- Signed with a self-signed code-signing certificate, under the hardened runtime. macOS ties privacy permissions to the designated requirement, which is then "this bundle identifier, signed by this certificate", so an update keeps Accessibility.
- Not notarized: each downloaded version is opened once through Privacy & Security → Open Anyway.
- Electron fuses: running as Node, `NODE_OPTIONS` and `--inspect` are off, and the app only loads its integrity-checked asar. The packaged app also refuses command-line switches, because none of the fuses covers Chromium's remote debugging. Together they stop other programs from using Diktatorn's permissions by starting it with different settings. They don't stop a program that can change files inside the installed app, for example by replacing a helper.
- Library validation is off (`disable-library-validation`). It only lets the app load code signed with the app's own Team ID, and a self-signed certificate has none, so the app couldn't load Electron. The hardened runtime still ignores `DYLD_*` variables.
- Development builds run as Diktatorn Dev, with their own bundle identifier. That copy of Electron runs any app directory it is given, so it must not satisfy the permissions people grant the release.

**Alternatives considered:** Developer ID signing and notarization (needs the paid Apple Developer Program); ad-hoc signing (the requirement pins one build's cdhash, so every update loses Accessibility); electron-builder.

**Rationale:** _TODO_
