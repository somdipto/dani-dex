// Shared renderer/native timings. These tune response speed, not display Hz.
const arcade = Object.freeze({ enter: 220, exit: 130, rotate: 100, expand: 140 });
const calm = Object.freeze({ enter: 420, exit: 220, rotate: 180, expand: 240 });
const reduced = Object.freeze({ enter: 0, exit: 0, rotate: 0, expand: 0 });
export const DIAL_EASING = Object.freeze({ out: "cubic-bezier(.16,1,.3,1)", exit: "cubic-bezier(.4,0,1,1)" });
export const isDialMotion = (mode) => ["full", "calm", "reduced", "precise", "mechanical"].includes(mode);
export const mechanicalTarget = (angle) => Math.round(angle / 2) * 2;
export const MECHANICAL_SETTLE_MS = 100;
export function dialMotion(mode) {
  return mode === "reduced" ? reduced : mode === "calm" ? calm : arcade;
}
// Windows wheel units: 120 per conventional detent, smaller values for fine input.
// Preserve every fractional unit. No snapping, inertia, rounding or event-count speed.
export function preciseRotation(angle, delta) {
  return Number.isFinite(delta) ? angle - delta * 6 : angle;
}
export function wheelIntent(line, mode) {
  if (mode === "precise" || mode === "mechanical") {
    if (!/^wheel:-?\d+$/.test(line)) return null;
    const raw = Number(line.slice(6));
    return raw !== 0 && Math.abs(raw) <= 32768 ? { precise: true, delta: -raw / 120 } : null;
  }
  return line === "next" ? 1 : line === "prev" ? -1 : null;
}
