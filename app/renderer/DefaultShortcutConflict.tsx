import { useEffect, useRef } from 'react';
import { useLocalization } from './Localization';

// Shown at startup while a default shortcut conflict lasts. It has no dismiss action: the user
// either fixes the shortcuts in settings or quits.
export function DefaultShortcutConflictDialog({ openShortcuts }: { openShortcuts(): void }) {
  const { t } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="default-shortcut-conflict" aria-labelledby="default-shortcut-conflict-title"
    onCancel={event => event.preventDefault()}
    // Browsers may still close a modal after repeated Escape presses, so it reopens.
    onClose={event => { if (event.currentTarget.isConnected) event.currentTarget.showModal(); }}>
    <h2 id="default-shortcut-conflict-title">{t('defaultShortcutConflictTitle')}</h2>
    <p>{t('defaultShortcutConflictHelp')}</p>
    <div className="dialog-actions">
      <button onClick={() => void window.workbench.quit()}>{t('quitApp')}</button>
      <button className="primary" autoFocus onClick={openShortcuts}>{t('openShortcuts')}</button>
    </div>
  </dialog>;
}
