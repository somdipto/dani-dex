import type { ServerSummary } from "@dani-dex/contracts/ipc";

export function installedSkillsRequestKey(
  agentId: string | undefined,
  server: ServerSummary | undefined,
  marketplaceOpen: boolean,
): string {
  const supported = server?.kind !== "remote" || server.compatibility?.capabilities.includes("installed-skills");
  return `${server?.id ?? "local"}\0${agentId ?? ""}\0${supported ? "supported" : "unsupported"}\0${marketplaceOpen ? "hidden" : "visible"}`;
}
