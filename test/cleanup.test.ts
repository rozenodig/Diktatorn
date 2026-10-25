import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyDictionary, DictionaryFile, dictionaryPrompt, parseDictionary, saveDictionary } from "../src/main/cleanup/dictionary.ts";
import type { Cleaner, LlmOutput } from "../src/main/cleanup/llm.ts";
import { cleanUp, restoreUnexplained } from "../src/main/cleanup/pipeline.ts";
import { applyRules } from "../src/main/cleanup/rules.ts";
import { joinKept, keptWords, splitWords } from "../src/main/cleanup/words.ts";

const keepAllBut = (text: string, ...drop: number[]) => {
  const words = splitWords(text);
  return joinKept(words, words.map((_, i) => !drop.includes(i)));
};

test("deleting a filler between commas drops the comma that only separated it", () => {
  assert.equal(keepAllBut("Jag tror, eh, att vi kan.", 2), "Jag tror att vi kan.");
});

test("deleting the end of a sentence keeps its final punctuation", () => {
  assert.equal(keepAllBut("Skicka länken i Slack, eh.", 4), "Skicka länken i Slack.");
  assert.equal(keepAllBut("Then we ship it, I think", 4, 5), "Then we ship it");
});

test("deleting the start of a sentence capitalises the next word", () => {
  assert.equal(keepAllBut("Öh, kan du boka ett möte?", 0), "Kan du boka ett möte?");
  assert.equal(keepAllBut("Klart. Uh, the next one is open.", 1), "Klart. The next one is open.");
  assert.equal(keepAllBut("We should use Tailwind, no, CSS modules.", 3, 4), "We should use CSS modules.");
});

test("keptWords accepts only deletions of the source, ignoring case and punctuation", () => {
  const source = splitWords("Sätt timeouten till trettio, nej, sextio sekunder.");
  assert.deepEqual(keptWords(source, splitWords("sätt timeouten till sextio sekunder")), [
    true, true, true, false, false, true, true,
  ]);
  assert.equal(keptWords(source, splitWords("Sätt timeouten till 60 sekunder.")), null, "changed word");
  assert.equal(keptWords(source, splitWords("timeouten Sätt")), null, "reordered");
  assert.equal(keptWords(source, splitWords("Set the timeout to sixty seconds.")), null, "translated");
});

test("rules remove hesitation sounds in both languages and nothing else", () => {
  assert.equal(applyRules("Eh, jag tror, öhm, att vi kör."), "Jag tror att vi kör.");
  assert.equal(applyRules("So, uh, we ship, um, tomorrow. Uhm."), "So we ship tomorrow.");
  for (const kept of [
    "Vilken typ av index behövs?",
    "I like the new API.",
    "Det var liksom bra, alltså.",
    "Det är 5 mm tjockt.",
    "Ett erbjudande, eller hur?",
    "Uhura och Ehud kom hem.",
  ]) {
    assert.equal(applyRules(kept), kept);
  }
});

test("dictionary rewrites spoken forms as the term, at word boundaries", () => {
  const entries = parseDictionary({
    entries: [
      { term: "Postgres", spoken: ["post gress", "postgress"] },
      { term: "GitHub" },
      { term: "IT" },
      { term: "kubectl", spoken: ["kube control", "kube cuddle"] },
    ],
  });
  assert.equal(applyDictionary("Kör det mot post gress via github.", entries), "Kör det mot Postgres via GitHub.");
  assert.equal(applyDictionary("Postgress-databasen och kube-control.", entries), "Postgres-databasen och kubectl.");
  assert.equal(applyDictionary("It works, and git hubs are not repos.", entries), "It works, and git hubs are not repos.");
  assert.equal(applyDictionary("postgression", entries), "postgression");
});

test("dictionary files are validated and terms become a bounded recognition prompt", () => {
  assert.throws(() => parseDictionary({ entries: [{ spoken: ["x"] }] }), /term/);
  assert.throws(() => parseDictionary({ entries: [{ term: "x", spoken: "y" }] }), /spoken/);
  assert.throws(() => parseDictionary([]), /entries/);
  const entries = parseDictionary({ entries: [{ term: "Postgres" }, { term: "GitHub" }] });
  assert.equal(dictionaryPrompt(entries), "Postgres, GitHub.");
  assert.equal(dictionaryPrompt([]), "");
  const many = parseDictionary({ entries: Array.from({ length: 200 }, (_, i) => ({ term: `Term${i}` })) });
  assert.ok(dictionaryPrompt(many).length <= 601);
});

