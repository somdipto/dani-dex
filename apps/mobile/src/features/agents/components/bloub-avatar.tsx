import type { AvatarMood } from "@dani-dex/brand/bloub-avatar-motion";
import type { AvatarHue } from "@dani-dex/contracts/ipc";
import { memo } from "react";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import { ROBOT_COLORS, robotColor, robotState } from "../model/robot-appearance";
import type { AgentPhotoProps } from "./agent-photo";
import { RobotAvatar } from "./robot-avatar";

interface BloubAvatarProps extends AgentPhotoProps {
  agentId: string;
  hue: AvatarHue | null;
  seed: string;
  size?: number;
  animateIdle?: boolean;
}

export function BloubAvatar({ agentId, serverId: hostId, hue, seed, size = 54 }: BloubAvatarProps) {
  const { agents, servers } = useMobileWorkspace();
  const serverId = hostId ?? agents.find((agent) => agent.id === agentId)?.serverId;
  const disconnected = !servers.some((server) => server.id === serverId && server.state === "online");
  const activity = useAgentActivity(agentId);
  return (
    <BloubAvatarPreview
      hue={hue}
      seed={seed}
      size={size}
      disconnected={disconnected}
      mood={disconnected ? "idle" : agentActivityMood(activity)}
    />
  );
}

export const BloubAvatarPreview = memo(function BloubAvatarPreview({
  hue,
  seed,
  size = 54,
  disconnected = false,
  mood = "idle",
}: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps & { mood?: AvatarMood }) {
  return <RobotAvatar color={robotColor(seed, hue)} state={robotState(mood)} size={size} disconnected={disconnected} />;
});

export const BloubAvatarThumbnail = memo(function BloubAvatarThumbnail({
  hue,
  seed,
  size = 48,
  disconnected = false,
}: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps) {
  return <RobotAvatar color={robotColor(seed, hue)} size={size} disconnected={disconnected} />;
});

export function getBloubAvatarColor(seed: string, hue: AvatarHue | null): string {
  return ROBOT_COLORS[robotColor(seed, hue)];
}
