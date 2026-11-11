import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { repositoryItem, type IssueLabel, type PlatformFailure, type RepositoryItem, type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { allowedHtml } from './platform-html';
import { PlatformFailureHelp, platformFailureReason } from './platform-failure';
import { relativeTime } from './list-row-parts';

// Pieces every detail shows the same way, whatever it details.

export type DetailFailure = { ok: false; failure: PlatformFailure } | { ok: false; error: string };

/** Reads a detail from the platform when it opens and on `read()`; only the latest read's answer is shown. */
export function useDetail<Item>(request: () => Promise<{ ok: true; item: Item } | { ok: false; failure: PlatformFailure }>, key: unknown[]) {
  const [state, setState] = useState<{ item?: Item; failure?: DetailFailure; loading: boolean }>({ loading: true });
  const latest = useRef(0);
  const read = () => {
    const current = ++latest.current;
    setState(shown => ({ ...shown, loading: true }));
    request().then(result => result, (error: Error) => ({ ok: false, error: error.message }) as const).then(result => {
      if (current !== latest.current) return;
      setState(result.ok ? { item: result.item, loading: false } : { failure: result, loading: false });
    });
  };
  useEffect(() => { setState({ loading: true }); read(); }, key);
  return { ...state, read };
}

/** Opens links inside the platform's HTML: the bound repository's issues and merge requests in the sidebar, everything else in the system browser. */
export function followLinks(repository: RepositoryReference, open: (item: RepositoryItem) => void) {
  return (event: MouseEvent) => {
    const link = (event.target as Element).closest?.('.platform-html a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href')!;
    const item = repositoryItem(repository, href);
    if (item) open(item); else window.open(href, '_blank');
  };
}

export function CreatedAt({ at }: { at: string }) {
  const { language } = useLocalization();
  const date = new Date(at);
  return <time dateTime={at} title={date.toLocaleString(language)}>{relativeTime(date, language)}</time>;
}

export function PlatformHtml({ html }: { html: string }) {
  return <div className="platform-html" dangerouslySetInnerHTML={{ __html: allowedHtml(html) }} />;
}

export function Labels({ labels }: { labels: IssueLabel[] }) {
  if (!labels.length) return null;
  return <div className="issue-detail-labels">{labels.map(label =>
    <span key={label.name} className="issue-label" style={{ '--label-color': `#${label.color}` } as CSSProperties}>{label.name}</span>)}</div>;
}

export function DetailFailureState({ failure, number, retry }: { failure: DetailFailure; number: number; retry(): void }) {
  const { t, text } = useLocalization();
  if ('error' in failure) return <div className="issue-sidebar-state" role="alert"><p>{text(failure.error)}</p><button onClick={retry}>{t('retry')}</button></div>;
  const { platform } = failure.failure;
  const reason = platformFailureReason(t, failure.failure,
    { unreachable: t('issueUnreachable', { number }), failed: reason => t('listReadFailed', { platform: platform.name, reason }) });
  return <div className="issue-sidebar-state" role="alert"><p>{reason}</p>
    <div className="issue-state-actions"><PlatformFailureHelp failure={failure.failure} /><button onClick={retry}>{t('retry')}</button></div></div>;
}
