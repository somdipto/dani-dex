import { createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentActivityIndicator } from "../src/features/conversation/AgentActivity";
import { STORY_AGENTS } from "./fixtures";

const indicatorMeta = {
  title: "Conversation/AgentActivityIndicator",
  component: AgentActivityIndicator,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentActivityIndicator>;

export default indicatorMeta;
type IndicatorStory = StoryObj<typeof indicatorMeta>;

export const Working: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[0],
    label: "Connecting the dots…",
  },
};

export const Playful: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[1],
    label: "Tiny gears are turning…",
  },
};

// The desktop app icon, scaled down and inlined so the story needs no network.
// It stands in for an agent’s uploaded avatar: the circular crop and the rings
// flying around it are what this story is for.
export const RobotWithSavedPhoto: IndicatorStory = {
  args: {
    agent: { ...STORY_AGENTS[0], avatarUrl: "dani-dex-avatar://agent/chief?v=saved-photo" },
    label: "Connecting the dots…",
  },
};

export const TransitionLoop: IndicatorStory = {
  args: {
    agent: STORY_AGENTS[0],
    label: "Putting the answer together…",
  },
  render: (args) => {
    const [phase, setPhase] = createSignal<"active" | "exiting">("active");
    onSettled(() => {
      const timer = window.setInterval(
        () => setPhase((current) => (current === "active" ? "exiting" : "active")),
        1_400,
      );
      return () => window.clearInterval(timer);
    });
    return <AgentActivityIndicator {...args} phase={phase()} />;
  },
};
