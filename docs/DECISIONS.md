# Design decisions

Each entry records the choice, the alternatives that were considered, and why.

## 1. Native helper

**Choice:** A small Swift executable for OS integration, talking to Electron over stdio with one JSON message per line.

**Alternatives considered:** N-API add-on (Objective-C++), Rust (napi-rs).

**Rationale:**

- **Native APIs in their own language.** Everything the helper does (the event tap, HID input, Accessibility, the pasteboard) is a macOS API that Swift calls directly. `swiftc` from the Command Line Tools builds it, so there's no Xcode project and no new dependency.
- **A crash stays in its own process.** A bug in an add-on, or a stalled event-tap thread inside Node, would take down the Electron main process, and with it the menu bar, the window and the dictation in progress. A dead helper is just an exit event: pending requests fail at once, and it is restarted (at most three crashes in five minutes, with a growing delay).
- **No ABI coupling.** An add-on has to be rebuilt for every Electron version. The executable doesn't care which Electron runs it.
- **stdio rather than a socket.** There's no port and nothing listening, the helper exits when the app's end of the pipe closes, and the protocol can be tested by typing JSON into it. The same supervisor (`JsonLinesProcess`) now runs the speech and cleanup processes too (decisions 4 and 6).
- **Rust** is memory-safe, but reaches these APIs through FFI crates, and it would add a second new toolchain for no gain over Swift.

## 2. Key capture

**Choice:**
- Hold the dictation key = push-to-talk; double-tap it = hands-free toggle. Esc cancels.
- The key is fn by default, or a right-hand ⌥, ⌘ or ⌃ for keyboards without fn.
- An active CGEventTap, plus IOHID where fn is not reported.
- Permissions: Accessibility only. It also gives the helper keyboard access, so Input Monitoring isn't requested separately; macOS doesn't list Diktatorn under Input Monitoring, so a step there could never be completed.

**Alternatives considered:** CGEventTap only; Electron `globalShortcut` (no fn, no key-up).

**Rationale:**

- **Push-to-talk needs the release.** Electron's `globalShortcut` fires on press only and can't register fn, so it can't do hold-to-talk. An event tap sees both edges of every modifier.
- **fn needs a second source.** On Apple keyboards fn is handled below the event-tap layer: in testing, the tap received ⌃, ⌥ and ⇧ but never fn. The helper also reads fn from the keyboard's HID reports, matched to the fn usage only, so that path sees no other key. Both sources feed one state, so a press seen by both counts once. If macOS disables the tap, the helper re-enables it, and fn keeps working through HID meanwhile.
- **Active, but it swallows one key.** The tap is active only so that Esc can cancel a recording without reaching the app you're typing in. It swallows Esc only while recording and passes everything else through. The callback compares a few values against state the main process pushed beforehand and never waits for Electron, so it can't add typing lag.
- **Keys that type nothing.** fn and the right-hand ⌥, ⌘ and ⌃ produce no characters on their own, so passing them through is harmless. Pressing another key while one is held (fn+arrow, ⌘C) cancels the dictation instead of blocking the shortcut.
- **A testable state machine.** Hold, double-tap, tap to stop and cancel live in a pure `Hotkey` class that takes timestamps as input, so every edge case is a unit test without timers. The 150 ms minimum hold and the 300 ms double-tap window were tuned by feel; the window never delays push-to-talk, only the discarding of a stray tap.
- **One permission.** Accessibility was needed anyway for pasting, and on macOS 14.7 it also unlocked keyboard listening, verified with fresh app identities that only had Microphone and Accessibility. macOS refused the Input Monitoring request without listing the app, so asking for it would have been a step users couldn't finish.

## 3. Audio capture and voice activity detection

**Choice:**
- Capture: `getUserMedia` in a hidden renderer, via an AudioWorklet at 16 kHz mono.
- Voice activity detection: whisper.cpp's built-in Silero, used only to trim silence and to skip empty recordings.

**Alternatives considered:** capture in the Swift helper (AVAudioEngine); a native Node audio module; Silero in the renderer; an energy gate.

**Rationale:**

