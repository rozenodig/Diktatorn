// Benchmark: stock Whisper against Diktatorn on recorded sentences, on this Mac.
//
// Systems, all on the same recordings:
//   stock       Whisper large-v3 turbo on the whole recording, detecting the language among every
//               language it knows: whisper.cpp out of the box.
//   routing     Diktatorn's recognition alone: speech trimmed, Swedish or English detected, and
//               the clip sent to KB-Whisper medium or Whisper large-v3 turbo. No cleanup.
//   diktatorn   Diktatorn as installed: routing, then cleanup (rules and the local language model),
//               with an empty dictionary. The pass criteria are judged on this system.
//   dictionary  Diktatorn with the benchmark terms in its dictionary (terms only, no spoken forms),
//               like a user who has added the words they use.
//   kbLarge     Diktatorn as installed with KB-Whisper large, when that model is downloaded.
//
// Usage: npm run bench [-- --sentences <file> --recordings <dir> --out <dir>]. Record first: menu
// bar icon → Record Benchmark. Writes RESULTS.md and results.json to bench/ (or --out).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SAMPLE_RATE } from "../src/main/audio.ts";
import { BENCH_LANGUAGES, loadBenchSentences, type BenchLanguage, type BenchSentence } from "../src/main/bench.ts";
import { dictionaryPrompt, loadDictionary, type DictionaryEntry } from "../src/main/cleanup/dictionary.ts";
import { LlamaCleaner } from "../src/main/cleanup/llm.ts";
import { cleanUp, LLM_TIMEOUT_MS } from "../src/main/cleanup/pipeline.ts";
import { transcribeUtterance } from "../src/main/dictation.ts";
import { PRIMARY_LANGUAGE, type Lang } from "../src/main/language.ts";
import { DEFAULT_CLEANUP_MODEL, DEFAULT_MODELS, MODELS, modelPath, type ModelId } from "../src/main/models.ts";
import { WhisperProcessEngine } from "../src/main/speech-engine.ts";
import { decodeWav } from "../src/main/wav.ts";
import { hasTerm, wer, wordErrors, type WordErrors } from "./wer.ts";

const SYSTEMS = {
  stock: "Stock Whisper large-v3 turbo",
  routing: "Diktatorn, recognition only",
  diktatorn: "Diktatorn",
  dictionary: "Diktatorn + dictionary",
  kbLarge: "Diktatorn with KB-Whisper large",
} as const;
type SystemId = keyof typeof SYSTEMS;
const LANGUAGE_NAMES: Record<BenchLanguage, string> = { sv: "Swedish", en: "English", mixed: "Mixed" };

interface Run {
  text: string;
  /** From the end of the recording to the final text. */
  ms: number;
  errors: WordErrors;
  /** Whether the sentence's term is spelled exactly right; null when it has none. */
  term: boolean | null;
  /** Which model the clip was sent to and why (Diktatorn systems only). */
  route?: { language: Lang; reason: string; svShare: number | null } | null;
  /** What the language-model cleanup did (Diktatorn systems with cleanup only). */
  llm?: string;
}

interface Clip {
  sentence: BenchSentence;
  audioMs: number;
  pcm: Float32Array;
  runs: Partial<Record<SystemId, Run>>;
}

const BENCH = import.meta.dirname;
const { values: args } = parseArgs({
  options: {
    sentences: { type: "string", default: join(BENCH, "sentences.json") },
    recordings: { type: "string", default: join(BENCH, "recordings") },
    out: { type: "string", default: BENCH },
  },
});
const recordingsDir = resolve(args.recordings);
const outDir = resolve(args.out);
const binary = (name: string) => join(BENCH, "..", "build", "bin", name);
const isReady = (id: ModelId) => existsSync(modelPath(id)) && statSync(modelPath(id)).size === MODELS[id].bytes;

const sentences = await loadBenchSentences(resolve(args.sentences));
const dictionary = await loadDictionary(join(BENCH, "dictionary.json"));
const clips: Clip[] = sentences.flatMap((sentence) => {
  const path = join(recordingsDir, `${sentence.id}.wav`);
  if (!existsSync(path)) return [];
  const pcm = decodeWav(readFileSync(path));
  return [{ sentence, pcm, audioMs: (pcm.length / SAMPLE_RATE) * 1000, runs: {} }];
});
if (clips.length === 0) {
  throw new Error(`no recordings in ${recordingsDir}. Record them first: menu bar icon → Record Benchmark.`);
}
if (clips.length < sentences.length) console.warn(`only ${clips.length} of ${sentences.length} sentences are recorded`);

