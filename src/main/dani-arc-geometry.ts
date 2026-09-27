/** Native pointer routing for the supplied right-corner dial. */
export type ArcBounds = { x: number; y: number; width: number; height: number };
export function arcHitTest(bounds: ArcBounds, x: number, y: number, depth: number): boolean {
  const radius = Math.hypot(x - (bounds.x + bounds.width), y - bounds.y);
  const rings = [
    [124, 260],
    [270, 346],
    [356, 432],
  ];
  return rings
    .slice(0, Math.max(1, Math.min(depth, 3)))
    .some(([inner, outer]) => radius >= inner - 9 && radius <= outer + 9);
}
