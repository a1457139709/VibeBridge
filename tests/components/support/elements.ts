/** `value`, which the test needs present; throws naming `what` when it is null or undefined. */
export function requireValue<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}, found ${String(value)}.`);
  return value;
}

/** `found`, which the test needs to be an element of `type` (an `HTMLElement` unless given); throws otherwise. */
export function requireElement(found: Element | null | undefined): HTMLElement;
export function requireElement<T extends Element>(found: Element | null | undefined, type: abstract new () => T): T;
export function requireElement(
  found: Element | null | undefined,
  type: abstract new () => Element = HTMLElement,
): Element {
  const description = found ? found.tagName : String(found);
  if (!(found instanceof type)) throw new Error(`Expected ${type.name}, found ${description}.`);
  return found;
}

/** The first `HTMLElement` in `root` that `selector` matches; throws when there is none. */
export function selectElement(selector: string, root: ParentNode = document): HTMLElement {
  return requireElement(root.querySelector(selector));
}

/** The focused element, which the test needs there; throws when nothing has focus. */
export function focusedElement(): Element {
  return requireValue(document.activeElement, 'a focused element');
}
