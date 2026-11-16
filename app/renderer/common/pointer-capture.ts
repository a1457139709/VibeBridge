// Own only capture and pointer listener cleanup; gesture calculations and outside
// cancellation triggers stay with their callers.
export function capturePointer(element: HTMLElement, pointerId: number, handlers: {
  move(event: PointerEvent): void;
  finish(commit: boolean, release?: PointerEvent): void;
}): () => void {
  let active = true;
  const finish = (commit: boolean, release?: PointerEvent) => {
    if (!active) return;
    active = false;
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', interrupted);
    element.removeEventListener('lostpointercapture', interrupted);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    handlers.finish(commit, release);
  };
  const move = (event: PointerEvent) => { if (event.pointerId === pointerId) handlers.move(event); };
  const up = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(true, event); };
  const interrupted = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(false); };
  element.setPointerCapture(pointerId);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', interrupted);
  element.addEventListener('lostpointercapture', interrupted);
  return () => finish(false);
}
