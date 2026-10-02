import { expect, it as test } from "vitest";
import { ROBOT_HUE_OPTIONS, robotColor, robotState } from "./robot-appearance";

test("saved hues resolve to one of the four robot presets", () => {
  for (const option of ROBOT_HUE_OPTIONS) expect(robotColor("agent", option.hue)).toBe(option.color);
  expect(robotColor("agent", null)).toBe(robotColor("agent", null));
  for (const hue of [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const)
    expect(["blue", "pink", "teal", "violet"]).toContain(robotColor("agent", hue));
});
test("activity states never select a shape or an unbuilt failed pose", () => {
  expect(robotState("working")).toBe("working");
  expect(robotState("connecting")).toBe("working");
  expect(robotState("waiting")).toBe("waiting");
  expect(robotState("responded")).toBe("replied");
  expect(robotState("failed")).toBe("idle");
  expect(robotState("asleep")).toBe("idle");
});
