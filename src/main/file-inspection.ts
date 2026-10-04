import { gunzipSync } from "node:zlib";
import { strFromU8, unzipSync } from "fflate";

const MAX_ENTRY = 2 * 1024 * 1024,
  MAX_TOTAL = 8 * 1024 * 1024;
function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]*?(?:\b(?:p|tr|br|row|si)\b)[^>]*>/gu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&#(x[\da-f]+|\d+);/giu, (_, value: string) => {
      const number = value[0]?.toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "�";
    })
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
/** Lists ZIP central metadata only. Does not extract entries or touch disk. */
export function zipInventory(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP central directory not in bounded preview.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < Math.min(count, 500); i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Invalid ZIP directory.");
    const length = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true),
      size = view.getUint32(offset + 24, true);
    if (offset + 46 + length > bytes.length) throw new Error("Incomplete ZIP directory.");
    names.push(`${strFromU8(bytes.subarray(offset + 46, offset + 46 + length))} (${size} bytes)`);
    offset += 46 + length + extra + comment;
  }
  return `Archive contents (${count} entries)\n\n${names.join("\n")}${count > 500 ? "\nShowing first 500 entries." : ""}`;
}
function officeText(name: string, bytes: Uint8Array): string {
  const pattern = /\.docx$/iu.test(name)
    ? /^word\/(?:document|header\d+|footer\d+)\.xml$/u
    : /\.pptx$/iu.test(name)
      ? /^ppt\/slides\/slide\d+\.xml$/u
      : /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/u;
  let total = 0,
    entries = 0;
  const files = unzipSync(bytes, {
    filter: (item) => {
      if (!pattern.test(item.name)) return false;
      total += item.originalSize;
      entries++;
      if (item.originalSize > MAX_ENTRY || total > MAX_TOTAL || entries > 100)
        throw new Error("Office preview exceeds safe extraction limits.");
      return true;
    },
  });
  return `Office document text preview (layout, images and macros are not executed)\n\n${Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([path, data]) => `${path}\n${xmlText(strFromU8(data))}`)
    .join("\n\n")
    .slice(0, 1000000)}`;
}
function tarInventory(bytes: Uint8Array): string {
  const names: string[] = [];
  let position = 0;
  while (position + 512 <= bytes.length && names.length < 500) {
    const head = bytes.subarray(position, position + 512);
    if (head.every((v) => v === 0)) break;
    const name = strFromU8(head.subarray(0, 100)).split("\0")[0] ?? "";
    const size = parseInt(strFromU8(head.subarray(124, 136)).replace(/\0/gu, "").trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid TAR size.");
    names.push(`${name} (${size} bytes)`);
    position += 512 + Math.ceil(size / 512) * 512;
  }
  return `TAR contents (bounded preview)\n\n${names.join("\n")}`;
}
export function binaryInspection(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, 4096); i += 16) {
    const row = bytes.subarray(i, i + 16);
    rows.push(
      `${i.toString(16).padStart(8, "0")}  ${Array.from(row, (v) => v.toString(16).padStart(2, "0"))
        .join(" ")
        .padEnd(47)}  ${Array.from(row, (v) => (v >= 32 && v <= 126 ? String.fromCharCode(v) : ".")).join("")}`,
    );
  }
  return `Binary hex preview (first ${Math.min(bytes.length, 4096)} bytes)\n\n${rows.join("\n")}`;
}
function inspectFileContent(name: string, bytes: Uint8Array): string {
  try {
    if (/\.(gz|tgz)$/iu.test(name)) {
      const expanded = new Uint8Array(gunzipSync(bytes, { maxOutputLength: MAX_TOTAL }));
      return /\.(tar\.gz|tgz)$/iu.test(name)
        ? tarInventory(expanded)
        : `GZIP content preview\n\n${inspectFile(name.replace(/\.gz$/iu, ""), expanded)}`;
    }
    if (/\.(docx|pptx|xlsx)$/iu.test(name)) return officeText(name, bytes);
    if (/\.(zip|jar|epub|odt|ods|odp)$/iu.test(name)) return zipInventory(bytes);
    if (/\.tar$/iu.test(name)) return tarInventory(bytes);
    const sample = bytes.subarray(0, 8192);
    if (sample.length && !sample.includes(0)) {
      try {
        return `Text preview\n\n${new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 1000000)}`;
      } catch {}
    }
    return binaryInspection(bytes);
  } catch (error) {
    return `Structured preview unavailable: ${error instanceof Error ? error.message : "Invalid format"}\n\n${binaryInspection(bytes)}`;
  }
}

export function inspectFile(name: string, bytes: Uint8Array): string {
  const result = inspectFileContent(name, bytes);
  return result.length > 1000000
    ? `${result.slice(0, 1000000)}\nPreview text truncated after 1,000,000 characters.`
    : result;
}
