// One utterance through the pipeline: find speech, trim, pick the language, transcribe.
import { SAMPLE_RATE, trimToSpeech } from "./audio.ts";
import { chooseLanguage, MIN_DETECT_SPEECH_MS, type Lang, type LanguageChoice, type LanguageMode } from "./language.ts";
import type { SpeechEngine } from "./speech-engine.ts";

/** Audio kept around detected speech so word onsets and endings are not clipped. */
const SPEECH_PAD_MS = 200;

export interface UtteranceSettings {
  languageMode: LanguageMode;
  primaryLanguage: Lang;
  /** Recognition bias, e.g. dictionary terms. */
  prompt?: string;
}

export interface UtteranceResult {
  text: string;
  speech: boolean;
  language: LanguageChoice | null;
  probs: Record<Lang, number> | null;
  audioMs: number;
  speechMs: number;
  timings: { vadMs: number; detectMs: number; transcribeMs: number; totalMs: number };
}

export async function transcribeUtterance(
  engine: SpeechEngine,
  pcm: Float32Array,
  settings: UtteranceSettings,
  previous: Lang | null,
): Promise<UtteranceResult> {
  const t0 = performance.now();
  const audioMs = (pcm.length / SAMPLE_RATE) * 1000;
  const timings = { vadMs: 0, detectMs: 0, transcribeMs: 0, totalMs: 0 };

  const segments = await engine.speechSegments(pcm);
  const trimmed = trimToSpeech(pcm, segments, SPEECH_PAD_MS);
  timings.vadMs = performance.now() - t0;
  if (!trimmed) {
    timings.totalMs = performance.now() - t0;
    return { text: "", speech: false, language: null, probs: null, audioMs, speechMs: 0, timings };
  }

  let probs: Record<Lang, number> | null = null;
  if (settings.languageMode === "auto" && trimmed.speechMs >= MIN_DETECT_SPEECH_MS) {
    const t = performance.now();
    probs = await engine.detectLanguage(trimmed.samples, ["sv", "en"]);
    timings.detectMs = performance.now() - t;
  }
  const language = chooseLanguage({
    override: settings.languageMode,
    probs: probs ?? { sv: 0, en: 0 },
    speechMs: trimmed.speechMs,
    previous,
    primary: settings.primaryLanguage,
  });

  const t = performance.now();
  const transcript = await engine.transcribe(trimmed.samples, { language: language.language, prompt: settings.prompt });
  timings.transcribeMs = performance.now() - t;
  timings.totalMs = performance.now() - t0;
  return { text: transcript.text, speech: true, language, probs, audioMs, speechMs: trimmed.speechMs, timings };
}
