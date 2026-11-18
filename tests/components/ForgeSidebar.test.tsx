import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { SidebarPreferences, ProjectView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { RepositoryChoices, RepositoryReference } from '../../app/shared/forge/forge';
import type { DesktopAPI } from '../../app/shared/api';
import { detail, message } from '../../app/shared/messages';
import { stubLayoutApis } from './support/no-layout';
import { provideWorkbench } from './support/workbench';
import { githubForge, githubView, githubRepository } from './support/forge';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  // Switching projects disconnects the workspace from the panel locator, which checks its animation's effect.
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
  api: Partial<DesktopAPI> = {},
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
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot),
    ready: async () => {},
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
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async () => choices,
    // A bound project's lists stay loading: these tests are about what the sidebar shows around them.
    issuePage: () => new Promise(() => {}),
    ...api,
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
const toggle = () => document.querySelector('.system-bar')!.lastElementChild as HTMLButtonElement;

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
  const opened = sidebar()!;
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
  document.querySelector<HTMLElement>('.xterm-helper-textarea')!.focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.ok(sidebar()!.contains(document.activeElement));
  document.querySelector<HTMLElement>('.xterm-helper-textarea')!.focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.equal(sidebar(), null);
  await waitFor(() =>
    assert.deepEqual(saved, [
      { visible: true, width: 380 },
      { visible: false, width: 380 },
    ]),
  );
});

test('the sidebar follows the current project and stays on the settings page', async () => {
  const { user } = renderWorkbench({ visible: true, width: 420 });
  assert.ok(within(await shownSidebar()).getByText('octo/bound'));
  assert.equal(sidebar()!.style.width, '420px');
  await user.click(screen.getByRole('button', { name: 'Unbound project' }));
  await waitFor(() => assert.ok(within(sidebar()!).getByText('No repository bound')));
  assert.equal(within(sidebar()!).queryByText('octo/bound'), null);
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  assert.ok(within(sidebar()!).getByText('No repository bound'));
});

const listed = (origin: string | null, paths = ['octo/tools', 'octo/unbound', 'acme/forge']): RepositoryChoices => ({
  ok: true,
  forge: githubForge,
  account: 'octo',
  origin: origin === null ? null : githubRepository(origin),
  repositories: paths.map(path => githubRepository(path)),
});

/** The Workbench with the unbound project's sidebar open; binding records its calls and binds as asked. */
async function unboundSidebar(choices: () => Promise<RepositoryChoices>, bind?: () => Promise<void>) {
  const binds: [string, RepositoryReference][] = [];
  const rendered = renderWorkbench(
    { visible: true, width: 380 },
    {
      repositoryChoices: choices,
      bindRepository: async (id, repository) => {
        binds.push([id, repository]);
        await bind?.();
        rendered.snapshot.projects.find(item => item.id === id)!.repository = repository;
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
  await waitFor(() => assert.ok(within(sidebar()!).getByText('octo/unbound', { selector: 'header *' })));
  assert.ok(within(sidebar()!).getByRole('button', { name: 'Change binding' }), 'the bound lists show');
});

test('Choose another repository… lists origin first and picked, Bind Y binds the one picked, and Back returns to the origin card', async () => {
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
  await user.click(await within(opened).findByRole('button', { name: 'Choose another repository…' }));
  await user.click(await within(opened).findByRole('option', { name: 'acme/forge' }));
  await user.click(within(opened).getByRole('button', { name: 'Bind acme/forge' }));
  assert.deepEqual(binds, [['unbound', githubRepository('acme/forge')]]);
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
  assert.equal((within(opened).getByRole('button', { name: 'Bind' }) as HTMLButtonElement).disabled, true);
  await user.click(within(opened).getByRole('option', { name: 'octo/tools' }));
  await user.click(within(opened).getByRole('button', { name: 'Bind octo/tools' }));
  assert.deepEqual(binds, [['unbound', githubRepository('octo/tools')]]);
});

test('a forge failure takes the place of the list with its reason and Retry, and nothing can be bound', async () => {
  const answers: RepositoryChoices[] = [
    { ok: false, failure: { kind: 'notInstalled', detail: '', forge: githubForge } },
    { ok: false, failure: { kind: 'loggedOut', detail: 'gh auth login', forge: githubForge } },
    { ok: false, failure: { kind: 'transient', detail: 'HTTP 502', forge: githubForge } },
    listed(null),
  ];
  const { user, opened } = await unboundSidebar(async () => answers.shift()!);
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
      if (fail) throw new Error(message('bindListFailed', { reason: detail('HTTP 502 原样') }));
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
  await waitFor(() => assert.ok(within(sidebar()!).getByText('octo/unbound', { selector: 'header *' })));
  assert.equal(binds.length, 2);
});