const requiredModels: ModelId[] = [DEFAULT_MODELS.sv, DEFAULT_MODELS.en, DEFAULT_MODELS.vad, DEFAULT_CLEANUP_MODEL];
const missing = [
  ...["diktatorn-asr", "diktatorn-llm"].map(binary).filter((p) => !existsSync(p)),
  ...requiredModels.filter((id) => !isReady(id)),
];
if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")} (run npm run build:native, then start the app once)`);

const engine = new WhisperProcessEngine(binary("diktatorn-asr"));
const cleaner = new LlamaCleaner(binary("diktatorn-llm"), modelPath(DEFAULT_CLEANUP_MODEL));
const speechModels = (sv: ModelId) => ({ sv: modelPath(sv), en: modelPath(DEFAULT_MODELS.en) });

function score(sentence: BenchSentence, text: string, ms: number, extra: Partial<Run> = {}): Run {
  const term = sentence.term === undefined ? null : hasTerm(text, sentence.term);
  return { text, ms, errors: wordErrors(sentence.text, text), term, ...extra };
}

async function runStock(clip: Clip): Promise<Run> {
  const t0 = performance.now();
  const { text } = await engine.transcribe(clip.pcm, { language: "auto" });
  return score(clip.sentence, text, performance.now() - t0);
}

/** The app's dictation path: recognition, then cleanup. Returns both stages. */
async function runDiktatorn(clip: Clip, entries: DictionaryEntry[]): Promise<{ raw: Run; cleaned: Run }> {
  const settings = { languageMode: "auto" as const, primaryLanguage: PRIMARY_LANGUAGE, prompt: dictionaryPrompt(entries) };
  // No previous dictation, so every clip is judged on its own.
  const r = await transcribeUtterance(engine, clip.pcm, settings, null);
  const svShare = r.probs && r.probs.sv + r.probs.en > 0 ? r.probs.sv / (r.probs.sv + r.probs.en) : null;
  const route = r.language && { language: r.language.language, reason: r.language.reason, svShare };
  const c = r.text ? await cleanUp(r.text, { dictionary: entries, llm: cleaner, llmTimeoutMs: LLM_TIMEOUT_MS }) : null;
  return {
    raw: score(clip.sentence, r.text, r.timings.totalMs, { route }),
    cleaned: score(clip.sentence, c?.text ?? "", r.timings.totalMs + (c?.ms ?? 0), { route, llm: c?.llm?.status ?? "none" }),
  };
}

async function forEachClip(label: string, fn: (clip: Clip) => Promise<void>): Promise<void> {
  for (const [i, clip] of clips.entries()) {
    process.stdout.write(`\r${label}: ${i + 1}/${clips.length} ${clip.sentence.id}   `);
    await fn(clip);
  }
  process.stdout.write("\n");
}

try {
  console.log("loading models…");
  await engine.ensureLoaded(speechModels(DEFAULT_MODELS.sv), modelPath(DEFAULT_MODELS.vad));
  await cleaner.ready;

  await forEachClip("stock Whisper", async (clip) => {
    clip.runs.stock = await runStock(clip);
  });
  await forEachClip("Diktatorn", async (clip) => {
    const { raw, cleaned } = await runDiktatorn(clip, []);
    clip.runs.routing = raw;
    clip.runs.diktatorn = cleaned;
  });
  await forEachClip("Diktatorn + dictionary", async (clip) => {
    clip.runs.dictionary = (await runDiktatorn(clip, dictionary)).cleaned;
  });
  if (isReady("kb-whisper-large")) {
    await engine.ensureLoaded(speechModels("kb-whisper-large"), modelPath(DEFAULT_MODELS.vad));
    await forEachClip("Diktatorn with KB-Whisper large", async (clip) => {
      clip.runs.kbLarge = (await runDiktatorn(clip, [])).cleaned;
    });
  } else {
    console.log("KB-Whisper large is not downloaded; skipping that system");
  }
} finally {
  engine.close();
  cleaner.close();
}

// ---- Report ----

const systems = (Object.keys(SYSTEMS) as SystemId[]).filter((id) => clips.every((c) => c.runs[id]));
const languages = BENCH_LANGUAGES.filter((l) => clips.some((c) => c.sentence.language === l));
const runsOf = (system: SystemId, language?: BenchLanguage) =>
  clips.filter((c) => !language || c.sentence.language === language).map((c) => c.runs[system]!);
