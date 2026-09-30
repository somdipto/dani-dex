import type { CodexProcessConfiguration } from "../backend/app-server-client";
import { hasChatGptPlanScope } from "./chatgpt-plan-oauth";
import type { ChatGptRegistration } from "./chatgpt-plan-store";

/** Tokens travel to this one child, never command arguments or global process.env. */
export function chatGptPlanRuntime(registration: () => ChatGptRegistration | null): CodexProcessConfiguration {
  return {
    arguments: [
      "-c",
      'model_provider="openai_chatgpt_plan"',
      "-c",
      'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
      "-c",
      'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
      "-c",
      'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
      "-c",
      'model_providers.openai_chatgpt_plan.wire_api="responses"',
      "-c",
      "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
      "-c",
      "model_providers.openai_chatgpt_plan.supports_websockets=false",
    ],
    environment: () => {
      const selected = registration();
      if (!selected || !hasChatGptPlanScope(selected.scopes.join(" ")))
        throw new Error("ChatGPT plan consent is required.");
      if (selected.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("ChatGPT connection needs renewal.");
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      delete env.ACCESS_TOKEN;
      return { ...env, ACCESS_TOKEN: selected.accessToken };
    },
  };
}
