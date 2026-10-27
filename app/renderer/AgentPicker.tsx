import { useLocalization } from './Localization';
import { useEffect, useRef, useState } from 'react';
import { message } from '../shared/messages';
import { agentNames, agentTypes } from '../shared/model';
import { agentIcons } from './agent-icons';

export function AgentPicker({ projectId, full, close, added, openAgentSettings }: {
  projectId: string; full: boolean; close(): void; added(): void; openAgentSettings(): void;
}) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: string; settings: boolean }>();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="agent-picker" aria-label={t('addPanel')} onCancel={close}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <button className="picker-close" aria-label={t('closeAgentPicker')} onClick={close}>×</button>
    {agentTypes.map(type => <button key={type} autoFocus={type === 'codex'} className={`agent-option ${type}`} disabled={busy || full}
      onClick={async () => {
        setBusy(true); setFailure(undefined);
        try {
          const result = await window.workbench.addPanel(projectId, type);
          const { launch } = result;
          if (launch.outcome === 'started') added();
          else if (launch.outcome === 'failed') setFailure({ error: message('launchFailed'), settings: true });
          else setFailure({ error: launch.reason, settings: false });
        } catch (error) { setFailure({ error: (error as Error).message, settings: false }); }
        finally { setBusy(false); }
      }}><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</button>)}
    {failure && <p className="error-text" role="alert">{text(failure.error)}</p>}
    {failure?.settings && <button className="picker-settings" onClick={() => { close(); openAgentSettings(); }}>{t('openAgentSettings')}</button>}
  </dialog>;
}
