import { userInfo } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { DaniDexDatabase } from "../backend/dani-dex-database";
import { HarmlessEffectExecutor } from "../backend/effects/harmless-effect-executor";
import type { EffectProposal } from "../backend/effects/harmless-effect-policy";

/** Separate development entry: ordinary application/provider startup is never imported. */
if (app.isPackaged || process.env.DANI_DEX_HARMLESS_PILOT !== "1") {
  throw new Error("Harmless pilot requires explicit development launch.");
}
const userData = app.commandLine.getSwitchValue("user-data-dir");
if (!userData) throw new Error("An explicit disposable user-data directory is required.");
app.setPath("userData", userData);
let database: DaniDexDatabase;
let executor: HarmlessEffectExecutor;
let grantId: string | null = null;
let window: BrowserWindow;
let current: EffectProposal | null = null;
let status =
  "Only local fixed receipt effects are available. No providers, browser tools, MCP or channel adapters start.";
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
async function render() {
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="font:18px system-ui;background:#101722;color:#e5eef8;padding:40px"><h1>Dani-Dex effect safety pilot</h1><p>Development-only local receipt. Use the Pilot menu.</p><p>${escapeHtml(status)}</p><h2>Final payload for owner review</h2><pre style="white-space:pre-wrap">${escapeHtml(current ? JSON.stringify(current.payload) : "No operation prepared")}</pre><h2>Durable operation state</h2><pre style="font-size:13px;white-space:pre-wrap">${escapeHtml(JSON.stringify(executor.journal.snapshot(), null, 2))}</pre></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
async function act(action: () => void | Promise<void>) {
  try {
    await action();
  } catch (error) {
    status = error instanceof Error ? error.message : "Pilot operation failed.";
  }
  await render();
}
void app.whenReady().then(async () => {
  database = new DaniDexDatabase(join(userData, "harmless-effects"));
  await database.initialize();
  executor = new HarmlessEffectExecutor(database, `uid:${userInfo().uid}`, Date.now);
  await executor.initialize();
  window = new BrowserWindow({
    width: 1100,
    height: 840,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Pilot",
        submenu: [
          {
            label: "Prepare fixed receipt",
            accelerator: "CommandOrControl+1",
            click: () =>
              void act(() => {
                current = executor.propose();
                grantId = null;
                status = "Prepared, not approved. Dispatch must fail until native review.";
              }),
          },
          {
            label: "Approve final payload",
            accelerator: "CommandOrControl+2",
            click: () =>
              void act(async () => {
                if (!current) throw new Error("Prepare an operation first.");
                const reviewedId = current.id;
                const review = await dialog.showMessageBox(window, {
                  type: "question",
                  title: "Approve harmless local effect",
                  message: "Write exactly this fixed payload to the disposable pilot receipt folder?",
                  detail: JSON.stringify(executor.proposal(reviewedId, executor.owner).payload, null, 2),
                  buttons: ["Cancel", "Approve once"],
                  defaultId: 0,
                  cancelId: 0,
                });
                if (review.response !== 1) {
                  status = "Approval cancelled. No effect.";
                  return;
                }
                grantId = executor.approve(reviewedId, {
                  issuer: executor.owner,
                  source: "native-dialog",
                  approvedAt: Date.now(),
                }).id;
                status = "Native review confirmation stored. One-shot dispatch pending.";
              }),
          },
          {
            label: "Dispatch once",
            accelerator: "CommandOrControl+3",
            click: () =>
              void act(async () => {
                if (!current) throw new Error("Prepare first.");
                status = (await executor.dispatch(current.id, grantId ?? "")).phase;
              }),
          },
          {
            label: "Dispatch with response loss",
            accelerator: "CommandOrControl+4",
            click: () =>
              void act(async () => {
                if (!current) throw new Error("Prepare first.");
                const perform = executor.adapter.perform.bind(executor.adapter);
                executor.adapter.perform = async (operation, payload) => {
                  await perform(operation, payload);
                  throw new Error("Test response loss.");
                };
                try {
                  status = (await executor.dispatch(current.id, grantId ?? "")).phase;
                } finally {
                  executor.adapter.perform = perform;
                }
              }),
          },
          {
            label: "Revoke pending grants",
            accelerator: "CommandOrControl+5",
            click: () =>
              void act(() => {
                executor.revoke();
                status = "Revocation epoch advanced. Pending earlier grants cannot dispatch.";
              }),
          },
          {
            label: "Reconcile unknown receipts",
            accelerator: "CommandOrControl+6",
            click: () =>
              void act(async () => {
                for (const row of executor.journal.snapshot())
                  if (row.phase === "unknown" || row.phase === "executing") await executor.reconcile(row.id);
                status = "Matched independent receipt bytes; no resend performed.";
              }),
          },
          { role: "quit" },
        ],
      },
    ]),
  );
  await render();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => database?.close());
