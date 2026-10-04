import { expect, it } from "vitest";
import { createRobotModel, disposeRobotModel, inferRobotRole } from "./robot-model";

it.each([
  ["Chief of staff", "chief", "crown"],
  ["Research", "research", "research-lens"],
  ["Builder", "builder", "builder-helmet"],
  ["Launch", "launch", "launch-rocket"],
] as const)("maps %s to distinct procedural 3D geometry", (name, role, accessory) => {
  expect(inferRobotRole(name)).toBe(role);
  const model = createRobotModel(role);
  try {
    expect(model.getObjectByName(accessory)).toBeDefined();
  } finally {
    disposeRobotModel(model);
  }
});
