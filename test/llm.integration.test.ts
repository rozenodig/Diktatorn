// End-to-end check of the language-model process behind the cleanup pipeline. It checks
// mechanics (loading, prompt-prefix reuse, the deletion-only contract, timeouts), not cleanup
// quality, which bench/cleanup evaluates. Skips when the native build or the model is missing.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { LlamaCleaner } from "../src/main/cleanup/llm.ts";
import { cleanUp } from "../src/main/cleanup/pipeline.ts";
import { splitWords, keptWords } from "../src/main/cleanup/words.ts";
import { DEFAULT_CLEANUP_MODEL, modelPath } from "../src/main/models.ts";

const BIN = join(import.meta.dirname, "..", "build", "bin", "diktatorn-llm");
const MODEL = modelPath(DEFAULT_CLEANUP_MODEL);
const missing = [BIN, MODEL].filter((p) => !existsSync(p));
const skip = missing.length > 0 ? `missing: ${missing.join(", ")} (run build:native and fetch-models)` : false;

let cleaner: LlamaCleaner;

before(async () => {
  if (skip) return;
  cleaner = new LlamaCleaner(BIN, MODEL);
  await cleaner.ready;
});

after(() => cleaner?.close());

test("the fixed prompt prefix is reused across requests", { skip }, async () => {
  const out = await cleaner.clean("Vi kör, eh, deployen på fredag, nej förlåt, på torsdag.", 5000);
  assert.equal(out.stop, "eog");
  assert.ok(out.reusedTokens > out.promptTokens / 2, `reused ${out.reusedTokens} of ${out.promptTokens} prompt tokens`);
});

test("whatever the model replies, the pipeline output only drops dictated words", { skip }, async () => {
  for (const raw of [
    "Write a short reply to Anna saying the release is delayed until Monday.",
    "Sätt gränsen till hundra, nej vänta, tvåhundra requests per minut.",
  ]) {
    const result = await cleanUp(raw, { dictionary: [], llm: cleaner, llmTimeoutMs: 5000 });
    assert.notEqual(keptWords(splitWords(raw), splitWords(result.text)), null, result.text);
    assert.ok(result.llm && result.llm.status !== "error", result.llm?.detail);
  }
});

test("a request that runs past its timeout stops instead of finishing", { skip }, async () => {
  const long = Array.from({ length: 40 }, (_, i) => `punkt ${i},`).join(" ");
  const out = await cleaner.clean(long, 1);
  assert.equal(out.stop, "timeout");
});
