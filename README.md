<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/header-dark.svg">
    <img src="docs/images/header-light.svg" alt="Diktatorn" width="440">
  </picture>
</h1>

Local dictation for macOS that speaks Swedish first and English too. Hold **fn**, talk, release, and the text appears wherever you were typing. Speech recognition, language detection and text cleanup all run on your Mac: no account, no cloud service, and no audio ever leaves the machine.

- **Swedish and English, detected for every dictation.** Swedish goes to [KB-Whisper](https://huggingface.co/KBLab/kb-whisper-medium), the National Library of Sweden's Whisper model trained on Swedish speech. English goes to Whisper large-v3 turbo.
- **Cleanup that cannot put words in your mouth.** Hesitations (*eh*, *öh*, *um*) and self-corrections (*klockan tre, nej förlåt, fyra*) are removed by a small local language model, Gemma 4 E2B. Its answer is only used to decide which of your words to delete. Anything that adds, changes or reorders a word is rejected.
- **Your words, spelled your way.** A personal dictionary fixes terms the recogniser gets wrong and nudges it towards them in the first place.
- **Works in every app.** Text is pasted into the focused field and your clipboard is put back afterwards.
- **Push-to-talk or hands-free.** Hold the key to talk, double-tap for hands-free, Esc to cancel. The key can be fn or a right-hand ⌥, ⌘ or ⌃.

<!-- bench:start -->
## Benchmark

Word error rate (lower is better) on 54 sentences read by one speaker on an M1 Max, compared with stock Whisper large-v3 turbo on the same recordings. The method, every transcript, and how to reproduce it are in [bench/](bench/README.md).

**Main set:** 36 sentences, each with an English technical term.

| | Swedish | English | Mixed | Terms spelled right | Median time |
|---|---:|---:|---:|---:|---:|
| Stock Whisper large-v3 turbo | 2.1% | 1.3% | 42.1% | 29/36 | 0.9 s |
| **Diktatorn** | 7.8% | 1.3% | 22.0% | 22/36 | 1.1 s |
| Diktatorn + dictionary | 5.0% | 1.3% | 18.3% | 28/36 | 1.1 s |
| Diktatorn with KB-Whisper large | 3.5% | 1.3% | 5.5% | 24/36 | 1.4 s |

**Held-out set:** 12 everyday Swedish sentences and 6 more mixed ones, recorded later to check decisions made on the main set.

| | Swedish | Mixed | Median time |
|---|---:|---:|---:|
| Stock Whisper large-v3 turbo | 2.3% | 16.0% | 0.9 s |
| **Diktatorn** | 0.8% | 19.8% | 1.1 s |
| Diktatorn with KB-Whisper large | 1.5% | 18.5% | 1.5 s |

**What the numbers show:**
- **Everyday Swedish:** Diktatorn makes a third of stock Whisper's errors.
- **English brand names inside Swedish speech** are its weak spot: KB-Whisper writes *Postgress QL* and *Versel*. Adding the terms to the dictionary fixes some of them, and KB-Whisper large fixes most.
- **Mixed Swedish and English:** stock Whisper often translates one language into the other ("It only happens on mobile" became "Det sker bara på mobilen"). Diktatorn did that less on the main set but not on the held-out set. Over all 18 mixed sentences, its error rate is 21% against stock Whisper's 34%, and 10% with KB-Whisper large.
- **English** is the same model either way, so the result is identical.
- **Acceptance criteria**, set before measuring (English no worse than stock, Swedish and mixed better): English passes. Mixed passes on the main set. Swedish fails on the main set because of the technical terms, and passes on everyday Swedish.
- **Medium is the default** because it is fast and best on everyday Swedish. KB-Whisper large is one switch away under Models, for better terms and mixed speech at about 0.3 s more per dictation.
- **Sample size:** one speaker and 54 sentences, so differences of a word or two are noise.
<!-- bench:end -->

## Cleanup eval

Cleanup is measured on its own on 20 transcripts with hesitations, fillers and self-corrections in Swedish and English. Four of them are controls: two dictated instructions that must not be carried out, and *typ* and *like* used as real words. The method, every output, and how the model was chosen are in [bench/cleanup/](bench/cleanup/README.md).

| | Pass | Words lost | Words left in | Median model time |
|---|---:|---:|---:|---:|
| Raw transcript | 3/20 | 0 | 37.7% | – |
| Rules only | 3/20 | 0 | 33.2% | – |
| **Diktatorn** | 16/20 | **0** | 10.4% | 0.24 s |

- **No meant word was deleted** in any sample, and all four controls were left as dictated. These are the eval's pass criteria.
- **Words left in fall from 38% to 10% of the meant text.** In each of the four failures, words were left in and none were lost. Twice the model deleted only a correction phrase and kept what it took back; the guard then put the phrase back, so the text shows the correction instead of silently keeping the wrong value.
- **Model choice:** six local models were compared on the same samples. Gemma 4 E2B tied for the best pass rate and was the only one whose failures almost never changed the meaning.
- **Regression sets:** the samples were written before the model was chosen, but the pipeline was built with them in view, so they catch regressions rather than measure how cleanup generalises.

## Install

Diktatorn needs an Apple Silicon Mac with macOS 14 or later.

1. Download `Diktatorn-<version>-arm64.dmg` from the [latest release](https://github.com/rozenodig/Diktatorn/releases/latest). To check it, put the `.sha256` file from the same release next to it and run `shasum -a 256 -c Diktatorn-<version>-arm64.dmg.sha256`.
2. Open the .dmg and drag Diktatorn to Applications.
3. Open Diktatorn. macOS says *"Diktatorn" can't be opened because Apple cannot check it for malicious software.* Close the message.
4. Go to System Settings → Privacy & Security, scroll down to Security and click **Open Anyway** next to the message about Diktatorn, then confirm. On macOS 14 you can instead Control-click Diktatorn in Applications and choose **Open**.

**Why the warning:** Apple only stops showing it for notarized apps, and notarizing needs a paid developer account. Diktatorn is signed with its own certificate instead. macOS ties Diktatorn's permissions to that certificate, so an update keeps them, but each newly downloaded version has to be opened this way once.

**Updating:** Diktatorn never checks for updates (see [Privacy](#privacy)). To update, quit it from the menu bar, download the new release and replace the app in Applications. Microphone and Accessibility stay allowed.

**First launch:**
- It downloads about 4.5 GB of models from Hugging Face. Each one is pinned to a fixed commit and checked against its SHA-256 before use, and an interrupted download resumes where it stopped.
- macOS asks for two permissions, each explained under [Privacy](#privacy). The first-run screen lists them, with a button that opens the right pane of System Settings, and marks each one as allowed as soon as you switch it on.

### From source

**Requirements:**
- Node.js 24+;
- the Xcode Command Line Tools (`xcode-select --install`);
- CMake.

```sh
git clone --recurse-submodules https://github.com/rozenodig/Diktatorn.git
cd Diktatorn
npm install
npm run build:native   # whisper.cpp, llama.cpp and the three Swift helpers
npm start
```

Development builds run as `build/Diktatorn.app`, called Diktatorn Dev in the permission prompts. Their permissions are separate from an installed release's.

## Hardware

Measured on an M1 Max with 64 GB:
- **Memory:** the speech process uses about 1.7 GB. The cleanup model memory-maps its 3.3 GB file, which macOS can page out under pressure.
- **Recommended:** 16 GB. On 8 GB, turning off Smart cleanup should help, but that hasn't been tested.
- **Timing:** the median from releasing the key to text, including cleanup, is 1.1 s with the default Swedish model and about 1.5 s with KB-Whisper large.
- **Not measured:** base M1 and M2 chips will be slower.

## Privacy

**Audio.** Diktatorn listens only while you hold the dictation key, or while hands-free mode is on. The audio stays in memory, is transcribed on your Mac and is then discarded. It is never written to disk.

**Network.** The only network requests are model downloads from Hugging Face, on first launch and when you pick another model. There's no telemetry, analytics, crash reporting, account or update check.

**Permissions:**

| Permission | Why |
|---|---|
| Microphone | To hear you while you dictate. |
| Accessibility | To notice the dictation key, to paste with ⌘V, and to keep Esc from reaching the app you're typing in while it cancels a dictation. The helper reports only the dictation key, Esc, and "another key was pressed", never which keys you type. Without Accessibility, the dictation key doesn't work and transcripts are left on the clipboard. |

**Clipboard.**
- Your clipboard is restored after each paste, unless you copied something new in the meantime.
- Content from password managers is never restored.
- Dictated text is marked as transient, so clipboard managers don't keep it.

**Stored on disk.** `~/Library/Application Support/Diktatorn` holds three things: `settings.json`, `dictionary.json` and the models. Recent dictations are shown for the current session only and are never saved.

## Architecture

```mermaid
flowchart LR
  subgraph Electron
    main["Main process (TypeScript)<br/>dictation pipeline, cleanup, settings, downloads"]
    capture["Capture window<br/>16 kHz microphone audio"]
    ui["App window · overlay · menu bar"]
  end
  helper["diktatorn-helper (Swift)<br/>dictation key, Esc, paste, clipboard"]
  asr["diktatorn-asr (Swift + whisper.cpp)<br/>voice detection, sv/en detection, transcription"]
  llm["diktatorn-llm (Swift + llama.cpp)<br/>cleanup model"]
  capture -- audio --> main
  main <-- JSON lines --> helper
  main <-- JSON lines --> asr
  main <-- JSON lines --> llm
  main --> ui
```

**One dictation, step by step:**
1. **Key down:** the microphone opens.
2. **Key up:** voice detection trims the silence.
3. **Language:** Swedish or English is detected (only those two are compared).
4. **Transcription:** KB-Whisper for Swedish, Whisper large-v3 turbo for English.
5. **Hesitation rules.**
6. **Cleanup model:** a deletion-only pass with a guard.
7. **Dictionary:** your terms are applied.
8. **Paste:** the text goes into the frontmost app and the clipboard is restored.

**Why separate processes:**
- Each native part runs in its own process and talks newline-delimited JSON over stdin/stdout. A crash in a model can't take the app down; the process is restarted after a crash.
- whisper.cpp and llama.cpp each bundle their own copy of ggml, so they can't share a process anyway.

**Where things live:**

| Path | What |
|---|---|
| `src/main` | Electron main process: dictation pipeline, hotkey state machine, cleanup, settings, model downloads |
| `src/renderer` | App window, overlay, debug window, microphone capture |
| `native/helper` | Swift: dictation key (event tap and HID), Esc, paste and clipboard restore |
| `native/asr`, `native/llm` | Swift processes linking whisper.cpp and llama.cpp (git submodules in `native/vendor`) |
| `bench` | Speech recognition benchmark, and the cleanup eval in `bench/cleanup`: samples, harnesses and results |
| `test` | Unit tests, plus integration tests that run the real models |

Every design choice, with the alternatives considered, is recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Development

```sh
npm test               # unit and integration tests (integration tests skip if models are missing)
npm run typecheck
npm run bench          # accuracy benchmark, see bench/README.md
npm run bench:cleanup  # cleanup eval, see bench/cleanup/README.md
npm run package        # release .dmg and its SHA-256 in build/release
```

**Release builds** are signed with a certificate called "Diktatorn Code Signing", which `scripts/create-signing-identity.sh` creates in your login keychain. A build signed with your own certificate works, but macOS keeps one permission entry per app, so installing it over an official release, or the other way round, means allowing Microphone and Accessibility again. `npm run package` starts the signed app once before it writes the .dmg, to check that it launches.

The debug window (menu bar icon → Debug Window) shows each dictation's raw and cleaned transcript, the language decision and per-stage timings.

## Limits

- **macOS on Apple Silicon only.**
- **One dictation, one language.** A dictation that switches language goes to one model, so it can garble the part in the other language.
- **Cleanup only deletes.** It never fixes grammar or rewrites.

## Licence

Diktatorn is licensed under the [GNU General Public License v3.0](LICENSE). You may use, study, change and share it. Anything you distribute that is based on it must be released under the same licence, with its source code.

## Credits

[whisper.cpp](https://github.com/ggml-org/whisper.cpp) and [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT); [KB-Whisper](https://huggingface.co/KBLab) by KBLab, National Library of Sweden (Apache-2.0); [Whisper](https://github.com/openai/whisper) by OpenAI (MIT); [Silero VAD](https://github.com/snakers4/silero-vad) (MIT); [Gemma 4](https://huggingface.co/google) by Google (Apache-2.0); [Electron](https://www.electronjs.org) (MIT).
