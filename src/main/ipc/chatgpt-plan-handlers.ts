import type { ChatGptPlanService } from "../chatgpt-plan-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { requireString } from "./validation";

function clientId(value: unknown): string {
  return requireString(value, "ChatGPT registration", 256);
}
export function chatGptPlanIpcHandlers({
  service,
}: {
  service: Pick<ChatGptPlanService, "summaries" | "connect" | "cancel" | "disconnect">;
}): Pick<IpcGroupHandlers, "chatGptPlan"> {
  return {
    chatGptPlan: {
      list: handler(() => service.summaries()),
      connect: payloadHandler(
        (value) => (value === null ? undefined : clientId(value)),
        async (id) => {
          const result = await service.connect(id);
          const summary = service.summaries().find((r) => r.clientId === result.clientId);
          if (!summary) throw new Error("ChatGPT registration was removed.");
          return summary;
        },
      ),
      cancel: handler(() => service.cancel()),
      disconnect: payloadHandler(clientId, (id) => service.disconnect(id)),
    },
  };
}
