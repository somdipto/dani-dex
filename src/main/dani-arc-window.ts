import { chiefConversationAgent } from "@dani-dex/contracts/chief-conversation";
/** Mac-only host for the supplied Arc dial. Separate from the existing Dynamic Island. */

import { join } from "node:path";
import { type AgentSummary, IPC_CHANNELS, LOCAL_SERVER_ID } from "@dani-dex/contracts/ipc";
import { BrowserWindow, type Display, type IpcMainInvokeEvent, type Rectangle, screen } from "electron";
import { arcHitTest } from "./dani-arc-geometry";
import { sendToRenderer } from "./renderer-ipc";

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
  readonly #pendingSignals = new Map<string, unknown>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #depth = 1;
  #visible = false;
  #ignored = true;
  #team: { id: string; name: string; status: string }[] = [];
  #preferences = { theme: "liquid", glow: "normal", motion: "full", volume: 0.38 };
  constructor(
    private readonly options: {
      platform: NodeJS.Platform;
      getMainWindow: () => BrowserWindow | null;
      showMainWindow: (window: BrowserWindow) => void;
      listAgents: () => AgentSummary[];
    },
  ) {}
  requireSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== this.#window?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Rejected Arc action from another renderer.");
  }
  decodeAction(payload: unknown): { type: string; id?: unknown; depth?: unknown } {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("type" in payload) ||
      typeof payload.type !== "string" ||
      !ROLES.has(payload.type)
    )
      throw new Error("Invalid Arc action.");
    return {
      type: payload.type,
      id: "id" in payload ? payload.id : undefined,
      depth: "depth" in payload ? payload.depth : undefined,
    };
  }
  performAction(action: { type: string; id?: unknown; depth?: unknown }): void {
    this.handleAction(action);
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
    const chief = chiefConversationAgent(this.options.listAgents());
    this.#team = chief ? [{ id: chief.id, name: chief.name, status: "Chief of staff" }] : [];
    this.#send("team", this.#team);
  }
  destroy(): void {
    this.#stopTracking();
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
    this.#pendingSignals.clear();
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
      this.#pendingSignals.clear();
      this.#visible = false;
      this.#stopTracking();
    });
    window.webContents.on("did-stop-loading", () => {
      if (this.#window !== window || window.isDestroyed()) return;
      for (const [name, value] of this.#pendingSignals) {
        if (this.#sendSignal(name, value)) this.#pendingSignals.delete(name);
      }
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
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    if (this.#sendSignal(name, value)) {
      this.#pendingSignals.delete(name);
    } else if (name !== "rotate") {
      // Keep state while the native page is loading. A late ready/finish-load can still
      // arrive before Electron clears isLoadingMainFrame, so did-stop-loading flushes it.
      this.#pendingSignals.set(name, value);
    }
  }
  #sendSignal(name: string, value: unknown): boolean {
    const window = this.#window;
    if (!window) return false;
    switch (name) {
      case "team":
        return sendToRenderer(window, IPC_CHANNELS.arcTeam, value);
      case "connection":
        return sendToRenderer(window, IPC_CHANNELS.arcConnection, value);
      case "hold":
        return sendToRenderer(window, IPC_CHANNELS.arcHold, value);
      case "rotate":
        return sendToRenderer(window, IPC_CHANNELS.arcRotate, value);
      case "sound":
        return sendToRenderer(window, IPC_CHANNELS.arcSound, value);
      case "voice":
        return sendToRenderer(window, IPC_CHANNELS.arcVoice, value);
      case "targets":
        return sendToRenderer(window, IPC_CHANNELS.arcTargets, value);
      case "visibility":
        return sendToRenderer(window, IPC_CHANNELS.arcVisibility, value);
      case "preferences":
        return sendToRenderer(window, IPC_CHANNELS.arcPreferences, value);
      case "edit":
        return sendToRenderer(window, IPC_CHANNELS.arcEdit, value);
    }
    return false;
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
