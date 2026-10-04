import { describe, expect, it } from "vitest";
import { chiefConversationAgent } from "./chief-conversation";

describe("Chief-only conversation identity", () => {
  it("selects the canonical Chief without dropping the worker roster", () => {
    const agents = [
      { id: "research", name: "Research" },
      { id: "chief-of-staff", name: "Chief of staff" },
      { id: "builder", name: "Builder" },
    ];
    expect(chiefConversationAgent(agents)?.id).toBe("chief-of-staff");
    expect(agents).toHaveLength(3);
  });
  it("supports one migrated Chief identity", () => {
    expect(chiefConversationAgent([{ id: "migrated", name: "Chief", avatarSeed: "manzanilla:chief" }])?.id).toBe(
      "migrated",
    );
  });
  it("does not turn an arbitrary first worker into Chief", () => {
    expect(chiefConversationAgent([{ id: "research", name: "Research" }])).toBeUndefined();
  });
  it("blocks ambiguous migrated identities", () => {
    expect(
      chiefConversationAgent([
        { id: "a", name: "Chief" },
        { id: "b", name: "Chief of staff" },
      ]),
    ).toBeUndefined();
  });
});
