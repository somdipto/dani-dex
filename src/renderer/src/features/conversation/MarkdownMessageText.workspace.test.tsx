import { fireEvent, render, screen } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { MarkdownMessageText } from "./MarkdownMessageText";

it("keeps absolute file links clickable even outside the workspace", async () => {
  const open = vi.fn();
  render(() => (
    <MarkdownMessageText
      body={
        "Created [outside](/tmp/dani-9409-permission-off.txt), `/tmp/other.txt`, and [inside](/tmp/chief/result.txt)."
      }
      workspaceRoot="/tmp/chief"
      agents={[]}
      onSelectAgent={vi.fn()}
      onOpenLink={vi.fn()}
      onOpenWorkspaceFile={open}
    />
  ));
  await fireEvent.click(screen.getByRole("button", { name: "Open workspace file dani-9409-permission-off.txt" }));
  await fireEvent.click(screen.getByRole("button", { name: "Open workspace file other.txt" }));
  await fireEvent.click(screen.getByRole("button", { name: "Open workspace file result.txt" }));
  expect(open.mock.calls.map(([path]) => path)).toEqual([
    "/tmp/dani-9409-permission-off.txt",
    "/tmp/other.txt",
    "/tmp/chief/result.txt",
  ]);
});
