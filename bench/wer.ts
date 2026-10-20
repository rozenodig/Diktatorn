// Word error rate and technical-term accuracy.
//
// Both texts are normalised before comparison: lower case, typographic apostrophes made
// plain, hyphens and slashes split words ("API-nyckeln" = "API nyckeln"), and punctuation is
// stripped from the ends of words but kept inside them, so "Next.js" stays one word and must
// be recognised as such. Term accuracy is stricter: the term must appear spelled exactly
// as written, capitals included.

export interface WordErrors {
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Words in the reference. */
  words: number;
}

export function normalizeWords(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .split(/[\s\-‐-―/]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w !== "");
}

/** Minimum substitutions, deletions and insertions that turn the reference into the hypothesis. */
export function wordErrors(reference: string, hypothesis: string): WordErrors {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  type Cell = { cost: number; s: number; d: number; i: number };
  // prev[j]: best alignment of the reference so far with the first j hypothesis words.
  let prev: Cell[] = hyp.map((_, j) => ({ cost: j, s: 0, d: 0, i: j }));
  prev.push({ cost: hyp.length, s: 0, d: 0, i: hyp.length });
  for (let r = 1; r <= ref.length; r++) {
    const row: Cell[] = [{ cost: r, s: 0, d: r, i: 0 }];
    for (let h = 1; h <= hyp.length; h++) {
      const diag = prev[h - 1]!;
      const up = prev[h]!;
      const left = row[h - 1]!;
      const same = ref[r - 1] === hyp[h - 1];
      const options: Cell[] = [
        same ? diag : { ...diag, cost: diag.cost + 1, s: diag.s + 1 },
        { ...up, cost: up.cost + 1, d: up.d + 1 },
        { ...left, cost: left.cost + 1, i: left.i + 1 },
      ];
      row.push(options.reduce((best, c) => (c.cost < best.cost ? c : best)));
    }
    prev = row;
  }
  const end = prev[hyp.length]!;
  return { substitutions: end.s, deletions: end.d, insertions: end.i, words: ref.length };
}

/** Word error rate over several sentences: all errors divided by all reference words. */
export function wer(results: WordErrors[]): number {
  const words = results.reduce((n, e) => n + e.words, 0);
  const errors = results.reduce((n, e) => n + e.substitutions + e.deletions + e.insertions, 0);
  return words === 0 ? 0 : errors / words;
}

/** True when the term appears exactly as spelled, not as part of a longer word. */
export function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(text.normalize("NFC"));
}
