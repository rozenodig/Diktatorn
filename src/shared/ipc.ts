// IPC channel names and payloads shared by the main process, preload and renderers.
export const IPC = {
  captureStart: "capture:start",
  captureStop: "capture:stop",
  captureCancel: "capture:cancel",
  captureStarted: "capture:started",
  captureAudio: "capture:audio",
  captureError: "capture:error",
  debugStatus: "debug:status",
  debugResult: "debug:result",
  debugRecord: "debug:record",
  overlayState: "overlay:state",
} as const;

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
  insertion: { app: string | null; kind: string; pasted: boolean; restored: boolean; note: string; ms: number } | null;
}
