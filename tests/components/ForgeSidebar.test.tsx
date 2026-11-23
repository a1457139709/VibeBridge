import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { RepositoryChoices, RepositoryReference } from '../../app/shared/forge/forge';
import { nestedMessage, message } from '../../app/shared/messages';
import { stubLayoutApis } from './support/no-layout';
import { githubForge, githubRepository } from './support/forge';
import { requireValue } from '../../app/renderer/common/required';
import { requireInstance, selectElement } from './support/elements';
import { t } from './support/localization';
import {
  bindButton,
  boundProject,
  hideSidebar,
  openedSidebar,
  renderWorkbench,
  showSidebar,
  shownSidebar,
  toggle,
  unboundProject,
} from './support/forge-sidebar';
import {
  alertMessages,
  currentlyBoundPath,
  queryForgeSidebar,
  repositoryOption,
  repositoryTitle,
} from './support/sidebar-queries';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

test('the button at the right end of the system bar opens the sidebar for the current project, with focus inside, and closes it', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: showSidebar });
  assert.equal(toggle().getAttribute('aria-label'), showSidebar, 'the toggle is the last item of the system bar');
  assert.equal(toggle().textContent, '', 'the toggle shows no count');
  assert.equal(queryForgeSidebar(), null);
  await user.click(toggle());
  const opened = openedSidebar();
  assert.equal(repositoryTitle(), 'octo/bound');
  assert.ok(opened.contains(document.activeElement), 'focus moves into the sidebar');
  assert.equal(toggle().getAttribute('aria-label'), hideSidebar);
  await user.click(toggle());
  assert.equal(queryForgeSidebar(), null);
  assert.deepEqual(saved, [
    { visible: true, width: 380 },
    { visible: false, width: 380 },
  ]);
});

test('Command+Alt+B opens the sidebar with focus inside wherever focus is, and closes it when open', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: showSidebar });
  selectElement('.xterm-helper-textarea').focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.ok(openedSidebar().contains(document.activeElement));
  selectElement('.xterm-helper-textarea').focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.equal(queryForgeSidebar(), null);
  await waitFor(() =>
    assert.deepEqual(saved, [
      { visible: true, width: 380 },
      { visible: false, width: 380 },
    ]),
  );
});

const drawnWidth = (region: 'navigation' | 'forge-sidebar') =>
  selectElement('.app-body').style.getPropertyValue(`--${region}-width`);
function resizeWindow(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  act(() => void window.dispatchEvent(new Event('resize')));
}

test('the sidebar follows the current project and stays on the settings page', async () => {
  const { user } = renderWorkbench({ visible: true, width: 420 });
  await shownSidebar();
  assert.equal(repositoryTitle(), 'octo/bound');
  assert.equal(drawnWidth('forge-sidebar'), '420px');
  await user.click(screen.getByRole('button', { name: unboundProject }));
  await waitFor(() => assert.equal(repositoryTitle(), t('noRepositoryBound')));
  assert.ok(!openedSidebar().textContent?.includes('octo/bound'));
  await user.click(screen.getByRole('button', { name: t('settings') }));
  await screen.findByRole('button', { name: t('back') });
  assert.equal(repositoryTitle(), t('noRepositoryBound'));
});

test('a narrower window draws the sidebar narrower without changing its remembered width, and a wider one restores it', async t => {
  t.after(() => resizeWindow(1024));
  resizeWindow(1400);
  const { saved, snapshot } = renderWorkbench({ visible: true, width: 700 });
  await shownSidebar();
  await waitFor(() => assert.equal(drawnWidth('forge-sidebar'), '700px'));
  resizeWindow(800);
  assert.equal(drawnWidth('forge-sidebar'), '588px', 'the sidebar narrows to end at the navigation');
  assert.equal(drawnWidth('navigation'), '212px');
  assert.deepEqual(saved, [], 'resizing the window saves no width');
  assert.deepEqual(snapshot.navigation, { visible: true, width: 212 });
  resizeWindow(1400);
  assert.equal(drawnWidth('forge-sidebar'), '700px');
  assert.deepEqual(saved, []);
});

const listed = (origin: string | null, paths = ['octo/tools', 'octo/unbound', 'acme/forge']): RepositoryChoices => ({
  ok: true,
  forge: githubForge,
  account: 'octo',
  origin: origin === null ? null : githubRepository(origin),
  repositories: paths.map(path => githubRepository(path)),
});

async function unboundSidebar(choices: () => Promise<RepositoryChoices>, bind?: () => Promise<void>) {
  const binds: [string, RepositoryReference][] = [];
  const rendered = renderWorkbench(
    { visible: true, width: 380 },
    {
      fetchRepositoryChoices: choices,
      bindRepository: async (id, repository) => {
        binds.push([id, repository]);
        await bind?.();
        requireValue(
          rendered.snapshot.projects.find(item => item.id === id),
          `project ${id}`,
        ).repository = repository;
        rendered.publish();
      },
    },
  );
  await rendered.user.click(await screen.findByRole('button', { name: unboundProject }));
  const opened = await shownSidebar();
  await waitFor(() => assert.equal(repositoryTitle(), t('noRepositoryBound')));
  return { ...rendered, binds, opened };
}

