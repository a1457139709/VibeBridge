import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, within } from '@testing-library/react';
import type { PullRequestReference } from '../../app/shared/forge/forge';
import { issue as listedIssue, stubSidebarApis } from './support/forge-lists';
import { selectElement } from './support/elements';
import {
  repositoryUrl,
  hoursAgo,
  links,
  detail,
  sidebar,
  pane,
  renderWorkbench,
  openPullRequest,
} from './support/pull-request-detail';
import { t } from './support/localization';

afterEach(cleanup);
before(stubSidebarApis);

test('a pull request row opens its detail: title, state, head into base, the changes on the forge, labels, and the issues it closes', async () => {
  const { user, request } = await openPullRequest(
    detail(12, {
      title: 'Read-only detail',
      head: 'feat/detail',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      closingIssues: [
        { number: 3, title: 'Spec', state: 'open', closedAs: null, url: `${repositoryUrl}/issues/3` },
        {
          number: 8,
          title: 'Elsewhere',
          state: 'closed',
          closedAs: 'completed',
          url: 'https://github.com/octo/other/issues/8',
        },
      ],
    }),
  );
  const doc = within(pane());
  assert.ok(doc.getByText('Open', { selector: '.forge-pill' }));
  assert.match(
    selectElement('.forge-pull-branches', pane()).textContent ?? '',
    /^mona wants to merge feat\/detail into main · 2d ago$/,
  );
  assert.equal(
    doc.getByRole('link', { name: 'View changes on GitHub ↗' }).getAttribute('href'),
    `${repositoryUrl}/pull/12/files`,
  );
  assert.ok(doc.getByText('bug'));
  const closes = doc.getByRole('group', { name: 'Closes on merge' });
  assert.equal(
    within(closes)
      .getByRole('link', { name: /Elsewhere/ })
      .getAttribute('href'),
    'https://github.com/octo/other/issues/8',
    'an issue of another repository opens in the browser',
  );
  await user.click(within(closes).getByRole('button', { name: /Spec/ }));
  const issue = await request(2);
  assert.deepEqual([issue.kind, issue.number], ['issue', 3], 'an issue of the bound repository opens in the sidebar');
  await user.click(within(sidebar()).getByRole('button', { name: 'Back' }));
  await within(pane()).findByRole('heading', { name: 'Read-only detail #12' });
});

test('the body, comments and review summaries follow in time order, reviews with their verdict', async () => {
  await openPullRequest(
    detail(12, {
      title: 'Timeline',
      body: '<p>The body.</p>',
      timeline: [
        { author: 'bob', createdAt: hoursAgo(4), html: '<p>Handle the draft row.</p>', verdict: 'changesRequested' },
        { author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null },
        { author: 'alice', createdAt: hoursAgo(2), html: '<p>LGTM</p>', verdict: 'approved' },
      ],
    }),
  );
  const cards = [...pane().querySelectorAll('.forge-card')].map(card => card.textContent);
  assert.deepEqual(cards, [
    'mona 2d agoThe body.',
    'bob Changes requested 4h agoHandle the draft row.',
    'hubot 3h agoRebased.',
    'alice Approved 2h agoLGTM',
  ]);
  assert.equal(pane().querySelector('.forge-earlier'), null, 'nothing came before the timeline');
  assert.ok(!within(pane()).queryByRole('button', { name: /Approve/ }), 'no approve button');
});

test('a timeline with earlier entries says how many at its top and links the pull request on the forge', async () => {
  await openPullRequest(
    detail(12, {
      body: '<p>The body.</p>',
      earlierEntries: 80,
      timeline: [{ author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null }],
    }),
  );
  const earlier = within(pane()).getByRole('link', { name: t('earlierEntries', { count: 80, forge: 'GitHub' }) });
  assert.equal(earlier.getAttribute('href'), `${repositoryUrl}/pull/12`);
  const [body, comment] = [...pane().querySelectorAll('.forge-card')];
  assert.ok(
    body.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING &&
      earlier.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice sits between the body and the timeline',
  );
});

test('a pull request that closes an issue opens in the sidebar from the issue detail; one of another repository opens in the browser', async () => {
  const pull = (number: number, url: string): PullRequestReference => ({
    number,
    title: `Change ${number}`,
    state: 'open',
    checks: 'passed',
    url,
  });
  const { user, request } = renderWorkbench({
    closingPullRequests: [pull(12, `${repositoryUrl}/pull/12`), pull(40, 'https://github.com/octo/other/pull/40')],
  });
  await user.click(
    await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('button', { name: 'Spec' }),
  );
  const issue = await request(1);
  issue.answer({
    ok: true,
    issue: {
      ...listedIssue(3, { title: 'Spec' }),
      url: `${repositoryUrl}/issues/3`,
      author: 'mona',
      assignees: [],
      body: '',
      comments: [],
      commentCount: 0,
      parent: null,
      subIssues: [],
      subIssueProgress: { closed: 0, total: 0 },
      blockedBy: [],
      blocking: [],
      closingPullRequests: [],
      links,
      canWrite: true,
    },
  });
  const closing = await within(sidebar()).findByRole('region', {
    name: 'Pull requests that close this issue on merge',
  });
  assert.equal(
    within(closing)
      .getByRole('link', { name: /Change 40/ })
      .getAttribute('href'),
    'https://github.com/octo/other/pull/40',
  );
  await user.click(within(closing).getByRole('button', { name: /Change 12/ }));
  const opened = await request(2);
  assert.deepEqual([opened.kind, opened.number], ['pullRequest', 12]);
  opened.answer({ ok: true, pullRequest: detail(12, { title: 'Change 12' }) });
  await within(pane()).findByRole('heading', { name: 'Change 12 #12' });
});

test('a link to a pull request of the bound repository in the body opens it in the sidebar', async () => {
  const { user, request } = await openPullRequest(
    detail(12, { title: 'Linking', body: `<p>Follows <a href="${repositoryUrl}/pull/11">#11</a>.</p>` }),
  );
  await user.click(within(pane()).getByRole('link', { name: '#11' }));
  const next = await request(2);
  assert.deepEqual([next.kind, next.number], ['pullRequest', 11]);
});
