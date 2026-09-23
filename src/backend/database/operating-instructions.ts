import { isDynamicRecord, isNumber, isString } from "@dani-dex/contracts/runtime-values";
import type { DatabaseCore } from "./database-core";

// Shared by migration v23 and the tail of the latest schema, so IF NOT EXISTS throughout.
//
// One row per bot. `user_turns` counts the user's own completed turns with it; `revised_at_turn` is
// that count at the last rewrite or user edit, so the gap between them is what the next rewrite waits on.
// No foreign key to projection_agents, for the reason `HARNESS_ROUTES_SCHEMA_SQL` gives; deleting a
// bot deletes its row.
export const OPERATING_INSTRUCTIONS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_operating_instructions (
    agent_id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('none', 'generated', 'edited')),
    revision INTEGER NOT NULL,
    auto_evolve INTEGER NOT NULL CHECK(auto_evolve IN (0, 1)),
    user_turns INTEGER NOT NULL,
    revised_at_turn INTEGER NOT NULL,
    updated_at TEXT
  );
`;

export interface StoredOperatingInstructions {
  readonly agentId: string;
  readonly text: string;
  readonly source: "none" | "generated" | "edited";
  readonly revision: number;
  readonly autoEvolve: boolean;
  readonly userTurns: number;
  readonly revisedAtTurn: number;
  readonly updatedAt: string | null;
}

export class OperatingInstructionsTable {
  readonly #core: DatabaseCore;

  constructor(options: { core: DatabaseCore }) {
    this.#core = options.core;
  }

  get(agentId: string): StoredOperatingInstructions {
    const row = this.#core.connection
      .prepare(
        `SELECT agent_id, text, source, revision, auto_evolve, user_turns, revised_at_turn, updated_at
         FROM projection_agent_operating_instructions WHERE agent_id = ?`,
      )
      .get(agentId);
    return decodeRow(row) ?? empty(agentId);
  }

  /** Counts one of the user's completed turns and returns the row as it now stands. */
  countUserTurn(agentId: string): StoredOperatingInstructions {
    this.#ensure(agentId);
    this.#core.connection
      .prepare("UPDATE projection_agent_operating_instructions SET user_turns = user_turns + 1 WHERE agent_id = ?")
      .run(agentId);
    return this.get(agentId);
  }

  /**
   * Writes a new revision, but only over the one it was derived from: a rewrite that finishes after
   * the user edited them is dropped rather than undoing the edit. Returns null when it was dropped.
   */
  write(
    agentId: string,
    change: { text: string; source: "generated" | "edited"; expectedRevision: number },
  ): StoredOperatingInstructions | null {
    this.#ensure(agentId);
    const result = this.#core.connection
      .prepare(
        `UPDATE projection_agent_operating_instructions
         SET text = ?, source = ?, revision = revision + 1, revised_at_turn = user_turns, updated_at = ?
         WHERE agent_id = ? AND revision = ?`,
      )
      .run(change.text, change.source, new Date().toISOString(), agentId, change.expectedRevision);
    return Number(result.changes) === 1 ? this.get(agentId) : null;
  }

  setAutoEvolve(agentId: string, autoEvolve: boolean): StoredOperatingInstructions {
    this.#ensure(agentId);
    this.#core.connection
      .prepare("UPDATE projection_agent_operating_instructions SET auto_evolve = ? WHERE agent_id = ?")
      .run(autoEvolve ? 1 : 0, agentId);
    return this.get(agentId);
  }

  /** The user's own latest messages in one thread, oldest first: never the bot's replies or tool items. */
  recentUserMessages(threadId: string, limit: number): string[] {
    const rows = this.#core.connection
      .prepare(
        `SELECT message_json FROM projection_thread_messages
         WHERE thread_id = ? AND author = 'user'
         ORDER BY created_at DESC, ordinal DESC LIMIT ?`,
      )
      .all(threadId, limit);
    const texts: string[] = [];
    for (const row of rows) {
      if (!isDynamicRecord(row) || !isString(row.message_json)) continue;
      const message = JSON.parse(row.message_json);
      if (isDynamicRecord(message) && isString(message.text) && message.text.trim()) texts.push(message.text.trim());
    }
    return texts.reverse();
  }

  #ensure(agentId: string): void {
    this.#core.connection
      .prepare(
        `INSERT OR IGNORE INTO projection_agent_operating_instructions
           (agent_id, text, source, revision, auto_evolve, user_turns, revised_at_turn, updated_at)
         VALUES (?, '', 'none', 0, 1, 0, 0, NULL)`,
      )
      .run(agentId);
  }
}

function empty(agentId: string): StoredOperatingInstructions {
  return {
    agentId,
    text: "",
    source: "none",
    revision: 0,
    autoEvolve: true,
    userTurns: 0,
    revisedAtTurn: 0,
    updatedAt: null,
  };
}

function decodeRow(row: unknown): StoredOperatingInstructions | null {
  if (!isDynamicRecord(row) || !isString(row.agent_id) || !isString(row.text)) return null;
  const source = row.source === "none" || row.source === "generated" || row.source === "edited" ? row.source : null;
  if (!source || !isNumber(row.revision) || !isNumber(row.user_turns) || !isNumber(row.revised_at_turn)) return null;
  return {
    agentId: row.agent_id,
    text: row.text,
    source,
    revision: row.revision,
    autoEvolve: row.auto_evolve === 1,
    userTurns: row.user_turns,
    revisedAtTurn: row.revised_at_turn,
    updatedAt: isString(row.updated_at) ? row.updated_at : null,
  };
}
