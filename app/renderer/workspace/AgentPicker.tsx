import { useLocalization } from '../common/Localization';
import { useEffect, useRef, useState } from 'react';
import { message } from '../../shared/messages';
import { agentNames, agentTypes } from '../../shared/model';
import { agentIcons } from '../common/agent-icons';
import { errorMessage } from '../../shared/caught-error';
import { requireValue } from '../common/required';

export function AgentPicker({
  projectId,
  atPanelLimit,
  close,
  onPanelAdded,
  openAgentSettings,
}: {
  projectId: string;
  atPanelLimit: boolean;
  close(): void;
  onPanelAdded(panelId: string): void;
  openAgentSettings(): void;
}) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: string; offerAgentSettings: boolean }>();
  useEffect(() => {
    const element = requireValue(dialog.current, 'the agent picker dialog');
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="agent-picker"
      aria-label={t('addPanel')}
      onCancel={close}
      onClick={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <button className="picker-close" aria-label={t('closeAgentPicker')} onClick={close}>
        ×
      </button>
      {agentTypes.map(type => (
        <button
          key={type}
          autoFocus={type === 'codex'}
          className={`agent-option ${type}`}
          disabled={busy || atPanelLimit}
          onClick={async () => {
            setBusy(true);
            setFailure(undefined);
            try {
              const result = await window.workbench.addPanel(projectId, type);
              const { launch } = result;
              if (launch.outcome === 'started') onPanelAdded(result.panel.id);
              else if (launch.outcome === 'failed')
                setFailure({ error: message('launchFailed'), offerAgentSettings: true });
              else setFailure({ error: launch.reason, offerAgentSettings: false });
            } catch (error) {
              setFailure({ error: errorMessage(error), offerAgentSettings: false });
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="agent-mark">{agentIcons[type]}</span>
          {agentNames[type]}
        </button>
      ))}
      {failure && (
        <p className="error-text" role="alert">
          {text(failure.error)}
        </p>
      )}
      {failure?.offerAgentSettings && (
        <button
          className="picker-settings"
          onClick={() => {
            close();
            openAgentSettings();
          }}
        >
          {t('openAgentSettings')}
        </button>
      )}
    </dialog>
  );
}
