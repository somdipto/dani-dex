import { readFile } from "node:fs/promises";
import { deepAssign } from "builder-util-runtime";
import { describe, expect, it } from "vitest";
import { parseBuilderConfig, universalMacConfig, universalMacOverrides } from "./dist-mac-universal";

describe("universal macOS configuration", () => {
  it("adds the x64 Hermes tree and the shared-resource pattern without touching the arm64 config", async () => {
    const base = parseBuilderConfig(await readFile("electron-builder.yml", "utf8"));
    const before = structuredClone(base);
    const config = universalMacConfig(base);

    expect(base).toEqual(before);
    expect(config.mac.extraResources).toContainEqual({ from: "build/hermes/mac/arm64", to: "hermes/mac/arm64" });
    expect(config.mac.extraResources).toContainEqual({ from: "build/hermes/mac/x64", to: "hermes/mac/x64" });
    expect(config.mac.x64ArchFiles).toBe("Contents/Resources/{cua-driver,remote-desktop-runtime,whisper,hermes}/**");
    // Every other mac key is carried over as is, so signing and notarization settings match the release.
    expect({ ...config.mac, extraResources: undefined, x64ArchFiles: undefined }).toEqual({
      ...base.mac,
      extraResources: undefined,
      x64ArchFiles: undefined,
    });
    expect(universalMacConfig(config).mac.extraResources).toHaveLength(config.mac.extraResources.length);
  });

  it("gives electron-builder only the additions, so its array merge copies each tree once", async () => {
    const text = await readFile("electron-builder.yml", "utf8");
    const merged = deepAssign(parseBuilderConfig(text), universalMacOverrides(parseBuilderConfig(text), false));
    const destinations = merged.mac.extraResources.map((resource: { to: string }) => resource.to);
    expect(new Set(destinations).size).toBe(destinations.length);
    expect(destinations).toContain("hermes/mac/arm64");
    expect(destinations).toContain("hermes/mac/x64");
    expect(merged.mac).toMatchObject({ identity: null, notarize: false });
    expect(universalMacOverrides(parseBuilderConfig(text), true).mac).not.toHaveProperty("identity");
  });
});
