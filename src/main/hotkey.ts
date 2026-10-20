// Dictation hotkey state machine (fn or a right-hand modifier). Recording starts on the first
// press so no speech is lost; what the press turns into is decided afterwards:
//   hold, then release                  -> push-to-talk: stop and transcribe on release
//   quick tap, second press in window   -> hands-free: keep recording after release
//   tap while hands-free                -> stop and transcribe
//   single quick tap (window expires)   -> discarded
//   hotkey + another key, or Esc        -> cancel
// The double-tap window is a timer owned by the caller: after "pending" it calls expire().
export type HotkeyAction = "start" | "pending" | "handsFree" | "stop" | "cancel" | "none";

type State =
  | { kind: "idle" }
  | { kind: "holding"; downAt: number; chorded: boolean }
  | { kind: "tapped" } // first tap released; recording continues until expire() or a second press
  | { kind: "arming" } // second press of the double-tap still held
  | { kind: "handsFree" }
  | { kind: "handsFreeTap"; chorded: boolean };

export class Hotkey {
  private state: State = { kind: "idle" };
  private readonly minHoldMs: number;

  constructor(opts: { minHoldMs: number }) {
    this.minHoldMs = opts.minHoldMs;
  }

  down(t: number): HotkeyAction {
    switch (this.state.kind) {
      case "idle":
        this.state = { kind: "holding", downAt: t, chorded: false };
        return "start";
      case "tapped":
        this.state = { kind: "arming" };
        return "handsFree";
      case "handsFree":
        this.state = { kind: "handsFreeTap", chorded: false };
        return "none";
      default:
        return "none";
    }
  }

  up(t: number): HotkeyAction {
    const s = this.state;
    switch (s.kind) {
      case "holding":
        if (s.chorded) {
          this.state = { kind: "idle" };
          return "none";
        }
        if (t - s.downAt >= this.minHoldMs) {
          this.state = { kind: "idle" };
          return "stop";
        }
        this.state = { kind: "tapped" };
        return "pending";
      case "arming":
        this.state = { kind: "handsFree" };
        return "none";
      case "handsFreeTap":
        if (s.chorded) {
          this.state = { kind: "handsFree" };
          return "none";
        }
        this.state = { kind: "idle" };
        return "stop";
      default:
        return "none";
    }
  }

  /** Another key went down while the hotkey was held. */
  chord(): HotkeyAction {
    const s = this.state;
    if (s.kind === "holding" && !s.chorded) {
      s.chorded = true;
      return "cancel";
    }
    if (s.kind === "handsFreeTap") s.chorded = true;
    return "none";
  }

  /** The double-tap window after a quick tap has passed. */
  expire(): HotkeyAction {
    if (this.state.kind !== "tapped") return "none";
    this.state = { kind: "idle" };
    return "cancel";
  }

  escape(): HotkeyAction {
    const s = this.state;
    if (s.kind === "idle" || (s.kind === "holding" && s.chorded)) return "none";
    this.state = { kind: "idle" };
    return "cancel";
  }
}