- **Chromium already does the hard parts.** `getUserMedia` handles device selection and unplugging, and an `AudioContext` created at 16 kHz, Whisper's input rate, does the resampling. Echo cancellation, noise suppression and automatic gain are off, so Whisper hears the raw signal.
- **It keeps the helper small.** Capturing in the Swift helper would mean handling device changes by hand and streaming binary audio over stdio. A native Node audio module would add a dependency for nothing the renderer can't already do.
- **The microphone is open only while dictating.** It opens on key down and its tracks stop on release, so the system's microphone indicator means a dictation is in progress. The benchmark is recorded through this same path, so anything lost at the start of a take shows up in its numbers.
- **Voice detection has two jobs, and segmentation isn't one of them.** In push-to-talk, the key release already ends the utterance. Voice detection trims leading and trailing silence, so less audio is transcribed, and skips transcription when a press held no speech, because Whisper tends to invent text for silence.
- **Silero inside whisper.cpp** runs in the speech process with no new dependency. Silero in the renderer would need an ONNX runtime, and an energy gate is fooled by background noise. The overlay's level meter is a separate, cheap `AnalyserNode` reading.

## 4. Speech-recognition runtime and models

**Choice:**
- Runtime: whisper.cpp (pinned release, Metal) inside a dedicated Swift process that keeps models loaded.
- Swedish model: kb-whisper-medium (q5_0).
- English model: whisper large-v3-turbo (q5_0).
- kb-whisper-large (q5_0) as an optional higher-accuracy model.

**Alternatives considered:** a Node binding for whisper.cpp in a utility process; the whisper.cpp HTTP server; WhisperKit (Core ML).

**Rationale:**

- **whisper.cpp** is mature, runs on Metal, and loads the quantised ggml files that KB-Whisper is published in. It's a submodule pinned to a release, so every build compiles the same code.
- **An own process gets the whole C API.** Swift imports `whisper.h` directly, which gives the per-language probabilities that routing needs (decision 5), the built-in voice detection, the prompt and the decoder settings. A Node binding exposes what its author chose and can lag behind upstream. The HTTP server has no detection-only call and serves one model per process. Both models stay loaded and are warmed up at start, so no dictation waits for a load.
- **WhisperKit** would mean converting KB-Whisper to Core ML with Python tools, a compile on first run, and a second model format to maintain.
- **KB-Whisper medium is the Swedish default.** On everyday Swedish it made a third of stock Whisper's errors (0.8% against 2.3%) at a median of 1.1 s. On the main set, where every Swedish sentence contains an English brand name, it fails against stock Whisper (7.8% against 2.1%); the dictionary brings that to 5.0%. KB-Whisper large is better on those terms and on mixed speech (3.5% and 5.5% on the main set), at about 0.3 s more per dictation, so it is one switch away rather than the default.
- **English stays on stock large-v3 turbo,** so English results are identical to stock Whisper (1.3% for both).
- **q5_0** keeps each default model under 600 MB (KB-Whisper medium 539 MB, turbo 574 MB), and the speech process uses about 1.7 GB with both loaded. The benchmark didn't compare quantised and full-precision models.

## 5. Language handling

**Choice:** Automatic detection restricted to Swedish and English, routing to the Swedish or English model, with a manual override (Auto / Svenska / English).

**Alternatives considered:** a separate hotkey or setting per language; one model for everything.

**Rationale:**

- **One specialised model per language.** KB-Whisper is the better Swedish model and stock turbo the better English one (decision 4), so each dictation goes to the model for its language.
- **Only two languages are compared.** Whisper's language head scores about a hundred languages, and Swedish speech puts probability on Norwegian and Danish. Routing uses only p(sv) / (p(sv) + p(en)), so that probability can't misroute a dictation: 0.65 or more goes to Swedish, 0.35 or less to English, and anything between counts as ambiguous.
- **Short or ambiguous dictations reuse the last language.** Detection is unreliable on very short clips, so dictations with less than 1.2 s of speech skip it and use the previous dictation's language, or Swedish if there is none. People tend to stay in one language from one dictation to the next.
- **Measured:** all 12 Swedish and all 12 English benchmark sentences went to the right model.
- **Checked on new data before shipping.** Sending confidently Swedish clips to turbo would have passed every criterion on the main set, but that rule was chosen after looking at those sentences. On the held-out set's everyday Swedish, turbo made four times as many errors as KB-Whisper medium, so the rule was dropped.
- **The override** (Auto, Svenska, English) covers what detection gets wrong without a second key to remember. A key or setting per language would add a decision to every dictation, and one model for everything would give up either Swedish or English accuracy.
- **Limit:** one dictation goes to one model, so a take that switches language can garble the part in the other language. Detecting per segment is the likely fix.

