import { useLocalization } from '../common/Localization';
import { languages, type Settings } from '../../shared/model';

export function GeneralSettings({
  language,
  fieldError,
  changeDraft,
}: {
  language: Settings['language'];
  fieldError(field: string): string;
  changeDraft(patch: Partial<Settings>): void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <label htmlFor="interface-language">{t('language')}</label>
      <select
        id="interface-language"
        data-settings-field="language"
        value={language}
        onChange={event => {
          const chosen = languages.find(language => language === event.target.value);
          if (chosen) changeDraft({ language: chosen });
        }}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="zh-CN" lang="zh-CN">
          简体中文
        </option>
      </select>
      <p className="muted">{t('languageHelp')}</p>
      {fieldError('language') && (
        <p className="error-text" role="alert">
          {fieldError('language')}
        </p>
      )}
    </>
  );
}
