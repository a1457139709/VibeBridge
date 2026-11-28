import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { testForgeCapabilities, testForge, testForgeUrl } from './support/forge';
import { selectElement } from './support/elements';
import { repositoryUrl, hoursAgo, summary, detail, renderWorkbench, pane, row } from './support/issue-detail';
import { alertMessages, detailHeading, forgeSidebar, staleRetry, statusMessages } from './support/sidebar-queries';

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
  assert.deepEqual(statusMessages(pane()), [t('loadingDetail', { number: 7 })]);
  first.answer({
    ok: true,
    issue: detail(7, {
      title: 'Issue detail',
      state: 'closed',
      closedAs: 'completed',
      assignees: ['ada', 'kai'],
      commentCount: 2,
      body: '<p>The body.</p>',
      comments: [
        { author: 'kai', createdAt: hoursAgo(1), html: '<p>Resolution: overlay.</p>' },
        { author: null, createdAt: hoursAgo(1), html: '<p>Ghost.</p>' },
      ],
    }),
  });
  await detailHeading(pane(), 'Issue detail', 7);
  assert.equal(
    selectElement('.forge-pill', pane()).textContent,
    t('stateCompleted'),
    'the state pill names how it was closed',
  );
  const meta = selectElement('.forge-doc-meta', pane());
  assert.equal(selectElement('b', meta).textContent, 'lin');
  assert.equal(selectElement('time', meta).textContent, t('hoursAgo', { count: 3 }));
  for (const part of [t('issueOpened'), t('commentCount', { count: 2 }), t('assigneeList', { names: 'ada, kai' })])
    assert.ok(meta.textContent?.includes(part), part);
  assert.deepEqual(
    within(pane())
      .getAllByRole('article')
      .map(card => [card.querySelector('header > b')?.textContent, card.querySelector('.forge-markdown')?.textContent]),
    [
      ['lin', 'The body.'],
      ['kai', 'Resolution: overlay.'],
      [t('deletedAccount'), 'Ghost.'],
    ],
    'a comment from a deleted account names no one',
  );
  assert.equal(
    within(pane())
      .getByRole('link', { name: t('openOnForge', { forge: testForge.name }) })
      .getAttribute('href'),
    `${repositoryUrl}/issues/7`,
  );
  assert.equal(within(forgeSidebar()).getAllByRole('listitem').length, 2, 'the list stays visible');
  await user.click(within(pane()).getByRole('button', { name: t('closeDetail') }));
  assert.equal(within(forgeSidebar()).queryByRole('region', { name: t('issueDetail') }), null);
});

test('the body and comments pass the HTML filter, same-repository issue links open in the sidebar, and others go to the browser', async () => {
  const linkText = {
      sameRepository: '#3',
      externalDocument: 'the doc',
      script: 'this',
      otherRepository: 'other/repo#3',
    },
    emoji = '🎉';
  const imageLink = (alt: string) => (name: string) => name.startsWith(alt);
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({
    ok: true,
    issue: detail(7, {
      body: `<p onclick="steal()">See <a class="issue-link" href="${testForgeUrl}/Ada/Alpha/issues/3">${linkText.sameRepository}</a>, <a href="https://example.com/doc">${linkText.externalDocument}</a>
      and <a href="javascript:steal()">${linkText.script}</a>.</p><script>steal()</script><style>p { display: none }</style>
      <img src="${testForgeUrl}/shot.png" alt="Screenshot">
      <a href="${testForgeUrl}/linked.png"><img src="${testForgeUrl}/linked.png" alt="Linked"></a>
      <iframe src="https://example.com"></iframe>
      <ul><li><input type="checkbox" checked> done</li></ul><g-emoji alias="tada">${emoji}</g-emoji><form><button>Submit</button></form>`,
      comments: [
        {
          author: 'kai',
          createdAt: hoursAgo(1),
          html: `<p>Merged in <a href="${testForgeUrl}/other/repo/issues/3">${linkText.otherRepository}</a>.</p><img src="x" onerror="steal()">`,
        },
      ],
    }),
  });
  const external = await within(pane()).findByRole('link', { name: linkText.externalDocument });
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
      .find(link => link.textContent === linkText.script)
      ?.getAttribute('href'),
    null,
    'a script link loses its target',
  );
  assert.deepEqual([external.getAttribute('target'), external.getAttribute('rel')], ['_blank', 'noreferrer']);
  assert.equal(
    within(pane())
      .getByRole('link', { name: imageLink('Screenshot') })
      .getAttribute('href'),
    `${testForgeUrl}/shot.png`,
    'an image becomes a link to it',
  );
  assert.equal(
    within(pane())
      .getByRole('link', { name: imageLink('Linked') })
      .getAttribute('href'),
    `${testForgeUrl}/linked.png`,
  );
  assert.equal(pane().querySelector('a a'), null, "an image the forge already links becomes that link's text");
  const checkbox = within(pane()).getByRole<HTMLInputElement>('checkbox');
  assert.ok(checkbox.checked && checkbox.disabled, 'a task list item stays read-only');
  assert.ok(pane().textContent?.includes(emoji));
  assert.equal(
    within(pane()).getByRole('link', { name: linkText.otherRepository }).getAttribute('target'),
    '_blank',
    'another repository opens in the browser',
  );

  await user.click(within(pane()).getByRole('link', { name: linkText.sameRepository }));
  const linked = await request(2);
  assert.equal(linked.number, 3, 'a same-repository issue link opens in the sidebar, whatever the case of its path');
  linked.answer({ ok: true, issue: detail(3, { title: 'Linked issue' }) });
  await detailHeading(pane(), 'Linked issue', 3);
  await user.click(within(pane()).getByRole('button', { name: t('detailBack') }));
  (await request(3)).answer({ ok: true, issue: detail(7) });
  await detailHeading(pane(), 'Issue 7', 7);
  assert.ok(
    within(pane()).getByRole<HTMLButtonElement>('button', { name: t('detailBack') }).disabled,
    'nothing before the first issue',
  );
});

