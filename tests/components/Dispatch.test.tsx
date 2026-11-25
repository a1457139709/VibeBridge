import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import { defaultShortcuts, displayShortcut } from '../../app/shared/settings/shortcuts';
import { commandText, workflows } from '../../app/shared/settings/workflows';
import type { AgentType } from '../../app/shared/model';
import { requireValue } from '../../app/renderer/common/required';
import { stubSidebarApis, summary } from './support/forge-lists';
import {
  command,
  dispatchButton,
  hoursAgo,
  issueButton,
  listed,
  menu,
  newTarget,
  newTargetName,
  panelOf,
  panelTarget,
  record,
  residentTitle,
  row,
  targetsMenu,
  trayTitle,
  commandNamed,
} from './support/dispatch';
import { descriptionParts, selectElement, shownTextParts } from './support/elements';
import { forgeSidebar, queryIssueDetail } from './support/sidebar-queries';
import { nameIncluding } from './support/accessible-names';

afterEach(cleanup);
before(stubSidebarApis);

const implement = 'implement',
  toSpec = 'to-spec',
  grillMe = 'grill-me',
  fresh = 'Fresh';
const implementCommand = requireValue(
  workflows.flatMap(workflow => workflow.commands).find(({ id }) => id === implement),
  'the implement command',
);
const preview = () => selectElement('.dispatch-preview', targetsMenu(implement));
const previewOf = (agent: AgentType) =>
  commandText(agent, implementCommand, { url: '…#9', number: 9, title: summary(9).title });
const anyImplement = commandNamed(implement);
const submitImplement = commandNamed(implement, ['submit']);

test('Dispatch opens the commands of the enabled workflow, each marked Submit or Fill only, without a workflow name', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.settings.workflows.matt.commands[toSpec] = { delivery: 'fill' };
  });
  assert.equal(within(row(8)).queryByRole('button', { name: t('dispatch') }), null, 'a closed issue is not dispatched');
  await f.user.click(dispatchButton(9));
  const commands = within(menu()).getAllByRole('menuitem').map(shownTextParts);
  assert.deepEqual(commands.slice(0, 3), [
    command('grill-with-docs', 'submit'),
    command(toSpec, 'fill'),
    command('to-tickets', 'submit'),
  ]);
  assert.equal(commands.length, 12);
  assert.deepEqual(within(menu()).queryAllByRole('heading'), [], 'a single workflow is not headed');
});

test('with every workflow off the menu only says where to turn one on', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.settings.workflows.matt.enabled = false;
  });
  await f.user.click(dispatchButton(9));
  assert.deepEqual(within(menu()).queryAllByRole('menuitem'), []);
  assert.deepEqual(descriptionParts(menu()), [t('noEnabledWorkflows')]);
});

test("a command opens its targets: new panels of each Agent type, then the project's panels with a run", async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', submitImplement));
  const targets = within(targetsMenu(implement)).getAllByRole('menuitem');
  assert.deepEqual(targets.map(shownTextParts), [
    newTarget('claude'),
    newTarget('codex'),
    newTarget('pi'),
    panelTarget('codex', 'ready', residentTitle, true),
    panelTarget('claude', 'busy', trayTitle, false),
  ]);
  await f.user.hover(targets[4]);
  assert.equal(
    selectElement('code', preview()).textContent,
    previewOf('claude'),
    'the preview shows the text the pointed target would receive',
  );
});

test("submitting to a panel dispatches the issue, returns focus to Dispatch and reloads that issue's row by number", async () => {
  const f = await listed();
  const rowsAsked: number[][] = [];
  f.forge.issuesByNumber = (_, numbers) => {
    rowsAsked.push(numbers);
    return new Promise(() => {});
  };
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', submitImplement));
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(trayTitle) }));
  await waitFor(() =>
    assert.deepEqual(f.dispatches, [
      [
        'alpha',
        {
          issue: { number: 9, title: summary(9).title },
          workflowId: 'matt',
          commandId: implement,
          target: { kind: 'panel', panelId: 'tray' },
          invertDelivery: false,
        },
      ],
    ]),
  );
  assert.equal(screen.queryByRole('menu'), null);
  await waitFor(() => assert.equal(document.activeElement, dispatchButton(9)));
  await waitFor(() => assert.deepEqual(rowsAsked, [[9]]));
});

