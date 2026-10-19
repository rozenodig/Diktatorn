// Which models are on disk, plus a download queue that reports progress to the app window.
// Events: "change" whenever the state shown in the window changes, "ready" (id) when a
// download has finished and been verified.
import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import type { ModelInfo, ModelStatus } from "../shared/ipc.ts";
import { downloadModel } from "./download.ts";
import { MODELS, modelPath, type ModelId } from "./models.ts";

const PROGRESS_INTERVAL_MS = 250;

export class ModelStore extends EventEmitter {
  private readonly userDataDir: string;
  private queue: ModelId[] = [];
  private active: { id: ModelId; received: number; abort: AbortController } | null = null;
  private readonly errors = new Map<ModelId, string>();

  constructor(userDataDir: string) {
    super();
    this.userDataDir = userDataDir;
  }

  path(id: ModelId): string {
    return modelPath(id, this.userDataDir);
  }

  /** On disk with the expected size. The content was verified when it was downloaded. */
  isReady(id: ModelId): boolean {
    try {
      return statSync(this.path(id)).size === MODELS[id].bytes;
    } catch {
      return false;
    }
  }

  info(): ModelInfo[] {
    return (Object.keys(MODELS) as ModelId[]).map((id) => ({
      id,
      name: MODELS[id].name,
      bytes: MODELS[id].bytes,
      status: this.status(id),
      received: this.active?.id === id ? this.active.received : 0,
      error: this.errors.get(id) ?? null,
    }));
  }

  /** Queues the models that are not on disk yet. Downloads run one at a time, in order. */
  download(ids: ModelId[]): void {
    for (const id of ids) {
      if (this.isReady(id) || this.active?.id === id || this.queue.includes(id)) continue;
      this.errors.delete(id);
      this.queue.push(id);
    }
    this.emit("change");
    void this.next();
  }

  /** Stops the current download, keeping its partial file for a later resume, and clears the queue. */
  cancel(): void {
    this.queue = [];
    this.active?.abort.abort();
    this.emit("change");
  }

  private status(id: ModelId): ModelStatus {
    if (this.active?.id === id) return "downloading";
    if (this.queue.includes(id)) return "queued";
    if (this.isReady(id)) return "ready";
    return this.errors.has(id) ? "error" : "missing";
  }

  private async next(): Promise<void> {
    if (this.active) return;
    const id = this.queue.shift();
    if (!id) return;
    const active = { id, received: 0, abort: new AbortController() };
    this.active = active;
    let lastEmit = 0;
    try {
      await downloadModel(MODELS[id], this.path(id), {
        signal: active.abort.signal,
        onProgress: (received) => {
          active.received = received;
          if (performance.now() - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = performance.now();
            this.emit("change");
          }
        },
      });
      this.active = null;
      this.emit("ready", id);
    } catch (err) {
      this.active = null;
      if (!active.abort.signal.aborted) this.errors.set(id, (err as Error).message);
    }
    this.emit("change");
    void this.next();
  }
}
