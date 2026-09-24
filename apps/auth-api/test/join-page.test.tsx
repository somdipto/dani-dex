import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "../src/components/landing/JoinPage";

// The page only exists once Dan Lab serves an invite origin; shipped defaults set none. This file
// runs the page against a configured stand-in on the reserved .example domain.
vi.mock("@dani-dex/contracts/online-services", () => ({
  DANI_DEX_WEB_ORIGIN: "https://dani-dex.example",
  DANI_DEX_API_ORIGIN: "https://api.dani-dex.example",
  DANI_DEX_TEAM_HOST_SUFFIX: ".dani-dex.example",
  DANI_DEX_ANALYTICS_API_URL: null,
  DANI_DEX_HOSTED_SITE_SUFFIX: null,
}));

// A path, not a full URL: the page reads only the path and query and resolves them against the invite origin.
const INVITE_URL =
  "/join?api=https%3A%2F%2Fstudio-mac-k7m4q2pz-host.dani-dex.example%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(cleanup);

describe("invitation landing page", () => {
  it("offers the desktop fallback without displaying the bearer token", async () => {
    window.history.replaceState({}, "", INVITE_URL);
    render(() => <JoinPage />);

    const openButton = await screen.findByRole("link", { name: "Open Dani-Dex" });
    await waitFor(() => expect(openButton).toHaveAttribute("href", expect.stringMatching(/^dani-dex:\/\/join\?/u)));
    expect(screen.getByRole("link", { name: "Download Dani-Dex" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("does not create an app link for an invalid invitation", async () => {
    window.history.replaceState({}, "", "/join?invite=bad");
    render(() => <JoinPage />);

    expect(
      await screen.findByText("This invitation link is invalid or incomplete. Ask the host for a new invitation."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Dani-Dex" })).not.toBeInTheDocument();
  });
});
