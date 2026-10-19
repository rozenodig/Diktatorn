import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasTerm, normalizeWords, wer, wordErrors } from "../bench/wer.ts";
import { BenchRecorder, loadBenchSentences } from "../src/main/bench.ts";
import { decodeWav, encodeWav } from "../src/main/wav.ts";

test("normalisation ignores case and outer punctuation but keeps words like Next.js whole", () => {
  assert.deepEqual(normalizeWords("Kör npm install igen, I think it’s broken."), ["kör", "npm", "install", "igen", "i", "think", "it's", "broken"]);
  assert.deepEqual(normalizeWords("Migrate to Next.js, then the API-nyckeln / SSH."), ["migrate", "to", "next.js", "then", "the", "api", "nyckeln", "ssh"]);
});

test("word errors count substitutions, deletions and insertions against the reference", () => {
  assert.deepEqual(wordErrors("the cat sat on the mat", "The cat sat on the mat."), { substitutions: 0, deletions: 0, insertions: 0, words: 6 });
  assert.deepEqual(wordErrors("the cat sat on the mat", "the cat sit on mat"), { substitutions: 1, deletions: 1, insertions: 0, words: 6 });
  assert.deepEqual(wordErrors("push to GitHub", "push it to git hub"), { substitutions: 1, deletions: 0, insertions: 2, words: 3 });
  assert.deepEqual(wordErrors("hello world", ""), { substitutions: 0, deletions: 2, insertions: 0, words: 2 });
  // Pooled over sentences, not averaged per sentence: 2 errors over 8 words.
  assert.equal(wer([wordErrors("a b c d e f", "a b c d e f"), wordErrors("g h", "")]), 0.25);
});

test("a term counts only when spelled exactly, as a whole word", () => {
  assert.ok(hasTerm("Kolla loggarna i Sentry, nu.", "Sentry"));
  assert.ok(hasTerm("Skicka API-nyckeln.", "API"));
  assert.ok(hasTerm("Migrate to Next.js first", "Next.js"));
  assert.ok(!hasTerm("Migrate to next.js first", "Next.js"));
  assert.ok(!hasTerm("Migrate to NextXjs first", "Next.js"));
  assert.ok(!hasTerm("a github repo", "GitHub"));
  assert.ok(!hasTerm("RAPIDS", "API"));
});

test("a WAV file round-trips 16 kHz mono 16-bit audio and other formats are refused", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const decoded = decodeWav(encodeWav(samples));
  assert.equal(decoded.length, samples.length);
  samples.forEach((s, i) => assert.ok(Math.abs(decoded[i]! - s) < 1 / 16_000, `sample ${i}`));
  const stereo = encodeWav(samples);
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => decodeWav(stereo), /mono/);
});

test("the recorder starts at the first unrecorded sentence and saves each take as WAV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diktatorn-bench-"));
  try {
    const sentences = [
      { id: "sv-01", language: "sv", term: "Slack", text: "En kanal i Slack." },
      { id: "en-01", language: "en", term: "JSON", text: "Store it as JSON." },
    ];
    writeFileSync(join(dir, "sentences.json"), JSON.stringify({ sentences }));
    assert.ok(BenchRecorder.available(dir));
    const recorder = new BenchRecorder(dir);
    await recorder.start();
    assert.equal(recorder.state().sentence?.id, "sv-01");

    assert.equal(await recorder.save(new Float32Array(1600)), "sv-01");
    assert.ok(existsSync(join(dir, "recordings", "sv-01.wav")));
    assert.equal(decodeWav(readFileSync(join(dir, "recordings", "sv-01.wav"))).length, 1600);
    assert.deepEqual([recorder.state().sentence?.id, recorder.state().recorded], ["en-01", 1]);

    // A restart resumes where the recordings stop.
    const again = new BenchRecorder(dir);
    await again.start();
    assert.equal(again.state().sentence?.id, "en-01");

    writeFileSync(join(dir, "sentences.json"), JSON.stringify({ sentences: [{ ...sentences[0], term: "Teams" }] }));
    await assert.rejects(loadBenchSentences(join(dir, "sentences.json")), /term it contains/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
