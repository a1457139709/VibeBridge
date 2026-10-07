import { useEffect, useRef, useState } from 'react';
import { agentNames, agentTypes } from '../shared/model';
import { agentIcons } from './agent-icons';

export function AgentPicker({ projectId, full, close, added }: {
  projectId: string; full: boolean; close(): void; added(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="agent-picker" aria-label="添加 Agent" onCancel={close}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <button className="picker-close" aria-label="关闭添加 Agent" onClick={close}>×</button>
    {agentTypes.map(type => <button key={type} autoFocus={type === 'codex'} className={`agent-option ${type}`} disabled={busy || full}
      onClick={async () => {
        setBusy(true); setError('');
        try {
          const result = await window.workbench.addPanel(projectId, type);
          if (result.launch.ok) added(); else setError(result.launch.error);
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
      }}><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</button>)}
    {error && <p className="error-text" role="alert">{error}</p>}
  </dialog>;
}
