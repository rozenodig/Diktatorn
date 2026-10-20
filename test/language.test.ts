import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseLanguage } from "../src/main/language.ts";

const base = { override: "auto", speechMs: 3000, previous: null, primary: "sv" } as const;

test("manual override wins over detection", () => {
  const r = chooseLanguage({ ...base, override: "en", probs: { sv: 0.99, en: 0.01 } });
  assert.deepEqual(r, { language: "en", reason: "override" });
});

test("confident detection routes to the detected language", () => {
  assert.equal(chooseLanguage({ ...base, probs: { sv: 0.8, en: 0.1 } }).language, "sv");
  assert.equal(chooseLanguage({ ...base, probs: { sv: 0.05, en: 0.9 } }).language, "en");
});

test("only the sv/en ratio matters, not absolute probability mass", () => {
  // e.g. Norwegian took most of the mass; sv still clearly beats en
  const r = chooseLanguage({ ...base, probs: { sv: 0.2, en: 0.02 } });
  assert.deepEqual(r, { language: "sv", reason: "detected" });
});

test("short clips fall back to the previous language, then the primary one", () => {
  const short = { ...base, speechMs: 800, probs: { sv: 0.01, en: 0.99 } };
  assert.deepEqual(chooseLanguage({ ...short, previous: "en" }), { language: "en", reason: "short-clip" });
  assert.deepEqual(chooseLanguage(short), { language: "sv", reason: "short-clip" });
});

test("ambiguous detection falls back like a short clip", () => {
  const r = chooseLanguage({ ...base, previous: "en", probs: { sv: 0.45, en: 0.4 } });
  assert.deepEqual(r, { language: "en", reason: "ambiguous" });
});

test("no probability mass at all is ambiguous", () => {
  const r = chooseLanguage({ ...base, probs: { sv: 0, en: 0 } });
  assert.deepEqual(r, { language: "sv", reason: "ambiguous" });
});