## 6. Text cleanup

**Choice:** a hybrid pipeline.
1. Conservative rules always run (unambiguous fillers, spacing, capitalisation).
2. An optional local LLM pass follows, accepted only if its output passes a deletion-only check. Otherwise the rule output is used. Each deleted run must also be fillers or a self-correction (a correction phrase plus the words it takes back); any other deleted words are kept.
3. Dictionary replacements are applied deterministically at the end. The same terms are passed to Whisper as a prompt.

Model runtime: Gemma 4 E2B (QAT, q4_0) in a dedicated Swift process that links a pinned llama.cpp release with Metal. It is part of the first-run download, and the pass can be switched off under Smart cleanup (on by default).

**Alternatives considered:** rules only; LLM only. For the runtime: node-llama-cpp in a utility process; Ollama. For enforcing deletion-only output: a grammar that only allows subsequences of the input during decoding.

**Rationale:**

- **Rules alone don't generalise.** When the cleanup model was chosen, a rule baseline written alongside the first sample set fell from 8/10 to 3/10 on new phrasing, and it deleted *typ* and *like* where they were real words. So the rules only remove hesitation sounds that are never words, and they always run.
- **A model alone isn't safe.** Of six local models, those of 2B parameters or fewer translated, kept the wrong option or rewrote commands, and even the best changed the meaning of one output in 20.
- **So the model only chooses deletions.** Its text never reaches the user: the reply must be the input with words removed, and the output is rebuilt from the input's own words. A translation, a rewrite or an added word is rejected by construction. A deletion can still be wrong, by dropping a real word or the instruction in "Write a short reply to Sarah…", so every deleted run must be fillers or a correction phrase with the words it takes back, and any other run is put back. A pass that deletes more than half of a longer transcript is rejected.
- **Measured:** 16 of 20 eval samples pass, no meant word was lost, all four controls were left as dictated, and the words left in fell from 38% to 10% of the meant text. Every failure leaves words in rather than losing any.
- **The grammar was tried and dropped.** Constraining decoding to subsequences of the input made greedy decoding fall back to the next input word whenever the model wanted to rewrite, and that was often the word being taken back. It scored 7/10 and 6/10, against 8/10 and 7/10 for free generation followed by the check.
- **Gemma 4 E2B** tied for the best pass rate (15 of 20, with qwen3:4b), failed almost only by leaving taken-back words in, and was faster (about 0.22 s against 0.31 s warm).
- **Its own Swift process,** for the same reasons as speech recognition: one protocol, build and supervisor, crash isolation, and direct control of llama.cpp. The fixed prompt is processed once and cached, a warm-up at start compiles the GPU paths, and a deadline is checked after every token. whisper.cpp and llama.cpp each bundle their own ggml, so they can't share a process. node-llama-cpp is a large native npm dependency with less control, and Ollama is a separate install with its own versions and model storage.
- **Latency:** the model's median time is 0.22 s, inside a 1.5 s budget after which the rule output is used. Dictations of about 100 words exceed the budget today and get rules only.
- **The dictionary runs last and deterministically,** so a term is spelled the user's way whatever the model did. Its terms also go to Whisper as a prompt; on the main set, the dictionary raised terms spelled right from 22 to 28 of 36.

## 7. Insertion

**Choice:** Clipboard snapshot, then a synthetic Cmd+V, then a guarded clipboard restore, with a small per-app table: in terminals newlines become spaces, and Chromium and Electron apps get a longer restore delay.

**Alternatives considered:** setting the focused element's value through Accessibility; synthesizing keystrokes.

**Rationale:**

