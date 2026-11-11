import { useLocalization } from './Localization';
import type { Settings } from '../shared/model';

/** The Appearance category's fields: theme, default layout, and how the issue sidebar and its detail share the window. */
export function AppearanceFields({ draft, changeDraft, fieldError, themeRestart }: {
  draft: Settings; changeDraft(patch: Partial<Settings>): void; fieldError(field: string): string;
  /** The saved theme differs from the one the window started with. */
  themeRestart: boolean;
}) {
  const { t } = useLocalization();
  const { theme, defaultLayout, sidebarCoexistence, detailCoexistence } = draft;
  return <>
    <h2>{t('theme')}</h2><p className="muted">{t('themeHelp')}</p>
    <div className="theme-options" role="radiogroup" aria-label={t('theme')} data-settings-field="theme" tabIndex={-1} aria-invalid={!!fieldError('theme') || undefined} aria-describedby={fieldError('theme') ? 'theme-error' : undefined}>{(['system', 'dark', 'light'] as const).map(option => <label key={option}><input type="radio" name="theme" value={option} checked={theme === option} onChange={() => changeDraft({ theme: option })} />{t(({ system: 'themeSystem', dark: 'themeDark', light: 'themeLight' } as const)[option])}</label>)}</div>
    {fieldError('theme') && <p id="theme-error" className="error-text" role="alert">{fieldError('theme')}</p>}
    {themeRestart && <p className="restart-notice" role="status">{t('themeRestart')}</p>}
    <hr /><label htmlFor="default-layout">{t('defaultLayout')}</label><select id="default-layout" data-settings-field="defaultLayout" aria-invalid={!!fieldError('defaultLayout') || undefined} aria-describedby={fieldError('defaultLayout') ? 'layout-error' : undefined} value={defaultLayout} onChange={event => changeDraft({ defaultLayout: event.target.value as Settings['defaultLayout'] })}><option value="auto">{t('layoutAuto')}</option><option value="row">{t('layoutRow')}</option><option value="column">{t('layoutColumn')}</option></select>
    {fieldError('defaultLayout') && <p id="layout-error" className="error-text" role="alert">{fieldError('defaultLayout')}</p>}
    <p className="muted">{t('layoutHelp')}</p>
    <hr /><h2>{t('sidebarCoexistence')}</h2><p className="muted">{t('sidebarCoexistenceHelp')}</p>
    <div className="theme-options" role="radiogroup" aria-label={t('sidebarCoexistence')} data-settings-field="sidebarCoexistence" tabIndex={-1} aria-invalid={!!fieldError('sidebarCoexistence') || undefined} aria-describedby={fieldError('sidebarCoexistence') ? 'sidebar-coexistence-error' : undefined}>{(['squeeze', 'overlay'] as const).map(option => <label key={option}><input type="radio" name="sidebarCoexistence" value={option} checked={sidebarCoexistence === option} onChange={() => changeDraft({ sidebarCoexistence: option })} />{t(option === 'squeeze' ? 'sidebarSqueeze' : 'sidebarOverlay')}</label>)}</div>
    {fieldError('sidebarCoexistence') && <p id="sidebar-coexistence-error" className="error-text" role="alert">{fieldError('sidebarCoexistence')}</p>}
    <hr /><h2>{t('detailCoexistence')}</h2><p className="muted">{t('detailCoexistenceHelp')}</p>
    <div className="theme-options" role="radiogroup" aria-label={t('detailCoexistence')} data-settings-field="detailCoexistence" tabIndex={-1} aria-invalid={!!fieldError('detailCoexistence') || undefined} aria-describedby={fieldError('detailCoexistence') ? 'detail-coexistence-error' : undefined}>{(['overlay', 'squeeze'] as const).map(option => <label key={option}><input type="radio" name="detailCoexistence" value={option} checked={detailCoexistence === option} onChange={() => changeDraft({ detailCoexistence: option })} />{t(option === 'squeeze' ? 'sidebarSqueeze' : 'sidebarOverlay')}</label>)}</div>
    {fieldError('detailCoexistence') && <p id="detail-coexistence-error" className="error-text" role="alert">{fieldError('detailCoexistence')}</p>}
  </>;
}
