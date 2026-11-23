import { SyncIcon } from '@primer/octicons-react';
import { useLocalization } from '../common/Localization';

export function SidebarHead({
  title,
  refresh,
  loading = false,
  changeBinding,
}: {
  title: string;
  refresh?(): void;
  loading?: boolean;
  changeBinding?(): void;
}) {
  const { t } = useLocalization();
  return (
    <header className="forge-sidebar-head">
      <span className="forge-sidebar-repository" role="heading" aria-level={2}>
        {title}
      </span>
      {changeBinding && (
        <button className="forge-head-text" onClick={changeBinding}>
          {t('changeBinding')}
        </button>
      )}
      <button
        className={`forge-head-action forge-refresh ${loading ? 'spinning' : ''}`}
        aria-label={t('refresh')}
        data-hint={t('refresh')}
        aria-busy={loading}
        disabled={loading || !refresh}
        onClick={refresh}
      >
        <SyncIcon size={14} />
      </button>
    </header>
  );
}
