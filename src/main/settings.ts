// User settings, stored as settings.json in the app's data folder. Reading is forgiving: a
// missing file, unreadable JSON or an invalid value falls back to the default for that value,
// so a hand-edited file can never stop the app from starting. Writes are atomic.
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { APPEARANCES, HOTKEYS, LANGUAGE_MODES, SWEDISH_MODELS, type Settings } from "../shared/ipc.ts";

export const DEFAULT_SETTINGS: Settings = {
  hotkey: "fn",
  microphoneId: null,
  languageMode: "auto",
  swedishModel: "kb-whisper-medium",
  smartCleanup: true,
  appearance: "system",
};

/** Keeps every valid value from `raw` and the default for everything else. */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
    values.includes(value as T) ? (value as T) : fallback;
  return {
    hotkey: oneOf(HOTKEYS, r.hotkey, base.hotkey),
    microphoneId:
      r.microphoneId === null || (typeof r.microphoneId === "string" && r.microphoneId !== "")
        ? r.microphoneId
        : base.microphoneId,
    languageMode: oneOf(LANGUAGE_MODES, r.languageMode, base.languageMode),
    swedishModel: oneOf(SWEDISH_MODELS, r.swedishModel, base.swedishModel),
    smartCleanup: typeof r.smartCleanup === "boolean" ? r.smartCleanup : base.smartCleanup,
    appearance: oneOf(APPEARANCES, r.appearance, base.appearance),
  };
}

/** Writes to a temporary file next to `path` and renames it into place. */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

export class SettingsStore {
  readonly path: string;
  private value: Settings = DEFAULT_SETTINGS;
  private writes: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  get current(): Settings {
    return this.value;
  }

  async load(): Promise<Settings> {
    try {
      this.value = parseSettings(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      this.value = DEFAULT_SETTINGS;
    }
    return this.value;
  }

  /** Applies the valid parts of `patch`, saves, and returns the new settings. */
  async update(patch: Partial<Settings>): Promise<Settings> {
    this.value = parseSettings({ ...this.value, ...patch }, this.value);
    const text = `${JSON.stringify(this.value, null, 2)}\n`;
    this.writes = this.writes.then(() => writeFileAtomic(this.path, text));
    await this.writes;
    return this.value;
  }
}
