import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/ProjectManagement';
import { Localization } from '../../app/renderer/Localization';
import type { ProjectView } from '../../app/shared/model';
import type { PlatformDescription, RepositoryChoices, RepositoryReference } from '../../app/shared/code-hosting';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const github: PlatformDescription = { id: 'github', name: 'GitHub', installUrl: 'https://cli.github.com', signInCommand: 'gh auth login', capabilities: [] };
const repository = (path: string): RepositoryReference => ({ platform: 'github', path });
const listed = (suggested: string | null): RepositoryChoices => ({ ok: true, platform: github, account: 'octo',
  repositories: ['octo/app', 'octo/docs', 'acme/platform'].map(repository), suggested: suggested ? repository(suggested) : null });

function openEditor(project: ProjectView, choices: () => Promise<RepositoryChoices>) {
  const calls: unknown[][] = [];
  provideWorkbench({ inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async id => { calls.push(['choices', id]); return choices(); },
    bindRepository: async (id, chosen) => { calls.push(['bind', id, chosen]); },
    editProject: async (id, edit) => { calls.push(['edit', id]); return { project: { ...project, ...edit }, launches: [] }; },
  });
  render(<Localization language="en"><ProjectNavigationItem project={project} openProject={() => {}}><span>{project.name}</span></ProjectNavigationItem></Localization>);
  const user = userEvent.setup();
  return { calls, user, async open() {
    await user.click(screen.getByRole('button', { name: `Project menu: ${project.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  } };
}
const unbound: ProjectView = { id: 'project', name: 'App', directory: '/work/app', panels: [], tray: [], layout: null };
const selected = () => screen.getAllByRole('option').filter(option => option.getAttribute('aria-selected') === 'true').map(option => option.textContent);

test('the repository field offers only listed repositories, preselects the origin repository and binds it on save', async () => {
  const f = openEditor(unbound, async () => listed('acme/platform'));
  await f.open();
  await screen.findByRole('option', { name: 'octo/app' });
  assert.deepEqual(selected(), ['acme/platform']);
  assert.ok(!f.calls.some(call => call[0] === 'bind'), 'the suggestion is not bound before saving');
  const search = screen.getByRole('combobox', { name: 'Repository' });
  await f.user.type(search, 'octo');
  assert.deepEqual(screen.getAllByRole('option').map(option => option.textContent), ['octo/app', 'octo/docs']);
  await f.user.clear(search);
  await f.user.type(search, 'https://github.com/someone/else{Enter}');
  assert.equal(screen.queryAllByRole('option').length, 0);
  assert.ok(screen.getByText('No matching repositories'));
  assert.ok(!f.calls.some(call => call[0] === 'bind' || call[0] === 'edit'), 'Enter in the search neither binds nor saves');
  await f.user.clear(search);
  await f.user.click(screen.getByRole('option', { name: 'octo/docs' }));
  await f.user.click(screen.getByRole('button', { name: 'Save changes' }));
  assert.deepEqual(f.calls.filter(call => call[0] !== 'choices'), [['bind', 'project', repository('octo/docs')], ['edit', 'project']]);
  assert.equal(screen.queryByRole('dialog'), null);
});

test('changing or removing a binding asks for confirmation before saving', async () => {
  const f = openEditor({ ...unbound, repository: repository('octo/app') }, async () => listed('acme/platform'));
  await f.open();
  await screen.findByRole('option', { name: 'octo/app' });
  assert.deepEqual(selected(), ['octo/app'], 'the bound repository stays selected over the origin suggestion');
  await f.user.click(screen.getByRole('option', { name: 'acme/platform' }));
  await f.user.click(screen.getByRole('button', { name: 'Save changes' }));
  const confirmation = screen.getByRole('alertdialog', { name: 'Change repository binding?' });
  assert.ok(within(confirmation).getByText('octo/app → acme/platform'));
  await f.user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
  assert.ok(!f.calls.some(call => call[0] === 'bind' || call[0] === 'edit'));
  await f.user.click(screen.getByRole('button', { name: 'Save changes' }));
  await f.user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change binding' }));
  assert.deepEqual(f.calls.filter(call => call[0] !== 'choices'), [['bind', 'project', repository('acme/platform')], ['edit', 'project']]);
});

test('removing the binding asks for confirmation and saves no repository', async () => {
  const f = openEditor({ ...unbound, repository: repository('octo/app') }, async () => listed(null));
  await f.open();
  await screen.findByRole('option', { name: 'octo/app' });
  await f.user.click(screen.getByRole('button', { name: 'Remove binding' }));
  assert.deepEqual(selected(), []);
  await f.user.click(screen.getByRole('button', { name: 'Save changes' }));
  const confirmation = screen.getByRole('alertdialog', { name: 'Remove repository binding?' });
  await f.user.click(within(confirmation).getByRole('button', { name: 'Remove binding' }));
  assert.deepEqual(f.calls.filter(call => call[0] !== 'choices'), [['bind', 'project', null], ['edit', 'project']]);
});

test('a platform CLI that is not installed or not signed in shows its state and a retry instead of the list', async () => {
  const answers: RepositoryChoices[] = [
    { ok: false, failure: { kind: 'notInstalled', platform: github, output: '' } },
    { ok: false, failure: { kind: 'signedOut', platform: github, output: 'You are not logged into any GitHub hosts.' } },
    { ok: false, failure: { kind: 'transient', platform: github, output: 'HTTP 502: Bad Gateway 原样' } },
    listed(null),
  ];
  const f = openEditor(unbound, async () => answers.shift()!);
  await f.open();
  const status = await screen.findByRole('status', { name: 'Repository' });
  assert.match(status.textContent!, /GitHub CLI is not installed/);
  assert.match(status.textContent!, /https:\/\/cli\.github\.com/);
  assert.equal(screen.queryByRole('combobox', { name: 'Repository' }), null);
  await f.user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText(/GitHub CLI is not signed in/);
  assert.match(screen.getByRole('status', { name: 'Repository' }).textContent!, /gh auth login/);
  await f.user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText(/HTTP 502: Bad Gateway 原样/);
  await f.user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('option', { name: 'octo/app' });
  assert.deepEqual(selected(), []);
});
