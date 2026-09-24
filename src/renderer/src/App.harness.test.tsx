import type { SaveSetupInput } from "@dani-dex/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { installDanidexStub } from "./app-test-harness";

/** The main process echoes the saved file and names the harness the running service was built with. */
function echoSetup(activeHarness: SaveSetupInput["harness"]) {
  vi.mocked(window.danidex.saveSetup).mockImplementation(async (input) => ({
    completed: true,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
    ...(input.harness ? { harness: input.harness } : {}),
    activeHarness: activeHarness ?? null,
  }));
}

async function openHarnessMenu() {
  await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  // Kobalte opens on pointer down, and the trigger's name starts with its label.
  await fireEvent.pointerDown(await screen.findByRole("button", { name: /^Harness/ }), {
    pointerType: "mouse",
    button: 0,
  });
}

describe("agent harness picker", () => {
  beforeEach(() => {
    installDanidexStub();
    // Developer builds only; a shipped build never shows it (see the test below).
    vi.stubEnv("VITE_DANI_DEX_SHOW_HARNESS", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("saves Hermes beside the provider and model, then restarts on request", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "claude",
      preferredModel: null,
      activeHarness: null,
    });
    echoSetup(null);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await openHarnessMenu();

    expect(await screen.findByRole("option", { name: "OMP (not available yet)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await fireEvent.click(screen.getByRole("option", { name: "Hermes" }));

    await waitFor(() =>
      expect(window.danidex.saveSetup).toHaveBeenLastCalledWith({
        preferredProvider: "claude",
        preferredModel: null,
        harness: "hermes",
      }),
    );
    // The service still runs on the provider CLI it was built with, so the change waits for a restart.
    expect(await screen.findByText("Restart Dani-Dex to switch to the new harness.")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(window.danidex.relaunchApp).toHaveBeenCalledTimes(1);
  });

  it("shows no restart when the saved harness is the one already running", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "codex",
      preferredModel: null,
      harness: "hermes",
      activeHarness: "hermes",
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: /^Harness.*Hermes/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart now" })).not.toBeInTheDocument();
  });

  it("switches back to the provider's own CLI", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "codex",
      preferredModel: null,
      harness: "hermes",
      activeHarness: "hermes",
    });
    echoSetup("hermes");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await openHarnessMenu();
    await fireEvent.click(await screen.findByRole("option", { name: "Provider's own CLI" }));
    await waitFor(() =>
      expect(window.danidex.saveSetup).toHaveBeenLastCalledWith({
        preferredProvider: "codex",
        preferredModel: null,
        harness: null,
      }),
    );
    expect(await screen.findByRole("button", { name: "Restart now" })).toBeInTheDocument();
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
