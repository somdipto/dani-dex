import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "@dani-dex/contracts/ipc";
import type { McpServerStore } from "./mcp-server-store";

export const FREE_RESEARCH_NAME = "dani-free-research";
export const FREE_RESEARCH_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

export function freeResearchConfig(): McpServerConfig {
  return {
    id: "",
    name: FREE_RESEARCH_NAME,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: FREE_RESEARCH_URL,
    headers: [],
  };
}

/** Seed once, without contacting the remote service. Deletion and disabling persist. */
export async function prepareFreeResearch(
  store: Pick<McpServerStore, "list" | "save">,
  userDataPath: string,
): Promise<void> {
  const receipt = join(userDataPath, "free-research-installed-v1");
  try {
    await access(receipt);
    return;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Never overwrite a named configuration, including a disabled or user-edited one.
  if (!store.list().some((server) => server.name === FREE_RESEARCH_NAME)) {
    store.save(freeResearchConfig());
  }
  await mkdir(userDataPath, { recursive: true });
  await writeFile(receipt, "Installed once. Removing the MCP entry opts out.\n", { flag: "wx", mode: 0o600 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
}
