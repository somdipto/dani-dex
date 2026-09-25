import { readFile } from "node:fs/promises";
import { deepAssign } from "builder-util-runtime";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parseBuilderConfig, universalMacConfig, universalMacOverrides } from "./dist-mac-universal";

describe("universal macOS configuration", () => {
  it("adds the x64 Hermes and Dani-Free trees and the shared-resource pattern without touching the arm64 config", async () => {
    const base = parseBuilderConfig(await readFile("electron-builder.yml", "utf8"));
    const before = structuredClone(base);
    const config = universalMacConfig(base);

    expect(base).toEqual(before);
    expect(config.mac.extraResources).toContainEqual({ from: "build/hermes/mac/arm64", to: "hermes/mac/arm64" });
    expect(config.mac.extraResources).toContainEqual({ from: "build/hermes/mac/x64", to: "hermes/mac/x64" });
    expect(config.mac.extraResources).toContainEqual({
      from: "build/dani-free/darwin/arm64",
      to: "dani-free/darwin/arm64",
    });
    expect(config.mac.extraResources).toContainEqual({
      from: "build/dani-free/darwin/x64",
      to: "dani-free/darwin/x64",
    });
    expect(config.mac.extraResources).toContainEqual({
      from: "build/dani-free-engine/darwin/arm64",
      to: "dani-free-engine/darwin/arm64",
    });
    expect(config.mac.extraResources).toContainEqual({
      from: "build/dani-free-engine/darwin/x64",
      to: "dani-free-engine/darwin/x64",
    });
    const rule = config.mac.x64ArchFiles ?? "";
    expect(
      rule.startsWith(
        "Contents/Resources/{cua-driver,remote-desktop-runtime,whisper,hermes,dani-free,dani-free-engine}/",
      ),
    ).toBe(true);
    const covered = (file: string) => minimatch(file, rule, { matchBase: true });
    // The file the first universal build with Hermes rejected.
    expect(
      covered("Contents/Resources/hermes/mac/arm64/python/lib/python3.11/site-packages/PIL/.dylibs/libXau.6.dylib"),
    ).toBe(true);
    expect(covered("Contents/Resources/hermes/a/.hidden.so")).toBe(true);
    expect(covered("Contents/Resources/whisper/bin/whisper-cli")).toBe(true);
    expect(covered("Contents/Resources/dani-free/darwin/x64/dani-free")).toBe(true);
    expect(covered("Contents/Resources/dani-free-engine/darwin/x64/dani-engine")).toBe(true);
    expect(covered("Contents/Frameworks/Electron Framework.framework/Electron Framework")).toBe(false);
    expect(covered("Contents/MacOS/Dani-Dex")).toBe(false);
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
    expect(destinations).toContain("dani-free/darwin/x64");
    expect(destinations).toContain("dani-free-engine/darwin/x64");
    expect(merged.mac).toMatchObject({ identity: null, notarize: false });
    expect(universalMacOverrides(parseBuilderConfig(text), true).mac).not.toHaveProperty("identity");
  });
});
