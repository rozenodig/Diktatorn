// Overlay pill: shows the dictation state. It never receives input; the window is
// click-through and cannot take focus.
import type { OverlayUpdate } from "../shared/ipc.ts";

const pill = document.getElementById("pill")!;
const text = document.getElementById("text")!;

window.diktatorn.overlay.onState((update: OverlayUpdate) => {
  pill.dataset.state = update.state;
  text.textContent = update.text;
});
