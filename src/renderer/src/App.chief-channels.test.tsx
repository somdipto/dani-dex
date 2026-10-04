import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, expect, it } from "vitest";
import { App } from "./App";
import { AppProviders } from "./app-providers";
import { installDanidexStub } from "./app-test-harness";
import { CHANNEL_SELECTION_STORAGE_KEY } from "./features/channels/channel-selection";
import { useChannels } from "./features/channels/channels-context";
import { AccountDock } from "./lazy-views";

beforeEach(installDanidexStub);

async function seedChannel() {
  await window.danidex.agent.channelCommand({
    type: "save",
    operationId: "seed-preserved-room",
    channelId: "channel-preserved",
    draft: {
      name: "Launch room",
      title: "Keep delegation records",
      instructions: "Preserve these records",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    },
  });
}

it("hides channel navigation and ignores stored channel selection without deleting its data", async () => {
  await AccountDock.preload();
  await seedChannel();
  const original = await window.danidex.agent.listChannels();
  window.localStorage.setItem(
    CHANNEL_SELECTION_STORAGE_KEY,
    JSON.stringify({ "user-1": { local: "channel-preserved" } }),
  );
  render(() => <App />);
  await screen.findByRole("heading", { name: "Chief" });
  expect(screen.queryByRole("button", { name: /Launch room/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("main", { name: "Channel conversation" })).not.toBeInTheDocument();
  expect(await window.danidex.agent.listChannels()).toEqual(original);
});

it("blocks direct channel opening while keeping the roster available internally", async () => {
  await seedChannel();
  function Probe() {
    const channels = useChannels();
    return (
      <>
        <button type="button" onClick={() => void channels.open("channel-preserved")}>
          Try opening preserved channel
        </button>
        <output aria-label="Selected channel">{channels.state.selectedId ?? "none"}</output>
        <output aria-label="Internal channel count">{channels.state.channels.length}</output>
      </>
    );
  }
  render(() => (
    <AppProviders>
      <Probe />
    </AppProviders>
  ));
  await waitFor(() => expect(screen.getByLabelText("Internal channel count")).toHaveTextContent("1"));
  await fireEvent.click(screen.getByRole("button", { name: "Try opening preserved channel" }));
  expect(screen.getByLabelText("Selected channel")).toHaveTextContent("none");
  expect(await window.danidex.agent.listChannels()).toHaveLength(1);
});
