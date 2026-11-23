import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { githubCapabilities, githubForge } from './support/forge';
import { selectElement } from './support/elements';
import {
  repositoryUrl,
  hoursAgo,
  summary,
  reference,
  detail,
  renderWorkbench,
  sidebar,
  pane,
  row,
  heading,
} from './support/issue-detail';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

test('clicking a row opens its detail beside the list, with the author, comment count and assignees, and closing it returns to the list alone', async () => {
  const { user, request } = renderWorkbench([summary(7, { title: 'Issue detail' }), summary(6)]);
  await user.click(await row('Issue detail'));
  const first = await request(1);
  assert.equal(first.number, 7);
  assert.equal(selectElement('.forge-empty', pane()).textContent, t('loadingDetail', { number: 7 }));
  first.answer({
    ok: true,
    issue: detail(7, {
      title: 'Issue detail',
      state: 'closed',
      closedAs: 'completed',
      assignees: ['octo', 'hubot'],
      commentCount: 2,
      body: '<p>The body.</p>',
      comments: [
        { author: 'hubot', createdAt: hoursAgo(1), html: '<p>Resolution: overlay.</p>' },
        { author: null, createdAt: hoursAgo(1), html: '<p>Ghost.</p>' },
      ],
    }),
  });
  await heading('Issue detail', 7);
  assert.equal(
    selectElement('.forge-pill', pane()).textContent,
    t('stateCompleted'),
    'the state pill names how it was closed',
  );
  assert.equal(
    selectElement('.forge-doc-meta', pane()).textContent,
    `mona ${t('issueOpened')} ${t('hoursAgo', { count: 3 })} · ${t('commentCount', { count: 2 })} · ${t('assigneeList', { names: 'octo, hubot' })}`,
  );
  assert.deepEqual(
    [...pane().querySelectorAll('.forge-card')].map(card => [
      card.querySelector('header > b')?.textContent,
      card.querySelector('.forge-markdown')?.textContent,
    ]),
    [
      ['mona', 'The body.'],
      ['hubot', 'Resolution: overlay.'],
      [t('deletedAccount'), 'Ghost.'],
    ],
    'a comment from a deleted account names no one',
  );
  assert.equal(
    within(pane())
      .getByRole('link', { name: t('openOnForge', { forge: githubForge.name }) })
      .getAttribute('href'),
    `${repositoryUrl}/issues/7`,
  );
  assert.equal(within(sidebar()).getAllByRole('listitem').length, 2, 'the list stays visible');
  await user.click(within(pane()).getByRole('button', { name: t('closeDetail') }));
  assert.equal(within(sidebar()).queryByRole('region', { name: t('issueDetail') }), null);
});

test('the body and comments pass the HTML filter, same-repository issue links open in the sidebar, and others go to the browser', async () => {
  const sameRepository = '#3',
    externalDocument = 'the doc',
    scriptLink = 'this',
    otherRepository = 'other/repo#3',
    emoji = '🎉';
  const imageLink = (alt: string) => `${alt} ↗`;
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, {
      body: `<p onclick="steal()">See <a class="issue-link" href="https://github.com/Octo/Alpha/issues/3">${sameRepository}</a>, <a href="https://example.com/doc">${externalDocument}</a>
      and <a href="javascript:steal()">${scriptLink}</a>.</p><script>steal()</script><style>p { display: none }</style>
      <img src="https://user-images.githubusercontent.com/shot.png" alt="Screenshot">
      <a href="https://user-images.githubusercontent.com/linked.png"><img src="https://user-images.githubusercontent.com/linked.png" alt="Linked"></a>
      <iframe src="https://example.com"></iframe>
      <ul><li><input type="checkbox" checked> done</li></ul><g-emoji alias="tada">${emoji}</g-emoji><form><button>Submit</button></form>`,
      comments: [
        {
          author: 'hubot',
          createdAt: hoursAgo(1),
          html: `<p>Merged in <a href="https://github.com/other/repo/issues/3">${otherRepository}</a>.</p><img src="x" onerror="steal()">`,
        },
      ],
    }),
  });
  const external = await within(pane()).findByRole('link', { name: externalDocument });
  const html = pane().innerHTML;
  for (const unsafe of [
    '<script',
    'steal()',
    '<style',
    '<iframe',
    '<img',
    '<form',
    '<button>Submit',
    'onclick',
    'onerror',
    'class="issue-link"',
  ]) {
    assert.ok(!html.includes(unsafe), `filtered out: ${unsafe}`);
  }
  assert.equal(external.parentElement?.tagName, 'P');
  assert.equal(
    [...pane().querySelectorAll('.forge-markdown a')]
      .find(link => link.textContent === scriptLink)
      ?.getAttribute('href'),
    null,
    'a script link loses its target',
  );
  assert.deepEqual([external.getAttribute('target'), external.getAttribute('rel')], ['_blank', 'noreferrer']);
  assert.equal(
    within(pane())
      .getByRole('link', { name: imageLink('Screenshot') })
      .getAttribute('href'),
    'https://user-images.githubusercontent.com/shot.png',
    'an image becomes a link to it',
  );
  assert.equal(
    within(pane())
      .getByRole('link', { name: imageLink('Linked') })
      .getAttribute('href'),
    'https://user-images.githubusercontent.com/linked.png',
  );
  assert.equal(pane().querySelector('a a'), null, "an image the forge already links becomes that link's text");
  const checkbox = within(pane()).getByRole<HTMLInputElement>('checkbox');
  assert.ok(checkbox.checked && checkbox.disabled, 'a task list item stays read-only');
  assert.ok(pane().textContent?.includes(emoji));
  assert.equal(
    within(pane()).getByRole('link', { name: otherRepository }).getAttribute('target'),
    '_blank',
    'another repository opens in the browser',
  );

  await user.click(within(pane()).getByRole('link', { name: sameRepository }));
  const linked = await request(2);
  assert.equal(linked.number, 3, 'a same-repository issue link opens in the sidebar, whatever the case of its path');
  linked.answer({ ok: true, issue: detail(3, { title: 'Linked issue' }) });
  await heading('Linked issue', 3);
  await user.click(within(pane()).getByRole('button', { name: t('detailBack') }));
  (await request(3)).answer({ ok: true, issue: detail(7) });
  await heading('Issue 7', 7);
  assert.ok(
    within(pane()).getByRole<HTMLButtonElement>('button', { name: t('detailBack') }).disabled,
    'nothing before the first issue',
  );
});

