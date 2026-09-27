export const DEFAULT_DIAL_LAYOUT = Object.freeze({ centerX: 1, centerY: 0, zoom: 1 });
export const DIAL_ZOOM = Object.freeze({ min: 0.6, max: 1.6 });
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function validDialLayout(value) {
  return value != null && typeof value === 'object' &&
    Number.isFinite(value.centerX) && value.centerX >= 0 && value.centerX <= 1 &&
    Number.isFinite(value.centerY) && value.centerY >= 0 && value.centerY <= 1 &&
    Number.isFinite(value.zoom) && value.zoom >= DIAL_ZOOM.min && value.zoom <= DIAL_ZOOM.max;
}
export function normalizeDialLayout(value = DEFAULT_DIAL_LAYOUT) {
  return { centerX: Number.isFinite(value?.centerX) ? clamp(value.centerX, 0, 1) : 1,
    centerY: Number.isFinite(value?.centerY) ? clamp(value.centerY, 0, 1) : 0,
    zoom: Number.isFinite(value?.zoom) ? clamp(value.zoom, DIAL_ZOOM.min, DIAL_ZOOM.max) : 1 };
}
export function inwardQuadrant(value) {
  const {centerX,centerY}=normalizeDialLayout(value);
  return centerX>=0.5 ? (centerY<=0.5?90:180) : (centerY<=0.5?0:270);
}
// Pure transaction used by the native host. Dragging never writes preferences.
export class DialEditSession {
  active = false;
  begin(layout) { this.original = normalizeDialLayout(layout); this.active = true; return { ...this.original }; }
  finish(layout, save) {
    if (!this.active) return null;
    if (save && !validDialLayout(layout)) return null;
    this.active = false;
    return save ? normalizeDialLayout(layout) : { ...this.original };
  }
}
