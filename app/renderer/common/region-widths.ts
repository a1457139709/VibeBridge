import { useSyncExternalStore } from 'react';

/** The regions whose width the user drags: the project navigation, the forge sidebar and the issue detail. */
export type Region = 'navigation' | 'forgeSidebar' | 'detail';
/** Each region's width, 0 for a region not shown. */
export type RegionWidths = Record<Region, number>;
/** How a region is drawn: the width it is drawn at, and the widest a drag of its edge may make it. */
export interface RegionFit {
  width: number;
  widest: number;
}
/** Records `region` as the region last resized and returns the widest a drag of its edge may make it. */
export type WidestOnResize = (region: Region) => number;
/** The whole-pixel width a drag sets: `width` kept between `narrowest` and `widest`. */
export const draggedWidth = (width: number, narrowest: number, widest: number) =>
  Math.round(Math.max(narrowest, Math.min(widest, width)));

/** Fits the regions' remembered widths into the window. The navigation and the sidebar share the window's width, and so
 * do the detail and the sidebar; the detail may cover the navigation. The region last resized keeps its width up to
 * the window's; the others are drawn narrower to fit, and their remembered widths stay as they are. Each drag edge
 * stays in the window: the sidebar's left edge reaches the navigation's right edge, the detail's the window's left
 * edge, and the navigation's right edge the sidebar's left edge. */
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
/** The window's width, following its resizing. */
export const useWindowWidth = () => useSyncExternalStore(subscribeToWindowWidth, () => window.innerWidth);