test('an unbound project whose origin points at a listed repository offers to bind it, and Bind binds it at once', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  const bind = await within(opened).findByRole('button', { name: t('bindTo', { repository: 'octo/unbound' }) });
  const card = within(opened).getByRole('group', { name: t('projectUnbound', { forge: githubForge.name }) });
  assert.ok(card.contains(bind), "the card offers binding origin's repository");
  assert.deepEqual(
    within(card)
      .getAllByRole('button')
      .map(button => button.textContent),
    [t('bindTo', { repository: 'octo/unbound' }), t('chooseOtherRepository')],
    'the card offers only binding the origin or choosing another',
  );
  await user.click(bind);
  assert.deepEqual(binds, [['unbound', githubRepository('octo/unbound')]]);
  await waitFor(() => assert.equal(repositoryTitle(), 'octo/unbound'));
  assert.ok(within(openedSidebar()).getByRole('button', { name: t('changeBinding') }), 'the bound lists show');
});

test('Choose another repository… lists origin first and picked, Bind Y binds the one picked, and Back returns focus to the origin card', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  await user.click(await within(opened).findByRole('button', { name: t('chooseOtherRepository') }));
  const search = await within(opened).findByRole('searchbox', { name: t('searchRepositories') });
  await waitFor(() => assert.equal(document.activeElement, search));
  assert.deepEqual(
    within(opened)
      .getAllByRole('option')
      .map(option => option.getAttribute('data-path')),
    ['octo/unbound', 'octo/tools', 'acme/forge'],
  );
  assert.deepEqual(
    within(opened)
      .getAllByRole('option', { selected: true })
      .map(option => option.getAttribute('data-path')),
    ['octo/unbound'],
    "origin's repository starts picked",
  );
  assert.ok(within(opened).getByRole('button', { name: t('bindTo', { repository: 'octo/unbound' }) }));
  await user.click(within(opened).getByRole('button', { name: t('bindingBack') }));
  const chooseOther = await within(opened).findByRole('button', { name: t('chooseOtherRepository') });
  await waitFor(() => assert.equal(document.activeElement, chooseOther));
  await user.click(chooseOther);
  await user.click(await waitFor(() => repositoryOption('acme/forge', opened)));
  await user.click(within(opened).getByRole('button', { name: t('bindTo', { repository: 'acme/forge' }) }));
  assert.deepEqual(binds, [['unbound', githubRepository('acme/forge')]]);
});

test('from the search box ↑/↓ move through the listed repositories, Enter or Space picks the one reached, and picking with the pointer keeps focus there', async () => {
  const { user, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  await user.click(await within(opened).findByRole('button', { name: t('chooseOtherRepository') }));
  const search = requireInstance(
    await within(opened).findByRole('searchbox', { name: t('searchRepositories') }),
    HTMLInputElement,
  );
  const reached = () => document.getElementById(search.getAttribute('aria-activedescendant') ?? '')?.dataset.path;
  const picked = () =>
    within(opened)
      .getAllByRole('option', { selected: true })
      .map(option => option.dataset.path);
  await waitFor(() => assert.equal(document.activeElement, search));
  assert.equal(reached(), undefined, 'no repository is reached before a key moves');
  await user.keyboard('{ArrowDown}');
  assert.equal(reached(), 'octo/unbound', 'the repository origin points at is listed first');
  await user.keyboard('{ArrowUp}');
  assert.equal(reached(), 'octo/unbound', 'the first repository stays reached');
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  assert.equal(reached(), 'acme/forge', 'the last repository stays reached');
  await user.keyboard('{Enter}');
  assert.deepEqual(picked(), ['acme/forge']);
  await user.keyboard('{ArrowUp} ');
  assert.deepEqual(picked(), ['octo/tools']);
  assert.equal(search.value, '', 'Space picks without typing');

  await user.hover(repositoryOption('octo/unbound', opened));
  assert.equal(reached(), 'octo/unbound', 'pointing reaches a repository');
  await user.keyboard('{ArrowDown}');
  assert.equal(reached(), 'octo/tools', 'the keys go on from where the pointer reached');
  await user.click(repositoryOption('acme/forge', opened));
  assert.deepEqual(picked(), ['acme/forge']);
  assert.equal(document.activeElement, search, 'picking with the pointer keeps focus in the search box');

  await user.type(search, 'tools');
  assert.equal(reached(), undefined, 'a new search reaches nothing yet');
  await user.keyboard('{ArrowDown}{Enter}');
  assert.deepEqual(picked(), ['octo/tools']);
});

test('without an origin on the list, the list shows with nothing picked and Bind is unavailable until one is', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed(null));
  const tools = await waitFor(() => repositoryOption('octo/tools', opened));
  assert.ok(opened.textContent?.includes(t('originNotListed', { forge: githubForge.name })));
  assert.equal(within(opened).queryByRole('option', { selected: true }), null);
  assert.equal(bindButton(opened).disabled, true);
  await user.click(tools);
  await user.click(within(opened).getByRole('button', { name: t('bindTo', { repository: 'octo/tools' }) }));
  assert.deepEqual(binds, [['unbound', githubRepository('octo/tools')]]);
});