- **Paste works everywhere.** Native apps, browsers, Electron apps and terminals all support ⌘V, and the text goes in through the app's own paste handling: one undo step, and web inputs fire their normal events. One code path covered Terminal, Chrome and Electron apps in testing.
- **Accessibility writes** work in native Cocoa fields, but Chromium and Electron apps often ignore them, terminals have no writable field, and they bypass the app's own input handling.
- **Synthesised typing** leaves the clipboard alone, but it's slow for long text, collides with auto-closing brackets, autocomplete and input methods, and turns a newline into Enter.
- **The clipboard is the price, so it's guarded.** Every item is saved with all its types, so a copied image or rich text survives. It's restored only if the pasteboard's change count is still ours, so anything the user copies in the meantime wins. Password-manager content is never restored, and the dictated text is marked transient so clipboard managers skip it.
- **Per-app rules are data, keyed by bundle ID.** In a terminal a newline would run the command, so newlines become spaces. Chromium and Electron apps read the pasteboard asynchronously after ⌘V, so they get 800 ms before the restore instead of 400 ms.
- **Limits:** the dictation sits on the clipboard for those 0.4–0.8 s, content an app only provides on demand can't be saved, and nothing confirms that the paste landed.

## 8. Overlay

**Choice:** A click-through, non-focusable Electron panel shown without activation. A native non-activating panel is the fallback if the overlay ever needs to be clickable.

**Alternatives considered:** native non-activating `NSPanel` from the start; a clickable window that re-activates the previous app.

**Rationale:**

- **The paste goes to the frontmost app,** so the overlay must never become the key window or activate Diktatorn. If it did, the text would land in the overlay, or nowhere.
- **Electron does it with public APIs.** `type: "panel"` makes it an NSPanel, `focusable: false` keeps it from becoming key, `showInactive()` shows it without activating the app, and `setIgnoreMouseEvents(true)` passes clicks through to the window underneath. It floats at screen-saver level on every Space, full-screen apps included.
- **It stays in the app's UI stack.** The overlay is HTML and CSS with the same tokens as the app window. A native `NSPanel` would mean a second UI toolkit and styling system, for interactivity the overlay doesn't need: Esc and the dictation key already cancel and stop.
- **Re-activating the previous app** after a click causes a focus flicker, and some apps reset the caret or selection.
- **Checked, not assumed.** The log records the frontmost app right before every paste. In live testing, every insert landed in the app being typed in while the overlay was showing.
- **Created once.** The window is made hidden at startup and reused, so a key press never waits for a new window.
- **Limit:** there's no automated test, because it needs a real window server.

## 9. Storage

**Choice:**
- JSON files for settings and the dictionary, written atomically.
- No history on disk: recent dictations are kept in memory for the current session only. No audio is stored, except benchmark takes recorded on purpose in a development build.

**Alternatives considered:** SQLite history (`node:sqlite`); JSONL history; SQLite for everything.

**Rationale:**

- **Settings are small and meant to be readable,** so a JSON file is enough. Writes go to a temporary file in the same folder that is renamed into place, so a crash leaves the old file or the new one, never half of each. Reading is forgiving per field: an invalid value falls back to its own default, so a hand edit or a version change can't stop the app from starting.
- **The dictionary is the user's own content,** so it's read more carefully: if the file can't be parsed, the last good entries stay in effect instead of the dictionary being emptied. It's re-read when the file changes, so hand edits apply to the next dictation.
- **No history, because dictated text is private.** Dictations can be messages, notes or anything else a person says, and text that is never written down has nothing to protect, purge or explain. The privacy promise stays simple to check: Diktatorn writes three things to disk. The recent list in the window covers copying a dictation again during the same session.
- **SQLite history** was the original plan, but to be worth having it would need retention limits, a delete-all control and search. JSONL would be simpler, with the same privacy cost. If a saved history ever comes, it's a new decision with retention built in.
- **SQLite for settings** would make them harder to read and edit by hand.

## 10. Speech engine boundary

**Choice:**
- An utterance-level interface behind a process boundary: `ensureLoaded`, `speechSegments`, `detectLanguage`, `transcribe` and `close`.
- The engine provides mechanisms only. Policy (silence trimming, the empty-recording gate, language routing) lives in the caller.
- A future meeting mode reuses it by segmenting audio before calling `transcribe`.

**Alternatives considered:** a streaming session API; a local HTTP service.

