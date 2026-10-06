import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { App } from "./App";
import { installDanidexStub } from "./app-test-harness";
import { CHANNEL_SELECTION_STORAGE_KEY } from "./features/channels/channel-selection";
import { AccountDock } from "./lazy-views";

beforeAll(async () => {
  await AccountDock.preload();
});

beforeEach(installDanidexStub);

it("keeps parked channel records without opening the owner channel UI", async () => {
  await window.danidex.agent.channelCommand({
    type: "save",
    operationId: "create-parked",
    channelId: "channel-parked",
    draft: {
      name: "Project room",
      title: "",
      instructions: "Research the project",
      members: [{ agentId: "chief" }],
      leadAgentId: "chief",
    },
  });
  window.localStorage.setItem(CHANNEL_SELECTION_STORAGE_KEY, JSON.stringify({ "user-1": { local: "channel-parked" } }));
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  expect(screen.queryByRole("button", { name: /Project room/ })).toBeNull();
  expect(screen.queryByRole("main", { name: "Channel conversation" })).toBeNull();
  await fireEvent.click(await screen.findByRole("button", { name: /^Chief, Chief of staff/ }));
  await screen.findByRole("main", { name: "Conversation" });
  expect(await window.danidex.agent.listChannels()).toContainEqual(
    expect.objectContaining({ id: "channel-parked", name: "Project room" }),
  );
});

it("does not offer channel creation in the released workspace", async () => {
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
  await screen.findByRole("menuitem", { name: "New agent" });
  expect(screen.queryByRole("menuitem", { name: "New channel" })).toBeNull();
  expect(await screen.findByRole("menuitem", { name: "New agent" })).toBeEnabled();
});
