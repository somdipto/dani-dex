/** Keep the full worker roster, but expose exactly one owner-facing conversation. */
export function chiefConversationAgent<T extends { id: string; name: string; avatarSeed?: string }>(
  agents: readonly T[],
): T | undefined {
  const canonical = agents.find((agent) => agent.id === "chief-of-staff");
  if (canonical) return canonical;
  const candidates = agents.filter(
    (agent) =>
      agent.id === "chief" ||
      agent.avatarSeed === "manzanilla:chief" ||
      /^(chief|chief of staff)$/i.test(agent.name.trim()),
  );
  // Ambiguous identities must not silently route the owner to the wrong worker.
  return candidates.length === 1 ? candidates[0] : undefined;
}
