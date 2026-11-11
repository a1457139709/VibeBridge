import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IssueLists, unfiltered } from '../../app/renderer/IssueLists';
import { Localization } from '../../app/renderer/Localization';
import type { PanelView, ProjectView } from '../../app/shared/model';
import type { DispatchLocation, DispatchRequest } from '../../app/shared/dispatch';
import type { IssueSummary } from '../../app/shared/code-hosting';
import { defaultShortcuts, type Shortcuts } from '../../app/shared/shortcuts';
import { defaultWorkflowSettings } from '../../app/shared/workflows';

afterEach(cleanup);

const running = (id: string, agent: PanelView['agent'], title?: string): PanelView =>
  ({ id, agent, run: { id: `run-${id}`, panelId: id, projectId: 'app', state: 'running', ...(title ? { title } : {}) }, status: 'ready' });
const issue = (number: number, state: IssueSummary['state'] = 'open'): IssueSummary => ({ number, title: `Issue ${number}`, state,
  closedAs: state === 'closed' ? 'completed' : null, createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [] });
const located = (panelId: string): DispatchLocation => ({ projectId: 'app', panelId, runId: `run-${panelId}`, ephemeral: false, status: 'busy', title: 'Fix the crash' });

/** The App project's issue list with a resident and an ephemeral running panel; issue 7 was dispatched to the resident one. */
async function renderList({ shortcuts = defaultShortcuts(), issues = [issue(7)] }: { shortcuts?: Shortcuts; issues?: IssueSummary[] } = {}) {
  const dispatched: DispatchRequest[] = [];
  const locations: DispatchLocation[] = [];
  const project: ProjectView = { id: 'app', name: 'App', directory: '/work/app', layout: null, repository: { platform: 'github', path: 'octo/app' },
    panels: [running('resident', 'claude', 'Fix the crash')], tray: [running('ephemeral', 'codex')],
    dispatches: issues.map(({ number }) => ({ issue: number, time: new Date().toISOString(), agent: 'claude', text: `/tdd #${number}`, location: located('resident') })) };
  const api = {
    issuePage: async () => ({ ok: true as const, page: { issues, next: null, labels: [] } }),
    mergeRequestPage: () => new Promise<never>(() => {}),
    dispatch: async (_projectId: string, request: DispatchRequest) => { dispatched.push(request); return null; },
  };
  render(<Localization language="en">
    <IssueLists project={project} repository={project.repository!} workflows={defaultWorkflowSettings()} shortcuts={shortcuts} changeBinding={() => {}} filters={unfiltered} setFilters={() => {}} refreshed={() => {}}
      locate={location => locations.push(location)} filled={location => locations.push(location)} detail={{ open() {} }} mergeRequestDetail={{ open() {} }} api={api} />
  </Localization>);
  await screen.findByRole('listitem', { name: `#${issues[0].number} Issue ${issues[0].number}` });
  return { user: userEvent.setup(), dispatched, locations };
}
const dispatchButton = (number = 7) => within(screen.getByRole('listitem', { name: `#${number} Issue ${number}` })).getByRole('button', { name: 'Dispatch ▾' });
const instructions = () => screen.getByRole('menu', { name: 'Dispatch #7' });
const targets = (instruction: string) => screen.queryByRole('menu', { name: `Dispatch ${instruction} to` });
const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent;

test('arrow keys move through the instructions, left opens and right leaves an instruction\'s targets, and Escape closes the whole menu', async () => {
  const { user, dispatched } = await renderList();
  await user.click(dispatchButton());
  assert.equal(focused(), 'grill-with-docsSubmit', 'opening the menu focuses its first instruction');
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
  assert.equal(focused(), 'to-specSubmit');
  await user.keyboard('{ArrowLeft}');
  assert.ok(targets('to-spec'));
  assert.equal(focused(), 'New · Claude Code', 'the first target, a new panel, has focus');
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  assert.equal(focused(), 'Fix the crash · Ready · Claude Code · Resident', 'the existing panels follow the new ones');
  await user.keyboard('{ArrowDown}');
  assert.equal(focused(), 'Untitled task · Ready · Codex · Ephemeral');
  await user.keyboard('{ArrowDown}');
  assert.equal(focused(), 'Untitled task · Ready · Codex · Ephemeral', 'moving stops at the last target');
  await user.keyboard('{ArrowRight}');
  assert.equal(targets('to-spec'), null);
  assert.equal(focused(), 'to-specSubmit');
  await user.keyboard('{ArrowLeft}{Escape}');
  assert.equal(screen.queryByRole('menu'), null, 'Escape closes both layers at once');
  assert.equal(document.activeElement, dispatchButton());
  assert.deepEqual(dispatched, []);
});

test('Space on an instruction opens its targets and Space on a target dispatches with the instruction\'s delivery', async () => {
  const { user, dispatched, locations } = await renderList();
  await user.click(dispatchButton());
  await user.keyboard('{ArrowDown}{ArrowDown} ');
  assert.equal(focused(), 'New · Claude Code');
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  assert.equal(focused(), 'Fix the crash · Ready · Claude Code · Resident');
  await user.keyboard(' ');
  assert.deepEqual(dispatched, [{ issue: { number: 7, title: 'Issue 7' }, workflow: 'matt', instruction: 'to-tickets', target: { panelId: 'resident' }, invert: false }]);
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(document.activeElement, dispatchButton(), 'a submitted dispatch returns focus to the dispatch button');
  assert.deepEqual(locations, []);
});

