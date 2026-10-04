import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { expect, it, vi } from "vitest";
import { VoiceSetupDialog } from "./VoiceSetupDialog";

it("requires paid consent before starting a call and never starts on cancel", async () => {
  const start = vi.fn(),
    close = vi.fn();
  vi.stubGlobal("danidex", {});
  Object.defineProperty(window, "danidex", {
    configurable: true,
    value: {
      providerRuntimes: runtimeApi(),
      voice: {
        codexStatus: vi.fn(async () => ({ connected: false })),
        codexStop: vi.fn(async () => undefined),
        getRealtimeApiKeyStatus: vi.fn(async () => "saved"),
      },
    },
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

function runtimeApi() {
  const status = { phase: "not-downloaded", progress: null, message: null, version: null };
  const snapshot = { revision: 1, providers: { codex: status } };
  return {
    getStatus: vi.fn(async () => snapshot),
    download: vi.fn(async () => ({ ...snapshot, providers: { codex: { ...status, phase: "ready" } } })),
    cancel: vi.fn(async () => snapshot),
    onEvent: vi.fn(() => vi.fn()),
  };
}
it("opening voice has no runtime effects; explicit experimental setup installs and initializes", async () => {
  const runtimes = runtimeApi();
  const voice = {
    codexStatus: vi.fn(async () => ({ connected: false })),
    codexConnect: vi.fn(),
    codexStart: vi.fn(),
    codexStop: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, "danidex", { configurable: true, value: { providerRuntimes: runtimes, voice } });
  render(() => (
    <VoiceSetupDialog open localSupported={false} onClose={vi.fn()} onLocalDictation={vi.fn()} onOpenAiCall={vi.fn()} />
  ));
  expect(runtimes.getStatus).not.toHaveBeenCalled();
  expect(runtimes.download).not.toHaveBeenCalled();
  expect(runtimes.onEvent).not.toHaveBeenCalled();
  expect(voice.codexStatus).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole("button", { name: "Experimental options" }));
  expect(runtimes.download).not.toHaveBeenCalled();
  expect(voice.codexStatus).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole("button", { name: "Prepare experimental voice runtime" }));
  await screen.findByText("Voice runtime ready. Sign-in and call consent are separate.");
  expect(runtimes.download).toHaveBeenCalledExactlyOnceWith("codex");
  expect(voice.codexStatus).toHaveBeenCalledOnce();
  expect(voice.codexConnect).not.toHaveBeenCalled();
  expect(voice.codexStart).not.toHaveBeenCalled();
});
it("shows download errors and retry without starting a call", async () => {
  const runtimes = runtimeApi();
  runtimes.download.mockRejectedValueOnce(new Error("Runtime download unavailable"));
  const voice = { codexStatus: vi.fn(async () => ({ connected: false })), codexStop: vi.fn(async () => undefined) };
  Object.defineProperty(window, "danidex", { configurable: true, value: { providerRuntimes: runtimes, voice } });
  render(() => (
    <VoiceSetupDialog open localSupported={false} onClose={vi.fn()} onLocalDictation={vi.fn()} onOpenAiCall={vi.fn()} />
  ));
  await fireEvent.click(screen.getByRole("button", { name: "Experimental options" }));
  await fireEvent.click(screen.getByRole("button", { name: "Prepare experimental voice runtime" }));
  await screen.findByText("Runtime download unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Prepare experimental voice runtime" }));
  await screen.findByText("Voice runtime ready. Sign-in and call consent are separate.");
  expect(runtimes.download).toHaveBeenCalledTimes(2);
});
it("cancel ignores a late runtime completion and does not initialize it", async () => {
  const runtimes = runtimeApi();
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = await runtimeApi().download();
  runtimes.download.mockImplementation(async () => {
    await held;
    return ready;
  });
  const voice = { codexStatus: vi.fn(), codexStop: vi.fn(async () => undefined) };
  Object.defineProperty(window, "danidex", { configurable: true, value: { providerRuntimes: runtimes, voice } });
  render(() => (
    <VoiceSetupDialog open localSupported={false} onClose={vi.fn()} onLocalDictation={vi.fn()} onOpenAiCall={vi.fn()} />
  ));
  await fireEvent.click(screen.getByRole("button", { name: "Experimental options" }));
  await fireEvent.click(screen.getByRole("button", { name: "Prepare experimental voice runtime" }));
  await waitFor(() => expect(runtimes.download).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Cancel voice setup" }));
  release?.();
  await screen.findByText("Voice setup cancelled. You can retry.");
  expect(runtimes.cancel).toHaveBeenCalledWith("codex");
  expect(voice.codexStatus).not.toHaveBeenCalled();
});

it("closing setup ignores a late download and removes the progress subscription", async () => {
  const runtimes = runtimeApi();
  const unsubscribe = vi.fn();
  runtimes.onEvent.mockReturnValue(unsubscribe);
  const ready = await runtimeApi().download();
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtimes.download.mockImplementation(async () => {
    await held;
    return ready;
  });
  const voice = { codexStatus: vi.fn(), codexStop: vi.fn(async () => undefined) };
  Object.defineProperty(window, "danidex", { configurable: true, value: { providerRuntimes: runtimes, voice } });
  const [open, setOpen] = createSignal(true);
  render(() => (
    <VoiceSetupDialog
      open={open()}
      localSupported={false}
      onClose={() => setOpen(false)}
      onLocalDictation={vi.fn()}
      onOpenAiCall={vi.fn()}
    />
  ));
  await fireEvent.click(screen.getByRole("button", { name: "Experimental options" }));
  await fireEvent.click(screen.getByRole("button", { name: "Prepare experimental voice runtime" }));
  await waitFor(() => expect(runtimes.download).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Close voice setup" }));
  release?.();
  await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  expect(voice.codexStatus).not.toHaveBeenCalled();
});
