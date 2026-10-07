import { CONTEXT_IMPORT_LIMITS } from "@dani-dex/contracts/context-import";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMockDaniDex, type MockDaniDexControls } from "../../preview/mock-dani-dex";
import { ContextImportPanel } from "./ContextImportPanel";

let mock: MockDaniDexControls;
const provenance = " | Source: this chat | Uncertainty: none known; coverage: partial";
beforeEach(() => {
  mock = createMockDaniDex();
  window.danidex = mock.api;
});
afterEach(() => mock.dispose());

async function preview(text: string): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "Import from ChatGPT or Claude" }));
  await fireEvent.click(await screen.findByRole("button", { name: "Import from ChatGPT" }));
  const pasted = await screen.findByRole("textbox", { name: "Pasted answer" });
  await fireEvent.input(pasted, { target: { value: text } });
  await fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findAllByRole("textbox", { name: "Imported entry" });
}

it("keeps entries beyond capacity available after saving the entries that fit", async () => {
  const [room, setRoom] = createSignal(1);
  const save = vi.fn(async (_texts: string[]): Promise<string[]> => {
    setRoom(0);
    return [];
  });
  render(() => <ContextImportPanel room={room()} limit={64} onSave={save} doneLabel={(n) => `Saved ${n}`} />);
  await preview(`- Uses Linux${provenance}\n- Builds Dani-Dex${provenance}`);
  await fireEvent.click(screen.getByRole("button", { name: "Save 1 memories" }));
  await waitFor(() => expect(screen.getAllByRole("textbox", { name: "Imported entry" })).toHaveLength(1));
  expect(screen.getByRole("textbox", { name: "Imported entry" })).toHaveValue(
    `Imported from ChatGPT (historical): Builds Dani-Dex${provenance}`,
  );
  expect(save).toHaveBeenCalledWith([`Imported from ChatGPT (historical): Uses Linux${provenance}`]);
  setRoom(1);
  await fireEvent.click(await screen.findByRole("button", { name: "Save 1 memories" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toEqual([`Imported from ChatGPT (historical): Builds Dani-Dex${provenance}`]);
});

it("redacts an edited entry on save and retains it after a host failure", async () => {
  const save = vi.fn(async (_texts: string[]): Promise<string[]> => {
    throw new Error("Host offline");
  });
  render(() => <ContextImportPanel room={64} limit={64} onSave={save} doneLabel={(n) => `Saved ${n}`} />);
  await preview(`- Uses Linux${provenance}`);
  await fireEvent.input(screen.getByRole("textbox", { name: "Imported entry" }), {
    target: { value: `Imported from ChatGPT (historical): My password is demo-edit-secret${provenance}` },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Save 1 memories" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0][0]).not.toContain("demo-edit-secret");
  expect(await screen.findByRole("status")).toHaveTextContent("Host offline");
  expect(screen.getByRole("textbox", { name: "Imported entry" })).toBeInTheDocument();
});

it("rejects an oversized paste before it creates entries or sends anything", async () => {
  const save = vi.fn(async (): Promise<string[]> => []);
  render(() => <ContextImportPanel room={64} limit={64} onSave={save} doneLabel={(n) => `Saved ${n}`} />);
  await fireEvent.click(screen.getByRole("button", { name: "Import from ChatGPT or Claude" }));
  await fireEvent.click(await screen.findByRole("button", { name: "Import from ChatGPT" }));
  await fireEvent.input(await screen.findByRole("textbox", { name: "Pasted answer" }), {
    target: { value: "x".repeat(CONTEXT_IMPORT_LIMITS.pastedText + 1) },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByRole("status")).toHaveTextContent("pasted context is too large");
  expect(screen.queryByRole("textbox", { name: "Imported entry" })).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
