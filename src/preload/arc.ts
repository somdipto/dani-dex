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
  action: (value: unknown) => ipcRenderer.send("dani-arc:action", value),
  on: (name: ArcSignal, listener: (value: unknown) => void) => {
    if (!allowed.includes(name) || typeof listener !== "function") return;
    ipcRenderer.on(`dani-arc:${name}`, (_event, value) => listener(value));
  },
});
