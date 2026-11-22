export function stubLayoutApis() {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  const matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  for (const target of [globalThis, window])
    Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
}