const werOf = (system: SystemId, language?: BenchLanguage) => wer(runsOf(system, language).map((r) => r.errors));
const wordsOf = (language: BenchLanguage) => runsOf("stock", language).reduce((n, r) => n + r.errors.words, 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const cell = (text: string) => text.replace(/\|/g, "\\|") || "_(nothing)_";

const criteria = [
  { language: "en" as const, text: "English WER no higher than stock Whisper", pass: (d: number, s: number) => d <= s },
  { language: "sv" as const, text: "Swedish WER lower than stock Whisper", pass: (d: number, s: number) => d < s },
  { language: "mixed" as const, text: "Mixed WER lower than stock Whisper", pass: (d: number, s: number) => d < s },
].map((c) => {
  if (!languages.includes(c.language)) return { ...c, result: "not measured", ok: true };
  const d = werOf("diktatorn", c.language);
  const s = werOf("stock", c.language);
  return { ...c, result: `${pct(d)} vs ${pct(s)}`, ok: c.pass(d, s) };
});

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const hardware = {
  chip: sh("sysctl", ["-n", "machdep.cpu.brand_string"]),
  memoryGB: Math.round(Number(sh("sysctl", ["-n", "hw.memsize"])) / 2 ** 30),
  macOS: sh("sw_vers", ["-productVersion"]),
};
const date = new Date().toISOString().slice(0, 10);

const md: string[] = [
  "# Benchmark results",
  "",
  `Generated by \`npm run bench\` on ${date}: ${hardware.chip}, ${hardware.memoryGB} GB, macOS ${hardware.macOS}.`,
  `${clips.length} recorded sentences read by one speaker; ` +
    languages.map((l) => `${LANGUAGE_NAMES[l].toLowerCase()} ${runsOf("stock", l).length} (${wordsOf(l)} words)`).join(", ") +
    ". See [README.md](README.md) for the method.",
  "",
  "## Word error rate",
  "",
  `| System | ${languages.map((l) => LANGUAGE_NAMES[l]).join(" | ")} | All | Terms spelled right | Median time |`,
  `|---|${languages.map(() => "---:").join("|")}|---:|---:|---:|`,
  ...systems.map((id) => {
    const runs = runsOf(id);
    const withTerm = runs.filter((r) => r.term !== null);
    const terms = withTerm.length ? `${withTerm.filter((r) => r.term).length}/${withTerm.length}` : "–";
    return `| ${SYSTEMS[id]} | ${languages.map((l) => pct(werOf(id, l))).join(" | ")} | ${pct(werOf(id))} | ${terms} | ${Math.round(median(runs.map((r) => r.ms)))} ms |`;
  }),
  "",
  "## Pass criteria (Diktatorn vs stock Whisper)",
  "",
  ...criteria.map((c) => `- ${c.ok ? "Pass" : "**Fail**"}: ${c.text} (${c.result})`),
  "",
  "## Language routing",
  "",
  ...languages.map((l) => {
    const routes = runsOf("routing", l).map((r) => r.route);
    const to = (lang: Lang) => routes.filter((x) => x?.language === lang).length;
    const unsure = routes.filter((x) => x && x.reason !== "detected").length;
    return `- ${LANGUAGE_NAMES[l]} sentences: ${to("sv")} to the Swedish model, ${to("en")} to the English model` +
      (unsure ? ` (${unsure} by fallback: short or ambiguous)` : "");
  }),
  "",
  "## Sentences with errors",
  "",
  "Every sentence where stock Whisper or Diktatorn made at least one error. Errors are counted after normalisation.",
  "",
  "| Sentence | Reference | Stock Whisper | Diktatorn |",
  "|---|---|---|---|",
  ...clips
    .filter((c) => wer([c.runs.stock!.errors]) > 0 || wer([c.runs.diktatorn!.errors]) > 0)
    .map((c) => {
      const errs = (r: Run) => r.errors.substitutions + r.errors.deletions + r.errors.insertions;
      return `| ${c.sentence.id} | ${cell(c.sentence.text)} | ${cell(c.runs.stock!.text)} (${errs(c.runs.stock!)}) | ${cell(c.runs.diktatorn!.text)} (${errs(c.runs.diktatorn!)}) |`;
    }),
  "",
];
writeFileSync(join(outDir, "RESULTS.md"), md.join("\n"));

const json = {
  date,
  hardware,
  systems: Object.fromEntries(systems.map((id) => [id, SYSTEMS[id]])),
  criteria: criteria.map(({ text, result, ok }) => ({ text, result, pass: ok })),
  clips: clips.map(({ sentence, audioMs, runs }) => ({ ...sentence, audioMs: Math.round(audioMs), runs })),
};
writeFileSync(join(outDir, "results.json"), `${JSON.stringify(json, null, 2)}\n`);

console.log(md.slice(md.indexOf("## Word error rate"), md.indexOf("## Language routing")).join("\n"));
console.log(`wrote RESULTS.md and results.json to ${outDir}`);
if (criteria.some((c) => !c.ok)) process.exitCode = 1;
