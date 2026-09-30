import { describe, expect, it } from "vitest";
import { listChatGptPlanModels } from "./chatgpt-plan-models";
import type { ChatGptRegistration } from "./chatgpt-plan-store";

const record: ChatGptRegistration = {
  clientId: "issued",
  subject: "subject",
  email: null,
  accessToken: "private-token",
  refreshToken: "refresh",
  idToken: "id",
  scopes: ["chatgpt.tokens.use.direct"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
describe("ChatGPT account model catalog", () => {
  it("uses selected account token and preserves server order while hiding non-list models", async () => {
    const f: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
      return Response.json({
        models: [
          { slug: "b", display_name: "B", visibility: "list" },
          { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
          { slug: "a", display_name: "A", visibility: "list" },
        ],
      });
    };
    expect(await listChatGptPlanModels(record, f)).toEqual([
      { id: "b", name: "B" },
      { id: "a", name: "A" },
    ]);
  });
  it("does not substitute a bundled catalog or reflect secret error content on failure", async () => {
    const f: typeof fetch = async () => new Response("private-error", { status: 403 });
    await expect(listChatGptPlanModels(record, f)).rejects.toThrow("HTTP 403");
  });
});
