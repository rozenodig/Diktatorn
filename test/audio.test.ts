import assert from "node:assert/strict";
import { test } from "node:test";
import { concatChunks, pcmToBase64, SAMPLE_RATE, trimToSpeech } from "../src/main/audio.ts";

test("pcmToBase64 encodes 16-bit little-endian with clipping", () => {
  const b64 = pcmToBase64(new Float32Array([0, 1, -1, 0.5, 2]));
  const bytes = Buffer.from(b64, "base64");
  const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  assert.deepEqual(Array.from(view), [0, 32767, -32768, 16384, 32767]);
});

test("concatChunks joins chunks in order", () => {
  const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
});

test("trimToSpeech keeps first-to-last speech plus padding", () => {
  const samples = new Float32Array(SAMPLE_RATE * 5); // 5 s
  // speech at 1.0–1.5 s and 3.0–3.2 s (centiseconds)
  const r = trimToSpeech(samples, [[100, 150], [300, 320]], 200);
  assert.ok(r);
  assert.equal(r.startMs, 800);
  assert.equal(r.endMs, 3400);
  assert.equal(r.samples.length, 2.6 * SAMPLE_RATE); // 41 600 samples
  assert.equal(r.speechMs, 700);
});

test("trimToSpeech clamps padding to the clip and returns null without speech", () => {
  const samples = new Float32Array(SAMPLE_RATE); // 1 s
  const r = trimToSpeech(samples, [[5, 95]], 300);
  assert.ok(r);
  assert.equal(r.startMs, 0);
  assert.equal(r.endMs, 1000);
  assert.equal(trimToSpeech(samples, [], 300), null);
});
