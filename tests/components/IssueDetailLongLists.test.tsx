import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { testForge } from './support/forge';
import { selectElement } from './support/elements';
import {
  detail,
  hoursAgo,
  pane,
  reference,
  renderWorkbench,
  repositoryUrl,
  row,
  summary,
} from './support/issue-detail';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const comments = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    author: 'kai',
    createdAt: hoursAgo(1),
    html: `<p>Comment ${index}.</p>`,
  }));
const commentTexts = (timeline: HTMLElement) =>
  within(timeline)
    .getAllByRole('article')
    .map(comment => selectElement('.forge-markdown', comment).textContent);

test('the comments show the latest two below the body until the earlier ones are expanded', async () => {
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, { body: '<p>The body.</p>', commentCount: 5, comments: comments(5) }),
  });
  const timeline = await within(pane()).findByRole('region', { name: t('issueComments') });
  assert.deepEqual(commentTexts(timeline), ['Comment 3.', 'Comment 4.']);
  const [body] = within(pane()).getAllByRole('article');
  assert.equal(selectElement('.forge-markdown', body).textContent, 'The body.');
  assert.ok(body.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING, 'the comments follow the body');
  await user.click(within(timeline).getByRole('button', { name: t('showEarlierComments', { count: 3 }) }));
  await waitFor(() => assert.equal(within(timeline).getAllByRole('article').length, 5));
  assert.deepEqual(commentTexts(timeline), ['Comment 0.', 'Comment 1.', 'Comment 2.', 'Comment 3.', 'Comment 4.']);
  assert.equal(within(timeline).queryByRole('button', { name: t('showEarlierComments', { count: 3 }) }), null);
  assert.equal(within(timeline).queryByRole('link'), null, 'every comment was read, so nothing waits on the forge');
});

test('an issue with more comments than read links the earlier ones on the forge at the top of the expanded comments', async () => {
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, { body: '<p>The body.</p>', commentCount: 120, comments: comments(100) }),
  });
  const timeline = await within(pane()).findByRole('region', { name: t('issueComments') });
  const earlierName = t('earlierEntries', { count: 20, forge: testForge.name });
  assert.equal(within(timeline).queryByRole('link', { name: earlierName }), null, 'folded comments hide the link');
  await user.click(within(timeline).getByRole('button', { name: t('showEarlierComments', { count: 98 }) }));
  const earlier = await within(timeline).findByRole('link', { name: earlierName });
  assert.equal(earlier.getAttribute('href'), `${repositoryUrl}/issues/7`);
  const [first] = within(timeline).getAllByRole('article');
  assert.equal(selectElement('.forge-markdown', first).textContent, 'Comment 0.');
  assert.ok(
    earlier.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the link sits above the first comment',
  );
});

test("an issue with more sub-issues than listed shows the forge's progress and links the rest on the forge", async () => {
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, {
      subIssues: Array.from({ length: 50 }, (_, index) => reference(100 + index)),
      subIssueProgress: { closed: 3, total: 55 },
    }),
  });
  const subIssues = await within(pane()).findByRole('region', { name: t('subIssues') });
  assert.ok(within(subIssues).getByRole('img', { name: t('subIssueProgress', { closed: 3, total: 55 }) }));
  const more = within(subIssues).getByRole('link', { name: t('moreSubIssues', { count: 5, forge: testForge.name }) });
  assert.equal(more.getAttribute('href'), `${repositoryUrl}/issues/7`);
});
