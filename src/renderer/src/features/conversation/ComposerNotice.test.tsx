import { fireEvent, render, screen } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { ComposerSignInNotice } from "./ComposerNotice";

it("contains a failed sign-in and leaves the action retryable", async () => {
  const onSignIn = vi.fn().mockRejectedValue(new Error("Provider login failed."));
  render(() => <ComposerSignInNotice provider="codex" onSignIn={onSignIn} />);
  const button = screen.getByRole("button", { name: "Sign in to ChatGPT" });
  await fireEvent.click(button);
  expect(await screen.findByText("Provider login failed.")).toBeInTheDocument();
  expect(button).toBeEnabled();
});

it("does not offer the intentionally blocked Claude subscription action", () => {
  const onSignIn = vi.fn();
  render(() => <ComposerSignInNotice provider="claude" onSignIn={onSignIn} />);
  expect(
    screen.getByText("Claude subscription sign-in is unavailable. Use a Claude API key in provider settings."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign in to Claude" })).not.toBeInTheDocument();
  expect(onSignIn).not.toHaveBeenCalled();
});
