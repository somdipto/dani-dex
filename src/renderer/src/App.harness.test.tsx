import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { installDanidexStub } from "./app-test-harness";

// Settings has no harness row any more (harness names never reach the user); the stored harness
// must still survive saves made elsewhere.
describe("agent harness", () => {
  beforeEach(() => {
    installDanidexStub();
    vi.stubEnv("VITE_DANI_DEX_SHOW_HARNESS", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the stored harness when the provider review saves", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "codex",
      preferredModel: null,
      harness: "hermes",
      activeHarness: "hermes",
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
    await fireEvent.click(screen.getByRole("button", { name: "Providers & permissions" }));
    await screen.findByRole("dialog", { name: "Providers & permissions" });
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    // The review screen names a provider alone. Dropping the harness here would move every agent off
    // Hermes on the next launch without the user ever touching the harness row.
    await waitFor(() =>
      expect(window.danidex.saveSetup).toHaveBeenLastCalledWith({
        preferredProvider: "codex",
        preferredModel: null,
        harness: "hermes",
      }),
    );
  });
});

describe("shipped build", () => {
  beforeEach(() => {
    installDanidexStub();
  });

  it("never offers a harness choice", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "claude",
      preferredModel: null,
      harness: "automatic",
      activeHarness: "hermes",
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^Harness/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hermes/)).not.toBeInTheDocument();
  });
});
