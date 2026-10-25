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

/** Text in Swedish, marked so screen readers pronounce it as Swedish. */
function swedish(text: string): HTMLElement {
  const span = h("span", "", text);
  span.lang = "sv";
  return span;
}

/** Says a short message to screen readers through the polite live region. */
function announce(message: string): void {
  const region = $("announcer");
  region.textContent = "";
  requestAnimationFrame(() => (region.textContent = message));
}

/** A control's identity across rebuilds: its id, its accessible name or its label. */
const controlName = (el: Element) => el.id || el.getAttribute("aria-label") || el.textContent;

/**
 * Moves focus to `target`, a control or a row, or to the view's title when it can't take focus,
 * e.g. because it was removed or hidden. Keyboard users never end up on the page body.
 */
function refocus(target: HTMLElement | null | undefined, within: HTMLElement): void {
  if (target && !target.matches("input, button")) target.tabIndex = -1;
  target?.focus();
  if (target && document.activeElement === target) return;
  const title = within.closest("[data-panel], #setup")?.querySelector<HTMLElement>("h1");
  if (!title) return;
  title.tabIndex = -1;
  title.focus();
}

/**
 * Replaces a container's rows only when `key` changed. State arrives several times a second
 * during downloads, and rebuilding each time would drop keyboard focus and re-announce live
 * regions. When the rows are rebuilt, focus returns to the same control in the same row (rows
 * carry `data-row`), or to the row itself if that control is gone, e.g. Download became Cancel.
 */
function renderRows(container: HTMLElement, key: string, build: () => HTMLElement[]): void {
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  const active = container.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
  const row = active?.closest<HTMLElement>("[data-row]")?.dataset.row;
  container.replaceChildren(...build());
  if (!active) return;
  const next = row === undefined ? null : container.querySelector<HTMLElement>(`[data-row="${CSS.escape(row)}"]`);
  const same = [...(next?.querySelectorAll<HTMLElement>("input, button") ?? [])].find((c) => controlName(c) === controlName(active));
  refocus(same ?? next, container);
}

