import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { platformDescriptions, repositoryItem, sameRepository, type IssueLabel, type PlatformFailure, type RelatedIssue, type RepositoryItem,
  type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { allowedHtml } from './platform-html';
import { ReadFailureState, useLatestRead, type ReadFailure } from './platform-failure';
import { relativeTime } from './list-row-parts';

// Pieces every detail shows the same way, whatever it details.

/** Reads a detail from the platform when it opens and on `read()`; only the latest read's answer is shown. */
export function useDetail<Item>(request: () => Promise<{ ok: true; item: Item } | { ok: false; failure: PlatformFailure }>, key: unknown[]) {
  const [state, setState] = useState<{ item?: Item; failure?: ReadFailure; loading: boolean }>({ loading: true });
  const latestRead = useLatestRead();
  const read = () => {
    setState(shown => ({ ...shown, loading: true }));
    latestRead(request(), result => setState(result.ok ? { item: result.item, loading: false } : { failure: result, loading: false }));
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

/** Opens a related issue: one of the bound repository in the sidebar, any other in the system browser. */
export function openRelatedIssue(repository: RepositoryReference, open: (item: RepositoryItem) => void) {
  return (issue: RelatedIssue) => {
    if (sameRepository(issue.repository, repository)) open({ kind: 'issue', number: issue.number });
    else window.open(issue.url, '_blank');
  };
}

/** A related issue's number, prefixed with its repository's path when that is not the bound repository. */
export const relatedIssueNumber = (issue: RelatedIssue, repository: RepositoryReference) =>
  `${sameRepository(issue.repository, repository) ? '' : issue.repository.path}#${issue.number}`;

/** The bar above a detail: what it shows, a link to it on the platform once read, and the close button. */
export function DetailBar({ label, url, repository, close }: { label: string; url?: string; repository: RepositoryReference; close(): void }) {
  const { t } = useLocalization();
  return <header className="issue-detail-bar">
    <span className="issue-detail-crumb">{label}</span>
    {url && <a href={url} target="_blank" rel="noreferrer">{t('openOnPlatform', { platform: platformDescriptions[repository.platform].name })}</a>}
    <button className="issue-detail-close" aria-label={t('closeDetail')} onClick={close}>×</button>
  </header>;
}

/** One entry of a conversation: who wrote it and when, with `note` between them, above its content. */
export function ConversationCard({ author, at, note, className, children }: { author: string | null; at: string; note?: ReactNode; className?: string; children: ReactNode }) {
  return <article className={className ? `issue-detail-card ${className}` : 'issue-detail-card'}>
    <header>{author && <b>{author}</b>} {note && <>{note} </>}<CreatedAt at={at} /></header>
    {children}
  </article>;
}

/** A body or comment as the platform rendered it. */
export function CommentCard({ author, at, body }: { author: string | null; at: string; body: string }) {
  return <ConversationCard author={author} at={at}><PlatformHtml html={body} /></ConversationCard>;
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

/** Why the issue or merge request with that number could not be read. */
export function DetailFailureState({ failure, number, retry }: { failure: ReadFailure; number: number; retry(): void }) {
  const { t } = useLocalization();
  return <ReadFailureState failure={failure} unreachable={t('itemUnreachable', { number })} retry={retry} />;
}
