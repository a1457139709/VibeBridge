import { useLocalization } from './Localization';
import { agentIcons } from './agent-icons';
import { agentNames, type PanelView } from '../shared/model';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import type { PointerEvent, Ref } from 'react';

/** The ephemeral panel tray: one card per tray panel, left to right in tray order. Cards
 * shrink to fit instead of overflowing; the narrowest keeps the Agent colour and status.
 * A card can be dragged into the layout area, and the tray takes resident panels dropped on it. */
export function PanelTray({ panels, openPanelId, open, collapse, cardPointerDown, ref }: {
  panels: PanelView[]; openPanelId?: string; open(panelId: string): void; collapse(): void;
  cardPointerDown?(event: PointerEvent<HTMLButtonElement>, panelId: string): void; ref?: Ref<HTMLElement>;
}) {
  const { t } = useLocalization();
  return <section ref={ref} className="panel-tray" aria-label={t('panelTray')}>
    {panels.map(panel => {
      const title = panel.run?.title ?? t('untitled');
      const opened = panel.id === openPanelId;
      return <button key={panel.id} data-tray-panel-id={panel.id} className={`tray-card ${panel.agent}`} aria-pressed={opened}
        title={`${agentNames[panel.agent]} · ${title}`} onPointerDown={event => cardPointerDown?.(event, panel.id)}
        onClick={() => opened ? collapse() : open(panel.id)}>
        <span className="tray-card-symbols"><ProcessingStatusIcon state={panel.status} /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span>
        <span className="session-title">{title}</span>
      </button>;
    })}
  </section>;
}
