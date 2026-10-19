// The app window and the menu bar icon. Diktatorn keeps running when its window is closed,
// because dictation works in every app: while the window is open the app has a Dock icon
// like any other, and once it is closed only the menu bar icon remains.
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray, type WebContents, type WebPreferences } from "electron";

export class AppWindow {
  private readonly file: string;
  private readonly webPreferences: WebPreferences;
  private win: BrowserWindow | null = null;
  private quitting = false;

  constructor(file: string, webPreferences: WebPreferences) {
    this.file = file;
    this.webPreferences = webPreferences;
    app.on("before-quit", () => (this.quitting = true));
  }

  get webContents(): WebContents | null {
    return this.win?.webContents ?? null;
  }

  async show(): Promise<void> {
    await app.dock?.show();
    if (this.win) {
      this.win.show();
      this.win.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 780,
      height: 540,
      minWidth: 680,
      minHeight: 460,
      title: "Diktatorn",
      show: false,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0f19" : "#f4f7fa",
      webPreferences: this.webPreferences,
    });
    this.win = win;
    win.once("ready-to-show", () => win.show());
    win.on("close", (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
      app.dock?.hide();
    });
    win.on("closed", () => (this.win = null));
    await win.loadFile(this.file);
  }

  send(channel: string, payload: unknown): void {
    this.win?.webContents.send(channel, payload);
  }
}

export function createTray(iconPath: string, actions: { open: () => void; debug: () => void }): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("Diktatorn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Diktatorn", click: actions.open },
      { label: "Debug Window", click: actions.debug },
      { type: "separator" },
      { label: "Quit Diktatorn", role: "quit" },
    ]),
  );
  return tray;
}
