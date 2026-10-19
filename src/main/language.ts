// Chooses which model transcribes an utterance. Detection is restricted to Swedish and
// English: only the sv:en ratio counts, so mass on Norwegian or Danish cannot misroute.
export type Lang = "sv" | "en";
export type LanguageMode = "auto" | Lang;

export interface LanguageInput {
  override: LanguageMode;
  probs: Record<Lang, number>;
  speechMs: number;
  previous: Lang | null;
  primary: Lang;
}

export interface LanguageChoice {
  language: Lang;
  reason: "override" | "detected" | "short-clip" | "ambiguous";
}

/** Short or ambiguous dictations fall back to this language when there is no previous one. */
export const PRIMARY_LANGUAGE: Lang = "sv";
/** Below this much detected speech, detection is too unreliable to trust. */
export const MIN_DETECT_SPEECH_MS = 1200;
/** sv share of (sv + en) must be outside [1 - x, x] to count as confident. */
export const CONFIDENT_SHARE = 0.65;

export function chooseLanguage(input: LanguageInput): LanguageChoice {
  if (input.override !== "auto") return { language: input.override, reason: "override" };
  const fallback = input.previous ?? input.primary;
  if (input.speechMs < MIN_DETECT_SPEECH_MS) return { language: fallback, reason: "short-clip" };

  const total = input.probs.sv + input.probs.en;
  const svShare = total > 0 ? input.probs.sv / total : 0.5;
  if (svShare >= CONFIDENT_SHARE) return { language: "sv", reason: "detected" };
  if (svShare <= 1 - CONFIDENT_SHARE) return { language: "en", reason: "detected" };
  return { language: fallback, reason: "ambiguous" };
}