/** Sets a progress bar's fill and value; the fill scales rather than resizing, so nothing reflows. */
function setProgress(bar: HTMLElement, fraction: number, valueText?: string): void {
  bar.querySelector<HTMLElement>("span")!.style.transform = `scaleX(${fraction})`;
  bar.setAttribute("aria-valuenow", String(Math.floor(fraction * 100)));
  if (valueText) bar.setAttribute("aria-valuetext", valueText);
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
  accessibility: { title: "Accessibility", why: (key) => `To notice when you hold ${key} and type the text where you are writing.`, icon: "accessibility" },
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
function explainedByPermission(s: StatusUpdate, permissions: AppState["permissions"]): boolean {
  const { microphone, accessibility } = permissions;
  return (s.key === "mic" && microphone === false) || ((s.key === "keys" || s.key === "paste") && accessibility === false);
}

const HOME_TITLES = { ready: "Ready to dictate", busy: "Getting ready…", attention: "Needs your attention" };

const missingPermissions = (s: AppState) => PERMISSIONS.filter((p) => s.permissions[p] === false);
const homeIssues = (s: AppState) => s.statuses.filter((st) => !st.ok && STATUS_TITLES[st.key] && !explainedByPermission(st, s.permissions));

function homeMode(s: AppState): keyof typeof HOME_TITLES {
  if (missingPermissions(s).length > 0 || homeIssues(s).length > 0) return "attention";
  // Dictation is ready once the speech engine is; the optional cleanup model can still be loading.
  const asr = s.statuses.find((st) => st.key === "asr");
  return !asr || (asr.ok && !asr.text.startsWith("ready")) ? "busy" : "ready";
}

function renderHome(): void {
  const missing = missingPermissions(state);
  const issues = homeIssues(state);
  const mode = homeMode(state);
  $("home-dot").dataset.state = mode;
  $("home-title").textContent = HOME_TITLES[mode];

  const hint = $("home-hint");
  hint.replaceChildren(
    "Hold ", h("kbd", "", KEY_NAMES[state.settings.hotkey]), " to dictate · double-tap for hands-free · ",
    h("kbd", "", "esc"), " cancels",
  );

  const language = h("span", "chip");
  language.append({ auto: "Swedish + English", sv: swedish("Svenska"), en: "English" }[state.settings.languageMode]);
  $("home-chips").replaceChildren(
    language,
    h("span", state.settings.smartCleanup ? "chip on" : "chip", state.settings.smartCleanup ? "Smart cleanup" : "Smart cleanup off"),
  );

  // Rebuild before hiding, so a focused row that disappears can still hand focus on.
  renderPermissions($("home-permissions"), missing);
  $("home-permissions").hidden = missing.length === 0;

  renderRows($("home-issues"), JSON.stringify(issues.map((s) => [s.key, s.text])), () =>
    issues.map((s) => {
      const item = h("div", "issue");
      item.append(h("strong", "", STATUS_TITLES[s.key] ?? s.key), s.text);
      return item;
    }),
  );

  renderRows($("home-recent"), JSON.stringify(state.recent), () => {
    if (state.recent.length === 0) return [h("p", "empty", "Your dictations from this session appear here.")];
    return state.recent.map((r) => {
      const item = h("div", "recent-item");
      item.dataset.row = `${r.at} ${r.text}`;
      const copy = button("Copy", () => {
        api.copy(r.text);
        copy.textContent = "Copied";
        announce("Copied");
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      }, "button plain");
      copy.setAttribute("aria-label", `Copy “${r.text.slice(0, 40)}”`);
      const app = r.app ? ` · ${r.app}` : "";
      item.append(h("p", "", r.text), copy, h("span", "meta", `${r.at}${app}`));
      return item;
    });
  });
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
    term.setAttribute("aria-label", `Word ${i + 1}`);
    const heard = document.createElement("input");
    heard.type = "text";
    heard.value = row.heard;
    heard.placeholder = "e.g. git hub";
    const remove = button("", () => {
      draft.splice(i, 1);
      renderDictionaryRows();
      scheduleSave();
      // Focus the remove button that took this one's place, or the one above, so several rows
      // can be removed in a row; with no rows left, Add word.
      const removes = $("dict-rows").querySelectorAll<HTMLElement>(".icon-button");
      (removes[Math.min(i, removes.length - 1)] ?? $("dict-add")).focus();
    }, "icon-button");
    remove.append(icon("remove"));
    // The names follow the word as it is typed.
    const name = () => {
      heard.setAttribute("aria-label", `What ${row.term || "the word"} is heard as`);
      remove.setAttribute("aria-label", `Remove ${row.term || `word ${i + 1}`}`);
    };
    name();
    term.addEventListener("input", () => ((row.term = term.value), name(), scheduleSave()));
    heard.addEventListener("input", () => ((row.heard = heard.value), scheduleSave()));
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
    const skipped = draft.some((r) => !r.term.trim() && r.heard.trim());
    const res = await api.setDictionary(entries);
    savedJson = JSON.stringify(entries);
    $("dict-status").textContent = !res.ok ? `Not saved: ${res.error}` : skipped ? "Saved. Rows without a word are left out." : "Saved";
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

/** A button named after its model, so a list of "Download" buttons can be told apart. */
function modelButton(label: string, m: ModelInfo, onClick: () => void): HTMLButtonElement {
  const b = button(label, onClick);
  b.setAttribute("aria-label", `${label} ${m.name}`);
  return b;
}

function modelState(m: ModelInfo): HTMLElement[] {
  switch (m.status) {
    case "ready": {
      const ready = h("span", "model-state ready");
      ready.append(icon("check"), "Downloaded");
      return [ready];
    }
    case "queued":
      return [h("span", "model-state", "Waiting")];
    case "downloading":
      return [
        h("span", "model-state percent", `${Math.floor((m.received / m.bytes) * 100)}%`),
        modelButton("Cancel", m, () => api.cancelDownload()),
      ];
    case "error":
      return [modelButton("Retry", m, () => api.download([m.id]))];
    case "missing":
      return [modelButton("Download", m, () => api.download([m.id]))];
  }
}

function modelRow(m: ModelInfo, label: (string | Node)[], sub = "", radio?: { name: string; checked: boolean; onSelect: () => void }): HTMLElement {
  const row = h("div", "model");
  row.dataset.row = m.id;
  const line = h("div", "model-line");
  // The status sits in a column of fixed width, so the sizes line up whatever each row shows.
  const end = h("div", "model-end");
  end.id = `model-${m.id}-state`;
  end.append(...modelState(m));
  if (radio) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = radio.name;
    input.checked = radio.checked;
    input.id = `model-${m.id}`;
    input.setAttribute("aria-describedby", end.id);
    input.addEventListener("change", radio.onSelect);
    line.append(input);
  }
  const title = h(radio ? "label" : "div", "row-title");
  if (radio) title.setAttribute("for", `model-${m.id}`);
  title.append(...label);
  if (sub) title.append(h("span", "row-sub", sub));
  line.append(title, h("span", "model-size", formatBytes(m.bytes)), end);
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
  const swedishRow = (id: Settings["swedishModel"], sub: string) =>
    modelRow(model(id), [swedish("Svenska"), ` · ${model(id).name}`], sub, {
      name: "swedish-model",
      checked: state.settings.swedishModel === id,
      onSelect: () => void api.setSettings({ swedishModel: id }),
    });
  renderRows($("models-speech"), key, () => [
    swedishRow("kb-whisper-medium", "Fast. Recommended for most Macs."),
    swedishRow("kb-whisper-large", "More accurate, about a third slower."),
    modelRow(model("whisper-large-v3-turbo"), [`English · ${model("whisper-large-v3-turbo").name}`]),
    modelRow(model("silero-vad"), [model("silero-vad").name], "Skips silence before transcribing."),
  ]);
  const toggle = $("cleanup-toggle");
  toggle.setAttribute("aria-checked", String(state.settings.smartCleanup));
  renderRows($("models-cleanup"), key, () => [modelRow(model("gemma-4-e2b-it-qat"), [model("gemma-4-e2b-it-qat").name], "Runs on your Mac.")]);
  updateModelRows();
}

$("cleanup-toggle").addEventListener("click", () => void api.setSettings({ smartCleanup: !state.settings.smartCleanup }));

// --- first-run setup ----------------------------------------------------------------------

const formatGB = (n: number) => (n / 1e9).toFixed(2);

function renderSetup(): void {
  // When the downloads finish, focus moves from the setup screen to Home's title.
  const finishing = !state.setup && !$("setup").hidden && ($("setup").contains(document.activeElement) || document.activeElement === document.body);
  $("setup").hidden = !state.setup;
  $("main").hidden = state.setup;
  $("content").hidden = state.setup; // one visible main landmark at a time
  if (finishing) refocus(null, $("home-title"));
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
  const amount = `${formatGB(received)} of ${formatGB(total)} GB`;
  if (failed) {
    if (!stateCell.querySelector("button")) {
      const retry = button("Retry", () => api.download([...FIRST_RUN_MODELS]));
      retry.setAttribute("aria-label", "Retry download");
      stateCell.replaceChildren(retry);
    }
  } else {
    // Retry turns back into text once the download resumes; its row keeps the focus.
    const hadFocus = stateCell.contains(document.activeElement);
    stateCell.textContent = downloading || received > 0 ? amount : "Waiting";
    if (hadFocus) refocus(stateCell.closest<HTMLElement>(".model"), stateCell);
  }
  setProgress($("setup-progress"), received / total, amount);
}

// --- state --------------------------------------------------------------------------------

function render(): void {
  renderSetup();
  renderHome();
  renderGeneral();
  renderModels();
  if (view === "dictionary") renderDictionary();
}

/** What changed that a screen reader user would otherwise miss; progress is never announced. */
function changes(prev: AppState, next: AppState): string[] {
  const said: string[] = [];
  for (const p of PERMISSIONS) if (next.permissions[p] && !prev.permissions[p]) said.push(`${PERMISSION_ROWS[p].title} allowed`);
  for (const m of next.models) {
    const before = prev.models.find((b) => b.id === m.id)?.status;
    if (m.status === "error" && before !== "error") said.push(`${m.name} download failed`);
    if (m.status === "ready" && before === "downloading") said.push(`${m.name} downloaded`);
  }
  if (!next.setup && homeMode(next) !== homeMode(prev)) said.push(HOME_TITLES[homeMode(next)]);
  return said;
}

state = await api.getState();
show("home");
render();
api.onState((next: AppState) => {
  const said = changes(state, next);
  state = next;
  render();
  if (said.length > 0) announce(said.join(". "));
});
