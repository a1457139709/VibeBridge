import './support/dom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { localize } from '../../app/shared/localization/localization';
import { githubForge, githubRepository } from './support/forge';
import type { RepositoryChoices } from '../../app/shared/forge/forge';
import {
  bug,
  failed,
  issue,
  openNoFilter,
  page,
  refresh,
  renderWorkbench,
  rows,
  sidebar,
  stubSidebarApis,
} from './support/forge-lists';

const { t } = localize('en');

afterEach(cleanup);
before(stubSidebarApis);

test('the issue list shows one page of rows with their state, number, age and labels, and Load more appends the next page', async () => {
  const { user, request } = renderWorkbench();
  const first = await request(1);
  assert.deepEqual(first, { ...first, projectId: 'alpha', query: { filter: openNoFilter, cursor: null } });
  first.answer(page([issue(9, { labels: [bug] }), issue(8)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8']));
  const row = within(sidebar()).getAllByRole('listitem')[0];
  assert.ok(within(row).getByText('#9'));
  assert.ok(within(row).getByText('3h ago'));
  assert.ok(within(row).getByText('bug'));
  assert.ok(within(row).getByLabelText('Open issue'), 'the state icon names the state');
  assert.ok(row.querySelector('.forge-row-action'), 'the row keeps room for dispatch');
  assert.ok(within(sidebar()).getByRole('button', { name: 'Open 7' }));
  assert.ok(within(sidebar()).getByRole('button', { name: 'Closed 2' }));
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(2);
  assert.deepEqual(more.query, { filter: openNoFilter, cursor: 'next' });
  more.answer(page([issue(7, { state: 'closed', closedAs: 'notPlanned' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8', 'Issue 7']));
  assert.ok(within(sidebar()).getByLabelText('Closed as not planned'));
  assert.equal(within(sidebar()).queryByRole('button', { name: 'Load more' }), null, 'the last page offers no more');
});

test('Refresh is unavailable and shows progress while a request runs, and reloads the first page', async () => {
  const { user, request } = renderWorkbench();
  const first = await request(1);
  assert.ok(refresh().hasAttribute('disabled'));
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  first.answer(page([issue(1)], 'next'));
  await waitFor(() => assert.ok(!refresh().hasAttribute('disabled')));
  await user.click(refresh());
  const again = await request(2);
  assert.deepEqual(again.query, { filter: openNoFilter, cursor: null });
  assert.ok(refresh().hasAttribute('disabled'));
  again.answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2']));
});

test('a missing forge CLI fills the sidebar with install instructions, and Retry refreshes', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('notInstalled'));
  const link = await within(sidebar()).findByRole('link', { name: 'Install instructions ↗' });
  assert.equal(link.getAttribute('href'), 'https://cli.github.com');
  assert.ok(within(sidebar()).getByText('Could not find gh. Install it to use the sidebar.'));
  assert.equal(
    within(sidebar()).queryByRole('tab', { name: 'Issues' }),
    null,
    'the state takes the whole content area',
  );
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
});

test('a logged-out forge CLI offers to copy the login command and Retry', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('loggedOut', 'HTTP 401: Bad credentials'));
  await user.click(await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' }));
  assert.equal(await navigator.clipboard.readText(), 'gh auth login');
  assert.ok(within(sidebar()).getByText('gh is not logged in, or its login expired.'));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  await request(2);
});

test('an inaccessible repository names the account and offers Retry and Change binding, which opens the change-binding page', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('inaccessible', 'GraphQL: Could not resolve to a Repository', 'octo'));
  await waitFor(() =>
    assert.ok(
      within(sidebar()).getByText(
        'Cannot access octo/alpha: it does not exist, or the gh account octo has no access to it.',
      ),
    ),
  );
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(failed('inaccessible', 'GraphQL: Could not resolve to a Repository', null));
  await waitFor(() =>
    assert.ok(
      within(sidebar()).getByText(
        'Cannot access octo/alpha: it does not exist, or the active gh account has no access to it.',
      ),
    ),
  );
  await user.click(
    within(sidebar())
      .getAllByRole('button', { name: 'Change binding' })
      .find(button => !button.closest('header'))!,
  );
  const search = await within(sidebar()).findByRole('searchbox', { name: 'Search repositories' });
  await waitFor(() =>
    assert.equal(document.activeElement, search, 'the change-binding page opens with focus in its search'),
  );
});

/** The bound project alpha's sidebar on its change-binding page, with octo/alpha listed and octo/renamed the origin;
 * binding and unbinding record their calls and take effect. */
async function changeBindingPage(choices?: () => Promise<RepositoryChoices>) {
  const calls: unknown[] = [];
  const rendered = renderWorkbench(undefined, {
    fetchRepositoryChoices:
      choices ??
      (async () => ({
        ok: true,
        forge: githubForge,
        account: 'octo',
        origin: githubRepository('octo/renamed'),
        repositories: ['octo/alpha', 'octo/renamed'].map(path => githubRepository(path)),
      })),
    bindRepository: async (id, repository) => {
      calls.push(['bind', id, repository]);
      rendered.snapshot.projects[0].repository = repository;
      rendered.publish();
    },
    unbindRepository: async id => {
      calls.push(['unbind', id]);
      rendered.snapshot.projects[0].repository = null;
      rendered.publish();
    },
  });
  (await rendered.request(1)).answer(page([issue(1)]));
  await rendered.user.click(within(sidebar().querySelector('header')!).getByRole('button', { name: 'Change binding' }));
  await within(sidebar()).findByRole('button', { name: '← Back' });
  return { ...rendered, calls };
}

test('Change binding turns the sidebar to its change-binding page, and ← Back returns to the lists with focus in the sidebar', async () => {
  const { user, request } = await changeBindingPage();
  assert.equal(screen.queryByRole('dialog'), null, 'no dialog opens');
  assert.equal(within(sidebar()).getByText('Currently bound:').querySelector('b')?.textContent, 'octo/alpha');
  const options = await within(sidebar()).findAllByRole('option');
  assert.deepEqual(
    options.map(option => option.textContent),
    ['octo/renamedorigin', 'octo/alphacurrent'],
    'origin first, and the current binding marked',
  );
  await user.click(within(sidebar()).getByRole('button', { name: '← Back' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await waitFor(() => assert.ok(sidebar().contains(document.activeElement), 'focus stays in the sidebar'));
});

test('picking another repository states what rebinding does, and Rebind to Y rebinds at once and returns to the lists', async () => {
  const { user, calls, request } = await changeBindingPage();
  assert.equal((within(sidebar()).getByRole('button', { name: 'Rebind' }) as HTMLButtonElement).disabled, true);
  await user.click(await within(sidebar()).findByRole('option', { name: /octo\/renamed/ }));
  assert.ok(
    within(sidebar()).getByText(
      'Rebinding to octo/renamed: Dispatch records for the old repository are hidden but kept, and show again if you switch back.',
    ),
  );
  await user.click(within(sidebar()).getByRole('button', { name: 'Rebind to octo/renamed' }));
  assert.deepEqual(calls, [['bind', 'alpha', githubRepository('octo/renamed')]]);
  const next = await request(2);
  assert.equal(next.projectId, 'alpha');
  await waitFor(() => assert.ok(within(sidebar()).getByText('octo/renamed', { selector: 'header *' })));
});

test('a bound repository the forge lists at a new path is listed once, there, as the current one, and Rebind stays unavailable', async () => {
  await changeBindingPage(async () => ({
    ok: true,
    forge: githubForge,
    account: 'octo',
    origin: githubRepository('octo/renamed'),
    repositories: [
      githubRepository('octo/alpha-x', githubRepository('octo/alpha').id),
      githubRepository('octo/renamed'),
    ],
  }));
  const options = await within(sidebar()).findAllByRole('option');
  assert.deepEqual(
    options.map(option => option.textContent),
    ['octo/renamedorigin', 'octo/alpha-xcurrent'],
  );
  assert.equal((within(sidebar()).getByRole('button', { name: 'Rebind' }) as HTMLButtonElement).disabled, true);
});

test('a binding changed elsewhere while the change-binding page shows returns the sidebar to the lists', async () => {
  const { snapshot, publish, request } = await changeBindingPage();
  snapshot.projects[0].repository = githubRepository('octo/renamed');
  publish();
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  assert.equal(within(sidebar()).queryByRole('button', { name: '← Back' }), null);
});

test('Unbind states what unbinding does before its own Unbind carries it out, Cancel steps back, and it works without gh', async () => {
  const { user, calls } = await changeBindingPage(async () => ({
    ok: false,
    failure: { kind: 'notInstalled', detail: '', forge: githubForge },
  }));
  await within(sidebar()).findByText('Could not find gh; install it to bind a repository.');
  await user.click(within(sidebar()).getByRole('button', { name: 'Unbind' }));
  const consequence = 'Unbinding: Dispatch records are kept; the sidebar shows the project as unbound.';
  assert.ok(within(sidebar()).getByText(consequence));
  const cancel = within(sidebar()).getByRole('button', { name: 'Cancel' });
  await waitFor(() => assert.equal(document.activeElement, cancel, 'focus moves to Cancel'));
  await user.click(cancel);
  assert.equal(within(sidebar()).queryByText(consequence), null);
  const unbind = within(sidebar()).getByRole('button', { name: 'Unbind' });
  await waitFor(() => assert.equal(document.activeElement, unbind, 'focus returns to Unbind'));
  assert.deepEqual(calls, []);
  await user.click(within(sidebar()).getByRole('button', { name: 'Unbind' }));
  await user.click(within(sidebar()).getByRole('button', { name: 'Unbind' }));
  assert.deepEqual(calls, [['unbind', 'alpha']]);
  await waitFor(() => assert.ok(within(sidebar()).getByText('No repository bound')));
});

test('a transient failure keeps the rows under a stale notice, and fills the sidebar when there were none', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('transient', 'HTTP 502: Bad Gateway'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Could not load issues: HTTP 502: Bad Gateway')));
  assert.equal(within(sidebar()).queryByRole('tab', { name: 'Issues' }), null);
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.click(refresh());
  (await request(3)).answer(failed('transient', 'API rate limit exceeded'));
  const stale = await within(sidebar()).findByText('Data may be stale');
  assert.deepEqual(rows(), ['Issue 1'], 'the old rows stay');
  await user.click(within(stale.parentElement!).getByRole('button', { name: 'Retry' }));
  (await request(4)).answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2']));
  assert.equal(within(sidebar()).queryByText('Data may be stale'), null);
});

test('Load more pages the filter of the rows shown, even while a new search is still settling', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(9)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9']));
  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search issues' }), 'x');
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(2);
  assert.deepEqual(more.query, { filter: openNoFilter, cursor: 'next' });
  more.answer(page([issue(8)]));
  const searched = await request(3);
  assert.deepEqual(searched.query, { filter: { search: 'x', state: 'open', labels: [] }, cursor: null });
  searched.answer(page([issue(5)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 5']));
});

test('a request that fails outside the forge fills the sidebar with its reason and Retry', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).fail(new Error('No repository bound'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Could not load issues: No repository bound')));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
});

test('the current issue row is the one highlight: strong while the list has focus, faint once it does not, and its title has no focus ring', async () => {
  const style = document.createElement('style');
  style.textContent = ['app/renderer/style.css', 'app/renderer/forge/forge-sidebar.css']
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
  document.head.append(style);
  try {
    const { user, request } = renderWorkbench(undefined, { issueDetail: () => new Promise(() => {}) });
    (await request(1)).answer(page([issue(9), issue(8)]));
    await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8']));
    const title = (name: string) => within(sidebar()).getByRole('button', { name });
    const highlight = (name: string) => window.getComputedStyle(title(name).closest('.forge-row')!).boxShadow;
    const unhighlighted = highlight('Issue 8');
    title('Issue 9').focus();
    assert.equal(window.getComputedStyle(title('Issue 9')).outline, 'none', 'the title draws no focus ring of its own');
    const strong = highlight('Issue 9');
    assert.notEqual(strong, unhighlighted, 'the row focus is on is highlighted');
    await user.click(title('Issue 9'));
    await waitFor(() => assert.ok(!sidebar().querySelector('.forge-rows')?.contains(document.activeElement)));
    const faint = highlight('Issue 9');
    assert.notEqual(faint, unhighlighted, "the open issue's row stays highlighted once focus leaves the list");
    assert.notEqual(faint, strong, 'and its highlight fades');
  } finally {
    style.remove();
  }
});
