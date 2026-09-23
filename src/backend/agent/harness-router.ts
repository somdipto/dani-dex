import {
  type AgentHarnessSetting,
  classifyAgentRole,
  type HarnessAvailability,
  routeHarness,
} from "@dani-dex/contracts/agent-harness-routing";
import type { AgentHarnessId } from "@dani-dex/contracts/agent-harnesses";
import type { AgentSummary } from "@dani-dex/contracts/ipc";
import type { HarnessRoutes, StoredHarnessRoute } from "../database/harness-routes";

export interface AgentHarnessRouterOptions {
  routes: HarnessRoutes;
  /** The harness the running service was built with. Every client today runs on this one. */
  running: AgentHarnessId | null;
  availability: HarnessAvailability;
}

/**
 * Routes each bot under the `automatic` setting: what it was created as (name, title, purpose)
 * decides its harness, the route is stored, and the bot keeps it for life. Its conversations all run
 * where the bot runs, so none of them loses its memory to a harness switch.
 *
 * Only harnesses in `availability` are ever chosen, so today every bot lands on Hermes and a
 * technical bot records that it wants OMP. The stored route is what lets OMP take technical bots
 * once it is installed, without re-deciding anything.
 */
export class AgentHarnessRouter {
  readonly #options: AgentHarnessRouterOptions;

  constructor(options: AgentHarnessRouterOptions) {
    this.#options = options;
  }

  routeAgent(agent: Pick<AgentSummary, "id" | "name" | "title" | "description">): StoredHarnessRoute {
    const existing = this.#options.routes.get(agent.id);
    if (existing) return existing;
    const classification = classifyAgentRole(agent);
    const route = routeHarness(classification.kind, this.#available());
    return this.#options.routes.recordFirst(agent.id, route, classification.signals);
  }

  /**
   * A harness counts as available only when this service can run it. The service holds one
   * harness's clients, so a second one reads as unavailable until it has its own.
   */
  #available(): HarnessAvailability {
    const { running, availability } = this.#options;
    return {
      hermes: availability.hermes && running === "hermes",
      omp: availability.omp && running === "omp",
    };
  }
}

export function isAutomaticHarness(setting: AgentHarnessSetting | null | undefined): boolean {
  return setting === "automatic";
}
