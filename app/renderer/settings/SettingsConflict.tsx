import { useLocalization } from '../common/Localization';
import type { SettingsCategory } from '../../shared/settings/settings';

function showModal(dialog: HTMLDialogElement | null) {
  dialog?.showModal();
}

export function SettingsConflictDialog({
  category,
  openSettings,
}: {
  category: SettingsCategory;
  openSettings(): void;
}) {
  const { t } = useLocalization();
  return (
    <dialog
      ref={showModal}
      className="settings-conflict"
      aria-labelledby="settings-conflict-title"
      aria-describedby="settings-conflict-help"
      onCancel={event => event.preventDefault()}
      onClose={event => {
        if (event.currentTarget.isConnected) event.currentTarget.showModal();
      }}
    >
      <h2 id="settings-conflict-title">{t('settingsConflictTitle')}</h2>
      <p id="settings-conflict-help">
        {t('settingsConflictHelp', { category: t('categorySettings', { category: t(category) }) })}
      </p>
      <div className="dialog-actions">
        <button onClick={() => void window.workbench.quit()}>{t('quitApp')}</button>
        <button className="primary" autoFocus onClick={openSettings}>
          {t('openConflictingSettings')}
        </button>
      </div>
    </dialog>
  );
}