test('filling a panel closes the detail, keeps the sidebar open and reloads the dispatched issue', async () => {
  const f = await listed(async (_, request) => ({ delivery: 'fill', panelId: panelOf(request) }));
  const detailsAsked: number[] = [];
  f.forge.issueDetail = (_, number) => {
    detailsAsked.push(number);
    return new Promise(() => {});
  };
  const rowsAsked: number[][] = [];
  f.forge.issuesByNumber = (_, numbers) => {
    rowsAsked.push(numbers);
    return new Promise(() => {});
  };
  await f.user.click(issueButton(9));
  await waitFor(() => assert.ok(queryIssueDetail()));
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', submitImplement));
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(residentTitle) }));
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.ok(forgeSidebar());
  await waitFor(() => assert.deepEqual(rowsAsked, [[9]], 'its row reloaded by number once dispatched'));
  assert.deepEqual(detailsAsked, [9], 'the detail read once, when opened');
});

test('submitting to a new panel dispatches to its Agent type and returns focus to Dispatch', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', submitImplement));
  const target = within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(newTargetName('codex')) });
  await f.user.hover(target);
  assert.equal(
    selectElement('code', preview()).textContent,
    previewOf('codex'),
    "the preview shows the text in the new panel's Agent type",
  );
  await f.user.click(target);
  await waitFor(() =>
    assert.deepEqual(f.dispatches, [
      [
        'alpha',
        {
          issue: { number: 9, title: summary(9).title },
          workflowId: 'matt',
          commandId: implement,
          target: { kind: 'new', agent: 'codex' },
          invertDelivery: false,
        },
      ],
    ]),
  );
  await waitFor(() => assert.equal(document.activeElement, dispatchButton(9)));
});

test('filling a new panel opens it as the temporary maximize once it joins the tray, closes the detail and keeps the sidebar open', async () => {
  const f = await listed(async () => ({ delivery: 'fill', panelId: 'new-panel' }));
  await f.user.click(issueButton(9));
  await waitFor(() => assert.ok(queryIssueDetail()));
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', submitImplement));
  await f.user.click(
    within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(newTargetName('pi')) }),
  );
  await waitFor(() =>
    assert.deepEqual(
      f.dispatches.map(([, request]) => request.target),
      [{ kind: 'new', agent: 'pi' }],
    ),
  );
  f.snapshot.projects[0].tray.push({
    id: 'new-panel',
    agent: 'pi',
    run: { id: 'new-run', panelId: 'new-panel', projectId: 'alpha', state: 'running', title: fresh },
  });
  f.publish();
  const card = await waitFor(() =>
    within(screen.getByRole('region', { name: t('panelTray') })).getByRole('button', { name: nameIncluding(fresh) }),
  );
  await waitFor(() => assert.equal(card.getAttribute('aria-pressed'), 'true'));
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.ok(forgeSidebar());
});

const skillOf = (number: number) => row(number).querySelector('.dispatch-skill');

test("an issue row shows only its latest dispatch's skill: a link to its panel with its age in the hint", async () => {
  const latest = record(9, { projectId: 'beta', panelId: 'beta-panel' }, { skill: grillMe, dispatchedAt: hoursAgo(2) });
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [
      record(9, null, { skill: toSpec }),
      latest,
      record(8, { projectId: 'beta', panelId: 'beta-panel' }),
    ];
  });
  const skill = within(row(9)).getByRole('button', { name: latest.skill });
  assert.equal(
    skill.getAttribute('data-hint'),
    t('dispatchSkillLocatable', {
      skill: grillMe,
      age: t('hoursAgo', { count: 2 }),
      shortcut: displayShortcut(defaultShortcuts().locateDispatchedPanel),
    }),
  );
  assert.equal(row(9).querySelectorAll('.dispatch-skill').length, 1, 'earlier dispatches do not show');
  assert.equal(skillOf(8), null, 'a closed issue shows no dispatch');
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  await f.user.click(skill);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('an issue row shows a latest dispatch whose session no panel is on as grey text that locates nothing', async () => {
  const latest = record(9, null, { skill: grillMe, dispatchedAt: hoursAgo(72) });
  await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [
      record(9, { projectId: 'beta', panelId: 'beta-panel' }, { skill: toSpec }),
      latest,
    ];
  });
  assert.equal(within(row(9)).queryByRole('button', { name: latest.skill }), null);
  const skill = requireValue(skillOf(9), 'the skill of #9');
  assert.equal(skill.textContent, grillMe);
  assert.equal(
    skill.getAttribute('data-hint'),
    t('dispatchSkillGone', { skill: grillMe, age: t('daysAgo', { count: 3 }) }),
  );
});

