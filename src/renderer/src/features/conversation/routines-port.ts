// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type { RoutineFields, RoutineRunFields, RoutineSchedule } from "@dani-dex/contracts/ipc";

export interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
}

export interface RoutinesPort {
  ownerId: string;
  /** The word the editor reads in its placeholder: "Describe what this agent should do." */
  ownerNoun: "agent" | "channel";
  list: () => Promise<RoutineFields[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineFields>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  subscribe: (reload: () => void) => () => void;
}

export function agentRoutinesPort(agentId: string): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    list: () => window.danidex.agent.listRoutines(agentId),
    listRuns: (routineId, limit) => window.danidex.agent.listRoutineRuns({ agentId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule }) =>
      routineId
        ? window.danidex.agent.updateRoutine({ agentId, routineId, name, instruction, active, schedule })
        : window.danidex.agent.createRoutine({ agentId, name, instruction, active, timezone, schedule }),
    remove: (routineId) => window.danidex.agent.deleteRoutine({ agentId, routineId }),
    test: async (routineId) => {
      await window.danidex.agent.testRoutine({ agentId, routineId });
    },
    subscribe: (reload) =>
      window.danidex.agent.onEvent((event) => {
        if (event.type === "routines-changed" && event.agentId === agentId) reload();
      }),
  };
}

export function channelRoutinesPort(channelId: string): RoutinesPort {
  return {
    ownerId: channelId,
    ownerNoun: "channel",
    list: () => window.danidex.agent.listChannelRoutines(channelId),
    listRuns: (routineId, limit) => window.danidex.agent.listChannelRoutineRuns({ channelId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule }) =>
      routineId
        ? window.danidex.agent.updateChannelRoutine({ channelId, routineId, name, instruction, active, schedule })
        : window.danidex.agent.createChannelRoutine({ channelId, name, instruction, active, timezone, schedule }),
    remove: (routineId) => window.danidex.agent.deleteChannelRoutine({ channelId, routineId }),
    test: async (routineId) => {
      await window.danidex.agent.testChannelRoutine({ channelId, routineId });
    },
    subscribe: (reload) =>
      window.danidex.agent.onEvent((event) => {
        if (event.type === "channel-routines-changed" && event.channelId === channelId) reload();
      }),
  };
}
