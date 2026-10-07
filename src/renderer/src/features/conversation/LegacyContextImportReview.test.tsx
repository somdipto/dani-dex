import type { LocalContextImportScope } from "@dani-dex/contracts/context-import";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installImportLocksStub } from "./context-import-locks.test-helper";
import { pendingImportTexts } from "./context-import-save";
import { LegacyContextImportReview } from "./LegacyContextImportReview";

let restoreLocks: () => void;
beforeEach(() => {
  restoreLocks = installImportLocksStub();
});
afterEach(() => {
  restoreLocks();
  localStorage.clear();
});

it("requires a new review if the account changes after the held import was opened", async () => {
  const local: LocalContextImportScope = { accountId: null, serverId: "local", agentId: "chief" };
  const other: LocalContextImportScope = { ...local, accountId: "another-owner" };
  localStorage.setItem("dani-dex.pending-context-import", JSON.stringify(["Uses Linux"]));
  const [scope, setScope] = createSignal(local);
  const adopted = vi.fn();
  render(() => <LegacyContextImportReview scope={scope()} onAdopt={adopted} />);
  await fireEvent.click(screen.getByRole("button", { name: "Review older imports" }));
  expect(await screen.findByRole("textbox", { name: "Older imported memories" })).toHaveValue("Uses Linux");
  setScope(other);
  expect(await screen.findByRole("alert")).toHaveTextContent("account or destination changed");
  await fireEvent.click(screen.getByRole("button", { name: "Keep for this local Chief" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("account or destination changed");
  expect(pendingImportTexts(other)).toEqual([]);
  expect(localStorage.getItem("dani-dex.pending-context-import")).not.toBeNull();
  expect(adopted).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole("button", { name: "Review older imports" }));
  await fireEvent.click(screen.getByRole("button", { name: "Review older imports" }));
  await fireEvent.click(screen.getByRole("button", { name: "Keep for this local Chief" }));
  await waitFor(() => expect(adopted).toHaveBeenCalledOnce());
  expect(pendingImportTexts(other)).toEqual(["Uses Linux"]);
  expect(pendingImportTexts(local)).toEqual([]);
  expect(adopted).toHaveBeenCalledOnce();
});
