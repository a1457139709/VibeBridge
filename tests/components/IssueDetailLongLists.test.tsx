import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { githubForge } from './support/forge';
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

test('an issue with more comments than listed says how many came earlier at the top of the comments and links the issue on the forge', async () => {
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, {
      body: '<p>The body.</p>',
      commentCount: 120,
      comments: Array.from({ length: 100 }, (_, index) => ({
        author: 'hubot',
        createdAt: hoursAgo(1),
        html: `<p>Comment ${index}.</p>`,
      })),
    }),
  });
  const earlier = await within(pane()).findByRole('link', {
    name: t('earlierEntries', { count: 20, forge: githubForge.name }),
  });
  assert.equal(earlier.getAttribute('href'), `${repositoryUrl}/issues/7`);
  const [body, comment] = within(pane()).getAllByRole('article');
  assert.ok(
    body.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING &&
      earlier.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice sits between the body and the first comment',
  );
});

test("an issue with more sub-issues than listed shows GitHub's progress and links the rest on the forge", async () => {
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
  const more = within(subIssues).getByRole('link', { name: t('moreSubIssues', { count: 5, forge: githubForge.name }) });
  assert.equal(more.getAttribute('href'), `${repositoryUrl}/issues/7`);
});
