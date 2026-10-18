// Debug window: helper/model/mic status and every transcript with its language decision
// and timings.
import type { DebugResult, StatusUpdate } from "../shared/ipc.ts";

const api = window.diktatorn.debug;
const statusEl = document.getElementById("status")!;
const resultsEl = document.getElementById("results")!;
const recordBtn = document.getElementById("record")!;
const rows = new Map<string, HTMLElement>();

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

api.onStatus((s: StatusUpdate) => {
  let value = rows.get(s.key);
  if (!value) {
    statusEl.append(el("span", "", s.key));
    value = el("span", "", "");
    statusEl.append(value);
    rows.set(s.key, value);
  }
  value.className = s.ok ? "ok" : "bad";
  value.textContent = s.text;
});

const ms = (n: number) => `${Math.round(n)} ms`;

api.onResult((r: DebugResult) => {
  const item = el("div", "result", "");
  item.append(el("div", "text", r.speech ? r.text || "(empty transcript)" : "(no speech detected)"));
  const probs = r.probs ? ` · p(sv) ${r.probs.sv.toFixed(3)} p(en) ${r.probs.en.toFixed(3)}` : "";
  const lang = r.language ? `${r.language} (${r.reason})${probs}` : "–";
  const t = r.timings;
  item.append(el("div", "meta", `${r.at} · ${lang}`));
  item.append(
    el(
      "div",
      "meta",
      `audio ${ms(r.audioMs)} · speech ${ms(r.speechMs)} · mic start ${r.micStartMs === null ? "–" : ms(r.micStartMs)}` +
        ` · vad ${ms(t.vadMs)} · detect ${ms(t.detectMs)} · transcribe ${ms(t.transcribeMs)} · total ${ms(t.totalMs)}`,
    ),
  );
  resultsEl.prepend(item);
});

recordBtn.addEventListener("pointerdown", () => api.record(true));
recordBtn.addEventListener("pointerup", () => api.record(false));
recordBtn.addEventListener("pointerleave", (e) => e.buttons && api.record(false));
