import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { type VoiceKeyApi, VoiceKeySettings } from "./VoiceKeySettings";

// Voice calls run on the user's own OpenAI key. What is asserted is the secret's path: exactly what
// reaches main, and that the input never holds a key once main has it.
function createApi(overrides: Partial<VoiceKeyApi> = {}) {
  return {
    getRealtimeApiKeyStatus: vi.fn(async () => "missing" as const),
    setRealtimeApiKey: vi.fn(async () => "saved" as const),
    clearRealtimeApiKey: vi.fn(async () => "missing" as const),
    ...overrides,
  };
}

describe("VoiceKeySettings", () => {
  it("saves the pasted key trimmed, then clears the input and reports it saved", async () => {
    const api = createApi();
    render(() => <VoiceKeySettings api={api} />);
    const input = screen.getByLabelText("OpenAI API key");
    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("No key saved");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    fireEvent.input(input, { target: { value: "  sk-user-key  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Key saved"));
    expect(api.setRealtimeApiKey).toHaveBeenCalledExactlyOnceWith("sk-user-key");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("removes a saved key, and says so when saving fails", async () => {
    const api = createApi({
      getRealtimeApiKeyStatus: vi.fn(async () => "saved" as const),
      setRealtimeApiKey: vi.fn(async () => {
        throw new Error("keychain refused");
      }),
    });
    render(() => <VoiceKeySettings api={api} />);
    const input = screen.getByLabelText("OpenAI API key");
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.input(input, { target: { value: "sk-other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the key"));
    expect(screen.getByRole("status")).toHaveTextContent("Key saved");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No key saved"));
    expect(api.clearRealtimeApiKey).toHaveBeenCalledOnce();
  });
});
