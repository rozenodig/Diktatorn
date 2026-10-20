// The user dictionary: terms that should always be written a certain way, each with optional
// spoken forms that the recogniser tends to produce instead. Terms also become the
// recogniser's initial prompt, which biases it towards them in the first place.
import { readFile, stat } from "node:fs/promises";
import type { DictionaryEntry } from "../../shared/ipc.ts";
import { writeFileAtomic } from "../settings.ts";

export type { DictionaryEntry };

/** Whisper reads at most about 224 prompt tokens; stay well below that. */
const MAX_PROMPT_CHARS = 600;

export function parseDictionary(json: unknown): DictionaryEntry[] {
  const entries = (json as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error("expected an object with an 'entries' array");
  return entries.map((raw, i) => {
    const { term, spoken = [] } = (raw ?? {}) as { term?: unknown; spoken?: unknown };
    if (typeof term !== "string" || !term.trim()) throw new Error(`entry ${i}: 'term' must be a non-empty string`);
    if (!Array.isArray(spoken) || !spoken.every((s) => typeof s === "string" && s.trim())) {
      throw new Error(`entry ${i}: 'spoken' must be a list of non-empty strings`);
    }
    return { term: term.trim(), spoken: spoken.map((s: string) => s.trim()) };
  });
}

/** Reads a dictionary file; a missing file is an empty dictionary. */
export async function loadDictionary(path: string): Promise<DictionaryEntry[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return parseDictionary(JSON.parse(text));
}

/** Validates and saves a dictionary; the file is replaced atomically. */
export async function saveDictionary(path: string, entries: DictionaryEntry[]): Promise<DictionaryEntry[]> {
  const valid = parseDictionary({ entries });
  await writeFileAtomic(path, `${JSON.stringify({ entries: valid }, null, 2)}\n`);
  return valid;
}

/** Re-reads the dictionary file whenever it changes on disk, so edits apply to the next dictation. */
export class DictionaryFile {
  readonly path: string;
  private mtimeMs = -1;
  private entries: DictionaryEntry[] = [];
  /** Why the file on disk could not be used; the last good entries stay in effect meanwhile. */
  error: string | null = null;

  constructor(path: string) {
    this.path = path;
  }

  async current(): Promise<DictionaryEntry[]> {
    const mtimeMs = (await stat(this.path).catch(() => null))?.mtimeMs ?? 0;
    if (mtimeMs !== this.mtimeMs) {
      this.mtimeMs = mtimeMs;
      try {
        this.entries = await loadDictionary(this.path);
        this.error = null;
      } catch (err) {
        this.error = (err as Error).message;
      }
    }
    return this.entries;
  }
}

/**
 * Rewrites every spoken form as its term. The term itself is also matched case-insensitively
 * when its spelling is distinctive (GitHub, macOS, user_id, Node.js); plain words, names and
 * all-caps acronyms are not, so "Go" or "IT" does not rewrite every "go" or "it".
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  for (const { term, spoken } of entries) {
    const forms = hasDistinctiveSpelling(term) ? [term, ...spoken] : spoken;
    if (forms.length === 0) continue;
    const alternatives = [...forms].sort((a, b) => b.length - a.length).map(flexiblePattern);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
    text = text.replace(pattern, () => term);
  }
  return text;
}

export function dictionaryPrompt(entries: DictionaryEntry[]): string {
  let prompt = "";
  for (const { term } of entries) {
    const next = prompt ? `${prompt}, ${term}` : term;
    if (next.length > MAX_PROMPT_CHARS) break;
    prompt = next;
  }
  return prompt ? `${prompt}.` : "";
}

function hasDistinctiveSpelling(term: string): boolean {
  return /[^\p{L}]|\p{Ll}\p{Lu}/u.test(term);
}

/** Escapes the form for a regex and lets spaces and hyphens inside it match either or neither. */
function flexiblePattern(form: string): string {
  return form
    .split(/[\s-]+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s-]*");
}
