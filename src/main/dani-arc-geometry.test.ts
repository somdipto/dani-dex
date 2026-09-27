import { describe, expect, it } from "vitest";
import { arcHitTest } from "./dani-arc-geometry";

const bounds = { x: 100, y: 50, width: 800, height: 650 };
describe("Mac Arc cursor routing", () => {
  it("keeps the surrounding desktop and center hole click-through", () => {
    expect(arcHitTest(bounds, 200, 400, 3)).toBe(false);
    expect(arcHitTest(bounds, 890, 60, 3)).toBe(false);
  });
  it("tracks expanding ring depths", () => {
    expect(arcHitTest(bounds, 700, 50, 1)).toBe(true);
    expect(arcHitTest(bounds, 600, 50, 1)).toBe(false);
    expect(arcHitTest(bounds, 600, 50, 2)).toBe(true);
    expect(arcHitTest(bounds, 500, 50, 2)).toBe(false);
    expect(arcHitTest(bounds, 500, 50, 3)).toBe(true);
  });
});
