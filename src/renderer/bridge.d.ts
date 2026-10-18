// Shape of the API that preload.cts exposes on window.diktatorn.
import type { DebugResult, StatusUpdate } from "../shared/ipc.ts";

declare global {
  interface Window {
    diktatorn: {
      capture: {
        onStart(cb: () => void): void;
        onStop(cb: () => void): void;
        onCancel(cb: () => void): void;
        started(micStartMs: number): void;
        audio(samples: Float32Array): void;
        error(message: string): void;
      };
      debug: {
        onStatus(cb: (status: StatusUpdate) => void): void;
        onResult(cb: (result: DebugResult) => void): void;
        record(down: boolean): void;
      };
    };
  }
}
