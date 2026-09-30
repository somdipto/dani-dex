import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { VoiceSetupDialog } from "./VoiceSetupDialog";

it("requires paid consent before starting a call and never starts on cancel", async () => {
  const start = vi.fn(),
    close = vi.fn();
  vi.stubGlobal("danidex", {});
  Object.defineProperty(window, "danidex", {
    configurable: true,
    value: { voice: { codexStop: vi.fn(async () => undefined), getRealtimeApiKeyStatus: vi.fn(async () => "saved") } },
  });
  render(() => (
    <VoiceSetupDialog open localSupported={false} onClose={close} onLocalDictation={vi.fn()} onOpenAiCall={start} />
  ));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText("Experimental ChatGPT plan voice")).toBeNull();
  expect(screen.getByRole("button", { name: "Use dictation" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close voice setup" }));
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Set up live conversation" }));
  const button = await screen.findByRole("button", { name: "Start paid call" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /paid OpenAI API usage/ }));
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(close).toHaveBeenCalled();
});
