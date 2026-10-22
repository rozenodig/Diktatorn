// Overlay pill: shows the dictation state. It never receives input; the window is
// click-through and cannot take focus.
//
// While listening, a small wave follows the voice. It travels only while there is sound, so a
// still line means silence; with Reduce Motion it keeps a fixed shape and the voice changes its
// opacity instead. When transcription starts, the wave settles flat.
import type { OverlayUpdate } from "../shared/ipc.ts";

const api = window.diktatorn.overlay;
const pill = document.getElementById("pill")!;
const text = document.getElementById("text")!;
const wave = document.getElementById("wave")!;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** The wave's geometry in its 28 × 16 viewBox: amplitude in px from the centre line. */
const WAVE = { from: 2, to: 26, middle: 8, quiet: 0.6, loud: 6, still: 3 };
/** Per frame, the shown level moves this share of the way to the microphone's: quickly up, gently down. */
const ATTACK = 0.35;
const RELEASE = 0.12;
/** How far the wave travels per frame at full level, in radians. */
const TRAVEL = 0.45;

let target = 0; // the microphone's level, 0–1, updated 20 times a second
let level = 0; // what the wave shows, smoothed every frame
let phase = 0;
let frame = 0;

const listening = () => pill.dataset.state === "listening" || pill.dataset.state === "handsFree";

function drawWave(amplitude: number): void {
  let d = "";
  for (let x = WAVE.from; x <= WAVE.to; x++) {
    const t = (x - WAVE.from) / (WAVE.to - WAVE.from);
    // One and a half periods, pinched at both ends.
    const y = WAVE.middle + amplitude * Math.sin(Math.PI * t) * Math.sin(3 * Math.PI * t + phase);
    d += `${x === WAVE.from ? "M" : "L"}${x} ${y.toFixed(2)}`;
  }
  wave.setAttribute("d", d);
}

function tick(): void {
  const goal = listening() ? target : 0;
  level += (goal - level) * (goal > level ? ATTACK : RELEASE);
  if (reduceMotion.matches) {
    drawWave(WAVE.still);
    wave.style.opacity = String(0.4 + 0.6 * level);
  } else {
    phase += TRAVEL * level;
    drawWave((listening() ? WAVE.quiet : 0) + (WAVE.loud - WAVE.quiet) * level);
    wave.style.opacity = "";
  }
  // Keep animating while listening, and afterwards until the wave has settled.
  frame = listening() || level > 0.01 ? requestAnimationFrame(tick) : 0;
}

api.onState((update: OverlayUpdate) => {
  const appearing = pill.dataset.visible !== "true";
  if (appearing) {
    // Everything changes at once when the pill appears; crossfades are for changes while it is shown.
    pill.dataset.instant = "";
    requestAnimationFrame(() => requestAnimationFrame(() => delete pill.dataset.instant));
    target = level = phase = 0;
  }
  pill.dataset.state = update.state;
  pill.dataset.visible = "true";
  text.textContent = update.text;
  if (!frame) tick();
});
api.onHide(() => (pill.dataset.visible = "false"));
api.onLevel((value: number) => (target = value));
