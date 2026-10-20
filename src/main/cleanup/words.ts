// Word-level editing for cleanup. Every cleanup step only marks whole words for deletion, so
// the result can never contain a word that was not dictated; punctuation and capitalisation
// are then repaired around each deleted run.

const TRAILING_PUNCTUATION = /[,.;:!?…]+$/;
const SENTENCE_END = /[.!?…]$/;

export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** The word without surrounding punctuation, lowercased, for matching. */
export function bareWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

/**
 * Joins the kept words. Around each deleted run: sentence-ending punctuation carried by the
 * run moves to the word before it, a comma that only separated the run is dropped, and the
 * next word is capitalised when the run started a sentence.
 */
export function joinKept(words: string[], keep: boolean[]): string {
  const out: string[] = [];
  let capitalizeNext = false;
  for (let i = 0; i < words.length; ) {
    const word = words[i]!;
    if (keep[i]) {
      out.push(capitalizeNext ? capitalize(word) : word);
      capitalizeNext = false;
      i++;
      continue;
    }
    let end = i;
    while (end < words.length && !keep[end]) end++;
    const prev = out.at(-1);
    if ((prev === undefined || SENTENCE_END.test(prev)) && startsUppercase(word)) capitalizeNext = true;
    if (prev !== undefined) {
      const punctuation = words[end - 1]!.match(TRAILING_PUNCTUATION)?.[0] ?? "";
      if (SENTENCE_END.test(punctuation) && !SENTENCE_END.test(prev)) {
        out[out.length - 1] = prev.replace(/[,;:]+$/, "") + punctuation.replace(/^[,;:]+/, "");
      } else if (prev.endsWith(",") && (punctuation.endsWith(",") || end === words.length)) {
        out[out.length - 1] = prev.slice(0, -1);
      }
    }
    i = end;
  }
  return out.join(" ");
}

/**
 * Which source words the output keeps, if the output is the source with some words deleted;
 * null if it adds, changes or reorders any word. Words are compared without case or
 * surrounding punctuation, since only the source words are used to build the result.
 */
export function keptWords(source: string[], output: string[]): boolean[] | null {
  const bare = source.map(bareWord);
  const keep = source.map(() => false);
  let i = 0;
  for (const word of output.map(bareWord).filter(Boolean)) {
    while (i < bare.length && bare[i] !== word) i++;
    if (i === bare.length) return null;
    keep[i++] = true;
  }
  return keep;
}

function startsUppercase(word: string): boolean {
  return /^[^\p{L}]*\p{Lu}/u.test(word);
}

function capitalize(word: string): string {
  return word.replace(/\p{L}/u, (c) => c.toUpperCase());
}
