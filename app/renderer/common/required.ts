/** A value the UI's structure guarantees, such as a mounted ref; a missing one means that structure is broken. */
export function requireValue<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

/** The element `selector` finds inside `root`, which the markup guarantees. */
export function requireElement(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing element ${selector}`);
  return found;
}

/** The nearest ancestor of `element`, or itself, matching `selector`, which the markup guarantees. */
export function requireClosest(element: Element, selector: string): HTMLElement {
  const found = element.closest(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing ancestor ${selector}`);
  return found;
}
