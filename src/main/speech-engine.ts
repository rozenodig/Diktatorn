// The speech engine boundary: utterance in, text out. Dictation uses it now; a future
// meeting mode can reuse it by segmenting continuous audio before calling transcribe().
import { once } from "node:events";
import { pcmToBase64 } from "./audio.ts";
import { JsonLinesProcess } from "./json-lines.ts";
import type { Lang } from "./language.ts";

export interface TranscriptSegment {
  t0: number; // centiseconds
  t1: number;
  text: string;
  noSpeechProb: number;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  engineMs: number;
}

export interface SpeechEngine {
  /** Loads (or keeps) one model per language plus the speech detector, and warms them up. */
  ensureLoaded(models: Record<Lang, string>, vadModel: string): Promise<void>;
  /** Speech segments as [start, end] in centiseconds; empty when there is no speech. */
  speechSegments(pcm: Float32Array): Promise<number[][]>;
  detectLanguage(pcm: Float32Array, candidates: Lang[]): Promise<Record<Lang, number>>;
  transcribe(pcm: Float32Array, opts: { language: Lang; prompt?: string }): Promise<Transcript>;
  close(): void;
}

/** Model whose (multilingual) language head is used for detection. */
const DETECTION_MODEL: Lang = "en";

export class WhisperProcessEngine implements SpeechEngine {
  private readonly proc: JsonLinesProcess;
  private readonly started: Promise<unknown>;
  private loadedKey = "";

  constructor(binaryPath: string) {
    this.proc = new JsonLinesProcess("asr", binaryPath);
    this.started = once(this.proc, "event");
  }

  async ensureLoaded(models: Record<Lang, string>, vadModel: string): Promise<void> {
    const key = JSON.stringify([models, vadModel]);
    if (key === this.loadedKey) return;
    await this.started;
    await this.proc.request("load", { models, vad: vadModel }, 120_000);
    this.loadedKey = key;
  }

  async speechSegments(pcm: Float32Array): Promise<number[][]> {
    const res = await this.proc.request("vad", { pcm: pcmToBase64(pcm) });
    return res.segments as number[][];
  }

  async detectLanguage(pcm: Float32Array, candidates: Lang[]): Promise<Record<Lang, number>> {
    const res = await this.proc.request("detect", { pcm: pcmToBase64(pcm), model: DETECTION_MODEL, candidates });
    return res.probs as Record<Lang, number>;
  }

  async transcribe(pcm: Float32Array, opts: { language: Lang; prompt?: string }): Promise<Transcript> {
    const res = await this.proc.request("transcribe", {
      pcm: pcmToBase64(pcm),
      model: opts.language,
      language: opts.language,
      prompt: opts.prompt ?? "",
    });
    return { text: res.text as string, segments: res.segments as TranscriptSegment[], engineMs: res.ms as number };
  }

  close(): void {
    this.proc.close();
  }
}
