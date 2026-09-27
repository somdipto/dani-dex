// Reference material presets. The glass values are visual filter parameters,
// not a claimed physical refractive index.
export const DIAL_THEMES = [
  { id: 'liquid', name: 'Liquid glass', glass: true },
  { id: 'vivid', name: 'Vivid', glass: false },
  { id: 'porcelain', name: 'Porcelain', glass: false },
  { id: 'graphite', name: 'Graphite', glass: false },
  { id: 'clay', name: 'Pastel clay', glass: false },
  { id: 'spectral', name: 'Spectral', glass: true },
  { id: 'obsidian', name: 'Obsidian', glass: true },
  { id: 'aurora', name: 'Aurora', glass: true },
  { id: 'smoke', name: 'Frosted Smoke', glass: true },
];
export const isDialTheme = id => DIAL_THEMES.some(theme => theme.id === id);
export const GLASS_LENS = Object.freeze({ displacement: 26, blur: 2.4, saturation: 1.55 });
