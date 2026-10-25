// Cleanup eval sample sets and scoring.
//
// A sample is a transcript to clean, the text the speaker meant (the reference), terms that
// must survive and phrases that must be gone. Cleanup only deletes words, so every reference is
// its input with words deleted, and an output can miss it in two ways only: words lost (meant,
// but deleted) and words left in (deleted in the reference, but kept). Lost words change what
// the speaker said; words left in only make the text less clean. The two are counted apart.
import { readFile } from "node:fs/promises";
import { keptWords, splitWords } from "../../src/main/cleanup/words.ts";
import { normalizeWords } from "../wer.ts";

export const CLEANUP_LANGUAGES = ["sv", "en"] as const;

export interface CleanupSample {
  id: string;
  language: (typeof CLEANUP_LANGUAGES)[number];
  input: string;
  reference: string;
  /** Must appear in the output exactly as written, capitals included. */
  mustKeep: string[];
  /** Must not appear in the output as whole words, ignoring case: fillers, taken-back words, correction phrases. */
  mustRemove: string[];
  /** For a control sample: what cleanup must not do to it. */
  control?: string;
  /** Why the reference looks the way it does, where that isn't obvious. */
  note?: string;
}

export interface CleanupSet {
  title: string;
  samples: CleanupSample[];
}

export interface CleanupScore {
  /** mustKeep terms the output lacks. */
  missing: string[];
  /** mustRemove phrases still in the output. */
  leftover: string[];
  /** Reference words. */
  words: number;
  /** Reference words the output lacks. */
  lost: number;
  /** Output words the reference lacks. */
  leftIn: number;
  pass: boolean;
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

export async function loadCleanupSet(path: string): Promise<CleanupSet> {
  const json = JSON.parse(await readFile(path, "utf8")) as { title?: unknown; samples?: unknown };
  if (typeof json.title !== "string" || !Array.isArray(json.samples)) throw new Error(`${path}: expected a 'title' and a 'samples' array`);
  const ids = new Set<string>();
  const samples = json.samples.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const fail = (why: string) => new Error(`${path}: sample ${typeof s.id === "string" ? s.id : i} ${why}`);
    if (
      typeof s.id !== "string" || !/^[\w-]+$/.test(s.id) ||
      !CLEANUP_LANGUAGES.includes(s.language as CleanupSample["language"]) ||
      typeof s.input !== "string" || typeof s.reference !== "string" ||
      !isStrings(s.mustKeep) || !isStrings(s.mustRemove)
    ) {
      throw fail("needs an id, a language (sv, en), an input, a reference, and mustKeep and mustRemove lists");
    }
    const sample = s as unknown as CleanupSample;
    if (ids.has(sample.id)) throw fail("is listed twice");
    ids.add(sample.id);
    // The checks below keep the data consistent with a cleanup that only deletes: a sample that
    // fails them cannot be passed by any such cleanup.
    if (!keptWords(splitWords(sample.input), splitWords(sample.reference))) throw fail("has a reference that is not its input with words deleted");
    const notKept = sample.mustKeep.filter((t) => !sample.reference.includes(t));
    if (notKept.length > 0) throw fail(`has mustKeep terms its reference lacks: ${notKept.join(", ")}`);
    const notRemoved = sample.mustRemove.filter((p) => containsPhrase(sample.reference, p));
    if (notRemoved.length > 0) throw fail(`has mustRemove phrases its reference still contains: ${notRemoved.join(", ")}`);
    return sample;
  });
  return { title: json.title, samples };
}

/** True when the phrase appears as whole words, ignoring case. */
export function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function scoreCleanup(sample: CleanupSample, output: string): CleanupScore {
  const missing = sample.mustKeep.filter((t) => !output.includes(t));
  const leftover = sample.mustRemove.filter((p) => containsPhrase(output, p));
  const ref = normalizeWords(sample.reference);
  const out = normalizeWords(output);
  const common = commonWords(ref, out);
  return {
    missing,
    leftover,
    words: ref.length,
    lost: ref.length - common,
    leftIn: out.length - common,
    pass: missing.length === 0 && leftover.length === 0,
  };
}

/** Length of the longest common subsequence: the words the two texts share, in order. */
function commonWords(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row.push(word === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!));
    prev = row;
  }
  return prev[b.length]!;
}