const cursor = () => {
  const id = menu().getAttribute('aria-activedescendant');
  return shownTextParts(requireValue(document.getElementById(id ?? ''), 'the menu cursor'));
};
const last = (target: string[]) => [...target, t('lastTarget')];

test('in the menu ↑/↓ move without wrapping, ← or Space enters the targets, → goes back, Space dispatches, and Enter does nothing', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  assert.equal(document.activeElement, menu(), 'keys go to the menu, not the terminal');
  assert.deepEqual(cursor(), command('grill-with-docs', 'submit'));
  await f.user.keyboard('{ArrowUp}{ArrowDown}{ArrowDown}');
  assert.deepEqual(cursor(), command('to-tickets', 'submit'));
  await f.user.keyboard('{ArrowDown}{ArrowLeft}');
  assert.ok(targetsMenu(implement));
  assert.deepEqual(cursor(), newTarget('claude'));
  await f.user.keyboard('{ArrowDown}{ArrowRight}');
  assert.equal(screen.queryByRole('menu', { name: t('dispatchTargets', { command: implement }) }), null);
  assert.deepEqual(cursor(), command(implement, 'submit'));
  await f.user.keyboard(' {ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
  assert.deepEqual(cursor(), panelTarget('claude', 'busy', trayTitle, false));
  await f.user.keyboard('{Enter}');
  assert.ok(menu(), 'Enter neither dispatches nor closes the menu');
  assert.deepEqual(f.dispatches, []);
  await f.user.keyboard(' ');
  await waitFor(() =>
    assert.deepEqual(
      f.dispatches.map(([, request]) => [request.commandId, request.target, request.invertDelivery]),
      [[implement, { kind: 'panel', panelId: 'tray' }, false]],
    ),
  );
  assert.equal(screen.queryByRole('menu'), null);
});

test('Esc closes the whole menu from its targets and returns focus to Dispatch', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.keyboard('{ArrowLeft}');
  assert.ok(targetsMenu('grill-with-docs'));
  await f.user.keyboard('{Escape}');
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(document.activeElement, dispatchButton(9));
});

test('holding ⌥ shows the inverted deliveries, and ⌥+Space or ⌥+click inverts this dispatch only', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowLeft}{Alt>}');
  assert.deepEqual(cursor(), newTarget('claude'));
  assert.deepEqual(shownTextParts(within(menu()).getByRole('menuitem', anyImplement)), command(implement, 'fill'));
  assert.equal(
    selectElement('span', preview()).textContent,
    `${t('deliveryFill')} ${t('dispatchInverted')}`,
    'the preview says the delivery is inverted',
  );
  await f.user.keyboard(' {/Alt}');
  await waitFor(() =>
    assert.deepEqual(
      f.dispatches.map(([, request]) => [request.target, request.invertDelivery]),
      [[{ kind: 'new', agent: 'claude' }, true]],
    ),
  );
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', anyImplement));
  assert.deepEqual(
    shownTextParts(within(menu()).getByRole('menuitem', anyImplement)),
    command(implement, 'submit'),
    'releasing ⌥ shows the deliveries as set',
  );
  await f.user.keyboard('{Alt>}');
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(trayTitle) }));
  await f.user.keyboard('{/Alt}');
  await waitFor(() =>
    assert.deepEqual(
      f.dispatches.map(([, request]) => request.invertDelivery),
      [true, true],
    ),
  );
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', anyImplement));
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(trayTitle) }));
  await waitFor(() =>
    assert.deepEqual(
      f.dispatches.map(([, request]) => request.invertDelivery),
      [true, true, false],
    ),
  );
});

test('the targets mark the one a command last went to and start the cursor there, without dispatching', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(menu()).getByRole('menuitem', anyImplement));
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(trayTitle) }));
  await waitFor(() => assert.equal(f.dispatches.length, 1));
  await f.user.click(dispatchButton(9));
  await f.user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowLeft}');
  const targets = within(targetsMenu(implement)).getAllByRole('menuitem').map(shownTextParts);
  assert.deepEqual(
    targets.filter(target => target.at(-1) === t('lastTarget')),
    [last(panelTarget('claude', 'busy', trayTitle, false))],
  );
  assert.deepEqual(cursor(), last(panelTarget('claude', 'busy', trayTitle, false)));
  assert.equal(f.dispatches.length, 1, 'the last target is not dispatched to by itself');
  await f.user.keyboard('{ArrowRight}{ArrowUp}{ArrowLeft}');
  assert.equal(
    targetsMenu('to-tickets').querySelector('.dispatch-last'),
    null,
    'another command has no last target yet',
  );
  assert.deepEqual(cursor(), newTarget('claude'));
});
