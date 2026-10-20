// Benchmark sentences, and a development tool that records them through the normal dictation
// path: the same key handling, microphone and capture code as a real dictation, so the
// benchmark hears exactly what dictation hears. Each take is saved as recordings/<id>.wav.
// The recorder covers every sentence file: the benchmark itself, then the held-out set used to
// check tuning decisions on sentences they were not tuned on.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchState } from "../shared/ipc.ts";
import { encodeWav } from "./wav.ts";

export const BENCH_LANGUAGES = ["sv", "en", "mixed"] as const;
export const BENCH_FILES = ["sentences.json", "heldout.json"] as const;
export type BenchLanguage = (typeof BENCH_LANGUAGES)[number];

export interface BenchSentence {
  id: string;
  language: BenchLanguage;
  /** The technical term the sentence contains, spelled as it should be written, if any. */
  term?: string;
  text: string;
}

export async function loadBenchSentences(path: string): Promise<BenchSentence[]> {
  const json = JSON.parse(await readFile(path, "utf8")) as { sentences?: unknown };
  if (!Array.isArray(json.sentences)) throw new Error(`${path}: expected a 'sentences' array`);
  return json.sentences.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const ok =
      typeof s.id === "string" && /^[\w-]+$/.test(s.id) &&
      BENCH_LANGUAGES.includes(s.language as BenchLanguage) &&
      typeof s.text === "string" && (s.term === undefined || (typeof s.term === "string" && s.text.includes(s.term)));
    if (!ok) throw new Error(`${path}: sentence ${i} needs an id, a language (sv, en, mixed) and a text containing its term, if it has one`);
    return s as unknown as BenchSentence;
  });
}

export class BenchRecorder {
  private readonly dir: string;
  private sentences: BenchSentence[] = [];
  private index = 0;
  active = false;

  /** `dir` is the bench folder, holding sentences.json and recordings/. */
  constructor(dir: string) {
    this.dir = dir;
  }

  static available(dir: string): boolean {
    return existsSync(join(dir, "sentences.json"));
  }

  /** Starts at the first sentence that has no recording yet. */
  async start(): Promise<void> {
    const files = BENCH_FILES.map((f) => join(this.dir, f)).filter((f) => existsSync(f));
    this.sentences = (await Promise.all(files.map(loadBenchSentences))).flat();
    const next = this.sentences.findIndex((s) => !existsSync(this.recording(s)));
    this.index = next === -1 ? 0 : next;
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  move(delta: number): void {
    this.index = Math.max(0, Math.min(this.sentences.length - 1, this.index + delta));
  }

  /** Saves a take for the current sentence, replacing any earlier one, and moves on. */
  async save(samples: Float32Array): Promise<string> {
    const sentence = this.sentences[this.index];
    if (!sentence) throw new Error("no benchmark sentence selected");
    await mkdir(join(this.dir, "recordings"), { recursive: true });
    await writeFile(this.recording(sentence), encodeWav(samples));
    this.move(1);
    return sentence.id;
  }

  state(): BenchState {
    const sentence = this.sentences[this.index];
    return {
      active: this.active,
      index: this.index,
      total: this.sentences.length,
      recorded: this.sentences.filter((s) => existsSync(this.recording(s))).length,
      sentence: sentence ? { ...sentence, recorded: existsSync(this.recording(sentence)) } : null,
    };
  }

  private recording(sentence: BenchSentence): string {
    return join(this.dir, "recordings", `${sentence.id}.wav`);
  }
}
