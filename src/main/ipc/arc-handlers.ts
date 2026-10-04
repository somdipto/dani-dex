import type { DaniArcWindow } from "../dani-arc-window";
import { authorizedHandler, type IpcGroupHandlers } from "./define-ipc-group";

export function arcIpcHandlers(arc: DaniArcWindow): Pick<IpcGroupHandlers, "arc"> {
  return {
    arc: {
      action: authorizedHandler(
        (event) => arc.requireSender(event),
        (payload) => arc.decodeAction(payload),
        (_event, action) => arc.performAction(action),
      ),
    },
  };
}
