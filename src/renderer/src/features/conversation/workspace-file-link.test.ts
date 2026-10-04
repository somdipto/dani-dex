import { describe, expect, it } from "vitest";
import { workspaceFileLinkAllowed } from "./workspace-file-link";

describe("workspace file link filter", () => {
  it("does not offer outside absolute paths or sibling-prefix paths", () => {
    const root = "/tmp/Dani-Dex/Agents/chief";
    expect(workspaceFileLinkAllowed("/tmp/dani-9409-permission-off.txt", root)).toBe(false);
    expect(workspaceFileLinkAllowed(`${root}-other/file.txt`, root)).toBe(false);
    expect(workspaceFileLinkAllowed(`${root}/../other/file.txt`, root)).toBe(false);
    expect(workspaceFileLinkAllowed("/tmp/file.txt", undefined)).toBe(false);
  });
  it("keeps contained and relative files clickable without allowing traversal", () => {
    expect(workspaceFileLinkAllowed("/tmp/chief/out/file.txt", "/tmp/chief")).toBe(true);
    expect(workspaceFileLinkAllowed("out/file.txt", "/tmp/chief")).toBe(true);
    expect(workspaceFileLinkAllowed("../file.txt", "/tmp/chief")).toBe(false);
    expect(workspaceFileLinkAllowed("C:\\chief\\out\\file.txt", "C:\\chief")).toBe(true);
  });
});