test('the relation graph draws open blockers and the open issues this one blocks, with the parent above and the sub-issues below', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({
    ok: true,
    issue: detail(5, {
      title: 'Detail',
      parent: { ...reference(1, { title: 'Spec' }), progress: { closed: 1, total: 3 } },
      blockedBy: [
        reference(2, { title: 'Open blocker' }),
        reference(3, { title: 'Closed blocker', state: 'closed', closedAs: 'completed' }),
      ],
      blocking: [reference(8, { title: 'Waits on detail' })],
      subIssues: [
        reference(6, { title: 'First part', state: 'closed', closedAs: 'completed' }),
        reference(9, { title: 'Second part' }),
      ],
      subIssueProgress: { closed: 1, total: 2 },
    }),
  });
  const graph = await within(pane()).findByRole('group', { name: t('relations') });
  const column = (name: string) =>
    [...graph.querySelectorAll(`.forge-node[data-relation="${name}"]`)].map(node => node.textContent);
  assert.deepEqual(column('blockedBy'), ['#2Open blocker'], 'only open blockers are drawn');
  assert.deepEqual(column('self'), ['#5Detail']);
  assert.deepEqual(column('blocking'), ['#8Waits on detail']);
  assert.deepEqual([...graph.querySelectorAll('path.forge-edge')].length, 2, 'one edge per blocking relation');
  assert.equal(
    selectElement('button.forge-parent', pane()).textContent,
    'Spec#11/3',
    'the parent shows above, with its sub-issue progress',
  );
  assert.ok(
    within(pane()).getByRole('img', { name: t('blockedBy', { issues: '#2' }) }),
    'the head shows the open blockers',
  );
  const subIssues = within(pane()).getByRole('region', { name: t('subIssues') });
  assert.equal(
    selectElement('.forge-progress', subIssues).textContent,
    '1/2',
    'the sub-issue progress counts closed ones',
  );
  assert.deepEqual(
    within(subIssues)
      .getAllByRole('button')
      .map(button => button.textContent),
    ['First part#6', 'Second part#9'],
  );

  await user.click(selectElement('button[data-relation="blockedBy"]', graph));
  assert.equal((await request(2)).number, 2, 'a node opens its issue in the sidebar');
});

