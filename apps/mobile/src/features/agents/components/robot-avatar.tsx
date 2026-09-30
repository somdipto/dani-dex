import { Image } from "expo-image";
import { memo } from "react";
import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import type { RobotColor, RobotState } from "../model/robot-appearance";

const frames = {
  blue: {
    idle: require("../../../../assets/robot/blue-idle.png"),
    working: require("../../../../assets/robot/blue-working.png"),
    waiting: require("../../../../assets/robot/blue-waiting.png"),
    replied: require("../../../../assets/robot/blue-replied.png"),
  },
  pink: {
    idle: require("../../../../assets/robot/pink-idle.png"),
    working: require("../../../../assets/robot/pink-working.png"),
    waiting: require("../../../../assets/robot/pink-waiting.png"),
    replied: require("../../../../assets/robot/pink-replied.png"),
  },
  teal: {
    idle: require("../../../../assets/robot/teal-idle.png"),
    working: require("../../../../assets/robot/teal-working.png"),
    waiting: require("../../../../assets/robot/teal-waiting.png"),
    replied: require("../../../../assets/robot/teal-replied.png"),
  },
  violet: {
    idle: require("../../../../assets/robot/violet-idle.png"),
    working: require("../../../../assets/robot/violet-working.png"),
    waiting: require("../../../../assets/robot/violet-waiting.png"),
    replied: require("../../../../assets/robot/violet-replied.png"),
  },
};

// Baked from our Three.js rig. No user photos, shape generator, or GPU context per list row.
export const RobotAvatar = memo(function RobotAvatar({
  color = "blue",
  state = "idle",
  size = 54,
  disconnected = false,
}: {
  color?: RobotColor;
  state?: RobotState;
  size?: number;
  disconnected?: boolean;
}) {
  return (
    <Image
      source={frames[color][state]}
      contentFit="contain"
      transition={0}
      accessible={false}
      accessibilityElementsHidden
      style={{ width: size, height: size, opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1 }}
    />
  );
});
