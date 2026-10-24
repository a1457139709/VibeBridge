import { useLocalization } from './Localization';
import { useEffect, useRef, useState } from 'react';
import { agentNames, agentTypes } from '../shared/model';
import { agentIcons } from './agent-icons';
import { message } from '../shared/messages';

export function AgentPicker({ projectId, full, close, added, openAgentSettings }: {
  projectId: string; full: boolean; close(): void; added(): void; openAgentSettings(): void;
}) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const launchFailed = error === message('launchFailed');
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
        setBusy(true); setError('');
        try {
          const result = await window.workbench.addPanel(projectId, type);
          if (result.launch.ok) added(); else setError(result.launch.error);
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
      }}><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</button>)}
    {error && <p className="error-text" role="alert">{text(error)}</p>}
    {launchFailed && <button className="picker-settings" onClick={() => { close(); openAgentSettings(); }}>{t('openAgentSettings')}</button>}
  </dialog>;
}