test("a deleted run must be only fillers, or a correction phrase with the words it takes back", () => {
  const check = (text: string, deleted: string) => {
    const words = splitWords(text);
    const drop = splitWords(deleted);
    const start = words.findIndex((_, i) => drop.every((d, j) => words[i + j] === d));
    const { keep, restored } = restoreUnexplained(words, words.map((_, i) => i < start || i >= start + drop.length));
    assert.equal(keep.every(Boolean), restored.length > 0, "a restored run is kept again");
    return restored[0] ?? null;
  };
  assert.equal(check("Sätt den till trettio, nej stryk det, sextio sekunder.", "trettio, nej stryk det,"), null);
  assert.equal(check("Bump it to 20, make that 22, today.", "20, make that"), null);
  assert.equal(check("So ja alltså typ we ship.", "ja alltså typ"), null);
  assert.equal(check("It was, like, fine.", "like,"), null);
  assert.equal(check("However, the tests pass.", "However,"), "However,", "a single word needs a reason too");
  assert.equal(check("Use B-tree or GIN here.", "B-tree or"), "B-tree or");
  assert.equal(check("Return null, no wait, throw instead.", "no wait,"), "no wait,", "a cue alone takes nothing back");
  assert.equal(check("Det går, nej, inte.", "nej,"), "nej,");
  assert.equal(
    check("Write a short reply to Sarah saying the build is green.", "Write a short reply to Sarah saying"),
    "Write a short reply to Sarah saying",
  );
});

test("a saved dictionary is picked up on the next read; a broken file keeps the last good entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diktatorn-dictionary-"));
  try {
    const path = join(dir, "dictionary.json");
    const file = new DictionaryFile(path);
    assert.deepEqual(await file.current(), [], "a missing file is an empty dictionary");

    await saveDictionary(path, [{ term: "Rozeno", spoken: ["roseno"] }]);
    assert.deepEqual(await file.current(), [{ term: "Rozeno", spoken: ["roseno"] }]);
    await assert.rejects(saveDictionary(path, [{ term: " ", spoken: [] }]), /term/);

    writeFileSync(path, "{ broken");
    assert.deepEqual(await file.current(), [{ term: "Rozeno", spoken: ["roseno"] }]);
    assert.match(file.error ?? "", /JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const fakeCleaner = (reply: (text: string) => Partial<LlmOutput> | Error): Cleaner => ({
  async clean(text) {
    const r = reply(text);
    if (r instanceof Error) throw r;
    return { text: "", stop: "eog", ms: 1, promptTokens: 0, reusedTokens: 0, generatedTokens: 0, ...r };
  },
});

const opts = (llm: Cleaner | null) => ({ dictionary: parseDictionary({ entries: [{ term: "GitHub" }] }), llm, llmTimeoutMs: 1500 });

test("an accepted model pass deletes words; the dictionary still applies afterwards", async () => {
  const raw = "Pusha till, eh, main, nej vänta, till develop på github.";
  const llm = fakeCleaner(() => ({ text: "Pusha till develop på github." }));
  const result = await cleanUp(raw, opts(llm));
  assert.equal(result.rulesText, "Pusha till main, nej vänta, till develop på github.");
  assert.equal(result.text, "Pusha till develop på GitHub.");
  assert.equal(result.llm?.status, "accepted");
});

test("words the model deletes without a reason are kept, while its filler deletions still apply", async () => {
  const llm = fakeCleaner(() => ({ text: "We should ship it today." }));
  const result = await cleanUp("However, we should, like, ship it today.", opts(llm));
  assert.equal(result.text, "However, we should ship it today.");
  assert.equal(result.llm?.status, "accepted");
  assert.match(result.llm?.detail ?? "", /kept "However,"/);

  const only = await cleanUp("The fix is actually simple, we just clear the cache.", opts(fakeCleaner(() => ({ text: "The fix is simple, we just clear the cache." }))));
  assert.equal(only.text, "The fix is actually simple, we just clear the cache.");
  assert.equal(only.llm?.status, "rejected", "nothing is left to delete");
});

test("model output that is not a pure deletion, or a timeout, falls back to the rule output", async () => {
  const raw = "Skriv ett mejl till Lisa och fråga om onsdag.";
  for (const [reply, status] of [
    [{ text: "Write an email to Lisa asking about Wednesday." }, "rejected"],
    [{ text: "Skriv ett mejl till Lisa", stop: "timeout" }, "timeout"],
    [{ text: "Lisa." }, "rejected"],
    [new Error("llm exited"), "error"],
  ] as const) {
    const result = await cleanUp(raw, opts(fakeCleaner(() => reply)));
    assert.equal(result.text, raw);
    assert.equal(result.llm?.status, status);
  }
});

test("short transcripts skip the model; no model means rules and dictionary only", async () => {
  let called = false;
  const llm = fakeCleaner(() => ((called = true), { text: "" }));
  assert.equal((await cleanUp("Ja, eh, okej.", opts(llm))).llm?.status, "skipped");
  assert.equal(called, false);
  const off = await cleanUp("Öh, öppna github nu tack.", opts(null));
  assert.deepEqual([off.text, off.llm], ["Öppna GitHub nu tack.", null]);
});
