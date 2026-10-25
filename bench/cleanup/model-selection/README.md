# Cleanup model selection (archived)

How the cleanup model was chosen, before the cleanup pipeline existed: six small local models, and a naive rule baseline, on the same two sample sets, on 2026-10-18. Kept as it was run; the current pipeline is evaluated in [../README.md](../README.md).

## Setup

- **Runtime:** Ollama 0.40.6 on an Apple M1 Max (64 GB). Temperature 0, thinking off where the model supports it, 3 warm runs per sample after one cold call.
- **Prompt:** one prompt for every model, in [run.mjs](run.mjs): cleanup rules, two worked examples, and the transcript inside `<transcript>` tags. There was no deletion guard yet, so models were free to rewrite.
- **Sets:**
  - [samples.json](samples.json): 10 transcripts, 5 Swedish and 5 English, each with fillers, a self-correction and technical terms. The rule baseline was written while looking at this set, so its score here is biased; the result files call it "tuned".
  - [samples-heldout.json](samples-heldout.json): 10 more, written before any model was run on them and with the rules frozen. They use other correction phrasings and include 4 controls: two dictated instructions that must not be carried out, and *typ* and *like* used as real words.
  - Both are kept exactly as used here. The eval's copies have since been converted to its format, and four references were replaced by answers a deletion-only cleanup can reach.
- **Scoring:** a sample passes when every must-include term is present, capitals included, and nothing from its must-exclude list is left. Mean WER is against the reference, with the harness's own normalisation.

Every output is in [results-tuned.md](results-tuned.md) and [results-heldout.md](results-heldout.md), with raw timings in the matching `.json` files.

## Results

| Model | Pass, tuned | Pass, held-out | Median / p90 warm, tuned | Median / p90 warm, held-out | Cold first call | Meaning-changing outputs (of 20) |
|---|---:|---:|---:|---:|---:|---|
| Rules (naive regex) | 8/10 (biased) | 3/10 | 0 / 7 ms | 0 / 7 ms | – | 4: drops a clause (en3) and a term (en5), deletes the real words *typ* (h-sv4) and *like* (h-en3) |
| qwen3.5:2b-q4_K_M | 4/10 | 6/10 | 207 / 391 ms | 192 / 376 ms | 3.2 s | 3: translates (sv1), keeps the retracted option (sv4), carries out an instruction (h-en2) |
| qwen3:1.7b | 2/10 | 5/10 | 199 / 272 ms | 175 / 230 ms | 2.4 s | 3: keeps only the retracted option and drops the rest (sv5), rewrites a command (en2), carries out an instruction (h-en2) |
| gemma3:1b | 0/10 | 2/10 | 203 / 283 ms | 156 / 275 ms | 1.8–1.9 s | 17: translates every Swedish sample into English, among others |
| qwen3:4b-instruct-2507-q4_K_M | 7/10 | 8/10 | 307 / 408 ms | 304 / 438 ms | 4.3 s | 3: keeps the retracted option (sv1), translates (sv2), carries out an instruction (h-en2) |
| gemma3:4b | 5/10 | 6/10¹ | 302 / 716 ms | 317 / 689 ms | 4.9–5.4 s | 5: keeps the retracted option (sv1, h-sv1), drops a clause (sv2, en3), carries out an instruction (h-en2) |
| **gemma4:e2b-it-qat** | **8/10** | 7/10 | 217 / 469 ms | 230 / 432 ms | 4.1–4.5 s | **1:** keeps the retracted value (h-sv3: *trettio* instead of *sextio*) |

A meaning-changing output says something other than what the speaker meant: it loses content, keeps the retracted option instead of the correction, translates, adds content, or carries out a dictated instruction. Leftover fillers or retracted words next to the correction, digits for spelled-out numbers and changed punctuation are not counted. Each output was classified by reading it; the sample ids point to the rows in the result files.

¹ gemma3:4b fails h-en3 only because it writes a typographic apostrophe (*I’d*), which the strict term check does not accept.

The "Loaded size" column in the result files comes from Ollama's `/api/ps`, which under-reports gemma4:e2b-it-qat (0.23 GB), so it is not comparable across models.

## What it decided

- **Rules don't generalise.** The baseline drops from 8/10 to 3/10 on phrasing it was not written for, and it damages text by deleting *typ* and *like* when they are real words. So the shipped rules only remove hesitation sounds that are never words (*eh*, *öh*, *um*), and everything else is left to the model.
- **Models of 2B parameters or fewer are not usable.** They translate, keep the wrong option, and rewrite commands. The next size up (qwen3:4b, gemma3:4b, gemma4:e2b) is the first usable tier, at about 0.2–0.3 s warm.
- **How a model fails matters more than its pass rate.** gemma4:e2b-it-qat and qwen3:4b-instruct both pass 15 of 20. gemma4 fails almost only by leaving retracted words in, which is safe; qwen3:4b translates and carries out an instruction, which is not. gemma4 is also faster, so it became the cleanup model.
- **No model is safe unguarded.** Even the best changed the meaning of 1 output in 20. That led to the deletion-only guard: the model's answer is only used to choose which dictated words to delete, so a translation or rewrite is rejected by construction.
- **A cold first call takes about 2–5 s,** so the app loads the model when it starts, or when Smart cleanup is turned on, and keeps it loaded.

## Limits

- 20 synthetic transcripts, one prompt, one machine.
- Typed transcripts, not speech recognition output: real Whisper output is already punctuated and capitalised, and Whisper drops many hesitations itself.
- The shipped prompt and pipeline differ from this harness, so these numbers are not comparable with [../RESULTS.md](../RESULTS.md).

## Re-running

Install Ollama 0.40.6, serve it on port 11435 (`OLLAMA_HOST=127.0.0.1:11435 ollama serve`), and pull the six models listed at the top of [run.mjs](run.mjs). Then, from this folder:

```sh
node run.mjs 3 samples.json results-tuned
node run.mjs 3 samples-heldout.json results-heldout
```

Ollama and the model tags change over time, so a re-run may not reproduce these numbers exactly.
