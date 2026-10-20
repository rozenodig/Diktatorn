// App window: status and recent dictations, settings, dictionary and models, plus the
// first-run setup screen. Everything shown comes from the main process's AppState; changes
// go back through the bridge and return as a new state.
import { FIRST_RUN_MODELS, type AppState, type ModelInfo, type Settings, type StatusUpdate } from "../shared/ipc.ts";

const api = window.diktatorn.app;
type View = "home" | "general" | "dictionary" | "models";
let state: AppState;
let view: View = "home";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h(tag: string, cls = "", text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, cls = "button"): HTMLButtonElement {
  const b = h("button", cls, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

// --- navigation ---------------------------------------------------------------------------

function show(next: View): void {
  if (next === "dictionary" && view !== "dictionary") loadDictionaryDraft();
  if (next === "general") void refreshMicrophones();
  view = next;
  for (const nav of document.querySelectorAll<HTMLElement>(".nav")) {
    if (nav.dataset.view === view) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) panel.hidden = panel.dataset.panel !== view;
}

for (const nav of document.querySelectorAll<HTMLElement>(".nav")) {
  nav.addEventListener("click", () => show(nav.dataset.view as View));
}

// --- home ---------------------------------------------------------------------------------

const KEY_NAMES: Record<Settings["hotkey"], string> = {
  fn: "fn",
  rightOption: "right ⌥",
  rightCommand: "right ⌘",
  rightControl: "right ⌃",
};
const STATUS_TITLES: Partial<Record<StatusUpdate["key"], string>> = {
  keys: "Keyboard access",
  paste: "Pasting",
  mic: "Microphone",
  asr: "Speech recognition",
  cleanup: "Smart cleanup",
};

function renderHome(): void {
  const issues = state.statuses.filter((s) => !s.ok && STATUS_TITLES[s.key]);
  // Dictation is ready once the speech engine is; the optional cleanup model can still be loading.
  const asr = state.statuses.find((s) => s.key === "asr");
  const busy = !asr || (asr.ok && !asr.text.startsWith("ready"));
  const mode = issues.length > 0 ? "attention" : busy ? "busy" : "ready";
  $("home-dot").dataset.state = mode;
  $("home-title").textContent = { ready: "Ready to dictate", busy: "Getting ready…", attention: "Needs your attention" }[mode];

  const hint = $("home-hint");
  hint.replaceChildren(
    "Hold ", h("kbd", "", KEY_NAMES[state.settings.hotkey]), " to dictate · double-tap for hands-free · ",
    h("kbd", "", "esc"), " cancels",
  );

  const language = { auto: "Swedish + English", sv: "Svenska", en: "English" }[state.settings.languageMode];
  $("home-chips").replaceChildren(
    h("span", "chip", language),
    h("span", state.settings.smartCleanup ? "chip on" : "chip", state.settings.smartCleanup ? "Smart cleanup" : "Smart cleanup off"),
  );

  $("home-issues").replaceChildren(
    ...issues.map((s) => {
      const item = h("div", "issue");
      item.append(h("strong", "", STATUS_TITLES[s.key] ?? s.key), s.text);
      return item;
    }),
  );

  const recent = $("home-recent");
  if (state.recent.length === 0) {
    recent.replaceChildren(h("p", "empty", "Your dictations from this session appear here."));
    return;
  }
  recent.replaceChildren(
    ...state.recent.map((r) => {
      const item = h("div", "recent-item");
      const copy = button("Copy", () => {
        api.copy(r.text);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      });
      copy.setAttribute("aria-label", `Copy “${r.text.slice(0, 40)}”`);
      const app = r.app ? ` · ${r.app}` : "";
      item.append(h("p", "", r.text), copy, h("span", "meta", `${r.at}${app}`));
      return item;
    }),
  );
}

// --- general ------------------------------------------------------------------------------

const hotkeySelect = $<HTMLSelectElement>("hotkey");
const micSelect = $<HTMLSelectElement>("microphone");

hotkeySelect.addEventListener("change", () => void api.setSettings({ hotkey: hotkeySelect.value as Settings["hotkey"] }));
micSelect.addEventListener("change", () => void api.setSettings({ microphoneId: micSelect.value || null }));
for (const b of document.querySelectorAll<HTMLElement>("[data-language]")) {
  b.addEventListener("click", () => void api.setSettings({ languageMode: b.dataset.language as Settings["languageMode"] }));
}
for (const b of document.querySelectorAll<HTMLElement>("[data-appearance]")) {
  b.addEventListener("click", () => void api.setSettings({ appearance: b.dataset.appearance as Settings["appearance"] }));
}

async function refreshMicrophones(): Promise<void> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications",
  );
  const options = [new Option("System default", "")];
  devices.forEach((d, i) => options.push(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  const chosen = state.settings.microphoneId;
  if (chosen && !devices.some((d) => d.deviceId === chosen)) options.push(new Option("Unavailable microphone", chosen));
  micSelect.replaceChildren(...options);
  micSelect.value = chosen ?? "";
}
navigator.mediaDevices.addEventListener("devicechange", () => void refreshMicrophones());

function renderGeneral(): void {
  hotkeySelect.value = state.settings.hotkey;
  if (micSelect.options.length > 0) micSelect.value = state.settings.microphoneId ?? "";
  for (const b of document.querySelectorAll<HTMLElement>("[data-language]")) {
    b.setAttribute("aria-checked", String(b.dataset.language === state.settings.languageMode));
  }
  for (const b of document.querySelectorAll<HTMLElement>("[data-appearance]")) {
    b.setAttribute("aria-checked", String(b.dataset.appearance === state.settings.appearance));
  }
}

// --- dictionary ---------------------------------------------------------------------------

/** The rows being edited. Saved shortly after each change; rows without a word are not saved. */
let draft: { term: string; heard: string }[] = [];
let savedJson = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loadDictionaryDraft(): void {
  savedJson = JSON.stringify(state.dictionary);
  draft = state.dictionary.map((e) => ({ term: e.term, heard: e.spoken.join(", ") }));
  renderDictionaryRows();
}

function renderDictionaryRows(focusLast = false): void {
  const rows = draft.map((row, i) => {
    const el = h("div", "dict-row");
    const term = document.createElement("input");
    term.type = "text";
    term.value = row.term;
    term.placeholder = "e.g. GitHub";
    term.setAttribute("aria-label", "Word");
    const heard = document.createElement("input");
    heard.type = "text";
    heard.value = row.heard;
    heard.placeholder = "e.g. git hub";
    heard.setAttribute("aria-label", `What ${row.term || "the word"} is heard as`);
    term.addEventListener("input", () => ((row.term = term.value), scheduleSave()));
    heard.addEventListener("input", () => ((row.heard = heard.value), scheduleSave()));
    const remove = button("✕", () => {
      draft.splice(i, 1);
      renderDictionaryRows();
      scheduleSave();
    }, "icon-button");
    remove.setAttribute("aria-label", `Remove ${row.term || "row"}`);
    el.append(term, heard, remove);
    return el;
  });
  $("dict-rows").replaceChildren(...rows);
  if (draft.length === 0) $("dict-rows").append(h("p", "empty row", "No words yet."));
  if (focusLast) $("dict-rows").querySelector<HTMLInputElement>(".dict-row:last-child input")?.focus();
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const entries = draft
      .filter((r) => r.term.trim())
      .map((r) => ({ term: r.term.trim(), spoken: r.heard.split(",").map((s) => s.trim()).filter(Boolean) }));
    const res = await api.setDictionary(entries);
    savedJson = JSON.stringify(entries);
    $("dict-status").textContent = res.ok ? "Saved" : `Not saved: ${res.error}`;
  }, 500);
}

