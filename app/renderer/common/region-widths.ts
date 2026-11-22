import { useSyncExternalStore } from 'react';

export type Region = 'navigation' | 'forgeSidebar' | 'detail';
export type RegionWidths = Record<Region, number>;
export interface RegionFit {
  width: number;
  widest: number;
}
export type WidestOnResize = (region: Region) => number;
export const draggedWidth = (width: number, narrowest: number, widest: number) =>
  Math.round(Math.max(narrowest, Math.min(widest, width)));

export function fitRegions(
  windowWidth: number,
  remembered: RegionWidths,
  lastResized: Region,
): Record<Region, RegionFit> {
  const within = (width: number, room: number) => Math.max(0, Math.min(width, room));
  const drawn = { ...remembered };
  if (lastResized === 'forgeSidebar') {
    drawn.forgeSidebar = within(remembered.forgeSidebar, windowWidth);
  } else {
    drawn[lastResized] = within(remembered[lastResized], windowWidth);
    drawn.forgeSidebar = within(remembered.forgeSidebar, windowWidth - drawn[lastResized]);
  }
  for (const region of ['navigation', 'detail'] as const)
    if (region !== lastResized) drawn[region] = within(remembered[region], windowWidth - drawn.forgeSidebar);
  return {
    navigation: { width: drawn.navigation, widest: windowWidth - drawn.forgeSidebar },
    forgeSidebar: { width: drawn.forgeSidebar, widest: windowWidth - drawn.navigation },
    detail: { width: drawn.detail, widest: windowWidth - drawn.forgeSidebar },
  };
}

const subscribeToWindowWidth = (changed: () => void) => {
  window.addEventListener('resize', changed);
  return () => window.removeEventListener('resize', changed);
};
export const useWindowWidth = () => useSyncExternalStore(subscribeToWindowWidth, () => window.innerWidth);
