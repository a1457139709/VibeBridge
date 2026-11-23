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
  pane,
  listedIssueTitle,
  renderWorkbench,
  openPullRequest,
} from './support/pull-request-detail';
import { githubForge } from './support/forge';
import { t } from './support/localization';
import { forgeSidebar, detailHeading } from './support/sidebar-queries';

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
  assert.equal(selectElement('.forge-pill', pane()).textContent, t('stateOpen'));
  const branches = selectElement('.forge-pull-branches', pane());
  assert.ok(branches.textContent?.includes(t('wantsToMerge', { author: 'mona', head: 'feat/detail', base: 'main' })));
  assert.equal(selectElement('time', branches).textContent, t('daysAgo', { count: 2 }));
  assert.equal(
    doc.getByRole('link', { name: t('viewChanges', { forge: githubForge.name }) }).getAttribute('href'),
    `${repositoryUrl}/pull/12/files`,
  );
  assert.deepEqual(
    [...pane().querySelectorAll('.forge-label')].map(label => label.textContent),
    ['bug'],
  );
  const closes = doc.getByRole('group', { name: t('closesOnMerge') });
  const elsewhere = within(closes).getByRole('link');
  assert.deepEqual(
    [elsewhere.textContent?.includes('Elsewhere'), elsewhere.getAttribute('href')],
    [true, 'https://github.com/octo/other/issues/8'],
    'an issue of another repository opens in the browser',
  );
  const spec = within(closes).getByRole('button', { name: name => name.includes('Spec') });
  await user.click(spec);
  const issue = await request(2);
  assert.deepEqual([issue.kind, issue.number], ['issue', 3], 'an issue of the bound repository opens in the sidebar');
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('detailBack') }));
  await detailHeading(pane(), 'Read-only detail', 12);
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
  const cards = within(pane())
    .getAllByRole('article')
    .map(card => [
      selectElement('header > b', card).textContent,
      card.querySelector('header .forge-checks')?.textContent ?? null,
      selectElement('time', card).textContent,
      selectElement('.forge-markdown', card).textContent,
    ]);
  assert.deepEqual(cards, [
    ['mona', null, t('daysAgo', { count: 2 }), 'The body.'],
    ['bob', t('verdictChangesRequested'), t('hoursAgo', { count: 4 }), 'Handle the draft row.'],
    ['hubot', null, t('hoursAgo', { count: 3 }), 'Rebased.'],
    ['alice', t('verdictApproved'), t('hoursAgo', { count: 2 }), 'LGTM'],
  ]);
  assert.equal(pane().querySelector('.forge-earlier'), null, 'nothing came before the timeline');
  assert.deepEqual(
    within(selectElement('.forge-doc', pane())).getAllByRole('button'),
    within(selectElement('.forge-merge-actions', pane())).getAllByRole('button'),
    'the only buttons in the document are the merge actions, so there is no approve button',
  );
});

test('a timeline with earlier entries says how many at its top and links the pull request on the forge', async () => {
  await openPullRequest(
    detail(12, {
      body: '<p>The body.</p>',
      earlierEntries: 80,
      timeline: [{ author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null }],
    }),
  );
  const earlier = within(pane()).getByRole('link', {
    name: t('earlierEntries', { count: 80, forge: githubForge.name }),
  });
  assert.equal(earlier.getAttribute('href'), `${repositoryUrl}/pull/12`);
  const [body, comment] = within(pane()).getAllByRole('article');
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
    await within(await screen.findByRole('complementary', { name: githubForge.name })).findByRole('button', {
      name: listedIssueTitle,
    }),
  );
  const issue = await request(1);
  issue.answer({
    ok: true,
    issue: {
      ...listedIssue(3, { title: listedIssueTitle }),
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
  const closing = await within(forgeSidebar()).findByRole('region', { name: t('closingPullRequests') });
  const other = within(closing).getByRole('link');
  assert.deepEqual(
    [other.querySelector('.forge-row-number')?.textContent, other.getAttribute('href')],
    ['#40', 'https://github.com/octo/other/pull/40'],
  );
  const same = within(closing).getByRole('button');
  assert.equal(same.querySelector('.forge-row-number')?.textContent, '#12');
  await user.click(same);
  const opened = await request(2);
  assert.deepEqual([opened.kind, opened.number], ['pullRequest', 12]);
  opened.answer({ ok: true, pullRequest: detail(12, { title: 'Change 12' }) });
  await detailHeading(pane(), 'Change 12', 12);
});

test('a link to a pull request of the bound repository in the body opens it in the sidebar', async () => {
  const link = { href: `${repositoryUrl}/pull/11`, text: '#11' };
  const { user, request } = await openPullRequest(
    detail(12, { title: 'Linking', body: `<p>Follows <a href="${link.href}">${link.text}</a>.</p>` }),
  );
  await user.click(within(pane()).getByRole('link', { name: link.text }));
  const next = await request(2);
  assert.deepEqual([next.kind, next.number], ['pullRequest', 11]);
});
