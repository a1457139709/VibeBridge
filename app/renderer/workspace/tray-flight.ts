import { useRef, useState } from 'react';
import { errorMessage } from '../../shared/caught-error';
import { playToEnd, type AnimationOutcome } from '../common/animation-outcome';

export const canFly = (panel: Element | null | undefined): panel is Element =>
  !!panel && typeof panel.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

const inPlace: Keyframe = { transform: 'none', opacity: 1, transformOrigin: '0 0' };

function overCard(panel: Element, card: Element): Keyframe {
  const from = panel.getBoundingClientRect(),
    to = card.getBoundingClientRect();
  return {
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
    opacity: 0.35,
    transformOrigin: '0 0',
  };
}

export function growFromCard(panel: Element, card: Element) {
  panel.animate([overCard(panel, card), inPlace], { duration: 260, easing: 'cubic-bezier(.2,0,.2,1)' });
}

export async function flyIntoCard(panel: Element, card: Element): Promise<AnimationOutcome> {
  return playToEnd(
    panel.animate([inPlace, overCard(panel, card)], {
      duration: 260,
      easing: 'cubic-bezier(.4,0,.7,1)',
      fill: 'forwards',
    }),
  );
}

export function growOpenedPanel(slot: HTMLElement | null) {
  const panelId = slot?.dataset.panelId;
  if (!slot || !panelId) return;
  const card = slot.closest('.workspace')?.querySelector(`[data-tray-panel-id="${CSS.escape(panelId)}"]`);
  if (card && canFly(slot)) growFromCard(slot, card);
}

export function useTrayFlight({
  openPanelId,
  canvas,
  tray,
  collapse,
  report,
}: {
  openPanelId?: string;
  canvas: Element | null;
  tray: Element | null;
  collapse(): void;
  report(message: string): void;
}) {
  const [landedPanelId, setLandedPanelId] = useState<string>();
  const flyingPanelId = useRef<string>(undefined);
  const flightOf = (panelId: string) => {
    const slot = canvas?.querySelector(`[data-panel-id="${CSS.escape(panelId)}"]`),
      card = tray?.querySelector(`[data-tray-panel-id="${CSS.escape(panelId)}"]`);
    return card && canFly(slot) ? { slot, card } : undefined;
  };
  const collapseIntoCard = () => {
    const panelId = openPanelId;
    if (!panelId) return;
    const flight = flightOf(panelId);
    if (!flight) {
      collapse();
      return;
    }
    if (flyingPanelId.current === panelId) return;
    flyingPanelId.current = panelId;
    const land = () => {
      flyingPanelId.current = undefined;
      if (!flight.slot.isConnected) return;
      collapse();
      setLandedPanelId(panelId);
    };
    void flyIntoCard(flight.slot, flight.card)
      .finally(land)
      .catch(error => report(errorMessage(error)));
  };
  return { landedPanelId, landingEnded: () => setLandedPanelId(undefined), collapseIntoCard };
}
