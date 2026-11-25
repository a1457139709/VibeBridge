import { useId } from 'react';
import { useLocalization } from '../common/Localization';

export function StaleNotice({ detail, retry, disabled }: { detail: string; retry(): void; disabled?: boolean }) {
  const { t } = useLocalization();
  const notice = useId();
  return (
    <div className="forge-stale" title={detail}>
      <span id={notice} role="status">
        {t('dataMayBeStale')}
      </span>
      <button onClick={retry} disabled={disabled} aria-describedby={notice}>
        {t('retry')}
      </button>
    </div>
  );
}
