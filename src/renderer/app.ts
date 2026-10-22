// App window: status and recent dictations, settings, dictionary and models, plus the
// first-run setup screen with the permissions. Everything shown comes from the main process's
// AppState; changes go back through the bridge and return as a new state.
import {
  FIRST_RUN_MODELS,
  PERMISSIONS,
  type AppState,
  type ModelInfo,
  type Permission,
  type Settings,
  type StatusUpdate,
} from "../shared/ipc.ts";

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

/** An icon from the sprite in app.html. */
function icon(name: string, cls = "icon"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

/**
 * Replaces a container's rows only when `key` changed. State arrives several times a second
 * during downloads, and rebuilding each time would drop keyboard focus; when the rows are
 * rebuilt, focus moves to the same row's control (rows carry `data-row`).
 */
function renderRows(container: HTMLElement, key: string, build: () => HTMLElement[]): void {
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  const focused = container.contains(document.activeElement) ? document.activeElement!.closest<HTMLElement>("[data-row]")?.dataset.row : undefined;
  container.replaceChildren(...build());
  if (focused) container.querySelector<HTMLElement>(`[data-row="${focused}"]`)?.querySelector<HTMLElement>("input, button")?.focus();
}

/** Sets a progress bar's fill and value; the fill scales rather than resizing, so nothing reflows. */
function setProgress(bar: HTMLElement, fraction: number): void {
  bar.querySelector<HTMLElement>("span")!.style.transform = `scaleX(${fraction})`;
  bar.setAttribute("aria-valuenow", String(Math.floor(fraction * 100)));
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

// Segmented controls are radio groups: one tab stop (the chosen segment), and the arrow keys
// move the choice.
for (const group of document.querySelectorAll<HTMLElement>(".segmented")) {
  group.addEventListener("keydown", (e) => {
    const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[e.key];
    if (!step) return;
    e.preventDefault();
    const segments = [...group.querySelectorAll<HTMLElement>("[role=radio]")];
    const next = segments[(segments.indexOf(e.target as HTMLElement) + step + segments.length) % segments.length]!;
    next.focus();
    next.click();
  });
}

function renderSegments(attribute: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    const checked = b.getAttribute(attribute) === value;
    b.setAttribute("aria-checked", String(checked));
    b.tabIndex = checked ? 0 : -1;
  }
}

// --- permissions --------------------------------------------------------------------------

const PERMISSION_ROWS: Record<Permission, { title: string; why: (key: string) => string; icon: string }> = {
  microphone: { title: "Microphone", why: () => "To hear you while you dictate.", icon: "microphone" },
  inputMonitoring: { title: "Input Monitoring", why: (key) => `To notice when you hold ${key}, in any app.`, icon: "keyboard" },
  accessibility: { title: "Accessibility", why: () => "To type the text where you are writing.", icon: "accessibility" },
};

function permissionRow(permission: Permission): HTMLElement {
  const info = PERMISSION_ROWS[permission];
  const allowed = state.permissions[permission];
  const row = h("div", "row permission");
  row.dataset.row = permission;
  const tile = h("span", "permission-icon");
  tile.append(icon(info.icon));
  if (allowed) tile.dataset.on = "";
  const label = h("div");
  label.append(h("span", "row-title", info.title), h("span", "row-sub", info.why(KEY_NAMES[state.settings.hotkey])));
  let status: HTMLElement;
  if (allowed === null) {
    status = h("span", "model-state", "Checking…");
  } else if (allowed) {
    status = h("span", "allowed");
    status.append(icon("check"), "Allowed");
  } else {
    status = button("Open System Settings", () => api.openSettings(permission));
    status.setAttribute("aria-label", `Open System Settings for ${info.title}`);
  }
  row.append(tile, label, status);
  return row;
}

function renderPermissions(container: HTMLElement, permissions: readonly Permission[]): void {
  const key = JSON.stringify([permissions, permissions.map((p) => state.permissions[p]), state.settings.hotkey]);
  renderRows(container, key, () => permissions.map(permissionRow));
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

/** Statuses that a missing permission already explains; its row on Home says what to do. */
function explainedByPermission(s: StatusUpdate): boolean {
  const { microphone, inputMonitoring, accessibility } = state.permissions;
  return (s.key === "mic" && microphone === false) || (s.key === "keys" && inputMonitoring === false) || (s.key === "paste" && accessibility === false);
}

function renderHome(): void {
  const missing = PERMISSIONS.filter((p) => state.permissions[p] === false);
  const issues = state.statuses.filter((s) => !s.ok && STATUS_TITLES[s.key] && !explainedByPermission(s));
  // Dictation is ready once the speech engine is; the optional cleanup model can still be loading.
  const asr = state.statuses.find((s) => s.key === "asr");
  const busy = !asr || (asr.ok && !asr.text.startsWith("ready"));
  const mode = missing.length > 0 || issues.length > 0 ? "attention" : busy ? "busy" : "ready";
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

  $("home-permissions").hidden = missing.length === 0;
  renderPermissions($("home-permissions"), missing);

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
      }, "button plain");
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
  renderSegments("data-language", state.settings.languageMode);
  renderSegments("data-appearance", state.settings.appearance);
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
    const remove = button("", () => {
      draft.splice(i, 1);
      renderDictionaryRows();
      scheduleSave();
    }, "icon-button");
    remove.append(icon("remove"));
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
      return h("span", "model-state percent", `${Math.floor((m.received / m.bytes) * 100)}%`);
    case "error":
      return button("Retry", () => api.download([m.id]));
    case "missing":
      return button("Download", () => api.download([m.id]));
  }
}

