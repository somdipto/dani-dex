import { IPC_CHANNELS } from "@dani-dex/contracts/ipc";
import { contextBridge, ipcRenderer } from "electron";

type ArcSignal =
  | "team"
  | "connection"
  | "hold"
  | "rotate"
  | "sound"
  | "voice"
  | "targets"
  | "visibility"
  | "preferences"
  | "edit";
const allowed: readonly string[] = [
  "team",
  "connection",
  "hold",
  "rotate",
  "sound",
  "voice",
  "targets",
  "visibility",
  "preferences",
  "edit",
];
contextBridge.exposeInMainWorld("arc", {
  action: (value: unknown) => void ipcRenderer.invoke(IPC_CHANNELS.arcAction, value).catch(() => undefined),
  on: (name: ArcSignal, listener: (value: unknown) => void) => {
    if (!allowed.includes(name) || typeof listener !== "function") return;
    switch (name) {
      case "team":
        ipcRenderer.on(IPC_CHANNELS.arcTeam, (_event, value) => listener(value));
        break;
      case "connection":
        ipcRenderer.on(IPC_CHANNELS.arcConnection, (_event, value) => listener(value));
        break;
      case "hold":
        ipcRenderer.on(IPC_CHANNELS.arcHold, (_event, value) => listener(value));
        break;
      case "rotate":
        ipcRenderer.on(IPC_CHANNELS.arcRotate, (_event, value) => listener(value));
        break;
      case "sound":
        ipcRenderer.on(IPC_CHANNELS.arcSound, (_event, value) => listener(value));
        break;
      case "voice":
        ipcRenderer.on(IPC_CHANNELS.arcVoice, (_event, value) => listener(value));
        break;
      case "targets":
        ipcRenderer.on(IPC_CHANNELS.arcTargets, (_event, value) => listener(value));
        break;
      case "visibility":
        ipcRenderer.on(IPC_CHANNELS.arcVisibility, (_event, value) => listener(value));
        break;
      case "preferences":
        ipcRenderer.on(IPC_CHANNELS.arcPreferences, (_event, value) => listener(value));
        break;
      case "edit":
        ipcRenderer.on(IPC_CHANNELS.arcEdit, (_event, value) => listener(value));
        break;
    }
  },
});
