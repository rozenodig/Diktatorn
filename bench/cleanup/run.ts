// Cleanup eval: the cleanup pipeline on transcripts with fillers, self-corrections and controls,
// against two baselines on the same samples.
//
// Systems:
//   raw        The transcript with no cleanup at all: how much there is to clean.
//   rules      The always-on rules alone (hesitation sounds), as with Smart cleanup off.
//   diktatorn  Diktatorn as installed: the rules, then the local language model under the
//              deletion guard, with an empty dictionary. The pass criteria are judged on this system.
//
// Each sample goes through the model --runs times (default 3). The model decodes greedily, so
// every run should give the same text; any sample whose runs differ is reported.
//
// Usage: npm run bench:cleanup [-- --samples <file> ... --runs <n> --out <dir>]. Needs the native
// build and the cleanup model: npm run build:native, then start the app once. Writes RESULTS.md and
// results.json to bench/cleanup (or --out).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LlamaCleaner } from "../../src/main/cleanup/llm.ts";
import { cleanUp, LLM_TIMEOUT_MS, type CleanupResult, type LlmStatus } from "../../src/main/cleanup/pipeline.ts";
import { DEFAULT_CLEANUP_MODEL, MODELS, modelPath } from "../../src/main/models.ts";
import { loadCleanupSet, scoreCleanup, type CleanupSample, type CleanupScore } from "./score.ts";

const SYSTEMS = {
  raw: "Raw transcript",
  rules: "Rules only",
  diktatorn: "Diktatorn",
} as const;
type SystemId = keyof typeof SYSTEMS;
const VERDICTS: LlmStatus[] = ["accepted", "unchanged", "rejected", "timeout", "skipped", "error"];

interface Run {
  text: string;
  score: CleanupScore;
}

interface ModelRun extends Run {
  /** What the language-model pass did, on the first run. */
  llm: CleanupResult["llm"];
  /** Time spent in the model pass, per run. */
  modelMs: number[];
  /** Whether every run gave the same text. */
  stable: boolean;
}

interface Result {
  sample: CleanupSample;
  raw: Run;
  rules: Run;
  diktatorn: ModelRun;
}

const DIR = import.meta.dirname;
const { values: args } = parseArgs({
  options: {
    samples: { type: "string", multiple: true, default: [join(DIR, "samples.json"), join(DIR, "heldout.json")] },
    runs: { type: "string", default: "3" },
    out: { type: "string", default: DIR },
  },
});
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive whole number, not '${args.runs}'`);
const outDir = resolve(args.out);

const sets = await Promise.all(args.samples.map(async (file) => ({ file: basename(file), ...(await loadCleanupSet(resolve(file))) })));
const binary = join(DIR, "..", "..", "build", "bin", "diktatorn-llm");
const model = MODELS[DEFAULT_CLEANUP_MODEL];
const missing = [binary, modelPath(DEFAULT_CLEANUP_MODEL)].filter((p) => !existsSync(p));
if (missing.length === 0 && statSync(modelPath(DEFAULT_CLEANUP_MODEL)).size !== model.bytes) missing.push(`${model.file} (incomplete)`);
if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")} (run npm run build:native, then start the app once)`);

const cleaner = new LlamaCleaner(binary, modelPath(DEFAULT_CLEANUP_MODEL));
const results: { title: string; file: string; results: Result[] }[] = [];
try {
  console.log("loading the cleanup model…");
  await cleaner.ready;
  for (const set of sets) {
    const setResults: Result[] = [];
    for (const [i, sample] of set.samples.entries()) {
      process.stdout.write(`\r${set.title}: ${i + 1}/${set.samples.length} ${sample.id}   `);
      const rules = await cleanUp(sample.input, { dictionary: [], llm: null, llmTimeoutMs: LLM_TIMEOUT_MS });
      const passes: CleanupResult[] = [];
      for (let r = 0; r < runs; r++) passes.push(await cleanUp(sample.input, { dictionary: [], llm: cleaner, llmTimeoutMs: LLM_TIMEOUT_MS }));
      const first = passes[0]!;
      setResults.push({
        sample,
        raw: { text: sample.input, score: scoreCleanup(sample, sample.input) },
        rules: { text: rules.text, score: scoreCleanup(sample, rules.text) },
        diktatorn: {
          text: first.text,
          score: scoreCleanup(sample, first.text),
          llm: first.llm && { ...first.llm, ms: Math.round(first.llm.ms) },
          modelMs: passes.map((p) => Math.round(p.llm?.ms ?? 0)),
          stable: passes.every((p) => p.text === first.text),
        },
      });
    }
    process.stdout.write("\n");
    results.push({ title: set.title, file: set.file, results: setResults });
  }
} finally {
  cleaner.close();
}

// ---- Report ----

