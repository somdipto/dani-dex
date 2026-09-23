import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { Arch, build, Platform } from "electron-builder";
import { parse } from "yaml";
import { z } from "zod";

const logger = createDaniDexLogger("dist-mac-universal");

/**
 * Resources that carry only arm64 binaries today. A universal build packs the same file into both
 * slices, and @electron/universal refuses an identical Mach-O it was not told about, so these are
 * named here. On an Intel Mac the features behind them stay unavailable until x64 builds exist.
 */
const SINGLE_SLICE_RESOURCES = ["cua-driver", "remote-desktop-runtime", "whisper"];

/**
 * Hermes ships both architectures side by side (`hermes/mac/arm64` and `hermes/mac/x64`), and
 * `bundledHermesExecutable` picks by `process.arch`, which is the running slice. Both trees are the
 * same in the two slices, so they are listed with the single-slice resources.
 */
const BOTH_ARCH_RESOURCES = ["hermes"];

const builderConfigSchema = z
  .object({
    mac: z
      .object({
        extraResources: z.array(z.object({ from: z.string(), to: z.string() })),
        x64ArchFiles: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type UniversalMacConfig = z.infer<typeof builderConfigSchema>;

/** Reads `electron-builder.yml` into the part of its shape this script edits. */
export function parseBuilderConfig(text: string): UniversalMacConfig {
  return builderConfigSchema.parse(parse(text));
}

/**
 * The universal configuration is derived from `electron-builder.yml` rather than kept beside it, so
 * the arm64 release and the universal build cannot drift apart. It adds the x64 Hermes tree and the
 * pattern for resources that are the same in both slices, and changes nothing else.
 */
export function universalMacConfig(base: UniversalMacConfig): UniversalMacConfig {
  const extraResources = [...base.mac.extraResources];
  if (!extraResources.some((resource) => resource.to === "hermes/mac/x64")) {
    extraResources.push({ from: "build/hermes/mac/x64", to: "hermes/mac/x64" });
  }
  const shared = [...SINGLE_SLICE_RESOURCES, ...BOTH_ARCH_RESOURCES].join(",");
  return {
    ...base,
    mac: { ...base.mac, extraResources, x64ArchFiles: `Contents/Resources/{${shared}}/**` },
  };
}

if (import.meta.main) {
  const sign = process.argv.includes("--sign");
  const base = parseBuilderConfig(await readFile(resolve("electron-builder.yml"), "utf8"));
  const config = universalMacConfig(base);
  if (!sign) {
    config.mac = { ...config.mac, identity: null, notarize: false };
  }
  logger.info(`Building a universal macOS app (${sign ? "signed" : "unsigned"}).`);
  await build({
    targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.universal),
    config,
    publish: "never",
  });
}
