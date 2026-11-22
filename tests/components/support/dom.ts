import { JSDOM } from 'jsdom';
import escape from 'css.escape';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of [
  'window',
  'document',
  'navigator',
  'Element',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLDialogElement',
  'Node',
  'MutationObserver',
  'DOMRect',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? window : Reflect.get(window, key),
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, CSS: { escape } });
// jsdom has no AnimationEvent, so React would listen for a vendor-prefixed animationend that fireEvent never sends.
Object.assign(window, { AnimationEvent: class AnimationEvent extends window.Event {} });
// jsdom has no layout or native modal UI. Model only the open/close DOM contract;
// these shims deliberately cannot verify scrolling, top-layer rendering or focus.
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
