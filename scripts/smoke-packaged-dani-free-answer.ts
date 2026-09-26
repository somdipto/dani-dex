import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { bundledDaniFreeExecutable, DaniFreeSupervisor } from "../src/main/dani-free";
import { bundledDaniFreeEngineSeed, verifiedDaniFreeEngineSeed } from "../src/main/dani-free-seed";
import { verifyPackagedDaniFree } from "./verify-packaged-dani-free";

const logger = createDaniDexLogger("smoke-packaged-dani-free-answer");

/** A real final response through the signed-off *packaged bytes*; no fake model or mock server. */
export async function smokePackagedDaniFreeAnswer(resources: string): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Run this installed-DMG smoke on a native Apple Silicon macOS runner.");
  }
  await verifyPackagedDaniFree(resources, "darwin", "arm64");
  const executable = bundledDaniFreeExecutable(resources, "darwin", "arm64");
  const seed = bundledDaniFreeEngineSeed(resources, "darwin", "arm64");
  if (!executable || !seed) throw new Error("Installed app has no Dani Free proxy or engine seed.");
  const engineSeed = await verifiedDaniFreeEngineSeed(seed);
  const home = await mkdtemp(join(tmpdir(), "dani-dex-installed-answer-"));
  const supervisor = new DaniFreeSupervisor({ executable, engineSeed, home });
  try {
    const source = await supervisor.start();
    if (source?.models.length !== 1 || source.models[0]?.id !== "dani-free-auto") {
      throw new Error("Installed app did not connect its bundled Dani Free proxy.");
    }
    const key = source.apiKey;
    if (!key) throw new Error("Installed proxy did not provide an authentication key.");
    const url = `${source.baseUrl}/chat/completions`;
    const ask = async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          model: "dani-free-auto",
          messages: [{ role: "user", content: "Reply with exactly: READY" }],
          stream: false,
        }),
        signal: AbortSignal.timeout(150_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(`Installed Dani Free returned HTTP ${response.status}; no verified model answer.`);
      if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) {
        throw new Error("Installed Dani Free returned no choices.");
      }
      const message = payload.choices[0]?.message;
      const content = message?.content;
      if (typeof content !== "string" || !content.trim())
        throw new Error("Installed Dani Free returned an empty answer.");
      return content.trim();
    };
    let answer: string;
    try {
      answer = await ask();
    } catch (firstError) {
      // The packaged proxy refreshes its free catalog at startup. Give that one warm-up a chance.
      await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
      try {
        answer = await ask();
      } catch (secondError) {
        throw new Error(
          `Real answer failed after one warm-up retry: ${String(secondError)}; first attempt: ${String(firstError)}`,
        );
      }
    }
    logger.info(`Installed Dani Free final answer: ${JSON.stringify(answer)}`);
    logger.info(
      "Verified installed DMG resources -> pinned proxy -> pinned seed -> live free model -> nonempty final answer. GUI turn not exercised.",
    );
  } finally {
    await supervisor.stop();
    await rm(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [resources] = process.argv.slice(2);
  if (!resources) throw new Error("Usage: bun scripts/smoke-packaged-dani-free-answer.ts <installed-app-resources>");
  await smokePackagedDaniFreeAnswer(resolve(resources));
}
