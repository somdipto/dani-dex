import { test } from "node:test";
import assert from "node:assert/strict";
import { robotColor, robotState, ROBOT_HUE_OPTIONS } from "./robot-appearance.ts";
test("saved hues resolve to one of the four robot presets", () => {
  for (const option of ROBOT_HUE_OPTIONS) assert.equal(robotColor("agent", option.hue), option.color);
  assert.equal(robotColor("agent", null), robotColor("agent", null));
  for (const hue of [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const)
    assert.ok(["blue", "pink", "teal", "violet"].includes(robotColor("agent", hue)));
});
test("activity states never select a shape or an unbuilt failed pose", () => {
  assert.equal(robotState("working"), "working"); assert.equal(robotState("connecting"), "working");
  assert.equal(robotState("waiting"), "waiting"); assert.equal(robotState("responded"), "replied");
  assert.equal(robotState("failed"), "idle"); assert.equal(robotState("asleep"), "idle");
});