function modelRow(m: ModelInfo, label: string, sub = "", radio?: { name: string; checked: boolean; onSelect: () => void }): HTMLElement {
  const row = h("div", "model");
  row.dataset.row = m.id;
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
    bar.append(h("span"));
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${m.name} download`);
    setProgress(bar, m.received / m.bytes);
    row.append(bar);
  }
  if (m.error) row.append(h("p", "model-error", m.error));
  return row;
}

/** Download progress and the chosen model change in place, so bars ease and focus stays put. */
function updateModelRows(): void {
  for (const m of state.models) {
    for (const row of document.querySelectorAll<HTMLElement>(`#models-speech [data-row="${m.id}"], #models-cleanup [data-row="${m.id}"]`)) {
      const bar = row.querySelector<HTMLElement>(".progress");
      if (bar) setProgress(bar, m.received / m.bytes);
      const percent = row.querySelector(".percent");
      if (percent) percent.textContent = `${Math.floor((m.received / m.bytes) * 100)}%`;
      const radio = row.querySelector<HTMLInputElement>("input[type=radio]");
      if (radio) radio.checked = state.settings.swedishModel === m.id;
    }
  }
}

function renderModels(): void {
  const model = (id: string) => state.models.find((m) => m.id === id)!;
  // Rows are rebuilt only when a status changes; progress and the radio choice update in place.
  const key = JSON.stringify(state.models.map((m) => [m.status, m.error]));
  const swedish = (id: Settings["swedishModel"], sub: string) =>
    modelRow(model(id), `Svenska · ${model(id).name}`, sub, {
      name: "swedish-model",
      checked: state.settings.swedishModel === id,
      onSelect: () => void api.setSettings({ swedishModel: id }),
    });
  renderRows($("models-speech"), key, () => [
    swedish("kb-whisper-medium", "Fast. Recommended for most Macs."),
    swedish("kb-whisper-large", "More accurate, about a third slower."),
    modelRow(model("whisper-large-v3-turbo"), `English · ${model("whisper-large-v3-turbo").name}`),
    modelRow(model("silero-vad"), model("silero-vad").name, "Skips silence before transcribing."),
  ]);
  const toggle = $("cleanup-toggle");
  toggle.setAttribute("aria-checked", String(state.settings.smartCleanup));
  renderRows($("models-cleanup"), key, () => [modelRow(model("gemma-4-e2b-it-qat"), model("gemma-4-e2b-it-qat").name, "Runs on your Mac.")]);
  updateModelRows();
}

$("cleanup-toggle").addEventListener("click", () => void api.setSettings({ smartCleanup: !state.settings.smartCleanup }));

// --- first-run setup ----------------------------------------------------------------------

const formatGB = (n: number) => (n / 1e9).toFixed(2);

function renderSetup(): void {
  $("setup").hidden = !state.setup;
  $("main").hidden = state.setup;
  if (!state.setup) return;
  renderPermissions($("setup-permissions"), PERMISSIONS);

  // The first-run models download one after another; here they show as a single download.
  const models = FIRST_RUN_MODELS.map((id) => state.models.find((m) => m.id === id)!);
  const total = models.reduce((sum, m) => sum + m.bytes, 0);
  const received = models.reduce((sum, m) => sum + (m.status === "ready" ? m.bytes : m.received), 0);
  const failed = models.some((m) => m.status === "error");
  const downloading = models.some((m) => m.status === "downloading");
  $("setup-download-sub").textContent = failed
    ? "A download failed. Check your connection, then retry."
    : "Keeps going in the menu bar if you close this window.";
  const stateCell = $("setup-download-state");
  if (failed) {
    if (!stateCell.querySelector("button")) stateCell.replaceChildren(button("Retry", () => api.download([...FIRST_RUN_MODELS])));
  } else {
    stateCell.textContent = downloading || received > 0 ? `${formatGB(received)} of ${formatGB(total)} GB` : "Waiting";
  }
  setProgress($("setup-progress"), received / total);
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
