import type { AgentProviderId, ProviderRuntimeStatus } from "@dani-dex/contracts/ipc";
import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker, type ProviderPickerOption } from "./ProviderPicker";

/*
 * The two provider rows Dani-Dex treats differently.
 *
 * Claude keeps an install guide and a signed-out sign-in button. OpenCode has neither: Dani-Dex
 * downloads the CLI, and its free models work with no account. Paid key management belongs in
 * Settings, never alongside the free model's Connect or Reconnect action.
 */
const openCode: ProviderPickerOption = {
  id: "opencode",
  name: "OpenCode",
  state: "not-installed",
  message: null,
};

const claude: ProviderPickerOption = {
  id: "claude",
  name: "Claude",
  state: "not-installed",
  message: null,
};

function runtime(status: Partial<ProviderRuntimeStatus>): ProviderRuntimeStatus {
  return { phase: "ready", progress: null, message: null, version: "1.18.30", ...status };
}

function renderPicker(
  options: ProviderPickerOption[],
  onSignInProvider = vi.fn(),
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>,
) {
  const view = render(() => (
    <ProviderPicker
      value="opencode"
      options={options}
      ariaLabel="AI providers"
      allowUnavailableSelection
      onChange={vi.fn()}
      onInstallProvider={vi.fn()}
      onConnectProvider={onConnectProvider}
      onSignInProvider={onSignInProvider}
    />
  ));
  return { view, onSignInProvider, onConnectProvider };
}

describe("ProviderPicker", () => {
  it("puts Dani Free first without removing other sign-in rows", () => {
    const view = render(() => (
      <ProviderPicker
        value="opencode"
        options={[claude, { id: "codex", name: "ChatGPT", state: "not-installed" }, openCode]}
        daniOnly
        ariaLabel="AI providers"
        allowUnavailableSelection
        onChange={vi.fn()}
        onSignInProvider={vi.fn()}
      />
    ));
    expect(view.getAllByRole("radio")).toEqual([
      view.getByRole("radio", { name: /Dani Free/ }),
      view.getByRole("radio", { name: /Claude/ }),
      view.getByRole("radio", { name: /ChatGPT/ }),
    ]);
  });

  it("offers a keyless connection and no key dialog for Dani Free", () => {
    const onConnectProvider = vi.fn();
    const { view, onSignInProvider } = renderPicker(
      [claude, { ...openCode, state: "available", runtimeStatus: runtime({}) }],
      vi.fn(),
      onConnectProvider,
    );
    expect(view.getByRole("radio", { name: /Claude/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Add paid models" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Reconnect OpenCode" }));
    expect(onConnectProvider).toHaveBeenCalledWith("opencode");
    expect(onSignInProvider).not.toHaveBeenCalled();
  });

  it("retries a failed free runtime without asking for a paid-model key", () => {
    const onConnectProvider = vi.fn();
    const { view, onSignInProvider } = renderPicker(
      [{ ...openCode, state: "error", runtimeStatus: runtime({}) }],
      vi.fn(),
      onConnectProvider,
    );
    fireEvent.click(view.getByRole("button", { name: "Connect OpenCode" }));
    expect(onConnectProvider).toHaveBeenCalledWith("opencode");
    expect(view.queryByRole("button", { name: "Add paid models" })).toBeNull();
    expect(onSignInProvider).not.toHaveBeenCalled();
  });

  it("never offers a paid-model key action on the free row, even when ready", () => {
    const { view, onSignInProvider } = renderPicker([{ ...openCode, state: "available", runtimeStatus: runtime({}) }]);
    expect(view.queryByRole("button", { name: "Add paid models" })).toBeNull();
    expect(view.queryByRole("button", { name: "Manage key" })).toBeNull();
    expect(onSignInProvider).not.toHaveBeenCalled();
  });

  it("keeps only Cancel on a downloading OpenCode row", () => {
    const downloading = renderPicker([
      { ...openCode, runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }) },
    ]);
    expect(downloading.view.queryByRole("button", { name: "Add paid models" })).toBeNull();
    expect(downloading.view.getByRole("button", { name: "Cancel OpenCode" })).toBeTruthy();
  });

  it("does not offer legacy CLI device-code login", () => {
    const view = render(() => (
      <ProviderPicker
        value="codex"
        options={[{ id: "codex", name: "ChatGPT", state: "available" }]}
        ariaLabel="AI providers"
        onChange={vi.fn()}
        onSignInWithCodeProvider={vi.fn()}
      />
    ));
    expect(view.queryByRole("button", { name: "More ways to log in to ChatGPT" })).toBeNull();
  });

  it("badges the tier and connection state without doubling them", () => {
    // A saved key leaves the runtime "Connected" to speak for the row: no second chip.
    expect(renderPicker([{ ...openCode, keyStatus: "saved" }]).view.queryByText("Free")).toBeNull();

    // Keyless rows read as free, including when the key is unreadable.
    expect(renderPicker([{ ...openCode, keyStatus: "missing" }]).view.getByText("Free")).toBeTruthy();
    expect(renderPicker([{ ...openCode, keyStatus: "unreadable" }]).view.getByText("Free")).toBeTruthy();

    // Unknown until the first read: no badge rather than a wrong one, and never on another row.
    expect(renderPicker([openCode, { ...claude, keyStatus: "saved" }]).view.queryByText("Free")).toBeNull();

    // Steady and signed in: the runtime badge alone, printed once.
    const steady = renderPicker([{ ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "saved" }]);
    expect(steady.view.getAllByText("Connected")).toHaveLength(1);

    // Steady and keyless: the Free tier badge beside the runtime one.
    const keyless = renderPicker([
      { ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "missing" },
    ]);
    expect(keyless.view.getByText("Free")).toBeTruthy();
    expect(keyless.view.getByText("Connected")).toBeTruthy();

    // Busy states still report, with no tier chip beside them once signed in. Main holds the
    // provider "connecting" for the whole install, so the row reports the download, not the word.
    const downloading = renderPicker([
      {
        ...openCode,
        connectionState: "connecting",
        runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }),
        keyStatus: "saved",
      },
    ]);
    expect(downloading.view.getByText("40%")).toBeTruthy();
    expect(downloading.view.queryByText("Free")).toBeNull();
    expect(downloading.view.queryByText("Connecting")).toBeNull();
  });

  it("requires the ChatGPT runtime download before offering sign-in", () => {
    const view = render(() => (
      <ProviderPicker
        value="opencode"
        options={[
          { ...claude, runtimeStatus: runtime({ phase: "not-downloaded", version: null }) },
          {
            id: "codex",
            name: "ChatGPT",
            state: "sign-in-required",
            runtimeStatus: runtime({ phase: "not-downloaded", version: null }),
          },
        ]}
        ariaLabel="AI providers"
        onChange={vi.fn()}
        onDownloadProvider={vi.fn()}
        onConnectProvider={vi.fn()}
        onOptionalApiKey={vi.fn()}
      />
    ));
    expect(view.getByRole("button", { name: "Download Claude" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Download ChatGPT" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Sign in with ChatGPT" })).toBeNull();
    expect(view.getByRole("button", { name: "Optional API key" })).toBeTruthy();
  });
});