test('a list that fails after a pick binds nothing: Bind is unavailable until the list shows again', async () => {
  const answers: RepositoryChoices[] = [
    listed(null),
    { ok: false, failure: { kind: 'transient', detail: 'HTTP 502', forge: githubForge } },
  ];
  const { user, binds, opened, snapshot, publish } = await unboundSidebar(async () =>
    requireValue(answers.shift(), 'a repository list answer'),
  );
  await user.click(await waitFor(() => repositoryOption('octo/tools', opened)));
  assert.ok(within(opened).getByRole('button', { name: t('bindTo', { repository: 'octo/tools' }) }));
  requireValue(
    snapshot.projects.find(item => item.id === 'unbound'),
    'the unbound project',
  ).directory = '/elsewhere';
  publish();
  await waitFor(() => assert.deepEqual(alertMessages(opened), [t('repositoryListFailed', { reason: 'HTTP 502' })]));
  assert.equal(bindButton(opened).disabled, true);
  assert.deepEqual(binds, []);
});

test('a forge failure takes the place of the list with its reason and Retry, and nothing can be bound', async () => {
  const answers: RepositoryChoices[] = [
    { ok: false, failure: { kind: 'notInstalled', detail: '', forge: githubForge } },
    { ok: false, failure: { kind: 'loggedOut', detail: 'gh auth login', forge: githubForge } },
    { ok: false, failure: { kind: 'transient', detail: 'HTTP 502', forge: githubForge } },
    listed(null),
  ];
  const { user, opened } = await unboundSidebar(async () => requireValue(answers.shift(), 'a repository list answer'));
  for (const reason of [
    t('forgeNotInstalled', { cli: githubForge.cli }),
    t('forgeLoggedOut', { cli: githubForge.cli, command: githubForge.loginCommand }),
    t('repositoryListFailed', { reason: 'HTTP 502' }),
  ]) {
    await waitFor(() => assert.deepEqual(alertMessages(opened), [reason]));
    assert.equal(bindButton(opened).disabled, true);
    await user.click(within(opened).getByRole('button', { name: t('retry') }));
  }
  assert.ok(await waitFor(() => repositoryOption('octo/tools', opened)));
});

test('a bind whose list check fails writes nothing, says why in place, and can be tried again', async () => {
  let fail = true;
  const { user, binds, opened } = await unboundSidebar(
    async () => listed('octo/unbound'),
    async () => {
      if (fail) throw new Error(message('bindListFailed', { reason: nestedMessage('HTTP 502 原样') }));
    },
  );
  const bindOrigin = t('bindTo', { repository: 'octo/unbound' });
  await user.click(await within(opened).findByRole('button', { name: bindOrigin }));
  assert.equal(
    (await within(opened).findByRole('alert')).textContent,
    t('bindListFailed', { reason: 'HTTP 502 原样' }),
  );
  assert.equal(repositoryTitle(), t('noRepositoryBound'), 'the project is still unbound');
  fail = false;
  await user.click(within(opened).getByRole('button', { name: bindOrigin }));
  await waitFor(() => assert.equal(repositoryTitle(), 'octo/unbound'));
  assert.equal(binds.length, 2);
});

async function editProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: t('projectMenu', { name }) }));
  await user.click(screen.getByRole('menuitem', { name: t('editProject') }));
  return screen.getByRole('dialog', { name: t('editProject') });
}

test("Edit project's link on a bound project closes the dialog and opens the sidebar on its change-binding page", async () => {
  const { user } = renderWorkbench();
  const dialog = await editProject(user, boundProject);
  const changeInSidebar = t('changeBindingInSidebar', { forge: githubForge.name });
  await user.click(within(dialog).getByRole('button', { name: changeInSidebar, description: 'octo/bound' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  const opened = await shownSidebar();
  assert.equal(currentlyBoundPath(opened), 'octo/bound');
  const search = await within(opened).findByRole('searchbox', { name: t('searchRepositories') });
  await waitFor(() => assert.equal(document.activeElement, search));
});

test("Edit project's link on an unbound project makes it current and opens the sidebar on its unbound state", async () => {
  const { user, snapshot } = renderWorkbench();
  const dialog = await editProject(user, unboundProject);
  const bindInSidebar = t('bindInSidebar', { forge: githubForge.name });
  await user.click(within(dialog).getByRole('button', { name: bindInSidebar, description: t('notBound') }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  await waitFor(() => assert.equal(snapshot.activeProjectId, 'unbound'));
  const opened = await shownSidebar();
  await waitFor(() => assert.equal(repositoryTitle(), t('noRepositoryBound')));
  assert.equal(within(opened).queryByRole('button', { name: t('bindingBack') }), null);
});