test('a closed issue draws no issues it blocks, and an issue with no live relations draws no graph', async () => {
  const { user, request } = renderWorkbench([summary(5), summary(4)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({
    ok: true,
    issue: detail(5, {
      state: 'closed',
      closedAs: 'completed',
      blocking: [reference(8)],
      blockedBy: [reference(3, { state: 'closed', closedAs: 'completed' })],
    }),
  });
  await heading('Issue 5', 5);
  assert.equal(within(pane()).queryByRole('group', { name: t('relations') }), null);
});

test('relations a forge does not declare are not shown', async () => {
  const { user, request } = renderWorkbench([summary(5)], { ...githubCapabilities, subIssues: false, blocking: false });
  await user.click(await row('Issue 5'));
  (await request(1)).answer({
    ok: true,
    issue: detail(5, {
      parent: { ...reference(1, { title: 'Spec' }), progress: { closed: 0, total: 1 } },
      blockedBy: [reference(2)],
      subIssues: [reference(6)],
    }),
  });
  await heading('Issue 5', 5);
  assert.equal(within(pane()).queryByRole('group', { name: t('relations') }), null);
  assert.equal(within(pane()).queryByRole('region', { name: t('subIssues') }), null);
  assert.equal(pane().querySelector('.forge-parent'), null);
});

test('the pull requests that close the issue on merge sit in their own block, closed ones included, each with its checks conclusion', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  const pull = (
    number: number,
    title: string,
    state: 'open' | 'draft' | 'merged' | 'closed',
    checks: 'passed' | 'failed' | 'pending' | 'none',
  ) => ({ number, title, state, checks, url: `${repositoryUrl}/pull/${number}` });
  (await request(1)).answer({
    ok: true,
    issue: detail(5, {
      closingPullRequests: [
        pull(40, 'Passing', 'open', 'passed'),
        pull(41, 'Running', 'draft', 'pending'),
        pull(42, 'Failing', 'open', 'failed'),
        pull(43, 'Merged', 'merged', 'passed'),
        pull(44, 'Abandoned', 'closed', 'failed'),
        pull(45, 'Unchecked', 'open', 'none'),
      ],
    }),
  });
  const block = await within(pane()).findByRole('region', { name: t('closingPullRequests') });
  const items = within(block).getAllByRole('listitem');
  assert.deepEqual(
    items.map(item => item.textContent),
    [
      `#40Passing✓ ${t('checksPassed')}`,
      `#41Running● ${t('checksPending')}`,
      `#42Failing✗ ${t('checksFailed')}`,
      '#43Merged',
      '#44Abandoned',
      '#45Unchecked',
    ],
  );
  assert.equal(
    items.filter(item => within(item).queryByRole('button')).length,
    6,
    'each, of the bound repository, opens in the sidebar',
  );
  assert.deepEqual(
    items.map(item => within(item).getByRole('img').getAttribute('aria-label')),
    [
      t('pullRequestOpen'),
      t('pullRequestDraft'),
      t('pullRequestOpen'),
      t('pullRequestMerged'),
      t('pullRequestClosed'),
      t('pullRequestOpen'),
    ],
  );
  assert.equal(
    within(pane()).queryByRole('group', { name: t('relations') }),
    null,
    'pull requests stay out of the issue graph',
  );
});

test('an overlaying detail leaves the layout area as it was, and a squeezing one narrows it until it closes', async () => {
  for (const detailCoexistence of ['overlay', 'squeeze'] as const) {
    const { user, request } = renderWorkbench([summary(7)], githubCapabilities, { detailCoexistence });
    const layoutArea = () => {
      const body = selectElement('.app-body');
      return [
        body.className,
        ...['--navigation-width', '--forge-sidebar-width'].map(name => body.style.getPropertyValue(name)),
      ];
    };
    const issue = await row('Issue 7');
    const before = layoutArea();
    await user.click(issue);
    (await request(1)).answer({ ok: true, issue: detail(7) });
    await heading('Issue 7', 7);
    if (detailCoexistence === 'overlay')
      assert.deepEqual(layoutArea(), before, 'overlay changes nothing the layout area lays out by');
    else assert.ok(layoutArea()[0].includes('forge-detail-squeeze'), 'squeeze narrows the layout area');
    await user.click(within(pane()).getByRole('button', { name: t('closeDetail') }));
    await waitFor(() => assert.deepEqual(layoutArea(), before, 'closing the detail restores the layout area'));
    cleanup();
  }
});

test('a detail that fails to load says why and Retry asks again', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({
    ok: false,
    failure: { kind: 'transient', detail: 'HTTP 502: Bad Gateway', forge: githubForge },
  });
  const loadFailure = () => selectElement('.forge-sidebar-state > p', pane()).textContent;
  await waitFor(() =>
    assert.equal(loadFailure(), t('detailLoadFailed', { number: 5, reason: 'HTTP 502: Bad Gateway' })),
  );
  await user.click(within(pane()).getByRole('button', { name: t('retry') }));
  const again = await request(2);
  assert.equal(again.number, 5);
  again.fail(new Error('Connection reset'));
  await waitFor(() => assert.equal(loadFailure(), t('detailLoadFailed', { number: 5, reason: 'Connection reset' })));
});

test('a refresh of a shown detail that fails keeps it showing with a stale notice, and Retry asks again', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: true, issue: detail(5) });
  await heading('Issue 5', 5);
  await user.click(within(sidebar()).getByRole('button', { name: t('refresh') }));
  (await request(2)).answer({
    ok: false,
    failure: { kind: 'transient', detail: 'HTTP 502: Bad Gateway', forge: githubForge },
  });
  const staleNotice = () => pane().querySelector('.forge-stale > span')?.textContent ?? null;
  await waitFor(() => assert.equal(staleNotice(), t('dataMayBeStale')));
  assert.ok(await heading('Issue 5', 5), 'the shown detail stays');
  await user.click(within(pane()).getByRole('button', { name: t('retry') }));
  (await request(3)).answer({ ok: true, issue: detail(5, { title: 'Renamed' }) });
  await heading('Renamed', 5);
  assert.equal(staleNotice(), null, 'the new answer clears the notice');
});
