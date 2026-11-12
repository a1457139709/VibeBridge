/** jsdom has no layout, frames or media queries. The shell and its terminals only need these to exist: observers
 * never report, media queries never match and frames never run, so tests using this cannot verify focus timing or animation. */
export function stubLayoutApis() {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
}
