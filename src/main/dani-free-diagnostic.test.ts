import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendDaniFreeDiagnostic, readDaniFreeDiagnosticSummary } from "./dani-free-diagnostic";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Dani Free diagnostics", () => {
  it("keeps a private local startup error and exports only typed stages, never its detail", async () => {
    const root = await mkdtemp(join(tmpdir(), "dani-free-diagnostic-"));
    roots.push(root);
    await appendDaniFreeDiagnostic(root, {
      stage: "ready",
      outcome: "failed",
      detail: "apiKey=superSecret12345; failed to spawn",
    });
    const raw = await readFile(join(root, "startup.log"), "utf8");
    expect(raw).toContain("failed to spawn");
    expect(raw).not.toContain("superSecret12345");
    const summary = await readDaniFreeDiagnosticSummary(root);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]).toMatchObject({ stage: "ready", outcome: "failed" });
    expect(JSON.stringify(summary)).not.toContain("failed to spawn");
    if (process.platform !== "win32") {
      const { stat } = await import("node:fs/promises");
      expect((await stat(join(root, "startup.log"))).mode & 0o777).toBe(0o600);
    }
  });
});
