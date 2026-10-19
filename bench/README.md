# Benchmark

Measures how accurately Diktatorn transcribes Swedish, English and mixed dictation compared with stock Whisper, on the same recordings and the same Mac. The latest numbers are in [RESULTS.md](RESULTS.md); every transcript is in [results.json](results.json).

## Sentences

[sentences.json](sentences.json) has 36 sentences of the kind people dictate at work: 12 Swedish, 12 English, and 12 that switch between the two mid-sentence. Each contains a technical term (GitHub Actions, PostgreSQL, Next.js, npm…), because terms are where dictation most often goes wrong. The sentences avoid digits, contractions and words with two accepted spellings (*i stället* / *istället*, *mejl* / *mail*), so the score counts recognition errors rather than spelling choices.

## Systems

All systems use the same decoder settings and the same whisper.cpp build.

| System | What it is |
|---|---|
| Stock Whisper large-v3 turbo | The whole recording to Whisper large-v3 turbo, which picks the language itself from all the languages it knows. What you get from whisper.cpp out of the box. |
| Diktatorn, recognition only | Silence trimmed by voice detection; the language is detected between Swedish and English only; Swedish goes to KB-Whisper medium, English to Whisper large-v3 turbo. No cleanup. |
| Diktatorn | As installed: the above plus cleanup (hesitation rules and the local language model), with an empty dictionary. **The pass criteria are judged on this system.** |
| Diktatorn + dictionary | The benchmark terms in the dictionary ([dictionary.json](dictionary.json)), spelling only and no spoken forms, as a user who has added the words they use would have it. |
| Diktatorn with KB-Whisper large | As installed, with the larger Swedish model. Only measured when that model is downloaded. |

Each clip is transcribed as a first dictation with no previous one, so a short or ambiguous clip falls back to Swedish.

## Metrics

- **Word error rate (WER):** substitutions, deletions and insertions needed to turn the reference into the transcript, divided by the number of reference words, pooled over all sentences in a group. Before comparing, both texts are lower-cased, hyphens and slashes split words, and punctuation is stripped from the ends of words but kept inside them, so *Next.js* must still come out as one word.
- **Terms spelled right:** the sentence's term appears in the transcript exactly as written, capitals included.
- **Median time:** from the end of the recording to the final text: voice detection, language detection, transcription and cleanup.

## Pass criteria

Against stock Whisper, Diktatorn's WER must be:
- **English:** no higher;
- **Swedish:** lower;
- **mixed:** lower.

## Limits

- **One speaker, one microphone, 36 sentences.** With roughly 150 words per group, one word is about 0.7 percentage points, so small differences are noise.
- **Read speech, not spontaneous speech.** Read sentences have almost no hesitations or self-corrections, so this measures whether cleanup *damages* clean text, not how well it cleans messy text.
- **Turbo as the baseline.** Stock Whisper means large-v3 turbo, the model Diktatorn already uses for English, not the larger and slower large-v3.

## Reproduce

1. Build and start the app once, so the models are downloaded: `npm run build:native && npm start`.
2. Record: menu bar icon → Debug Window → **Start benchmark recording**. Hold the dictation key, read the sentence shown, and release. Takes are saved to `bench/recordings/`, which is not committed.
3. Run `npm run bench`. Use `--recordings <dir>` for another set of takes and `--out <dir>` to write the results elsewhere.
