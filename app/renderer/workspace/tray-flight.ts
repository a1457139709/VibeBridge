/** An open tray panel flies between its tray card and the layout area: it grows out of the card as it opens and
 * shrinks into the card as it collapses. Only the tray moves this way; with reduced motion it opens and collapses
 * at once. */

/** Whether a tray panel can fly: motion is not reduced and the panel can animate. */
export const canFly = (panel: Element | null | undefined): panel is HTMLElement =>
  !!(panel as HTMLElement | null)?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;

const inPlace: Keyframe = { transform: 'none', opacity: 1, transformOrigin: '0 0' };

/** The panel drawn over its card: moved to the card's corner and scaled to the card's size. */
function overCard(panel: HTMLElement, card: Element): Keyframe {
  const from = panel.getBoundingClientRect(),
    to = card.getBoundingClientRect();
  return {
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
    opacity: 0.35,
    transformOrigin: '0 0',
  };
}

/** Grows the just-opened panel out of its card into place. */
export function growFromCard(panel: HTMLElement, card: Element) {
  panel.animate([overCard(panel, card), inPlace], { duration: 260, easing: 'cubic-bezier(.2,0,.2,1)' });
}

/** Shrinks the panel into its card; settles when it has landed there, or when the flight is cut short. */
export async function flyIntoCard(panel: HTMLElement, card: Element) {
  try {
    await panel.animate([inPlace, overCard(panel, card)], {
      duration: 260,
      easing: 'cubic-bezier(.4,0,.7,1)',
      fill: 'forwards',
    }).finished;
  } catch {
    // A cancelled flight ends where it is; the panel still collapses.
  }
}
