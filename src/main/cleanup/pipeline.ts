// Cleanup pipeline: conservative rules, then the optional language-model pass, then the user
// dictionary. The model's answer is only used to decide which words to delete; it is
// rejected unless it is the rule output with words removed, and the rule output is used
// instead whenever the model is off, slow, wrong or failing. Each deleted run must then be
// fillers or a self-correction, and any other run is put back.
import { applyDictionary, type DictionaryEntry } from "./dictionary.ts";
import type { Cleaner } from "./llm.ts";
import { applyRules, isHesitation } from "./rules.ts";
import { bareWord, joinKept, keptWords, splitWords } from "./words.ts";

/** After this, the language-model pass is abandoned and the rule output is used. */
export const LLM_TIMEOUT_MS = 1500;
/** Shorter transcripts rarely contain a self-correction, and the pass would only add latency. */
const MIN_LLM_WORDS = 4;
/** A cleanup that deletes more than this share of a longer transcript is assumed to be wrong. */
const MAX_DELETED_SHARE = 0.5;
const LONG_TRANSCRIPT_WORDS = 8;
/** Ways speakers take something back. Any deletion other than fillers must contain one, plus the
 * words it takes back: otherwise the model has dropped a real word ("however"), hidden a
 * correction by deleting only the cue, or acted on the text (answered or carried out an
 * instruction) instead of cleaning it, and those words are kept. */
const CORRECTION_CUES = [
  "nej", "förlåt", "menar", "vänta", "stryk det", "rättare sagt",
  "no wait", "wait no", "actually", "sorry", "i mean", "i meant", "scratch that", "make that", "rather",
].map((cue) => cue.split(" "));
const FILLER_WORDS = new Set(["typ", "liksom", "alltså", "ba", "ja", "like", "you", "know"]);

export type LlmStatus = "accepted" | "unchanged" | "skipped" | "rejected" | "timeout" | "error";

export interface CleanupResult {
  text: string;
  rulesText: string;
  llm: { status: LlmStatus; ms: number; detail: string } | null;
  ms: number;
}

export interface CleanupOptions {
  dictionary: DictionaryEntry[];
  llm: Cleaner | null;
  llmTimeoutMs: number;
}

export async function cleanUp(raw: string, opts: CleanupOptions): Promise<CleanupResult> {
  const t0 = performance.now();
  const rulesText = applyRules(raw);
  let text = rulesText;
  let llm: CleanupResult["llm"] = null;

  if (opts.llm) {
    const words = splitWords(rulesText);
    if (words.length < MIN_LLM_WORDS) {
      llm = { status: "skipped", ms: 0, detail: `fewer than ${MIN_LLM_WORDS} words` };
    } else {
      const t = performance.now();
      try {
        const out = await opts.llm.clean(rulesText, opts.llmTimeoutMs);
        const ms = performance.now() - t;
        const keep = keptWords(words, splitWords(out.text));
        const kept = keep?.filter(Boolean).length ?? 0;
        if (out.stop !== "eog") {
          llm = { status: out.stop === "timeout" ? "timeout" : "rejected", ms, detail: `stopped: ${out.stop}` };
        } else if (!keep || kept === 0) {
          llm = { status: "rejected", ms, detail: `not a deletion of the input: ${out.text}` };
        } else if (words.length >= LONG_TRANSCRIPT_WORDS && kept < words.length * (1 - MAX_DELETED_SHARE)) {
          llm = { status: "rejected", ms, detail: `would delete ${words.length - kept} of ${words.length} words` };
        } else if (kept === words.length) {
          llm = { status: "unchanged", ms, detail: "" };
        } else {
          const checked = restoreUnexplained(words, keep);
          const deleted = checked.keep.filter((k) => !k).length;
          const restored = checked.restored.map((run) => `"${run}"`).join(", ");
          const putBack = `put back ${restored}: neither fillers nor a correction phrase with the words it takes back`;
          if (deleted === 0) {
            llm = { status: "rejected", ms, detail: putBack };
          } else {
            text = joinKept(words, checked.keep);
            const note = restored ? `; ${putBack}` : "";
            llm = { status: "accepted", ms, detail: `deleted ${deleted} of ${words.length} words${note}` };
          }
        }
      } catch (err) {
        llm = { status: "error", ms: performance.now() - t, detail: String(err) };
      }
    }
  }

  text = applyDictionary(text, opts.dictionary);
  return { text, rulesText, llm, ms: performance.now() - t0 };
}

/**
 * The deletion with every run that is neither all fillers nor a correction phrase with what it
 * takes back put back, and the runs that were put back.
 */
export function restoreUnexplained(words: string[], keep: boolean[]): { keep: boolean[]; restored: string[] } {
  const out = [...keep];
  const restored: string[] = [];
  for (let i = 0; i < words.length; ) {
    if (keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < words.length && !keep[end]) end++;
    const run = words.slice(i, end);
    if (!isFillerRun(run) && !isCorrection(run)) {
      out.fill(true, i, end);
      restored.push(run.join(" "));
    }
    i = end;
  }
  return { keep: out, restored };
}

function isFillerRun(run: string[]): boolean {
  return run.every((w) => isHesitation(w) || FILLER_WORDS.has(bareWord(w)));
}

/** A correction phrase plus at least one word that is neither part of it nor a filler. */
function isCorrection(run: string[]): boolean {
  const bare = run.map(bareWord);
  const inCue = bare.map(() => false);
  for (let i = 0; i < bare.length; i++) {
    for (const cue of CORRECTION_CUES) {
      if (cue.every((w, j) => bare[i + j] === w)) cue.forEach((_, j) => (inCue[i + j] = true));
    }
  }
  return inCue.includes(true) && run.some((w, i) => !inCue[i] && !isFillerRun([w]));
}
