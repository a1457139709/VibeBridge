import { useLocalization } from './Localization';
import { agentIcons } from './agent-icons';
import { agentNames, type PanelView } from '../shared/model';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';

/** The ephemeral panel tray: one card per tray panel, left to right in tray order. Cards
 * shrink to fit instead of overflowing; the narrowest keeps the Agent colour and status. */
export function PanelTray({ panels, openPanelId, open, collapse }: {
  panels: PanelView[]; openPanelId?: string; open(panelId: string): void; collapse(): void;
}) {
  const { t } = useLocalization();
  return <section className="panel-tray" aria-label={t('panelTray')}>
    {panels.map(panel => {
      const title = panel.run?.title ?? t('untitled');
      const opened = panel.id === openPanelId;
      return <button key={panel.id} data-tray-panel-id={panel.id} className={`tray-card ${panel.agent}`} aria-pressed={opened}
        title={`${agentNames[panel.agent]} · ${title}`} onClick={() => opened ? collapse() : open(panel.id)}>
        <span className="tray-card-symbols"><ProcessingStatusIcon state={panel.status} /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span>
        <span className="session-title">{title}</span>
      </button>;
    })}
  </section>;
}
