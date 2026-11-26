import { flushSync } from 'react-dom';

export function focusAfterUpdate(update: () => void, target: () => HTMLElement | null | undefined) {
  flushSync(update);
  target()?.focus();
}
