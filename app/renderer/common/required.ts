export function requireValue<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

export function requireElement(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing element ${selector}`);
  return found;
}

export function requireClosest(element: Element, selector: string): HTMLElement {
  const found = element.closest(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing ancestor ${selector}`);
  return found;
}
