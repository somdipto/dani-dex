import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { CodexVoicePanel } from "./CodexVoicePanel";

it("keeps OAuth completion separate from consent and never starts a call on login", async () => {
  const voice = {
    codexConnect: vi.fn(async () => undefined),
    codexStatus: vi.fn(async () => ({ connected: true })),
    codexStart: vi.fn(),
    codexStop: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, "danidex", { configurable: true, value: { voice } });
  render(() => <CodexVoicePanel ready />);
  const start = screen.getByRole("button", { name: "Start experimental call" });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with OpenAI" }));
  await screen.findByText("Finish OpenAI sign-in in your browser, then check sign-in here.");
  expect(voice.codexStart).not.toHaveBeenCalled();
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check OpenAI sign-in" }));
  await waitFor(() => expect(start).toBeEnabled());
  expect(voice.codexStart).not.toHaveBeenCalled();
});
it("an unfinished OAuth login cannot enable a call", async () => {
  const voice = { codexStatus: vi.fn(async () => ({ connected: false })), codexStop: vi.fn(async () => undefined) };
  Object.defineProperty(window, "danidex", { configurable: true, value: { voice } });
  render(() => <CodexVoicePanel ready />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Check OpenAI sign-in" }));
  await screen.findByText("OpenAI sign-in is not complete. Finish it in your browser, then check again.");
  expect(screen.getByRole("button", { name: "Start experimental call" })).toBeDisabled();
});
