import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** README is the install entry point: release assets and its three buttons must agree. */
export const README_INSTALL_ASSETS = [
  "Dani-Dex-mac-universal.dmg",
  "Dani-Dex-windows-x64.exe",
  "Dani-Dex-linux-x86_64.AppImage",
] as const;
const ROOT = "https://github.com/somdipto/dani-dex/releases/latest/download/";
const BUTTON_LABELS = ["Download for macOS", "Download for Windows", "Download for Linux"] as const;

export function verifyReadmeInstallLinks(readme: string, releaseAssetNames: readonly string[]): void {
  for (const [index, name] of README_INSTALL_ASSETS.entries()) {
    const link = `${ROOT}${name}`;
    if (readme.split(link).length !== 2 || !readme.includes(`<a href="${link}"><img alt="${BUTTON_LABELS[index]}"`)) {
      throw new Error(`README must link exactly once to ${name} from its installer button.`);
    }
    if (releaseAssetNames.filter((asset) => asset === name).length !== 1) {
      throw new Error(`Latest release is missing the README installer ${name}.`);
    }
  }
}

if (import.meta.main) {
  const [manifest] = process.argv.slice(2);
  if (!manifest) throw new Error("Usage: bun scripts/verify-readme-install-links.ts <release-asset-list.json>");
  const names = JSON.parse(await readFile(resolve(manifest), "utf8"));
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
    throw new Error("Release asset list is not an array of names.");
  }
  verifyReadmeInstallLinks(await readFile(resolve("README.md"), "utf8"), names);
}
