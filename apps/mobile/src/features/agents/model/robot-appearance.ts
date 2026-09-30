import type { AvatarHue } from "@dani-dex/contracts/ipc";

export const ROBOT_COLORS = {
  blue: "#3299F4",
  pink: "#E65CAA",
  teal: "#17B4BD",
  violet: "#9561ED",
} as const;
export type RobotColor = keyof typeof ROBOT_COLORS;
export type RobotState = "idle" | "working" | "waiting" | "replied";
export const ROBOT_HUE_OPTIONS = [
  { hue: 215, label: "Blue", color: "blue" },
  { hue: 320, label: "Pink", color: "pink" },
  { hue: 185, label: "Teal", color: "teal" },
  { hue: 280, label: "Violet", color: "violet" },
] as const;

export function robotColor(seed: string, hue: AvatarHue | null): RobotColor {
  if (hue !== null) {
    if (hue >= 300 || hue < 55) return "pink";
    if (hue < 200) return "teal";
    if (hue < 245) return "blue";
    return "violet";
  }
  let hash = 0;
  for (const char of seed) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return (["blue", "pink", "teal", "violet"] as const)[hash % 4];
}

export function robotState(mood: string): RobotState {
  if (mood === "working" || mood === "connecting") return "working";
  if (mood === "waiting") return "waiting";
  if (mood === "responded") return "replied";
  return "idle";
}
