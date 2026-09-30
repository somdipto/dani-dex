import { describe, expect, it } from "vitest";
import { chatGptPlanRuntime } from "./chatgpt-plan-runtime";
import type { ChatGptRegistration } from "./chatgpt-plan-store";

const registration: ChatGptRegistration = {
  clientId: "issued",
  subject: "subject",
  email: null,
  accessToken: "private-token",
  refreshToken: "private-refresh",
  idToken: "private-id",
  scopes: ["chatgpt.tokens.use.direct"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
describe("ChatGPT child-only routing", () => {
  it("supplies the selected OAuth token only to the configured Responses child", () => {
    const before = process.env.ACCESS_TOKEN;
    const config = chatGptPlanRuntime(() => registration);
    expect(config.environment?.().ACCESS_TOKEN).toBe("private-token");
    expect(process.env.ACCESS_TOKEN).toBe(before);
    expect(config.arguments?.join(" ")).not.toContain("private-token");
    expect(config.arguments).toContain("model_providers.openai_chatgpt_plan.supports_websockets=false");
    expect(config.environment?.().OPENAI_API_KEY).toBeUndefined();
  });
  it("fails closed for identity-only, disconnected or expired registrations", () => {
    for (const value of [null, { ...registration, scopes: ["openid"] }, { ...registration, expiresAt: 1 }])
      expect(() => chatGptPlanRuntime(() => value).environment?.()).toThrow();
  });
});
