import type { DesktopAPI } from '../../../app/shared/api';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

// The preload API is the component's external boundary. Unexpected calls fail
// instead of silently returning a permissive default.
export function provideWorkbench(methods: Partial<DesktopAPI>) {
  window.workbench = new Proxy(methods, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    throw new Error(`Unexpected workbench call: ${String(key)}`);
  } }) as DesktopAPI;
}
