import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Ref callbacks execute in Solid's owned render scope, before settled setup. */
describe("conversation DOM ref lifecycle", () => {
  const source = readFileSync(new URL("./conversation-scope.ts", import.meta.url), "utf8");
  for (const name of ["setScrollElement", "setVirtualRootElement"]) {
    it(`${name} captures its element without a reactive measurement write`, () => {
      const body = source.match(
        new RegExp(`const ${name} = \\(element: HTMLDivElement\\) => \\{([\\s\\S]*?)\\n  \\};`),
      )?.[1];
      expect(body).toBeDefined();
      expect(body).not.toContain("updateVirtualScrollMargin()");
    });
  }
  it("keeps layout measurement in post-mount observers and animation frames", () => {
    expect(source).toContain("scrollResizeObserver = new ResizeObserver(() => {\n      updateVirtualScrollMargin();");
    expect(source).toContain(
      "requestAnimationFrame(() => {\n      if (!scrollElement) return;\n      updateVirtualScrollMargin();",
    );
  });
});
