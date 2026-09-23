import { createEffect, createRoot } from "solid-js";
import type { AgentMessage } from "../../data";

export interface AgentReplySource {
  messages: () => readonly AgentMessage[];
  activeTurnId: () => string | null | undefined;
}

/**
 * The spoken answer is the agent's last finished text message of the turn the voice call started.
 * `knownIds` is every message id present before the utterance was submitted, so an older reply is
 * never read out. Nothing is returned while the turn is still running or a message still streams.
 */
export function findFinalAgentReply(
  messages: readonly AgentMessage[],
  knownIds: ReadonlySet<string>,
  activeTurnId: string | null | undefined,
): string | null {
  if (activeTurnId) return null;
  let reply: string | null = null;
  for (const message of messages) {
    if (knownIds.has(message.id) || message.author !== "agent") continue;
    if (message.streaming) return null;
    if (message.kind && message.kind !== "text" && message.kind !== "error") continue;
    const body = message.body.trim();
    if (body) reply = body;
  }
  return reply;
}

/** Resolves with the final reply once the agent's turn settles; rejects when the call aborts. */
export function waitForAgentReply(
  source: AgentReplySource,
  knownIds: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Interrupted", "AbortError"));
      return;
    }
    createRoot((dispose) => {
      let turnStarted = false;
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        dispose();
        settle();
      };
      const onAbort = () => finish(() => reject(new DOMException("Interrupted", "AbortError")));
      signal.addEventListener("abort", onAbort, { once: true });
      createEffect(
        () => ({ activeTurnId: source.activeTurnId(), messages: source.messages() }),
        ({ activeTurnId, messages }) => {
          if (activeTurnId) turnStarted = true;
          const hasNewAgentMessage = messages.some(
            (message) => !knownIds.has(message.id) && message.author === "agent",
          );
          if (!turnStarted && !hasNewAgentMessage) return;
          const reply = findFinalAgentReply(messages, knownIds, activeTurnId);
          // Settle outside the effect run so the root is not disposed from inside its own effect.
          if (reply !== null) queueMicrotask(() => finish(() => resolve(reply)));
        },
      );
    });
  });
}
