import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@dani-dex/contracts/ipc";
import { expect, it } from "vitest";
import { freeResearchConfig, prepareFreeResearch } from "./free-research-bootstrap";

it("exposes only anonymous search and page reading, never paid agent tools or credentials", () => {
  const config = freeResearchConfig();
  expect(new URL(config.url).searchParams.get("tools")).toBe("web_search_exa,web_fetch_exa");
  expect(config.headers).toEqual([]);
  expect(config.env).toEqual([]);
  expect(config.envPassthrough).toEqual([]);
});

it("seeds once and respects deletion across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "dani-research-"));
  let rows: McpServerConfig[] = [];
  const store = {
    list: () => rows,
    save: (config: McpServerConfig) => {
      rows.push(config);
      return config;
    },
  };
  try {
    await prepareFreeResearch(store, root);
    expect(rows).toHaveLength(1);
    await prepareFreeResearch(store, root);
    expect(rows).toHaveLength(1);
    rows = [];
    await prepareFreeResearch(store, root);
    expect(rows).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves a user-edited disabled config", async () => {
  const root = await mkdtemp(join(tmpdir(), "dani-research-"));
  const rows = [{ ...freeResearchConfig(), enabled: false, url: "https://example.com/mcp" }];
  try {
    await prepareFreeResearch(
      {
        list: () => rows,
        save: () => {
          throw new Error("must not overwrite");
        },
      },
      root,
    );
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].url).toBe("https://example.com/mcp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
