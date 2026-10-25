# Cleanup eval

Measures how much of the hesitations, fillers and self-corrections Diktatorn's cleanup removes, and whether it ever deletes a word the speaker meant.

- **Results:** [RESULTS.md](RESULTS.md), with every output in [results.json](results.json).
- **How the model was chosen:** [model-selection/](model-selection/README.md).

The cleanup pipeline ([src/main/cleanup](../../src/main/cleanup)) is run on typed transcripts, without speech recognition, so cleanup is judged on its own. The [speech benchmark](../README.md) covers recognition. Its read sentences have almost no hesitations, so there it only shows that cleanup does not damage clean text.

## Samples

[samples.json](samples.json), the main set, has 10 transcripts: 5 Swedish and 5 English, each with fillers, a self-correction and technical terms (*npm run build*, *getUserById*, *kubectl get pods*…).

[heldout.json](heldout.json) has 10 more, with other ways of correcting oneself (*eller förresten*, *nej stryk det*, *make that*, *I meant*, *no wait*) and 4 controls:
- two dictated instructions (*Skriv ett mejl till Lisa…*, *Write a short reply to Sarah…*), which must be cleaned but never carried out;
- *typ* and *like* used as real words, which must stay.

Each sample has an input, a reference (the text the speaker meant), `mustKeep` terms that must survive exactly as written, and `mustRemove` phrases that must be gone: fillers, taken-back words and correction phrases. Cleanup only deletes words, so every reference is its input with words deleted. `npm test` checks that, and that every must-keep term is in its reference and no must-remove phrase is.

**Where the samples come from.** Both sets were written for the [model selection](model-selection/README.md) on 2026-10-18, the held-out set before any model had been run on it. Two things have changed since:
- Four references (en3, en4, en5, h-sv1) were first written for a cleanup allowed to rewrite. Here they are replaced by the best answer reachable by deleting words, and each has a note on why. The originals are in [model-selection/](model-selection/).
- The held-out set was held out from model selection, but not from the pipeline: its prompt examples and the guard's correction cues were written with both sets in view. **For the shipped pipeline, both sets are regression sets,** and they don't show how it does on transcripts it was not built against. That needs a new set, written after the pipeline is frozen.

## Systems

| System | What it is |
|---|---|
| Raw transcript | The input, uncleaned: how much there is to remove. |
| Rules only | The always-on rules, which remove only hesitation sounds that are never words (*eh*, *öh*, *um*): what you get with Smart cleanup off. |
| Diktatorn | As installed: the rules, then the local language model (Gemma 4 E2B) under the deletion guard, with an empty dictionary. **The pass criteria are judged on this system.** |

## Metrics

- **Pass:** every must-keep term is in the output, capitals included, and no must-remove phrase is (whole words, any case).
- **Words lost:** reference words missing from the output. Cleanup only deletes, so these are words the speaker meant that were deleted. This is the error that matters most.
- **Words left in:** output words the reference does not have. These are fillers, taken-back words or correction phrases that were not removed. They make the text less clean, but they don't change what was said.
- Both are counted after the same normalisation as the speech benchmark, and pooled over the set as a share of reference words. There's no WER: output and reference are both deletions of the same input, so every difference is either a lost word or a word left in, and WER would add the two into one number.
- **Guard verdict:** what the pipeline did with the model's answer:
  - *accepted*: the deletions were applied. Any deleted run that is neither fillers nor a correction phrase with the words it takes back is put back, and the verdict names it.
  - *unchanged*: the model deleted nothing.
  - *rejected*: the answer was not a pure deletion, deleted more than half of a longer transcript, or had none of its deletions survive the check, so the rule output is used. A *timeout* also falls back to the rule output.
- **Model time:** the model pass per sample, the median of its runs; the max is over all runs.
- **Runs:** each sample goes through the model 3 times (`--runs`). Decoding is greedy, so the runs should give the same text, and the results say whether they did.

## Pass criteria

Both follow from what the [README](../../README.md) promises about cleanup, and the run exits with status 1 if either fails, so it can gate a change to the prompt, the guard or the model:
- **No word the speaker meant is deleted:** 0 words lost.
- **Every control is left as dictated.**

The pass rate is reported, but it is not a criterion.

## What the results show

From [RESULTS.md](RESULTS.md), run on 2026-10-25:
- **Nothing meant was deleted.** The criteria pass: 0 words lost and 4 of 4 controls intact, with the same text on every run.
- **Most of what should go is removed.** Words left in fall from 48.7% of the reference to 11.3% on the main set, and from 25.9% to 9.4% on the held-out set. 8 of 10 samples pass in each set; with rules alone, 0 and 3 do.
- **All four failures leave words in; none loses any:**
  - **en3:** the model moved *a 400* to where *a 404* was. That is a rewrite, so the guard rejected it.
  - **en5:** the correction rephrases the sentence, and the model kept *Redis*.
  - **h-en4, h-sv1:** the model deleted only the correction phrase and kept the words it took back (*return null*, *ska använda Tailwind*). The guard put the phrase back, so the text still shows that a correction happened instead of hiding it.
- **Known gap:** in h-sv1 even a correct answer would be put back, because *förresten* is not one of the guard's correction cues.
- **Speed:** the model pass takes a median of 237 ms over both sets, at most 352 ms, well inside the 1.5 s after which the rule output is used.

## Limits

- **20 typed transcripts by one author,** not speech recognition output. Real Whisper output is already punctuated and capitalised, and Whisper drops many hesitations itself. Several inputs here are lowercase and unpunctuated. Cleanup adds neither punctuation nor capitals, and the scoring ignores both.
- **Regression sets, not a test of generalisation** (see above).
- **One machine** for the timings, and an empty dictionary.

## Reproduce

1. Build the native processes and download the cleanup model: `npm run build:native && npm run fetch-models -- gemma-4-e2b-it-qat` (or start the app once with Smart cleanup on).
2. Run `npm run bench:cleanup`. `--samples <file>` (repeatable) scores other sets in the same format, `--runs <n>` sets the runs per sample, and `--out <dir>` writes the results elsewhere.