const all = results.flatMap((s) => s.results);
const pct = (n: number, of: number) => `${of === 0 ? "0.0" : ((n / of) * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ") || "_(nothing)_";
const sum = (rs: Result[], system: SystemId, key: "words" | "lost" | "leftIn") => rs.reduce((n, r) => n + r[system].score[key], 0);

const unstable = all.filter((r) => !r.diktatorn.stable).map((r) => r.sample.id);
const controls = all.filter((r) => r.sample.control);
const criteria = [
  {
    text: "No word the speaker meant is deleted",
    result: `${sum(all, "diktatorn", "lost")} words lost`,
    pass: sum(all, "diktatorn", "lost") === 0,
  },
  {
    text: "Every control is left as dictated",
    result: `${controls.filter((r) => r.diktatorn.score.pass).length}/${controls.length} intact`,
    pass: controls.every((r) => r.diktatorn.score.pass),
  },
];

const sh = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { encoding: "utf8" }).trim();
const hardware = {
  chip: sh("sysctl", ["-n", "machdep.cpu.brand_string"]),
  memoryGB: Math.round(Number(sh("sysctl", ["-n", "hw.memsize"])) / 2 ** 30),
  macOS: sh("sw_vers", ["-productVersion"]),
};
const date = new Date().toISOString().slice(0, 10);

function outcome(score: CleanupScore): string {
  if (score.pass) return "Pass";
  const parts = [];
  if (score.missing.length) parts.push(`lost ${score.missing.join(", ")}`);
  if (score.leftover.length) parts.push(`left in ${score.leftover.join(", ")}`);
  return `**Fail**: ${parts.join("; ")}`;
}

const md: string[] = [
  "# Cleanup eval results",
  "",
  `Generated by \`npm run bench:cleanup\` on ${date}: ${hardware.chip}, ${hardware.memoryGB} GB, macOS ${hardware.macOS}.`,
  `Model: ${model.name} (\`${model.file}\`), ${runs} run${runs === 1 ? "" : "s"} per sample. See [README.md](README.md) for the method.`,
  "",
  "## Summary",
  "",
  "Pass: every must-keep term is there and every must-remove phrase is gone. Words lost and words left in are counted against the reference, as a share of its words.",
  "",
];
const summaries = results.map((set) => ({ heading: `**${set.title}** (\`${set.file}\`)`, results: set.results }));
if (results.length > 1) summaries.push({ heading: "**All sets**", results: all });
for (const set of summaries) {
  const words = sum(set.results, "raw", "words");
  md.push(
    `${set.heading}: ${set.results.length} samples, ${words} reference words`,
    "",
    "| System | Pass | Words lost | Words left in | Model time (median / max) |",
    "|---|---:|---:|---:|---:|",
    ...(Object.keys(SYSTEMS) as SystemId[]).map((id) => {
      const passed = set.results.filter((r) => r[id].score.pass).length;
      const lost = sum(set.results, id, "lost");
      const leftIn = sum(set.results, id, "leftIn");
      const ms = set.results.map((r) => median(r.diktatorn.modelMs));
      const max = Math.max(...set.results.flatMap((r) => r.diktatorn.modelMs));
      const time = id === "diktatorn" ? `${Math.round(median(ms))} / ${max} ms` : "–";
      return `| ${SYSTEMS[id]} | ${passed}/${set.results.length} | ${lost} (${pct(lost, words)}) | ${leftIn} (${pct(leftIn, words)}) | ${time} |`;
    }),
    "",
  );
}
md.push(
  "## Pass criteria",
  "",
  ...criteria.map((c) => `- ${c.pass ? "Pass" : "**Fail**"}: ${c.text} (${c.result})`),
  "",
  unstable.length === 0
    ? `Every sample gave the same text on all ${runs} runs.`
    : `**Runs differed** for ${unstable.join(", ")}; the tables show the first run.`,
  "",
);
for (const set of results) {
  const verdicts = VERDICTS.flatMap((status) => {
    const n = set.results.filter((r) => r.diktatorn.llm?.status === status).length;
    return n > 0 ? [`${n} ${status}`] : [];
  });
  md.push(
    `## ${set.title}`,
    "",
    `Guard verdicts on the model's answers: ${verdicts.join(", ")}.`,
    "",
    "| Sample | Reference | Diktatorn | Result | Guard verdict |",
    "|---|---|---|---|---|",
    ...set.results.map((r) => {
      const llm = r.diktatorn.llm;
      const pass = llm ? `${llm.status}${llm.detail ? `: ${llm.detail}` : ""}` : "none";
      const id = r.sample.control ? `${r.sample.id} (control)` : r.sample.id;
      return `| ${id} | ${cell(r.sample.reference)} | ${cell(r.diktatorn.text)} | ${outcome(r.diktatorn.score)} | ${cell(pass)} |`;
    }),
    "",
  );
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "RESULTS.md"), md.join("\n"));

const json = {
  date,
  hardware,
  model: model.file,
  runs,
  systems: SYSTEMS,
  criteria,
  sets: results.map((set) => ({
    title: set.title,
    file: set.file,
    samples: set.results.map(({ sample, raw, rules, diktatorn }) => ({ ...sample, runs: { raw, rules, diktatorn } })),
  })),
};
writeFileSync(join(outDir, "results.json"), `${JSON.stringify(json, null, 2)}\n`);

console.log(md.slice(md.indexOf("## Summary"), md.indexOf(`## ${results[0]?.title}`)).join("\n"));
console.log(`wrote RESULTS.md and results.json to ${outDir}`);
if (criteria.some((c) => !c.pass)) process.exitCode = 1;