$("dict-add").addEventListener("click", () => {
  draft.push({ term: "", heard: "" });
  renderDictionaryRows(true);
});

function renderDictionary(): void {
  // Pick up changes made elsewhere (e.g. the file edited by hand) unless the user is typing.
  const editing = $("dict-rows").contains(document.activeElement);
  if (!editing && JSON.stringify(state.dictionary) !== savedJson) loadDictionaryDraft();
}

// --- models -------------------------------------------------------------------------------

function modelState(m: ModelInfo): HTMLElement {
  switch (m.status) {
    case "ready":
      return h("span", "model-state ready", "Downloaded");
    case "queued":
      return h("span", "model-state", "Waiting");
    case "downloading":
      return h("span", "model-state", `${Math.floor((m.received / m.bytes) * 100)}%`);
    case "error":
      return button("Retry", () => api.download([m.id]));
    case "missing":
      return button("Download", () => api.download([m.id]));
  }
}

function modelRow(m: ModelInfo, label: string, sub = "", radio?: { name: string; checked: boolean; onSelect: () => void }): HTMLElement {
  const row = h("div", "model");
  const line = h("div", "model-line");
  if (radio) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = radio.name;
    input.checked = radio.checked;
    input.id = `model-${m.id}`;
    input.addEventListener("change", radio.onSelect);
    line.append(input);
  }
  const title = h(radio ? "label" : "div", "row-title");
  if (radio) title.setAttribute("for", `model-${m.id}`);
  title.append(label);
  if (sub) title.append(h("span", "row-sub", sub));
  line.append(title, h("span", "model-size", formatBytes(m.bytes)), modelState(m));
  if (m.status === "downloading") line.append(button("Cancel", () => api.cancelDownload()));
  row.append(line);
  if (m.status === "downloading" || m.status === "queued") {
    const bar = h("div", "progress");
    const fill = h("span");
    fill.style.width = `${(m.received / m.bytes) * 100}%`;
    bar.append(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${m.name} download`);
    bar.setAttribute("aria-valuenow", String(Math.floor((m.received / m.bytes) * 100)));
    row.append(bar);
  }
  if (m.error) row.append(h("p", "model-error", m.error));
  return row;
}

function renderModels(): void {
  const model = (id: string) => state.models.find((m) => m.id === id)!;
  const swedish = (id: Settings["swedishModel"], sub: string) =>
    modelRow(model(id), `Svenska · ${model(id).name}`, sub, {
      name: "swedish-model",
      checked: state.settings.swedishModel === id,
      onSelect: () => void api.setSettings({ swedishModel: id }),
    });
  $("models-speech").replaceChildren(
    swedish("kb-whisper-medium", "Fast. Recommended for most Macs."),
    swedish("kb-whisper-large", "More accurate, about a third slower."),
    modelRow(model("whisper-large-v3-turbo"), `English · ${model("whisper-large-v3-turbo").name}`),
    modelRow(model("silero-vad"), model("silero-vad").name, "Skips silence before transcribing."),
  );
  const toggle = $("cleanup-toggle");
  toggle.setAttribute("aria-checked", String(state.settings.smartCleanup));
  $("models-cleanup").replaceChildren(modelRow(model("gemma-4-e2b-it-qat"), model("gemma-4-e2b-it-qat").name, "Runs on your Mac."));
}

$("cleanup-toggle").addEventListener("click", () => void api.setSettings({ smartCleanup: !state.settings.smartCleanup }));

// --- first-run setup ----------------------------------------------------------------------

function renderSetup(): void {
  $("setup").hidden = !state.setup;
  $("main").hidden = state.setup;
  if (!state.setup) return;
  const models = FIRST_RUN_MODELS.map((id) => state.models.find((m) => m.id === id)!);
  $("setup-models").replaceChildren(...models.map((m) => modelRow(m, m.name)));
  const failed = models.some((m) => m.status === "error");
  const note = $("setup-note");
  note.replaceChildren(
    failed ? "A download failed. Check your connection, then " : "You can close this window. Downloads continue in the menu bar.",
  );
  if (failed) note.append(button("Retry", () => api.download([...FIRST_RUN_MODELS])));
}

// --- state --------------------------------------------------------------------------------

function render(): void {
  renderSetup();
  renderHome();
  renderGeneral();
  renderModels();
  if (view === "dictionary") renderDictionary();
}

state = await api.getState();
show("home");
render();
api.onState((next: AppState) => {
  state = next;
  render();
});
