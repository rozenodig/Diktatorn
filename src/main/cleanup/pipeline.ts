// Cleanup pipeline: conservative rules, then the optional language-model pass, then the user
// dictionary. The model's answer is only used to decide which words to delete; it is
// rejected unless it is the rule output with words removed, and the rule output is used
// instead whenever the model is off, slow, wrong or failing.
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
/** Deleting this many words in a row needs a reason: a correction phrase in the deleted run. */
const MIN_RUN_NEEDING_CUE = 3;
/** Ways speakers take something back. A long deletion without one is more likely the model
 * acting on the text (answering or carrying out an instruction) than a self-correction. */
const CORRECTION_CUES = [
  "nej", "förlåt", "menar", "vänta", "stryk det", "rättare sagt",
  "no wait", "wait no", "actually", "sorry", "i mean", "i meant", "scratch that", "make that", "rather",
];
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
        const unexplained = keep && unexplainedDeletion(words, keep);
        if (out.stop !== "eog") {
          llm = { status: out.stop === "timeout" ? "timeout" : "rejected", ms, detail: `stopped: ${out.stop}` };
        } else if (!keep || kept === 0) {
          llm = { status: "rejected", ms, detail: `not a deletion of the input: ${out.text}` };
        } else if (words.length >= LONG_TRANSCRIPT_WORDS && kept < words.length * (1 - MAX_DELETED_SHARE)) {
          llm = { status: "rejected", ms, detail: `would delete ${words.length - kept} of ${words.length} words` };
        } else if (unexplained) {
          llm = { status: "rejected", ms, detail: `deletes "${unexplained}" without a correction phrase` };
        } else if (kept === words.length) {
          llm = { status: "unchanged", ms, detail: "" };
        } else {
          text = joinKept(words, keep);
          llm = { status: "accepted", ms, detail: `deleted ${words.length - kept} of ${words.length} words` };
        }
      } catch (err) {
        llm = { status: "error", ms: performance.now() - t, detail: String(err) };
      }
    }
  }

  text = applyDictionary(text, opts.dictionary);
  return { text, rulesText, llm, ms: performance.now() - t0 };
}

/** The first long deleted run that is neither all fillers nor contains a correction phrase. */
export function unexplainedDeletion(words: string[], keep: boolean[]): string | null {
  for (let i = 0; i < words.length; ) {
    if (keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < words.length && !keep[end]) end++;
    const run = words.slice(i, end);
    const bare = ` ${run.map(bareWord).join(" ")} `;
    const allFillers = run.every((w) => isHesitation(w) || FILLER_WORDS.has(bareWord(w)));
    if (run.length >= MIN_RUN_NEEDING_CUE && !allFillers && !CORRECTION_CUES.some((cue) => bare.includes(` ${cue} `))) {
      return run.join(" ");
    }
    i = end;
  }
  return null;
}
