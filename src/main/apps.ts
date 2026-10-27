// Per-app insertion rules, keyed by macOS bundle identifier.
export type AppKind = "terminal" | "chromium" | "default";

export interface InsertPlan {
  text: string;
  kind: AppKind;
  /** How long the dictated text stays on the clipboard before the user's clipboard is restored. */
  restoreDelayMs: number;
}

const TERMINALS = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "net.kovidgoyal.kitty",
  "com.mitchellh.ghostty",
  "io.alacritty",
  "com.github.wez.wezterm",
]);

// Electron and Chromium apps read the pasteboard asynchronously after Cmd+V, so restoring
// too early can paste the user's old clipboard instead of the dictation.
const CHROMIUM = new Set([
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "company.thebrowser.Browser",
  "com.microsoft.VSCode",
  "com.todesktop.230313mzl4w4u92", // Cursor
  "com.tinyspeck.slackmacgap",
  "com.hnc.Discord",
  "notion.id",
]);

const RESTORE_DELAY_MS: Record<AppKind, number> = { terminal: 400, chromium: 800, default: 400 };

export function appKind(bundleId: string | null): AppKind {
  if (bundleId && TERMINALS.has(bundleId)) return "terminal";
  if (bundleId && CHROMIUM.has(bundleId)) return "chromium";
  return "default";
}

export function planInsertion(text: string, bundleId: string | null): InsertPlan | null {
  const kind = appKind(bundleId);
  // Only newlines and tabs survive anywhere: Esc could end a bracketed paste in a terminal,
  // including one inside an app such as VS Code, and a carriage return becomes a newline.
  let out = text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim();
  if (!out) return null;
  if (kind === "terminal") out = out.replace(/\s*[\n\t]\s*/g, " "); // a newline would run the command
  else out += " ";
  return { text: out, kind, restoreDelayMs: RESTORE_DELAY_MS[kind] };
}
