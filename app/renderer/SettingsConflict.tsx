import { useEffect, useRef } from 'react';
import { useLocalization } from './Localization';
import type { SettingsCategory } from '../shared/settings';

// Shown at startup while the settings hold a settings conflict. It has no dismiss action: the
// user either fixes the conflicting category in settings or quits.
export function SettingsConflictDialog({ category, openSettings }: { category: SettingsCategory; openSettings(): void }) {
  const { t } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-conflict" aria-labelledby="settings-conflict-title"
    onCancel={event => event.preventDefault()}
    // Browsers may still close a modal after repeated Escape presses, so it reopens.
    onClose={event => { if (event.currentTarget.isConnected) event.currentTarget.showModal(); }}>
    <h2 id="settings-conflict-title">{t('settingsConflictTitle')}</h2>
    <p>{t('settingsConflictHelp', { category: t('categorySettings', { category: t(category) }) })}</p>
    <div className="dialog-actions">
      <button onClick={() => void window.workbench.quit()}>{t('quitApp')}</button>
      <button className="primary" autoFocus onClick={openSettings}>{t('openConflictingSettings')}</button>
    </div>
  </dialog>;
}
