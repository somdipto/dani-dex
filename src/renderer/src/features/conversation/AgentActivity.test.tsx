import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../data";
import { STORY_AGENTS } from "../../preview/fixtures";
import { AgentActivityIndicator } from "./AgentActivity";

function withAvatar(index: number, avatarUrl: string | null): AgentProfile {
  const agent = STORY_AGENTS[index];
  if (!agent) throw new Error("Story agents are empty.");
  return { ...agent, avatarUrl };
}

describe("AgentActivityIndicator", () => {
  it("shows the robot even when an agent has a saved photo", async () => {
    const agent = withAvatar(0, "dani-dex-avatar://agent/chief?v=image-1");
    render(() => <AgentActivityIndicator agent={agent} label="Working on it…" />);

    await screen.findByRole("status");
    expect(screen.queryByAltText("")).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Chief/);
  });

  it("uses the robot avatar when the agent has no custom image", async () => {
    render(() => <AgentActivityIndicator agent={withAvatar(0, null)} label="Working on it…" />);

    await screen.findByRole("status");
    expect(screen.queryByAltText("")).toBeNull();
    expect(screen.getByRole("status")).toHaveAccessibleName(/is working: Working on it/);
  });

  it("follows the agent it is given, including an avatar that is removed", async () => {
    const [agent, setAgent] = createSignal(withAvatar(0, "dani-dex-avatar://agent/chief?v=image-1"));
    render(() => <AgentActivityIndicator agent={agent()} label="Working on it…" />);

    await screen.findByRole("status");
    setAgent(withAvatar(1, null));
    flush();
    expect(screen.queryByAltText("")).toBeNull();
    expect(screen.getByRole("status")).toHaveAccessibleName(/is working: Working on it/);

    setAgent(withAvatar(1, "dani-dex-avatar://agent/sales?v=image-2"));
    flush();
    expect(screen.queryByAltText("")).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Research/);
  });
});
