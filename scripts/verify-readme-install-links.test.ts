import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { README_INSTALL_ASSETS, verifyReadmeInstallLinks } from "./verify-readme-install-links";

const root = "https://github.com/somdipto/dani-dex/releases/latest/download/";

describe("README installer links", () => {
  it("uses the exact fixed asset names supplied by the release workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(() => verifyReadmeInstallLinks(readme, README_INSTALL_ASSETS)).not.toThrow();
  });
  it("fails if a button points at an old installer or the release asset is absent", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(() =>
      verifyReadmeInstallLinks(
        readme.replace(`${root}${README_INSTALL_ASSETS[0]}`, `${root}old.dmg`),
        README_INSTALL_ASSETS,
      ),
    ).toThrow("README must link");
    expect(() => verifyReadmeInstallLinks(readme, README_INSTALL_ASSETS.slice(1))).toThrow("Latest release is missing");
  });
});