**Rationale:**

- **One press, one call.** Push-to-talk produces one utterance per key press, so an utterance call is the exact fit. whisper.cpp has no true streaming, so a streaming API would re-decode a growing buffer: complexity with no gain for dictation.
- **Mechanisms in the engine, policy in TypeScript.** The engine finds speech, scores languages and transcribes. Thresholds, the trimming pad, the empty-recording gate and routing live in `dictation.ts`, `language.ts` and `audio.ts`, where routing and trimming are unit-tested without models, and the Swift process stays small.
- **The benchmark runs the same code.** It imports `transcribeUtterance` and the same engine class as the app, so it measures what ships.
- **Meeting mode fits without a new API.** Continuous capture plus a segmenter outside the engine can send each segment to `transcribe`, and segments come back with timestamps for alignment.
- **A local HTTP service** would add a port that any local process can reach, and with it the question of authentication on localhost, with no user for it.

## 11. Packaging and signing

**Choice:**
- `npm run package`: Electron Packager, a `.dmg` made with `hdiutil`, and its SHA-256. Apple Silicon only.
- Signed with a self-signed code-signing certificate, under the hardened runtime. macOS ties privacy permissions to the designated requirement, which is then "this bundle identifier, signed by this certificate", so an update keeps Accessibility.
- Not notarized: each downloaded version is opened once through Privacy & Security → Open Anyway.
- Electron fuses: running as Node, `NODE_OPTIONS` and `--inspect` are off, and the app only loads its integrity-checked asar. The packaged app also refuses command-line switches, because none of the fuses covers Chromium's remote debugging. Together they stop other programs from using Diktatorn's permissions by starting it with different settings. They don't stop a program that can change files inside the installed app, for example by replacing a helper.
- Library validation is off (`disable-library-validation`). It only lets the app load code signed with the app's own Team ID, and a self-signed certificate has none, so the app couldn't load Electron. The hardened runtime still ignores `DYLD_*` variables.
- Development builds run as Diktatorn Dev, with their own bundle identifier. That copy of Electron runs any app directory it is given, so it must not satisfy the permissions people grant the release.
- The release key lives in a keychain of its own: off the search list, and locked except while `npm run package` signs. Whoever can sign with it can ship an update that keeps every user's Accessibility, and in the login keychain any program running as the developer could do that without a prompt. Development builds are signed with a separate certificate, so they never need the release key.

**Alternatives considered:** Developer ID signing and notarization (needs the paid Apple Developer Program); ad-hoc signing (the requirement pins one build's cdhash, so every update loses Accessibility); electron-builder.

**Rationale:**

- **Permissions have to survive updates.** Diktatorn does nothing without Accessibility, and asking for it again after every update would teach people to click through the prompt. In a test, an update signed with the same certificate kept every permission without a prompt, while an ad-hoc build of the same app lost Accessibility.
- **A certificate of its own instead of Developer ID.** Developer ID and notarization need a paid membership, which a free project shouldn't depend on. The cost is macOS's warning, once per downloaded version, and the README walks through Open Anyway. Moving to Developer ID later would change the designated requirement, so every user would allow Diktatorn once more.
- **Nothing else may drive the app.** With Accessibility a program can type into any app, and with the microphone it can listen. A program that could start Diktatorn as plain Node, with `NODE_OPTIONS` or under a debugger would run its own code with those permissions. The fuses close Electron's routes. Remote debugging has none, and in review `--remote-debugging-port` did open a debugging port on the signed build, so the packaged app refuses every command-line argument. Opening it from Finder passes none.
- **A release can be checked and traced.** The .dmg comes with its SHA-256, the README shows how to check the certificate with `codesign`, and every release records the commit it was built from and refuses uncommitted changes. Someone deciding whether to grant Accessibility to a stranger's app can check what they got.
- **Electron Packager and `hdiutil`** do exactly the steps needed, in one script: package, sign every binary from the innermost out, check that the signed app and both engines start, and build the .dmg. electron-builder adds auto-update, installers and publishing, none of which Diktatorn uses: it never checks for updates.
- **Apple Silicon only,** because the native engines are built for arm64 with Metal, and that's the only hardware the timings were measured on.
