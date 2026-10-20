// Always-on cleanup rules. Deliberately conservative: only hesitation sounds that are never
// words in Swedish or English are removed. Fillers that are also real words ("typ", "liksom",
// "alltså", "like") and self-corrections are left to the optional language-model pass,
// because a rule cannot tell "I like it" from "it was, like, fine".
import { bareWord, joinKept, splitWords } from "./words.ts";

/** eh, ehm, öh, äh, uh, uhm, um, umm, erm, including drawn-out spellings like "ehhh". */
const HESITATION = /^(?:[eöä]+h+m*|u+h+m*|u+m+|e+r+m+)$/;

export function isHesitation(word: string): boolean {
  return HESITATION.test(bareWord(word));
}

export function applyRules(text: string): string {
  const words = splitWords(text);
  return joinKept(words, words.map((w) => !isHesitation(w)));
}
