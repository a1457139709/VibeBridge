import { useRef, useState, type RefObject } from 'react';
import { useRenderSyncBeforePaint } from '../common/effects/render-sync';

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

export async function flyIntoCard(panel: Element, card: Element) {
  try {
    await panel.animate([inPlace, overCard(panel, card)], {
      duration: 260,
      easing: 'cubic-bezier(.4,0,.7,1)',
      fill: 'forwards',
    }).finished;
  } catch {}
}

export function useTrayFlight({
  openPanelId,
  canvas,
  tray,
  collapse,
}: {
  openPanelId?: string;
  canvas: RefObject<Element | null>;
  tray: RefObject<Element | null>;
  collapse(): void;
}) {
  const [landedPanelId, setLandedPanelId] = useState<string>();
  const shownPanelId = useRef<string>(undefined);
  const flyingPanelId = useRef<string>(undefined);
  const flightOf = (panelId: string) => {
    const slot = canvas.current?.querySelector(`[data-panel-id="${CSS.escape(panelId)}"]`),
      card = tray.current?.querySelector(`[data-tray-panel-id="${CSS.escape(panelId)}"]`);
    return card && canFly(slot) ? { slot, card } : undefined;
  };
  useRenderSyncBeforePaint(() => {
    if (openPanelId && openPanelId !== shownPanelId.current) {
      const flight = flightOf(openPanelId);
      if (flight) growFromCard(flight.slot, flight.card);
    }
    shownPanelId.current = openPanelId;
  });
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
    void flyIntoCard(flight.slot, flight.card).then(() => {
      flyingPanelId.current = undefined;
      if (shownPanelId.current !== panelId) return;
      collapse();
      setLandedPanelId(panelId);
    });
  };
  return { landedPanelId, landingEnded: () => setLandedPanelId(undefined), collapseIntoCard };
}
