/** Mac-only host for the supplied Arc dial. Separate from the existing Dynamic Island. */

import { join } from "node:path";
import { type AgentSummary, IPC_CHANNELS, LOCAL_SERVER_ID } from "@dani-dex/contracts/ipc";
import { BrowserWindow, type Display, ipcMain, type Rectangle, screen } from "electron";
import { arcHitTest } from "./dani-arc-geometry";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";

const SIZE = { width: 800, height: 650 } as const;
const ROLES = new Set([
  "ready",
  "depth",
  "browse",
  "close",
  "exited",
  "entering",
  "entered",
  "employee",
  "team",
  "overview",
  "create",
  "loops",
  "connections",
  "preferences",
  "sound",
]);
export class DaniArcWindow {
  #window: BrowserWindow | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #depth = 1;
  #visible = false;
  #ignored = true;
  #team: { id: string; name: string; status: string }[] = [];
  #preferences = { theme: "liquid", glow: "normal", motion: "full", volume: 0.38 };
  #onAction: (_event: Electron.IpcMainEvent, payload: unknown) => void;
  constructor(
    private readonly options: {
      platform: NodeJS.Platform;
      getMainWindow: () => BrowserWindow | null;
      showMainWindow: (window: BrowserWindow) => void;
      listAgents: () => AgentSummary[];
    },
  ) {
    this.#onAction = (event, payload) => {
      if (
        event.sender !== this.#window?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !isTrustedRendererUrl(event.senderFrame.url) ||
        typeof payload !== "object" ||
        payload === null
      )
        return;
      if (!("type" in payload) || typeof payload.type !== "string" || !ROLES.has(payload.type)) return;
      const action = {
        type: payload.type,
        id: "id" in payload ? payload.id : undefined,
        depth: "depth" in payload ? payload.depth : undefined,
      };
      this.handleAction(action);
    };
    ipcMain.on("dani-arc:action", this.#onAction);
  }
  show(): void {
    if (this.options.platform !== "darwin") return;
    if (!this.#window || this.#window.isDestroyed()) this.create();
    const window = this.#window;
    if (!window) return;
    this.#depth = 1;
    this.#visible = true;
    window.setBounds(this.bounds(), false);
    window.showInactive();
    window.setAlwaysOnTop(true, "floating");
    this.#ignored = true;
    this.#send("visibility", true);
    this.syncTeam();
    this.#startTracking();
  }
  syncTeam(): void {
    this.#team = this.options
      .listAgents()
      .slice(0, 100)
      .map((agent) => ({ id: agent.id, name: agent.name, status: "Agent" }));
    this.#send("team", this.#team);
  }
  destroy(): void {
    this.#stopTracking();
    ipcMain.removeListener("dani-arc:action", this.#onAction);
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
  }
  private bounds(): Rectangle {
    const cursor = screen.getCursorScreenPoint();
    const display: Display = screen.getDisplayNearestPoint(cursor);
    const work = display.workArea;
    return { x: work.x + work.width - SIZE.width, y: work.y, ...SIZE };
  }
  private create(): void {
    const window = new BrowserWindow({
      ...this.bounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      focusable: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      type: "panel",
      webPreferences: {
        preload: join(__dirname, "../preload/arc.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.#window = window;
    window.setMenu(null);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.setHiddenInMissionControl(true);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => {
      if (target !== window.webContents.getURL()) event.preventDefault();
    });
    window.on("closed", () => {
      this.#window = null;
      this.#visible = false;
      this.#stopTracking();
    });
    window.webContents.on("did-finish-load", () => {
      this.#send("preferences", this.#preferences);
      this.syncTeam();
      this.#send("visibility", this.#visible);
    });
    const developmentUrl = process.env.ELECTRON_RENDERER_URL;
    const url = developmentUrl
      ? new URL("/arc/manzanilla-overlay.html", developmentUrl)
      : new URL("dani-dex-app://app/arc/manzanilla-overlay.html");
    void window.loadURL(url.toString()).catch(() => {
      if (!window.isDestroyed()) window.destroy();
    });
  }
  private handleAction(action: { type: string; id?: unknown; depth?: unknown }): void {
    switch (action.type) {
      case "ready":
        this.#send("preferences", this.#preferences);
        this.syncTeam();
        this.#send("visibility", this.#visible);
        break;
      case "depth":
        if (typeof action.depth === "number" && [0, 1, 2, 3].includes(action.depth))
          this.#depth = Math.max(1, action.depth);
        break;
      case "close":
        this.#send("visibility", false);
        this.#visible = false;
        setTimeout(() => {
          if (!this.#visible) {
            this.#window?.hide();
            this.#stopTracking();
          }
        }, 450);
        break;
      case "exited":
        if (!this.#visible) {
          this.#window?.hide();
          this.#stopTracking();
        }
        break;
      case "preferences": {
        const input = action.id;
        if (!input || typeof input !== "object") return;
        if (!("key" in input) || !("value" in input)) return;
        const { key, value } = input;
        if (
          (key === "theme" &&
            typeof value === "string" &&
            ["liquid", "vivid", "porcelain", "graphite", "clay", "smoke", "spectral", "obsidian", "aurora"].includes(
              value,
            )) ||
          (key === "motion" &&
            typeof value === "string" &&
            ["full", "calm", "precise", "mechanical", "reduced"].includes(value)) ||
          (key === "glow" && typeof value === "string" && ["soft", "normal", "bright"].includes(value)) ||
          (key === "volume" && typeof value === "number" && value >= 0 && value <= 1)
        ) {
          if (key === "volume" && typeof value === "number") this.#preferences.volume = value;
          else if (key === "theme" && typeof value === "string") this.#preferences.theme = value;
          else if (key === "motion" && typeof value === "string") this.#preferences.motion = value;
          else if (key === "glow" && typeof value === "string") this.#preferences.glow = value;
          this.#send("preferences", this.#preferences);
        }
        break;
      }
      case "employee": {
        const id = action.id;
        if (typeof id !== "string" || !this.#team.some((agent) => agent.id === id)) return;
        this.openApp(id);
        break;
      }
      case "team":
      case "overview":
      case "create":
      case "loops":
      case "connections":
      case "talk":
        this.openApp();
        break;
      // Voice, device controls, theme edit persistence and window-wide waves are deliberately not wired.
      default:
        break;
    }
  }
  private openApp(agentId?: string): void {
    const main = this.options.getMainWindow();
    if (main && !main.isDestroyed()) {
      this.options.showMainWindow(main);
      if (agentId) {
        const action = { type: "open-agent" as const, serverId: LOCAL_SERVER_ID, agentId };
        if (main.webContents.isLoadingMainFrame())
          main.webContents.once("did-finish-load", () =>
            sendToRenderer(main, IPC_CHANNELS.dynamicIslandAction, action),
          );
        else sendToRenderer(main, IPC_CHANNELS.dynamicIslandAction, action);
      }
    }
    this.handleAction({ type: "close" });
  }
  #send(name: string, value: unknown): void {
    if (this.#window && !this.#window.isDestroyed() && !this.#window.webContents.isLoadingMainFrame())
      sendToRenderer(this.#window, `dani-arc:${name}`, value);
  }
  #startTracking(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      const window = this.#window;
      if (!window || window.isDestroyed() || !this.#visible) return;
      const point = screen.getCursorScreenPoint();
      const bounds = window.getBounds();
      const interactive = arcHitTest(bounds, point.x, point.y, this.#depth);
      if (interactive === !this.#ignored) return;
      this.#ignored = !interactive;
      window.setIgnoreMouseEvents(this.#ignored, { forward: true });
    }, 80);
  }
  #stopTracking(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#ignored = true;
    if (this.#window && !this.#window.isDestroyed()) this.#window.setIgnoreMouseEvents(true, { forward: true });
  }
}
