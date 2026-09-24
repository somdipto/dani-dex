// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDaniFreePreference, writeDaniFreePreference } from "./dani-free-preference-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function preferencePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dani-dex-dani-free-preference-"));
  roots.push(root);
  return join(root, "dani-free-preference.json");
}

describe("Dani-Free preference store", () => {
  it("starts with free models on and the notice not yet shown", async () => {
    await expect(readDaniFreePreference(await preferencePath())).resolves.toEqual({
      privateMode: false,
      freeModelsNoticeAcknowledged: false,
    });
  });

  it("keeps each setting when the other changes", async () => {
    const path = await preferencePath();
    await writeDaniFreePreference(path, { freeModelsNoticeAcknowledged: true });
    await expect(writeDaniFreePreference(path, { privateMode: true })).resolves.toEqual({
      privateMode: true,
      freeModelsNoticeAcknowledged: true,
    });
    await expect(readDaniFreePreference(path)).resolves.toEqual({
      privateMode: true,
      freeModelsNoticeAcknowledged: true,
    });
  });

  it("shows the notice again when the file is damaged", async () => {
    const path = await preferencePath();
    await writeFile(path, "{not json");
    await expect(readDaniFreePreference(path)).resolves.toEqual({
      privateMode: false,
      freeModelsNoticeAcknowledged: false,
    });
    await writeFile(path, '{"version":1,"privateMode":"yes","freeModelsNoticeAcknowledged":"yes"}');
    await expect(readDaniFreePreference(path)).resolves.toEqual({
      privateMode: false,
      freeModelsNoticeAcknowledged: false,
    });
  });
});
