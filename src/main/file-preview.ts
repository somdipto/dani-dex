import { open, readFile } from "node:fs/promises";
import { attachmentMimeTypeForName } from "@dani-dex/contracts/attachment-files";
import { ATTACHMENT_LIMITS } from "@dani-dex/contracts/input-limits";
import { type FilePreview, filePreviewKindForFile } from "@dani-dex/contracts/ipc";

import { inspectFile } from "./file-inspection";

export function mimeTypeForName(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  const additional: Record<string, string> = {
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp4: "video/mp4",
    webm: "video/webm",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    csv: "text/csv",
    jsonl: "text/plain",
    yaml: "text/plain",
    yml: "text/plain",
    toml: "text/plain",
    html: "text/plain",
    xml: "text/plain",
  };
  return additional[extension ?? ""] ?? attachmentMimeTypeForName(name);
}

export function filePreviewFromBytes(name: string, bytes: Uint8Array): FilePreview {
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error("The file exceeds the 100 MB limit.");
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  return {
    name,
    size: bytes.byteLength,
    mimeType,
    previewKind: kind,
    bytes: kind === "none" ? null : bytes,
    ...(kind === "none" ? { inspection: inspectFile(name, bytes) } : {}),
  };
}

export async function localFilePreview(path: string, name: string, size: number): Promise<FilePreview> {
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  if (size > ATTACHMENT_LIMITS.fileBytes || kind === "none") {
    const file = await open(path, "r");
    try {
      const bytes = new Uint8Array(Math.min(size, 8 * 1024 * 1024));
      const read = await file.read(bytes, 0, bytes.length, 0);
      return {
        name,
        size,
        mimeType,
        previewKind: "none",
        bytes: null,
        inspection: inspectFile(name, bytes.subarray(0, read.bytesRead)),
        truncated: size > read.bytesRead,
      };
    } finally {
      await file.close();
    }
  }
  return { name, size, mimeType, previewKind: kind, bytes: new Uint8Array(await readFile(path)) };
}
