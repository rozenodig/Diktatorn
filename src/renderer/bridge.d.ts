// Shape of the API that preload.cts exposes on window.diktatorn.
import type { AppState, DebugResult, DictionaryEntry, OverlayUpdate, Settings, StatusUpdate } from "../shared/ipc.ts";

declare global {
  interface Window {
    diktatorn: {
      capture: {
        onStart(cb: () => void): void;
        onStop(cb: () => void): void;
        onCancel(cb: () => void): void;
        onDevice(cb: (deviceId: string | null) => void): void;
        started(micStartMs: number): void;
        audio(samples: Float32Array): void;
        error(message: string): void;
      };
      overlay: {
        onState(cb: (update: OverlayUpdate) => void): void;
      };
      app: {
        getState(): Promise<AppState>;
        onState(cb: (state: AppState) => void): void;
        setSettings(patch: Partial<Settings>): Promise<Settings>;
        setDictionary(entries: DictionaryEntry[]): Promise<{ ok: boolean; error?: string }>;
        download(ids: string[]): void;
        cancelDownload(): void;
        copy(text: string): void;
      };
      debug: {
        onStatus(cb: (status: StatusUpdate) => void): void;
        onResult(cb: (result: DebugResult) => void): void;
        record(down: boolean): void;
      };
    };
  }
}
