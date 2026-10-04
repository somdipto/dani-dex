import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import FilePreviewPanel from "./FilePreviewPanel";

afterEach(cleanup);
describe("internal file inspection panel", () => {
  it("shows binary/Office inspection instead of an external-only dead end", () => {
    const external = vi.fn();
    render(() => (
      <FilePreviewPanel
        preview={{
          name: "unknown.bin",
          size: 8,
          mimeType: "application/octet-stream",
          previewKind: "none",
          bytes: null,
          inspection: "Binary hex preview\n00000000  00 01",
          truncated: true,
        }}
        agents={[]}
        defaultWidth={() => 400}
        maxWidth={() => 1000}
        onWidthChange={() => {}}
        onOpenLink={() => {}}
        onOpenSharedFile={() => {}}
        onOpenWorkspaceFile={() => {}}
        onOpenExternally={external}
        onClose={() => {}}
      />
    ));
    expect(screen.getByLabelText("File inspection")).toHaveTextContent("Binary hex preview");
    expect(screen.queryByText("Preview unavailable")).toBeNull();
    expect(external).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Open file externally"));
    expect(external).toHaveBeenCalledTimes(1);
  });
});
