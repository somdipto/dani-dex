import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VoiceKeySettings } from "../src/features/settings/VoiceKeySettings";
import "../src/features/settings/settings-modal.css";

const meta = {
  title: "Settings/VoiceKeySettings",
  component: VoiceKeySettings,
  parameters: { layout: "padded", a11y: { test: "error" } },
  args: {
    api: {
      getRealtimeApiKeyStatus: fn(async () => "missing" as const),
      setRealtimeApiKey: fn(async () => "saved" as const),
      clearRealtimeApiKey: fn(async () => "missing" as const),
    },
  },
} satisfies Meta<typeof VoiceKeySettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoKey: Story = {};

export const Saved: Story = {
  args: {
    api: {
      getRealtimeApiKeyStatus: fn(async () => "saved" as const),
      setRealtimeApiKey: fn(async () => "saved" as const),
      clearRealtimeApiKey: fn(async () => "missing" as const),
    },
  },
};
