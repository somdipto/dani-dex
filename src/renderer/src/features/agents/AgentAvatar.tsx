import type { AvatarMood } from "@dani-dex/brand/bloub-avatar-motion";
import type { AvatarHue } from "@dani-dex/contracts/ipc";
import type { AvatarMotion, SupportedAvatarSilhouetteId } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { RobotAvatar } from "./manzanilla/RobotAvatar";
import { inferRobotRole, ROBOT_ROLES, type RobotRole } from "./manzanilla/robot-model";

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> & Partial<Pick<AgentProfile, "name">>;
  seed?: string;
  hue?: AvatarHue | null;
  url?: string | null;
  motion?: AvatarMotion;
  mood?: AvatarMood;
  cycleOffset?: number;
  animationOffset?: number;
  shape?: SupportedAvatarSilhouetteId;
  class?: string;
  characterSize?: number;
  style?: Record<string, string>;
}
export function AgentAvatar(props: AgentAvatarProps) {
  const role = (): RobotRole => {
    const seed = props.seed ?? props.agent?.avatarSeed ?? "";
    const saved = seed.startsWith("manzanilla:") ? seed.slice("manzanilla:".length) : "";
    return ROBOT_ROLES.find((item) => item.id === saved)?.id ?? inferRobotRole(props.agent?.name ?? seed);
  };
  return (
    <span
      class={`agent-avatar agent-avatar-manzanilla agent-avatar-motion-${props.motion ?? "hover"} ${props.class ?? ""}`}
      style={props.style}
      data-avatar="manzanilla"
      data-mood={props.mood ?? "idle"}
    >
      <RobotAvatar
        size={props.characterSize ?? 72}
        label={props.agent?.name ?? role()}
        role={role()}
        motion={props.mood === "working" ? "working" : props.mood === "waiting" ? "waiting" : "idle"}
      />
    </span>
  );
}
