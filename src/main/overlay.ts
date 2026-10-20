// The recording overlay: a small pill at the bottom of the screen that shows the dictation
// state. A non-activating panel that ignores the mouse, so it can never take focus from the
// text field the user is dictating into, and the paste lands where they were typing.
import { BrowserWindow, screen, type WebPreferences } from "electron";
import { IPC, type OverlayState } from "../shared/ipc.ts";

const SIZE = { width: 300, height: 56 };
const BOTTOM_MARGIN = 24;

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
        y: Math.round(area.y + area.height - SIZE.height - BOTTOM_MARGIN),
        ...SIZE,
      });
      this.win.showInactive();
    }
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.win.hide();
  }
}
