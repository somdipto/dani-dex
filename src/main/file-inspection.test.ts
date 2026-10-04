import { gzipSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { binaryInspection, inspectFile, zipInventory } from "./file-inspection";

describe("bounded internal file inspection", () => {
  it("decodes bounded gzip and rejects oversized gzip", () => {
    expect(inspectFile("a.txt.gz", new Uint8Array(gzipSync("hello")))).toContain("hello");
    expect(inspectFile("big.gz", new Uint8Array(gzipSync(new Uint8Array(8 * 1024 * 1024 + 1))))).toContain(
      "Binary hex preview",
    );
  });
  it("reads DOCX text without executing embedded content", () => {
    const bytes = zipSync({
      "word/document.xml": strToU8("<w:p><w:t>Hello &amp; world</w:t></w:p>"),
      "word/vba.bin": new Uint8Array([0, 1]),
    });
    expect(inspectFile("a.docx", bytes)).toContain("Hello & world");
  });
  it("lists ZIP without inflating archive entries", () => {
    const bytes = zipSync({ "../file.txt": strToU8("hi"), "empty/": new Uint8Array() });
    expect(zipInventory(bytes)).toContain("../file.txt (2 bytes)");
  });
  it("rejects oversized Office inflate and preserves internal hex", () => {
    const bytes = zipSync({ "word/document.xml": new Uint8Array(2 * 1024 * 1024 + 1) });
    expect(inspectFile("a.docx", bytes)).toContain("safe extraction limits");
    expect(inspectFile("a.docx", bytes)).toContain("Binary hex preview");
  });
  it("handles corrupt archives as hex, never external-only", () => {
    expect(inspectFile("broken.zip", new Uint8Array([0, 1]))).toContain("Binary hex preview");
  });
  it("sniffs unknown UTF8 and bounds binary bytes", () => {
    expect(inspectFile("LICENSE.custom", strToU8("hello"))).toContain("hello");
    expect(binaryInspection(new Uint8Array(5000))).toContain("first 4096 bytes");
  });
});
