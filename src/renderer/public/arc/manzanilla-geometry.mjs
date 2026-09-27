// Shared SVG geometry and Windows click-through regions.
import { normalizeDialLayout } from './manzanilla-layout.mjs';
export const DESIGN = { width: 1672, height: 880, cx: 1672, cy: 0 };
export const DIAL_RINGS = [[124, 260], [270, 346], [356, 432]];
export function arcLayout(width, height, expanded = false, placement) {
  // Electron bounds are DIPs already. Never enlarge the dial on a larger monitor.
  const layout = normalizeDialLayout(placement);
  const scale = Math.min(1, width / 800, height / 650) * layout.zoom;
  const count = expanded === true ? 3 : Math.max(1, Math.min(3, Number(expanded) || 1));
  return { scale, offset: width * layout.centerX - DESIGN.cx * scale, top: height * layout.centerY, cx: DESIGN.cx, cy: DESIGN.cy,
    rings: DIAL_RINGS.slice(0, count),
    card: expanded ? { x: 1000, y: 555, width: 356, height: 278 } : { x: 1222, y: 372, width: 358, height: 300 } };
}
export function polar(radius, angle) {
  const a = angle * Math.PI / 180;
  return [DESIGN.cx + radius * Math.cos(a), DESIGN.cy + radius * Math.sin(a)];
}
export function sector(inner, outer, start, end) {
  return `M ${polar(outer, start)} A ${outer} ${outer} 0 0 1 ${polar(outer, end)} L ${polar(inner, end)} A ${inner} ${inner} 0 0 0 ${polar(inner, start)} Z`;
}
// Rounded annular wedges, retaining true circular inner and outer edges.
export function roundedSector(inner, outer, start, end, corner = 7) {
  const ao = corner / outer * 180 / Math.PI, ai = corner / inner * 180 / Math.PI;
  return `M ${polar(outer, start + ao)} A ${outer} ${outer} 0 0 1 ${polar(outer, end - ao)} Q ${polar(outer, end)} ${polar(outer - corner, end)} L ${polar(inner + corner, end)} Q ${polar(inner, end)} ${polar(inner, end - ai)} A ${inner} ${inner} 0 0 0 ${polar(inner, start + ai)} Q ${polar(inner, start)} ${polar(inner + corner, start)} L ${polar(outer - corner, start)} Q ${polar(outer, start)} ${polar(outer, start + ao)} Z`;
}
// Two half-arcs per contour render a genuine 360-degree annulus. A single
// start=end SVG arc is degenerate and would disappear during rotation.
export function annulus(inner, outer) {
  const contour=r=>`M ${polar(r,0)} A ${r} ${r} 0 1 1 ${polar(r,180)} A ${r} ${r} 0 1 1 ${polar(r,360)} Z`;
  return `${contour(outer)} ${contour(inner)}`;
}
export function hitRegions(width, height, expanded = false, placement, summoning = false) {
  const l = arcLayout(width, height, expanded, placement), result = [];
  // A shrinking ring sweeps through its center hole. Cover that disk while
  // animating so the native window shape cannot clip the smaller frames.
  const rings = summoning ? [[0,l.rings.at(-1)[1]]] : l.rings;
  for (let y = 0; y < height; y += 2) {
    const dy = Math.abs((y - l.top) / l.scale - l.cy);
    for (const [inner, outer] of rings) {
      if (dy >= outer + 8) continue;
      const center = l.offset + l.cx * l.scale;
      const reach = Math.sqrt(Math.max(0, (outer + 8) ** 2 - dy ** 2)) * l.scale;
      const hole = dy < inner - 8 ? Math.sqrt((inner - 8) ** 2 - dy ** 2) * l.scale : 0;
      // Both halves matter when the user brings the center inside the screen.
      const spans = hole ? [[center-reach, center-hole], [center+hole, center+reach]] : [[center-reach, center+reach]];
      for (const [left,right] of spans) {
        const x = Math.max(0, Math.floor(left)), span = Math.min(width, Math.ceil(right)) - x;
        if (span > 0) result.push({ x, y, width: span, height: Math.min(2, height - y) });
      }
    }
  }
  // No detail-card rectangle: the real desktop remains clickable below the wheel.
  return result;
}
