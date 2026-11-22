import { requireValue } from '../../../app/renderer/common/required';

export function requireInstance<T extends Element>(found: Element | null | undefined, type: abstract new () => T): T {
  const description = found ? found.tagName : String(found);
  if (!(found instanceof type)) throw new Error(`Expected ${type.name}, found ${description}.`);
  return found;
}

export function selectElement(selector: string, root: ParentNode = document): HTMLElement {
  return requireInstance(root.querySelector(selector), HTMLElement);
}

export function focusedElement(): Element {
  return requireValue(document.activeElement, 'a focused element');
}
