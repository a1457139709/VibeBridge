import { useLocalization } from '../common/Localization';
import { agentIcons } from '../common/agent-icons';
import { agentNames, type PanelView } from '../../shared/model';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import type { PointerEvent, Ref } from 'react';

/** The ephemeral panel tray: one card per tray panel, left to right in tray order. Cards
 * shrink to fit instead of overflowing; the narrowest keeps the Agent colour and status.
 * A card can be dragged into the layout area, and the tray takes resident panels dropped on it.
 * An empty tray takes no space and shows only as the drop target while a resident panel is dragged.
 * The card a collapsed panel has just flown into flashes once. */
export function PanelTray({
  panels,
  openPanelId,
  landedPanelId,
  open,
  collapse,
  landingEnded,
  cardPointerDown,
  ref,
}: {
  panels: PanelView[];
  openPanelId?: string;
  landedPanelId?: string;
  open(panelId: string): void;
  collapse(): void;
  landingEnded?(): void;
  cardPointerDown?(event: PointerEvent<HTMLButtonElement>, panelId: string): void;
  ref?: Ref<HTMLElement>;
}) {
  const { t } = useLocalization();
  return (
    <section ref={ref} className={`panel-tray ${panels.length ? '' : 'empty'}`} aria-label={t('panelTray')}>
      {panels.map(panel => {
        const title = panel.run?.title ?? t('untitled');
        const opened = panel.id === openPanelId;
        return (
          <button
            key={panel.id}
            data-tray-panel-id={panel.id}
            className={`tray-card ${panel.agent} ${panel.id === landedPanelId ? 'landed' : ''}`}
            aria-pressed={opened}
            data-hint={`${agentNames[panel.agent]} · ${title}`}
            onPointerDown={event => cardPointerDown?.(event, panel.id)}
            onClick={() => (opened ? collapse() : open(panel.id))}
            onAnimationEnd={event => {
              if (event.target === event.currentTarget && panel.id === landedPanelId) landingEnded?.();
            }}
          >
            <span className="tray-card-symbols">
              <ProcessingStatusIcon state={panel.status} />
              <span className="agent-mark" aria-hidden="true">
                {agentIcons[panel.agent]}
              </span>
            </span>
            <span className="session-title">{title}</span>
          </button>
        );
      })}
    </section>
  );
}
