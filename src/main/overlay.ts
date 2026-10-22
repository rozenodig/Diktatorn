// The recording overlay: a small pill at the bottom of the screen that shows the dictation
// state. A non-activating panel that ignores the mouse, so it can never take focus from the
// text field the user is dictating into, and the paste lands where they were typing.
import { BrowserWindow, screen, type WebPreferences } from "electron";
import { IPC, type OverlayState } from "../shared/ipc.ts";

/** Larger than the pill, so its shadow fits inside the transparent window. */
const SIZE = { width: 360, height: 96 };
/** Where the pill's centre sits above the bottom of the screen's usable area. */
const PILL_CENTRE_ABOVE_BOTTOM = 52;
/** The pill fades out in --duration-quick (120 ms); the window hides once the fade has been painted. */
const FADE_OUT_MS = 160;

export class Overlay {
  private readonly win: BrowserWindow;
  private hideTimer: NodeJS.Timeout | null = null;

  private constructor(win: BrowserWindow) {
    this.win = win;
  }

  static async create(file: string, webPreferences: WebPreferences): Promise<Overlay> {
    const win = new BrowserWindow({
      ...SIZE,
      type: "panel",
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      hiddenInMissionControl: true,
      webPreferences,
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true);
    await win.loadFile(file);
    return new Overlay(win);
  }

  /** Shows the overlay on the display under the cursor, without activating the app. */
  show(state: OverlayState, text: string, hideAfterMs?: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = hideAfterMs === undefined ? null : setTimeout(() => this.hide(), hideAfterMs);
    this.win.webContents.send(IPC.overlayState, { state, text });
    if (!this.win.isVisible()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      this.win.setBounds({
        x: Math.round(area.x + (area.width - SIZE.width) / 2),
        y: Math.round(area.y + area.height - PILL_CENTRE_ABOVE_BOTTOM - SIZE.height / 2),
        ...SIZE,
      });
      this.win.showInactive();
    }
  }

  /** Fades the pill out, then hides the window. A show() before then cancels the hide. */
  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (!this.win.isVisible()) return;
    this.win.webContents.send(IPC.overlayHide);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.win.hide();
    }, FADE_OUT_MS);
  }

  /** The microphone level while listening, 0–1. */
  level(level: number): void {
    if (this.win.isVisible()) this.win.webContents.send(IPC.overlayLevel, level);
  }
}
