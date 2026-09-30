import { z } from "zod";
import { hasChatGptPlanScope } from "./chatgpt-plan-oauth";
import type { ChatGptRegistration } from "./chatgpt-plan-store";
import { readChatGptJson } from "./chatgpt-plan-tokens";

const catalogSchema = z.object({
  models: z
    .array(
      z.object({ slug: z.string().min(1).max(256), display_name: z.string().min(1).max(512), visibility: z.string() }),
    )
    .max(2000),
});
export interface ChatGptModelChoice {
  id: string;
  name: string;
}
export async function listChatGptPlanModels(
  registration: ChatGptRegistration,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatGptModelChoice[]> {
  if (!hasChatGptPlanScope(registration.scopes.join(" ")) || registration.expiresAt <= Math.floor(Date.now() / 1000))
    throw new Error("ChatGPT plan connection is not ready.");
  const catalog = await readChatGptJson(fetchImpl, "https://api.openai.com/v1/models", catalogSchema, {
    headers: { Authorization: `Bearer ${registration.accessToken}` },
  });
  const visible = catalog.models.filter((m) => m.visibility === "list");
  if (new Set(visible.map((m) => m.slug)).size !== visible.length)
    throw new Error("ChatGPT model catalog repeats a model.");
  return visible.map((m) => ({ id: m.slug, name: m.display_name }));
}
