import { JSDOM } from 'jsdom';
import escape from 'css.escape';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement', 'Node', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key as keyof typeof window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, CSS: { escape } });
// jsdom has no layout or native modal UI. Model only the open/close DOM contract;
// these shims deliberately cannot verify scrolling, top-layer rendering or focus.
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
