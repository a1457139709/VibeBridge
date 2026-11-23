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

export const descriptionParts = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .flatMap(id => document.getElementById(id)?.textContent ?? []);

export const shownTextParts = (element: Element): string[] =>
  [...element.childNodes].flatMap(node => {
    if (!(node instanceof Element)) return node.textContent ? [node.textContent] : [];
    if (node.getAttribute('aria-hidden') === 'true') return [];
    if (node.getAttribute('role') === 'img') return [node.getAttribute('aria-label') ?? ''];
    return node.children.length ? shownTextParts(node) : [node.textContent ?? ''];
  });
