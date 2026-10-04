import { EventEmitter } from "node:events";
import { IPC_CHANNELS } from "@dani-dex/contracts/ipc";
import { afterEach, expect, it, vi } from "vitest";

const windows: FakeWindow[] = [];
class FakeWindow extends EventEmitter {
  destroyed = false;
  loading = true;
  webContents = Object.assign(new EventEmitter(), {
    isLoadingMainFrame: () => this.loading,
    isDestroyed: () => this.destroyed,
    mainFrame: { isDestroyed: () => false, detached: false },
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: () => "http://localhost/arc/manzanilla-overlay.html",
  });
  constructor() {
    super();
    windows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
  setMenu() {}
  setVisibleOnAllWorkspaces() {}
  setHiddenInMissionControl() {}
  setIgnoreMouseEvents() {}
  setBounds() {}
  showInactive() {}
  setAlwaysOnTop() {}
  hide() {}
  getBounds() {
    return { x: 0, y: 0, width: 800, height: 650 };
  }
  loadURL() {
    return Promise.resolve();
  }
}
vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1500, height: 1000 } }),
  },
}));

const { DaniArcWindow } = await import("./dani-arc-window");

let arc: InstanceType<typeof DaniArcWindow> | undefined;
afterEach(() => {
  arc?.destroy();
  windows.splice(0);
  vi.useRealTimers();
});

function showArc() {
  vi.useFakeTimers();
  arc = new DaniArcWindow({
    platform: "darwin",
    getMainWindow: () => null,
    showMainWindow: () => undefined,
    listAgents: () => [],
  });
  arc.show();
  return windows[0];
}
it("delivers visibility after ready and finish-load still report main-frame loading", () => {
  const window = showArc();
  arc?.performAction({ type: "ready" });
  window.webContents.emit("did-finish-load");
  expect(window.webContents.send).not.toHaveBeenCalled();
  window.loading = false;
  window.webContents.emit("did-stop-loading");
  expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.arcVisibility, true);
  expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.arcTeam, []);
  expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.arcPreferences, expect.any(Object));
});
it("flushes only the latest visibility, not an earlier summon after a close", () => {
  const window = showArc();
  arc?.performAction({ type: "close" });
  window.loading = false;
  window.webContents.emit("did-stop-loading");
  expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.arcVisibility, false);
  expect(window.webContents.send).not.toHaveBeenCalledWith(IPC_CHANNELS.arcVisibility, true);
});
