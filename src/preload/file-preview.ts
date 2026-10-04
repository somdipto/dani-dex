import type { FilePreview } from "@dani-dex/contracts/ipc";
import { isFilePreviewKind } from "@dani-dex/contracts/ipc";
import { decodeRecord } from "@dani-dex/contracts/ipc-decoding";
import { isNumber, isString } from "@dani-dex/contracts/runtime-values";

export function decodeFilePreview(value: unknown): FilePreview {
  const preview = decodeRecord(value, "file preview");
  if (
    !isString(preview.name) ||
    !isNumber(preview.size) ||
    !isString(preview.mimeType) ||
    !isFilePreviewKind(preview.previewKind) ||
    (preview.bytes !== null && !(preview.bytes instanceof Uint8Array))
  ) {
    throw new Error("Invalid file preview response.");
  }
  if (
    preview.inspection !== undefined &&
    (typeof preview.inspection !== "string" || preview.inspection.length > 1100000)
  )
    throw new Error("Invalid inspection text.");
  if (preview.truncated !== undefined && typeof preview.truncated !== "boolean")
    throw new Error("Invalid preview truncation.");
  let directory: FilePreview["directory"];
  if (preview.directory !== undefined) {
    const value = decodeRecord(preview.directory, "directory preview");
    if (
      typeof value.path !== "string" ||
      !Array.isArray(value.entries) ||
      value.entries.length > 500 ||
      typeof value.truncated !== "boolean"
    )
      throw new Error("Invalid directory preview.");
    directory = {
      path: value.path,
      truncated: value.truncated,
      entries: value.entries.map((item) => {
        const entry = decodeRecord(item, "directory entry");
        if (typeof entry.name !== "string" || typeof entry.path !== "string" || typeof entry.isDirectory !== "boolean")
          throw new Error("Invalid directory entry.");
        return { name: entry.name, path: entry.path, isDirectory: entry.isDirectory };
      }),
    };
  }
  return {
    ...(typeof preview.inspection === "string" ? { inspection: preview.inspection } : {}),
    ...(preview.truncated === true ? { truncated: true } : {}),
    ...(directory ? { directory } : {}),
    ...(preview.openedExternally === true ? { openedExternally: true } : {}),
    name: preview.name,
    size: preview.size,
    mimeType: preview.mimeType,
    previewKind: preview.previewKind,
    bytes: preview.bytes,
  };
}
