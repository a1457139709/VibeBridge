import { useMemo, useState } from 'react';
import { useLocalization } from '../common/Localization';
import type { ForgeComment, IssueDetail } from '../../shared/forge/forge';
import { filterForgeHtml } from '../../shared/forge/forge-html';
import { RelativeTime } from './ForgeDisplay';
import { presentCommentTimeline } from './comment-timeline';

export function IssueComments({
  issue,
  forge,
}: {
  issue: Pick<IssueDetail, 'comments' | 'commentCount' | 'url'>;
  forge: string;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden, earlierOnForge } = presentCommentTimeline(issue, expanded);
  if (!issue.comments.length && !earlierOnForge) return null;
  return (
    <section className="forge-comments" aria-label={t('issueComments')}>
      {!!earlierOnForge && (
        <a className="forge-earlier" href={issue.url} target="_blank" rel="noreferrer">
          {t('earlierEntries', { count: earlierOnForge, forge })}
        </a>
      )}
      {!!hidden && (
        <button className="forge-comments-earlier" onClick={() => setExpanded(true)}>
          {t('showEarlierComments', { count: hidden })}
        </button>
      )}
      {shown.map((comment, index) => (
        <Comment key={hidden + index} comment={comment} />
      ))}
    </section>
  );
}

function Comment({ comment }: { comment: ForgeComment }) {
  const { t } = useLocalization();
  const filtered = useMemo(() => filterForgeHtml(comment.html), [comment.html]);
  return (
    <article className="forge-comment">
      <header>
        <b>{comment.author ?? t('deletedAccount')}</b> <RelativeTime iso={comment.createdAt} />
      </header>
      <div className="forge-markdown" dangerouslySetInnerHTML={{ __html: filtered }} />
    </article>
  );
}