test('an overlaying detail leaves the layout area as it was, and a squeezing one narrows it until it closes', async () => {
  for (const detailCoexistence of ['overlay', 'squeeze'] as const) {
    const { user, request } = renderWorkbench([summary(7)], testForgeCapabilities, { detailCoexistence });
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
    await detailHeading(pane(), 'Issue 7', 7);
    if (detailCoexistence === 'overlay')
      assert.deepEqual(layoutArea(), before, 'overlay changes nothing the layout area lays out by');
    else assert.ok(layoutArea()[0].includes('forge-detail-squeeze'), 'squeeze narrows the layout area');
    await user.click(within(pane()).getByRole('button', { name: t('closeDetail') }));
    await waitFor(() => assert.deepEqual(layoutArea(), before, 'closing the detail restores the layout area'));
    cleanup();
  }
});

test('leaving the lists closes a squeezing detail, and the lists come back without it', async () => {
  const { user, request } = renderWorkbench([summary(7)], testForgeCapabilities, { detailCoexistence: 'squeeze' });
  const squeezed = () => selectElement('.app-body').className.includes('forge-detail-squeeze');
  await user.click(await row('Issue 7'));
  (await request(1)).answer({ ok: true, issue: detail(7) });
  await detailHeading(pane(), 'Issue 7', 7);
  assert.ok(squeezed(), 'the open detail narrows the layout area');
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('changeBinding') }));
  await waitFor(() => assert.ok(!squeezed(), 'the change-binding page shows no detail'));
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('bindingBack') }));
  await row('Issue 7');
  assert.equal(within(forgeSidebar()).queryByRole('region', { name: t('issueDetail') }), null);
  assert.ok(!squeezed(), 'the lists come back without the detail');
});

test('a detail that fails to load says why and Retry asks again', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({
    ok: false,
    failure: { kind: 'transient', detail: 'HTTP 502: Bad Gateway', forge: testForge },
  });
  const loadFailure = () => alertMessages(pane());
  await waitFor(() =>
    assert.deepEqual(loadFailure(), [t('detailLoadFailed', { number: 5, reason: 'HTTP 502: Bad Gateway' })]),
  );
  await user.click(within(pane()).getByRole('button', { name: t('retry') }));
  const again = await request(2);
  assert.equal(again.number, 5);
  again.fail(new Error('Connection reset'));
  await waitFor(() =>
    assert.deepEqual(loadFailure(), [t('detailLoadFailed', { number: 5, reason: 'Connection reset' })]),
  );
});

test('a refresh of a shown detail that fails keeps it showing with a stale notice, and Retry asks again', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: true, issue: detail(5) });
  await detailHeading(pane(), 'Issue 5', 5);
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('refresh') }));
  (await request(2)).answer({
    ok: false,
    failure: { kind: 'transient', detail: 'HTTP 502: Bad Gateway', forge: testForge },
  });
  await waitFor(() => assert.deepEqual(statusMessages(pane()), [t('dataMayBeStale')]));
  assert.ok(await detailHeading(pane(), 'Issue 5', 5), 'the shown detail stays');
  await user.click(staleRetry(pane()));
  (await request(3)).answer({ ok: true, issue: detail(5, { title: 'Renamed' }) });
  await detailHeading(pane(), 'Renamed', 5);
  assert.deepEqual(statusMessages(pane()), [], 'the new answer clears the notice');
});
