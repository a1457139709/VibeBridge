import { useLocalization } from '../common/Localization';
import type { Settings } from '../../shared/model';

export function AppearanceSettings({
  draft,
  savedTheme,
  startupTheme,
  fieldError,
  changeDraft,
  submit,
}: {
  draft: Settings;
  savedTheme: Settings['theme'];
  startupTheme: Settings['theme'];
  fieldError(field: string): string;
  changeDraft(patch: Partial<Settings>): void;
  submit(): void;
}) {
  const { t } = useLocalization();
  const { theme, defaultLayout } = draft;
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <h2>{t('theme')}</h2>
      <p className="muted">{t('themeHelp')}</p>
      <div
        className="radio-options"
        role="radiogroup"
        aria-label={t('theme')}
        data-settings-field="theme"
        tabIndex={-1}
        aria-invalid={!!fieldError('theme') || undefined}
        aria-describedby={fieldError('theme') ? 'theme-error' : undefined}
      >
        {(['system', 'dark', 'light'] as const).map(option => (
          <label key={option}>
            <input
              type="radio"
              name="theme"
              value={option}
              checked={theme === option}
              onChange={() => changeDraft({ theme: option })}
            />
            {t(({ system: 'themeSystem', dark: 'themeDark', light: 'themeLight' } as const)[option])}
          </label>
        ))}
      </div>
      {fieldError('theme') && (
        <p id="theme-error" className="error-text" role="alert">
          {fieldError('theme')}
        </p>
      )}
      {savedTheme !== startupTheme && (
        <p className="restart-notice" role="status">
          {t('themeRestart')}
        </p>
      )}
      <hr />
      <label htmlFor="default-layout">{t('defaultLayout')}</label>
      <select
        id="default-layout"
        data-settings-field="defaultLayout"
        aria-invalid={!!fieldError('defaultLayout') || undefined}
        aria-describedby={fieldError('defaultLayout') ? 'layout-error' : undefined}
        value={defaultLayout}
        onChange={event => changeDraft({ defaultLayout: event.target.value as Settings['defaultLayout'] })}
      >
        <option value="auto">{t('layoutAuto')}</option>
        <option value="row">{t('layoutRow')}</option>
        <option value="column">{t('layoutColumn')}</option>
      </select>
      {fieldError('defaultLayout') && (
        <p id="layout-error" className="error-text" role="alert">
          {fieldError('defaultLayout')}
        </p>
      )}
      <p className="muted">{t('layoutHelp')}</p>
      <hr />
      <h2 id="sidebar-coexistence">{t('sidebarCoexistence')}</h2>
      <div
        className="radio-options"
        role="radiogroup"
        aria-labelledby="sidebar-coexistence"
        data-settings-field="sidebarCoexistence"
        tabIndex={-1}
        aria-invalid={!!fieldError('sidebarCoexistence') || undefined}
        aria-describedby={fieldError('sidebarCoexistence') ? 'sidebar-coexistence-error' : undefined}
      >
        {(['squeeze', 'overlay'] as const).map(option => (
          <label key={option}>
            <input
              type="radio"
              name="sidebarCoexistence"
              value={option}
              checked={draft.sidebarCoexistence === option}
              onChange={() => changeDraft({ sidebarCoexistence: option })}
            />
            <span>
              <b>{t(option === 'squeeze' ? 'sidebarSqueeze' : 'sidebarOverlay')}</b>
              {t(option === 'squeeze' ? 'sidebarSqueezeHelp' : 'sidebarOverlayHelp')}
            </span>
          </label>
        ))}
      </div>
      {fieldError('sidebarCoexistence') && (
        <p id="sidebar-coexistence-error" className="error-text" role="alert">
          {fieldError('sidebarCoexistence')}
        </p>
      )}
      <hr />
      <h2 id="detail-coexistence">{t('detailCoexistence')}</h2>
      <div
        className="radio-options"
        role="radiogroup"
        aria-labelledby="detail-coexistence"
        data-settings-field="detailCoexistence"
        tabIndex={-1}
        aria-invalid={!!fieldError('detailCoexistence') || undefined}
        aria-describedby={fieldError('detailCoexistence') ? 'detail-coexistence-error' : undefined}
      >
        {(['overlay', 'squeeze'] as const).map(option => (
          <label key={option}>
            <input
              type="radio"
              name="detailCoexistence"
              value={option}
              checked={draft.detailCoexistence === option}
              onChange={() => changeDraft({ detailCoexistence: option })}
            />
            <span>
              <b>{t(option === 'overlay' ? 'detailOverlay' : 'detailSqueeze')}</b>
              {t(option === 'overlay' ? 'detailOverlayHelp' : 'detailSqueezeHelp')}
            </span>
          </label>
        ))}
      </div>
      {fieldError('detailCoexistence') && (
        <p id="detail-coexistence-error" className="error-text" role="alert">
          {fieldError('detailCoexistence')}
        </p>
      )}
      <p className="muted">{t('detailCoexistenceNote')}</p>
    </form>
  );
}
