// Decides whether a crashed helper process is restarted: after a delay that grows with each
// recent crash, and not at all once it has crashed too often in a short time, so a model that
// crashes while loading cannot put the app into a restart loop.
export class RestartPolicy {
  private readonly maxCrashes: number;
  private readonly windowMs: number;
  private crashes: number[] = [];

  constructor(opts: { maxCrashes: number; windowMs: number } = { maxCrashes: 3, windowMs: 5 * 60_000 }) {
    this.maxCrashes = opts.maxCrashes;
    this.windowMs = opts.windowMs;
  }

  /** Records a crash at `now` (ms). Returns the delay before restarting, or null to give up. */
  crashed(now: number): number | null {
    this.crashes = this.crashes.filter((t) => now - t < this.windowMs);
    this.crashes.push(now);
    return this.crashes.length > this.maxCrashes ? null : 1000 * this.crashes.length;
  }
}
