import assert from 'node:assert/strict';
import test from 'node:test';
import { presentCommentTimeline } from '../app/renderer/forge/comment-timeline';

const comments = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ author: 'kai', createdAt: '2026-01-01T00:00:00Z', html: `${index}` }));
const summarized = (timeline: ReturnType<typeof presentCommentTimeline>) => [
  timeline.shown.map(comment => comment.html),
  timeline.hidden,
  timeline.earlierOnForge,
];

test('a folded timeline shows the latest two comments and counts the rest as hidden', () => {
  const timeline = presentCommentTimeline({ comments: comments(5), commentCount: 5 }, false);
  assert.deepEqual(summarized(timeline), [['3', '4'], 3, 0]);
});

test('an expanded timeline shows every comment read and counts those left on the forge', () => {
  const timeline = presentCommentTimeline({ comments: comments(4), commentCount: 9 }, true);
  assert.deepEqual(summarized(timeline), [['0', '1', '2', '3'], 0, 5]);
});

test('with no more than two comments read nothing folds, so those left on the forge are counted at once', () => {
  const timeline = presentCommentTimeline({ comments: comments(2), commentCount: 7 }, false);
  assert.deepEqual(summarized(timeline), [['0', '1'], 0, 5]);
});

test('a folded timeline leaves the comments on the forge uncounted until it is expanded', () => {
  const timeline = presentCommentTimeline({ comments: comments(3), commentCount: 7 }, false);
  assert.deepEqual(summarized(timeline), [['1', '2'], 1, 0]);
});
