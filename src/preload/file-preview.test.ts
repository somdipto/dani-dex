import { expect, it } from "vitest";
import { decodeFilePreview } from "./file-preview";

it("preserves OS-open directory acknowledgement instead of creating a preview placeholder", () => {
  expect(
    decodeFilePreview({
      name: "Shared",
      size: 0,
      mimeType: "inode/directory",
      previewKind: "none",
      bytes: null,
      openedExternally: true,
    }),
  ).toMatchObject({ openedExternally: true });
  expect(
    decodeFilePreview({
      name: "old.txt",
      size: 3,
      mimeType: "text/plain",
      previewKind: "text",
      bytes: new Uint8Array(3),
    }),
  ).not.toHaveProperty("openedExternally");
});

it("keeps validated directory children across the preload boundary", () => {
  expect(
    decodeFilePreview({
      name: "Shared",
      size: 0,
      mimeType: "inode/directory",
      previewKind: "none",
      bytes: null,
      directory: {
        path: "/tmp/Shared",
        entries: [{ name: "note.txt", path: "/tmp/Shared/note.txt", isDirectory: false }],
        truncated: false,
      },
    }).directory?.entries[0]?.name,
  ).toBe("note.txt");
});
