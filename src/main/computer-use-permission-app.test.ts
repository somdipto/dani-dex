import { describe, expect, it } from "vitest";
import { applicationBundleName, applicationBundlePath, applicationIconName } from "./computer-use-permission-app";

describe("applicationBundlePath", () => {
  it("finds the bundle a packaged executable sits inside", () => {
    expect(applicationBundlePath("/Applications/Dani-Dex.app/Contents/MacOS/Dani-Dex", "darwin")).toBe(
      "/Applications/Dani-Dex.app",
    );
  });

  // A development build runs Electron, and Electron is the application the grant is attached to.
  it("finds the bundle of a development build", () => {
    expect(
      applicationBundlePath("/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", "darwin"),
    ).toBe("/repo/node_modules/electron/dist/Electron.app");
  });

  it("finds nothing for an executable in a plain directory", () => {
    expect(applicationBundlePath("/usr/local/bin/danidex", "darwin")).toBeNull();
  });

  // Only macOS asks for a bundle in a permission list, so there is nothing to drag anywhere else.
  it("finds nothing away from macOS", () => {
    expect(applicationBundlePath("/Applications/Dani-Dex.app/Contents/MacOS/Dani-Dex", "linux")).toBeNull();
  });
});

describe("applicationBundleName", () => {
  it("names the bundle as the list will show it", () => {
    expect(applicationBundleName("/Applications/Dani-Dex.app")).toBe("Dani-Dex");
  });
});

describe("applicationIconName", () => {
  it("prefers the icon named after the bundle", () => {
    expect(applicationIconName("/Applications/Dani-Dex.app", ["document.icns", "dani-dex.icns", "en.lproj"])).toBe(
      "dani-dex.icns",
    );
  });

  it("takes any icon the bundle carries", () => {
    expect(applicationIconName("/Applications/Dani-Dex.app", ["app-picture.icns"])).toBe("app-picture.icns");
  });

  // A drag with no image is refused, so the caller has to know there is nothing to draw.
  it("finds nothing in a bundle with no icon", () => {
    expect(applicationIconName("/Applications/Dani-Dex.app", ["Info.plist"])).toBeNull();
  });
});
