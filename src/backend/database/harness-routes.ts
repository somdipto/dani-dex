import type { AgentTaskKind, HarnessRoute } from "@dani-dex/contracts/agent-harness-routing";
import type { AgentHarnessId } from "@dani-dex/contracts/agent-harnesses";
import { isDynamicRecord, isString } from "@dani-dex/contracts/runtime-values";
import type { DatabaseCore } from "./database-core";

// Migration v22 as it shipped. Frozen: v23 rebuilds the table as `HARNESS_ROUTES_SCHEMA_SQL`.
export const HARNESS_ROUTES_V22_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_harness_routes (
    agent_id TEXT PRIMARY KEY REFERENCES projection_agents(agent_id) ON DELETE CASCADE,
    task_kind TEXT NOT NULL CHECK(task_kind IN ('technical', 'general')),
    harness TEXT CHECK(harness IS NULL OR harness IN ('hermes', 'omp')),
    wanted_harness TEXT CHECK(wanted_harness IS NULL OR wanted_harness IN ('hermes', 'omp')),
    signals_json TEXT NOT NULL CHECK(json_valid(signals_json)),
    created_at TEXT NOT NULL
  );
`;

// The tail of the latest schema and the table v23 rebuilds, so IF NOT EXISTS throughout.
//
// No foreign key to projection_agents: every roster change rewrites all of its rows, and a cascade
// would drop every route each time a bot was renamed or answered. Deleting a bot deletes its route.
//
// One row per bot, written once from its name, title and purpose, the first time the bot runs under
// the automatic setting. The route sticks because each harness keeps its own session memory: moving
// a bot to another harness would make it forget its conversations.
export const HARNESS_ROUTES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_harness_routes (
    agent_id TEXT PRIMARY KEY,
    task_kind TEXT NOT NULL CHECK(task_kind IN ('technical', 'general')),
    harness TEXT CHECK(harness IS NULL OR harness IN ('hermes', 'omp')),
    wanted_harness TEXT CHECK(wanted_harness IS NULL OR wanted_harness IN ('hermes', 'omp')),
    signals_json TEXT NOT NULL CHECK(json_valid(signals_json)),
    created_at TEXT NOT NULL
  );
`;

/**
 * v23: the v22 table cascaded from projection_agents, which every roster change rewrites, so routes
 * were being dropped and decided again. Rebuilt under its own name, so the stored SQL matches a new
 * install's text exactly, keeping whatever routes survived.
 */
export function rebuildHarnessRoutesWithoutCascade(db: { exec(sql: string): void }): void {
  db.exec(`
    ALTER TABLE projection_agent_harness_routes RENAME TO projection_agent_harness_routes_v22;
    ${HARNESS_ROUTES_SCHEMA_SQL}
    INSERT INTO projection_agent_harness_routes
      (agent_id, task_kind, harness, wanted_harness, signals_json, created_at)
    SELECT agent_id, task_kind, harness, wanted_harness, signals_json, created_at
    FROM projection_agent_harness_routes_v22;
    DROP TABLE projection_agent_harness_routes_v22;
  `);
}

export interface StoredHarnessRoute extends HarnessRoute {
  readonly agentId: string;
  readonly signals: readonly string[];
  readonly createdAt: string;
}

export class HarnessRoutes {
  readonly #core: DatabaseCore;

  constructor(options: { core: DatabaseCore }) {
    this.#core = options.core;
  }

  get(agentId: string): StoredHarnessRoute | null {
    const row = this.#core.connection
      .prepare(
        `SELECT agent_id, task_kind, harness, wanted_harness, signals_json, created_at
         FROM projection_agent_harness_routes WHERE agent_id = ?`,
      )
      .get(agentId);
    return decodeRoute(row);
  }

  /** Records the route unless the bot already has one, and returns the one that stands. */
  recordFirst(agentId: string, route: HarnessRoute, signals: readonly string[]): StoredHarnessRoute {
    this.#core.connection
      .prepare(
        `INSERT OR IGNORE INTO projection_agent_harness_routes
           (agent_id, task_kind, harness, wanted_harness, signals_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(agentId, route.kind, route.harness, route.wanted, JSON.stringify(signals), new Date().toISOString());
    const stored = this.get(agentId);
    if (!stored) throw new Error("The bot's harness route was not recorded.");
    return stored;
  }
}

function harnessColumn(value: unknown): AgentHarnessId | null | undefined {
  if (value === null) return null;
  return value === "hermes" || value === "omp" ? value : undefined;
}

function decodeRoute(row: unknown): StoredHarnessRoute | null {
  if (!isDynamicRecord(row) || !isString(row.agent_id) || !isString(row.created_at)) return null;
  const kind: AgentTaskKind | null =
    row.task_kind === "technical" || row.task_kind === "general" ? row.task_kind : null;
  const harness = harnessColumn(row.harness);
  const wanted = harnessColumn(row.wanted_harness);
  if (!kind || harness === undefined || wanted === undefined || !isString(row.signals_json)) return null;
  const parsed = JSON.parse(row.signals_json);
  const signals = Array.isArray(parsed) ? parsed.filter(isString) : [];
  return { agentId: row.agent_id, kind, harness, wanted, signals, createdAt: row.created_at };
}
