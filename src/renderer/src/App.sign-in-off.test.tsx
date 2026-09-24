import { render, screen } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { emitAuth, installDanidexStub } from "./app-test-harness";

describe("Dani-Dex with sign-in switched off", () => {
  beforeEach(() => {
    installDanidexStub();
  });

  it("opens the workspace for a signed-out user without a sign-in screen", async () => {
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "signed_out" });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Dani-Dex" })).not.toBeInTheDocument();
    expect(await screen.findByText("On this computer")).toBeInTheDocument();
    // There is no account to sign out of.
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("goes straight to first-run onboarding for a new signed-out user", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "signed_out" });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Meet Dani-Dex" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Dani-Dex" })).not.toBeInTheDocument();
  });

  it("does not wait on the account service before opening", async () => {
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "loading" });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connecting to Dani-Dex" })).not.toBeInTheDocument();
    emitAuth?.({
      status: "signed_in",
      user: { id: "u1", email: "person@example.com", name: "Person", avatarUrl: null },
    });
    expect(await screen.findByText("person@example.com")).toBeInTheDocument();
  });
});
