import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { SidebarPreferences, ProjectView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { RepositoryChoices, RepositoryReference } from '../../app/shared/forge/forge';
import type { DesktopAPI } from '../../app/shared/api';
import { nestedMessage, message } from '../../app/shared/messages';
import { stubLayoutApis } from './support/no-layout';
import { provideWorkbench } from './support/workbench';
import { forgeSidebarData, type ForgeAnswers } from './support/forge-sidebar-data';
import { githubForge, githubView, githubRepository } from './support/forge';
import { requireValue } from '../../app/renderer/common/required';
import { requireInstance, selectElement } from './support/elements';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const project = (id: string, name: string, repository: ProjectView['repository']): ProjectView => ({
  id,
  name,
  directory: `/work/${id}`,
  layout: { panel: `${id}-panel` },
  tray: [],
  repository,
  ...githubView,
  panels: [
    {
      id: `${id}-panel`,
      agent: 'codex',
      run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` },
    },
  ],
});

function renderWorkbench(
  forgeSidebar: SidebarPreferences = { visible: false, width: 380 },
  api: Partial<DesktopAPI> & ForgeAnswers = {},
) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar,
    activeProjectId: 'bound',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [
      project('bound', 'Bound project', githubRepository('octo/bound')),
      project('unbound', 'Unbound project', null),
    ],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => {
    for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
  };
  const saved: SidebarPreferences[] = [];
  const choices: RepositoryChoices = {
    ok: true,
    forge: githubForge,
    account: 'octo',
    origin: null,
    repositories: [githubRepository('octo/unbound')],
  };
  const { fetchRepositoryChoices: repositoryChoices, ...calls } = api;
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    saveSidebar: async (sidebar, preferences) => {
      if (sidebar === 'forgeSidebar') saved.push(preferences);
      snapshot[sidebar] = preferences;
      publish();
    },
    activateProject: async id => {
      snapshot.activeProjectId = id;
      publish();
    },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
    ...forgeSidebarData(
      {
        repositoryChoices: repositoryChoices ?? (async () => choices),
        issuePage: () => new Promise(() => {}),
      },
      event => {
        for (const listener of listeners) listener(event);
      },
    ),
    ...calls,
  });
  render(<App />);
  return { user: userEvent.setup(), saved, snapshot, publish };
}

const sidebar = () => screen.queryByRole('complementary', { name: 'GitHub' });
const shownSidebar = () =>
  waitFor(() => {
    const element = sidebar();
    assert.ok(element, 'the sidebar is shown');
    return element;
  });
const openedSidebar = () => requireValue(sidebar(), 'the opened sidebar');
const toggle = () => requireInstance(selectElement('.system-bar').lastElementChild, HTMLButtonElement);

test('the button at the right end of the system bar opens the sidebar for the current project, with focus inside, and closes it', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: 'Show the GitHub sidebar' });
  assert.equal(
    toggle().getAttribute('aria-label'),
    'Show the GitHub sidebar',
    'the toggle is the last item of the system bar',
  );
  assert.equal(toggle().textContent, '', 'the toggle shows no count');
  assert.equal(sidebar(), null);
  await user.click(toggle());
  const opened = openedSidebar();
  assert.ok(within(opened).getByText('octo/bound'));
  assert.ok(opened.contains(document.activeElement), 'focus moves into the sidebar');
  assert.equal(toggle().getAttribute('aria-label'), 'Hide the GitHub sidebar');
  await user.click(toggle());
  assert.equal(sidebar(), null);
  assert.deepEqual(saved, [
    { visible: true, width: 380 },
    { visible: false, width: 380 },
  ]);
});

test('Command+Alt+B opens the sidebar with focus inside wherever focus is, and closes it when open', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: 'Show the GitHub sidebar' });
  selectElement('.xterm-helper-textarea').focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.ok(openedSidebar().contains(document.activeElement));
  selectElement('.xterm-helper-textarea').focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.equal(sidebar(), null);
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
  assert.ok(within(await shownSidebar()).getByText('octo/bound'));
  assert.equal(drawnWidth('forge-sidebar'), '420px');
  await user.click(screen.getByRole('button', { name: 'Unbound project' }));
  await waitFor(() => assert.ok(within(openedSidebar()).getByText('No repository bound')));
  assert.equal(within(openedSidebar()).queryByText('octo/bound'), null);
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  assert.ok(within(openedSidebar()).getByText('No repository bound'));
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
  await rendered.user.click(await screen.findByRole('button', { name: 'Unbound project' }));
  const opened = await shownSidebar();
  await waitFor(() => within(opened).getByText('No repository bound'));
  return { ...rendered, binds, opened };
}

test('an unbound project whose origin points at a listed repository offers to bind it, and Bind binds it at once', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  const bind = await within(opened).findByRole('button', { name: 'Bind octo/unbound' });
  assert.ok(within(opened).getByText('This project has no GitHub repository bound.'));
  assert.ok(within(opened).getByText("The project directory's origin points at"));
  assert.equal(within(opened).queryByRole('button', { name: "Don't bind" }), null);
  assert.equal(within(opened).queryByRole('button', { name: 'Undo' }), null);
  await user.click(bind);
  assert.deepEqual(binds, [['unbound', githubRepository('octo/unbound')]]);
  await waitFor(() => assert.ok(within(openedSidebar()).getByText('octo/unbound', { selector: 'header *' })));
  assert.ok(within(openedSidebar()).getByRole('button', { name: 'Change binding' }), 'the bound lists show');
});

test('Choose another repository… lists origin first and picked, Bind Y binds the one picked, and Back returns focus to the origin card', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  await user.click(await within(opened).findByRole('button', { name: 'Choose another repository…' }));
  const search = await within(opened).findByRole('searchbox', { name: 'Search repositories' });
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
  assert.ok(within(opened).getByRole('button', { name: 'Bind octo/unbound' }));
  await user.click(within(opened).getByRole('button', { name: '← Back' }));
  const chooseOther = await within(opened).findByRole('button', { name: 'Choose another repository…' });
  await waitFor(() => assert.equal(document.activeElement, chooseOther));
  await user.click(chooseOther);
  await user.click(await within(opened).findByRole('option', { name: 'acme/forge' }));
  await user.click(within(opened).getByRole('button', { name: 'Bind acme/forge' }));
  assert.deepEqual(binds, [['unbound', githubRepository('acme/forge')]]);
});

test('from the search box ↑/↓ move through the listed repositories, Enter or Space picks the one reached, and picking with the pointer keeps focus there', async () => {
  const { user, opened } = await unboundSidebar(async () => listed('octo/unbound'));
  await user.click(await within(opened).findByRole('button', { name: 'Choose another repository…' }));
  const search = requireInstance(
    await within(opened).findByRole('searchbox', { name: 'Search repositories' }),
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

  await user.hover(within(opened).getByRole('option', { name: /^octo\/unbound/ }));
  assert.equal(reached(), 'octo/unbound', 'pointing reaches a repository');
  await user.keyboard('{ArrowDown}');
  assert.equal(reached(), 'octo/tools', 'the keys go on from where the pointer reached');
  await user.click(within(opened).getByRole('option', { name: 'acme/forge' }));
  assert.deepEqual(picked(), ['acme/forge']);
  assert.equal(document.activeElement, search, 'picking with the pointer keeps focus in the search box');

  await user.type(search, 'tools');
  assert.equal(reached(), undefined, 'a new search reaches nothing yet');
  await user.keyboard('{ArrowDown}{Enter}');
  assert.deepEqual(picked(), ['octo/tools']);
});

test('without an origin on the list, the list shows with nothing picked and Bind is unavailable until one is', async () => {
  const { user, binds, opened } = await unboundSidebar(async () => listed(null));
  await within(opened).findByRole('option', { name: 'octo/tools' });
  assert.ok(
    within(opened).getByText(
      "The project directory's origin does not point at a GitHub repository; pick one from the list.",
    ),
  );
  assert.equal(within(opened).queryByRole('option', { selected: true }), null);
  assert.equal(requireInstance(within(opened).getByRole('button', { name: 'Bind' }), HTMLButtonElement).disabled, true);
  await user.click(within(opened).getByRole('option', { name: 'octo/tools' }));
  await user.click(within(opened).getByRole('button', { name: 'Bind octo/tools' }));
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
  await user.click(await within(opened).findByRole('option', { name: 'octo/tools' }));
  assert.ok(within(opened).getByRole('button', { name: 'Bind octo/tools' }));
  requireValue(
    snapshot.projects.find(item => item.id === 'unbound'),
    'the unbound project',
  ).directory = '/elsewhere';
  publish();
  await within(opened).findByText('Could not read the repository list: HTTP 502');
  assert.equal(requireInstance(within(opened).getByRole('button', { name: 'Bind' }), HTMLButtonElement).disabled, true);
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
    'Could not find gh; install it to bind a repository.',
    'gh is logged out. Run gh auth login, then retry.',
    'Could not read the repository list: HTTP 502',
  ]) {
    await within(opened).findByText(reason);
    assert.equal(within(opened).queryByRole('button', { name: /^Bind/ })?.matches(':enabled') ?? false, false);
    await user.click(within(opened).getByRole('button', { name: 'Retry' }));
  }
  assert.ok(await within(opened).findByRole('option', { name: 'octo/tools' }));
});

test('a bind whose list check fails writes nothing, says why in place, and can be tried again', async () => {
  let fail = true;
  const { user, binds, opened } = await unboundSidebar(
    async () => listed('octo/unbound'),
    async () => {
      if (fail) throw new Error(message('bindListFailed', { reason: nestedMessage('HTTP 502 原样') }));
    },
  );
  await user.click(await within(opened).findByRole('button', { name: 'Bind octo/unbound' }));
  assert.equal(
    (await within(opened).findByRole('alert')).textContent,
    'Not bound: could not read the repository list (HTTP 502 原样). You can try again.',
  );
  assert.ok(within(opened).getByText('No repository bound'), 'the project is still unbound');
  fail = false;
  await user.click(within(opened).getByRole('button', { name: 'Bind octo/unbound' }));
  await waitFor(() => assert.ok(within(openedSidebar()).getByText('octo/unbound', { selector: 'header *' })));
  assert.equal(binds.length, 2);
});

async function editProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Project menu: ${name}` }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  return screen.getByRole('dialog', { name: 'Edit project' });
}

test("Edit project's link on a bound project closes the dialog and opens the sidebar on its change-binding page", async () => {
  const { user } = renderWorkbench();
  const dialog = await editProject(user, 'Bound project');
  assert.equal(
    selectElement('.repository-current', dialog).textContent,
    'octo/boundChange or unbind in the GitHub sidebar',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Change or unbind in the GitHub sidebar' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  const opened = await shownSidebar();
  assert.equal(within(opened).getByText('Currently bound:').querySelector('b')?.textContent, 'octo/bound');
  const search = await within(opened).findByRole('searchbox', { name: 'Search repositories' });
  await waitFor(() => assert.equal(document.activeElement, search));
});

test("Edit project's link on an unbound project makes it current and opens the sidebar on its unbound state", async () => {
  const { user, snapshot } = renderWorkbench();
  const dialog = await editProject(user, 'Unbound project');
  assert.equal(selectElement('.repository-current', dialog).textContent, 'Not boundBind in the GitHub sidebar');
  await user.click(within(dialog).getByRole('button', { name: 'Bind in the GitHub sidebar' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  await waitFor(() => assert.equal(snapshot.activeProjectId, 'unbound'));
  const opened = await shownSidebar();
  await waitFor(() => within(opened).getByText('No repository bound'));
  assert.equal(within(opened).queryByRole('button', { name: '← Back' }), null);
});
