// IPC channel names and payloads shared by the main process, preload and renderers.
export const IPC = {
  captureStart: "capture:start",
  captureStop: "capture:stop",
  captureCancel: "capture:cancel",
  captureStarted: "capture:started",
  captureAudio: "capture:audio",
  captureError: "capture:error",
  captureDevice: "capture:device",
  debugStatus: "debug:status",
  debugResult: "debug:result",
  debugRecord: "debug:record",
  overlayState: "overlay:state",
  appState: "app:state",
  appGetState: "app:get-state",
  appSetSettings: "app:set-settings",
  appSetDictionary: "app:set-dictionary",
  appDownload: "app:download",
  appCancelDownload: "app:cancel-download",
  appCopy: "app:copy",
} as const;

/** Keys that can be the dictation hotkey; none of them types anything by itself. */
export const HOTKEYS = ["fn", "rightOption", "rightCommand", "rightControl"] as const;
export type HotkeyKey = (typeof HOTKEYS)[number];
export const SWEDISH_MODELS = ["kb-whisper-medium", "kb-whisper-large"] as const;
export const LANGUAGE_MODES = ["auto", "sv", "en"] as const;
export const APPEARANCES = ["system", "light", "dark"] as const;

export interface Settings {
  hotkey: HotkeyKey;
  /** A microphone's deviceId, or null for the system default. */
  microphoneId: string | null;
  languageMode: (typeof LANGUAGE_MODES)[number];
  swedishModel: (typeof SWEDISH_MODELS)[number];
  smartCleanup: boolean;
  appearance: (typeof APPEARANCES)[number];
}

export interface DictionaryEntry {
  /** How the term is written, e.g. "GitHub". */
  term: string;
  /** What the recogniser writes instead, e.g. ["git hub"]. Matched case-insensitively. */
  spoken: string[];
}

/** Downloaded automatically on first run: both speech models, voice detection and cleanup. */
export const FIRST_RUN_MODELS = ["silero-vad", "kb-whisper-medium", "whisper-large-v3-turbo", "gemma-4-e2b-it-qat"] as const;

export type ModelStatus = "missing" | "queued" | "downloading" | "ready" | "error";

export interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  status: ModelStatus;
  received: number;
  error: string | null;
}

export interface RecentDictation {
  at: string;
  text: string;
  app: string | null;
}

/** Everything the app window shows; sent whole whenever something changes. */
export interface AppState {
  settings: Settings;
  statuses: StatusUpdate[];
  models: ModelInfo[];
  recent: RecentDictation[];
  dictionary: DictionaryEntry[];
  /** True until every default model has been downloaded once. */
  setup: boolean;
}

export type OverlayState = "listening" | "handsFree" | "processing" | "done" | "error";

export interface OverlayUpdate {
  state: OverlayState;
  text: string;
}

export interface StatusUpdate {
  key: "keys" | "paste" | "asr" | "cleanup" | "mic" | "recording";
  ok: boolean;
  text: string;
}

export interface DebugResult {
  at: string;
  /** What was inserted: the transcript after cleanup. */
  text: string;
  /** The transcript as recognised. */
  raw: string;
  speech: boolean;
  language: string | null;
  reason: string | null;
  probs: { sv: number; en: number } | null;
  audioMs: number;
  speechMs: number;
  micStartMs: number | null;
  timings: { vadMs: number; detectMs: number; transcribeMs: number; totalMs: number };
  cleanup: { ms: number; llm: { status: string; ms: number; detail: string } | null } | null;
  insertion: { app: string | null; appName: string | null; kind: string; pasted: boolean; restored: boolean; note: string; ms: number } | null;
}
