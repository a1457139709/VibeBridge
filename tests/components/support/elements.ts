import { requireValue } from '../../../app/renderer/common/required';

/** `found`, which the test needs to be an element of `type`; throws naming what it found otherwise. */
export function requireInstance<T extends Element>(found: Element | null | undefined, type: abstract new () => T): T {
  const description = found ? found.tagName : String(found);
  if (!(found instanceof type)) throw new Error(`Expected ${type.name}, found ${description}.`);
  return found;
}

/** The first `HTMLElement` in `root` that `selector` matches; throws when there is none. */
export function selectElement(selector: string, root: ParentNode = document): HTMLElement {
  return requireInstance(root.querySelector(selector), HTMLElement);
}

/** The focused element, which the test needs there; throws when nothing has focus. */
export function focusedElement(): Element {
  return requireValue(document.activeElement, 'a focused element');
}
