// Push-to-talk state machine for the fn key. Recording starts on press so no speech is
// lost; a release turns it into a real utterance only if the key was held long enough
// and fn was not used as a modifier for another key.
export type PttAction = "start" | "stop" | "cancel" | "none";

export class PushToTalk {
  private downAt: number | null = null;
  private cancelled = false;
  private readonly minHoldMs: number;

  constructor(opts: { minHoldMs: number }) {
    this.minHoldMs = opts.minHoldMs;
  }

  fnDown(t: number): PttAction {
    if (this.downAt !== null) return "none";
    this.downAt = t;
    this.cancelled = false;
    return "start";
  }

  fnUp(t: number): PttAction {
    if (this.downAt === null) return "none";
    const held = t - this.downAt;
    const wasCancelled = this.cancelled;
    this.downAt = null;
    if (wasCancelled) return "none";
    return held >= this.minHoldMs ? "stop" : "cancel";
  }

  /** Another key went down while fn was held. */
  chord(_t: number): PttAction {
    if (this.downAt === null || this.cancelled) return "none";
    this.cancelled = true;
    return "cancel";
  }
}
