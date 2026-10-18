// End-to-end check of the speech process and the dictation pipeline on synthetic speech
// (macOS `say`). It checks mechanics (speech gate, trimming, language routing), not
// accuracy: synthetic voices mangle technical terms, and accuracy is measured separately on
// real recordings. Skips when the native build or the models are missing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { SAMPLE_RATE } from "../src/main/audio.ts";
import { transcribeUtterance } from "../src/main/dictation.ts";
import { DEFAULT_MODELS, modelPath } from "../src/main/models.ts";
import { WhisperProcessEngine } from "../src/main/speech-engine.ts";

const BIN = join(import.meta.dirname, "..", "build", "bin", "diktatorn-asr");
const paths = { sv: modelPath(DEFAULT_MODELS.sv), en: modelPath(DEFAULT_MODELS.en), vad: modelPath(DEFAULT_MODELS.vad) };
const missing = [BIN, ...Object.values(paths)].filter((p) => !existsSync(p));
const skip = missing.length > 0 ? `missing: ${missing.join(", ")} (run build:native and fetch-models)` : false;

let engine: WhisperProcessEngine;
let dir: string;

/** Synthesizes speech, converts it to 16 kHz mono, and surrounds it with silence. */
function speak(voice: string, text: string, padMs = 600): Float32Array {
  const aiff = join(dir, "clip.aiff");
  const wav = join(dir, "clip.wav");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const bytes = readFileSync(wav);
  const data = bytes.indexOf("data") + 8;
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset + data, (bytes.length - data) >> 1);
  const pad = (padMs / 1000) * SAMPLE_RATE;
  const out = new Float32Array(pcm.length + 2 * pad);
  pcm.forEach((s, i) => (out[pad + i] = s / 32768));
  return out;
}

const auto = { languageMode: "auto", primaryLanguage: "sv" } as const;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), "diktatorn-test-"));
  engine = new WhisperProcessEngine(BIN);
  const t = performance.now();
  await engine.ensureLoaded({ sv: paths.sv, en: paths.en }, paths.vad);
  console.log(`cold load + warm-up: ${Math.round(performance.now() - t)} ms`);
});

after(() => {
  engine?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("silence is gated before any transcription", { skip }, async () => {
  const r = await transcribeUtterance(engine, new Float32Array(SAMPLE_RATE * 2), auto, null);
  assert.equal(r.speech, false);
  assert.equal(r.text, "");
});

test("Swedish speech is detected as Swedish and transcribed by the Swedish model", { skip }, async () => {
  const pcm = speak("Alva", "Vi måste deploya till staging innan standup, så att Johan hinner granska ändringen.");
  const r = await transcribeUtterance(engine, pcm, auto, null);
  console.log("sv:", r.text, r.probs, r.timings);
  assert.equal(r.language?.language, "sv");
  assert.equal(r.language?.reason, "detected");
  assert.match(r.text, /Johan hinner granska/);
  assert.ok(r.speechMs < r.audioMs - 1000, "trimming removed the surrounding silence");
});

test("English speech is detected as English and transcribed by the English model", { skip }, async () => {
  const pcm = speak("Samantha", "Please refactor the settings component, because it re-renders on every keystroke.");
  const r = await transcribeUtterance(engine, pcm, auto, "sv");
  console.log("en:", r.text, r.probs, r.timings);
  assert.equal(r.language?.language, "en");
  assert.match(r.text, /settings component/i);
});

test("a manual override skips detection", { skip }, async () => {
  const pcm = speak("Alva", "Kan du köra npm install och sedan starta om servern?");
  const r = await transcribeUtterance(engine, pcm, { languageMode: "sv", primaryLanguage: "sv" }, null);
  assert.equal(r.probs, null);
  assert.equal(r.timings.detectMs, 0);
  assert.equal(r.language?.reason, "override");
  assert.match(r.text, /starta om/i);
});
