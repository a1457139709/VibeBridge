import type { ForgeComment, IssueDetail } from '../../shared/forge/forge';

export const foldedCommentCount = 2;

export interface CommentTimeline {
  shown: ForgeComment[];
  hidden: number;
  earlierOnForge: number;
}

export function presentCommentTimeline(
  { comments, commentCount }: Pick<IssueDetail, 'comments' | 'commentCount'>,
  expanded: boolean,
): CommentTimeline {
  const hidden = expanded ? 0 : Math.max(0, comments.length - foldedCommentCount);
  return {
    shown: comments.slice(hidden),
    hidden,
    earlierOnForge: hidden ? 0 : Math.max(0, commentCount - comments.length),
  };
}