test('Enter does nothing in the menu', async () => {
  const { user, dispatched } = await renderList();
  await user.click(dispatchButton());
  await user.keyboard('{Enter}');
  assert.equal(targets('grill-with-docs'), null);
  await user.keyboard('{ArrowLeft}{Enter}');
  assert.ok(targets('grill-with-docs'));
  assert.equal(focused(), 'New · Claude Code');
  assert.deepEqual(dispatched, []);
});

test('Option with Space or with a click inverts the delivery of that one dispatch', async () => {
  const { user, dispatched, locations } = await renderList();
  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^implement-spec/ }));
  await user.keyboard('{ArrowLeft}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Alt>}[Space]{/Alt}');
  assert.deepEqual(dispatched.map(({ instruction, target, invert }) => ({ instruction, target, invert })),
    [{ instruction: 'implement-spec', target: { panelId: 'ephemeral' }, invert: true }]);
  assert.deepEqual(locations.map(location => location.panelId), ['ephemeral'], 'the submit instruction was filled, so its panel is located');

  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^wayfinder/ }));
  await user.keyboard('{Alt>}');
  await user.click(screen.getByRole('menuitem', { name: /Resident$/ }));
  await user.keyboard('{/Alt}');
  assert.deepEqual(dispatched.map(({ instruction, invert }) => ({ instruction, invert })),
    [{ instruction: 'implement-spec', invert: true }, { instruction: 'wayfinder', invert: true }]);
  assert.deepEqual(locations.map(location => location.panelId), ['ephemeral', 'resident']);
});

test('an instruction\'s targets highlight the one it last went to without dispatching to it', async () => {
  const { user, dispatched } = await renderList();
  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^research/ }));
  assert.deepEqual(within(targets('research')!).getAllByRole('menuitem').filter(item => item.getAttribute('aria-current')), []);
  await user.click(screen.getByRole('menuitem', { name: /Ephemeral$/ }));

  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^research/ }));
  const highlighted = within(targets('research')!).getAllByRole('menuitem').filter(item => item.getAttribute('aria-current'));
  assert.deepEqual(highlighted.map(item => item.getAttribute('aria-label')), ['Untitled task · Ready · Codex · Ephemeral']);
  assert.equal(dispatched.length, 1, 'highlighting dispatches nothing');
  await user.click(within(instructions()).getByRole('menuitem', { name: /^prototype/ }));
  assert.deepEqual(within(targets('prototype')!).getAllByRole('menuitem').filter(item => item.getAttribute('aria-current')), [], 'other instructions remember their own');
});

test('a new panel of an Agent type is remembered and highlighted as the target an instruction last went to', async () => {
  const { user, dispatched } = await renderList();
  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^triage/ }));
  await user.click(screen.getByRole('menuitem', { name: 'New · Codex' }));
  assert.deepEqual(dispatched.map(({ target }) => target), [{ agent: 'codex' }]);

  await user.click(dispatchButton());
  await user.click(within(instructions()).getByRole('menuitem', { name: /^triage/ }));
  const highlighted = within(targets('triage')!).getAllByRole('menuitem').filter(item => item.getAttribute('aria-current'));
  assert.deepEqual(highlighted.map(item => item.getAttribute('aria-label')), ['New · Codex']);
});

test('the dispatch shortcut opens the menu of the issue holding focus and the locate shortcut locates its dispatch', async () => {
  const { user, locations } = await renderList({ shortcuts: { ...defaultShortcuts(), dispatch: 'Command+Alt+D' }, issues: [issue(7), issue(8)] });
  within(screen.getByRole('listitem', { name: '#8 Issue 8' })).getByRole('button', { name: /^Locate/ }).focus();
  await user.keyboard('{Meta>}d{/Meta}');
  assert.equal(screen.queryByRole('menu'), null, 'only the bound shortcut opens the menu');
  await user.keyboard('{Meta>}{Alt>}d{/Alt}{/Meta}');
  assert.ok(screen.getByRole('menu', { name: 'Dispatch #8' }));
  assert.equal(focused(), 'grill-with-docsSubmit');
  await user.keyboard('{Escape}');
  await user.keyboard('{Meta>}l{/Meta}');
  assert.deepEqual(locations.map(location => location.panelId), ['resident']);
});

test('outside an issue the shortcuts pass on, and a closed issue has no dispatch to locate', async () => {
  const { user, locations } = await renderList({ issues: [issue(7, 'closed')] });
  const search = screen.getByRole('searchbox');
  assert.equal(fireEvent.keyDown(search, { key: 'd', code: 'KeyD', metaKey: true }), true, 'the key event is not consumed');
  assert.equal(fireEvent.keyDown(search, { key: 'l', code: 'KeyL', metaKey: true }), true);
  assert.equal(screen.queryByRole('menu'), null);
  dispatchButton().focus();
  await user.keyboard('{Meta>}l{/Meta}');
  assert.deepEqual(locations, []);
});
