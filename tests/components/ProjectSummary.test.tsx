import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createRef, useEffect, useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectSummary, type ProjectSummaryActions } from '../../app/renderer/workspace/ProjectSummary';
import { Localization } from '../../app/renderer/common/Localization';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { PanelView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import { provideWorkbench } from './support/workbench';
import { testForgeView } from './support/forge';
import { requireValue } from '../../app/renderer/common/required';
import { focusedElement, shownTextParts } from './support/elements';
import { localize } from '../../app/shared/localization/localization';
import { agentNames } from '../../app/shared/model';
import { t } from './support/localization';
import { nameIncluding, summaryEntryName } from './support/accessible-names';

afterEach(cleanup);

const zh = localize('zh-CN').t;
const title = (id: string) => `Session ${id}`;
const titled = (id: string) => nameIncluding(title(id));
const renamed = 'Renamed session';

const panel = (id: string, status: ProcessingState): PanelView => ({
  id,
  agent: 'codex',
  run: { id, panelId: id, projectId: 'project', state: 'running', title: title(id) },
  status,
});

function fixture() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: false, width: 380 },
    activeProjectId: 'project',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [
      {
        id: 'project',
        name: 'Project title stays out of the bar',
        directory: '/project',
        layout: null,
        panels: (
          [
            ['first', 'done'],
            ['third', 'needs-input'],
          ] as const
        ).map(([id, status]) => panel(id, status)),
        tray: (
          [
            ['second', 'done'],
            ['fresh', 'ready'],
          ] as const
        ).map(([id, status]) => panel(id, status)),
        repository: null,
        ...testForgeView,
      },
    ],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const located: string[] = [];
  const summary = createRef<ProjectSummaryActions>();
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  function Summary() {
    const [state, setState] = useState<Snapshot>();
    useEffect(() => {
      void window.workbench.fetchSnapshot().then(setState);
      return window.workbench.subscribe(event => {
        if (event.kind === 'snapshot') setState(event.snapshot);
      });
    }, []);
    const active = state?.projects.find(project => project.id === state.activeProjectId);
    return (
      <Localization language={state?.settings.language ?? 'en'}>
        <button>Outside</button>
        {active && (
          <ProjectSummary
            ref={summary}
            key={active.id}
            panels={[...active.panels, ...active.tray]}
            locate={panel => located.push(panel.id)}
          />
        )}
      </Localization>
    );
  }
  render(<Summary />);
  return {
    snapshot,
    member: (id: string) =>
      requireValue(
        [...snapshot.projects[0].panels, ...snapshot.projects[0].tray].find(panel => panel.id === id),
        `panel ${id}`,
      ),
    located,
    user: userEvent.setup(),
    update: async () => {
      await act(() => {
        for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
      });
      act(() => summary.current?.membersChanged());
    },
  };
}

test("summary counts the current project's panels by state in fixed order and always lists members before locating, even one result", async () => {
  const { user, located, snapshot } = fixture();
  const bar = await screen.findByRole('region', { name: t('projectSummary') });
  await screen.findByRole('button', { name: summaryEntryName(1, 'needs-input') });
  assert.deepEqual(
    within(bar)
      .getAllByRole('button')
      .map(button => button.textContent),
    [
      summaryEntryName(1, 'ready'),
      summaryEntryName(1, 'needs-input'),
      summaryEntryName(2, 'done'),
      summaryEntryName(0, 'error'),
    ],
  );
  assert.equal(bar.textContent?.includes(snapshot.projects[0].name), false);
  for (const entry of within(bar).getAllByRole('button'))
    assert.equal(entry.dataset.hint, entry.getAttribute('aria-label'), 'names survive a collapse to icon and count');
  assert.equal(
    within(bar).getByRole<HTMLButtonElement>('button', { name: summaryEntryName(0, 'error') }).disabled,
    true,
  );
  await user.click(within(bar).getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  const list = screen.getByRole('dialog', { name: t('needs-input') });
  assert.equal(located.length, 0);
  assert.equal(within(list).getAllByRole('listitem').length, 1);
  await user.click(within(list).getByRole('button', { name: titled('third') }));
  assert.deepEqual(located, ['third']);
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(within(bar).getByRole('button', { name: summaryEntryName(1, 'ready') }));
  await user.click(
    within(screen.getByRole('dialog', { name: t('ready') })).getByRole('button', { name: titled('fresh') }),
  );
  assert.deepEqual(located.at(-1), 'fresh');
});

test('keyboard users can choose members, switch lists and return to the triggering entry on Escape or close', async () => {
  const { user, located } = fixture();
  const done = await screen.findByRole('button', { name: summaryEntryName(2, 'done') });
  done.focus();
  await user.keyboard('{Enter}');
  assert.match(focusedElement().textContent ?? '', new RegExp(title('first')));
  await user.keyboard('{ArrowDown}');
  assert.match(focusedElement().textContent ?? '', new RegExp(title('second')));
  await user.keyboard('{Home}');
  assert.match(focusedElement().textContent ?? '', new RegExp(title('first')));
  await user.keyboard('{End}');
  assert.match(focusedElement().textContent ?? '', new RegExp(title('second')));
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog'));
  assert.equal(document.activeElement, done);
  await user.keyboard(' ');
  await user.click(screen.getByRole('button', { name: t('closePanelList') }));
  assert.equal(document.activeElement, done);
  await user.click(done);
  await user.click(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  assert.equal(screen.queryByRole('dialog', { name: t('done') }), null);
  assert.ok(screen.getByRole('dialog', { name: t('needs-input') }));
  assert.equal(done.getAttribute('aria-expanded'), 'false');
  await user.click(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(done);
  await user.click(screen.getAllByRole('button')[0]);
  assert.ok(!screen.queryByRole('dialog'));
  done.focus();
  await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
  assert.deepEqual(located, ['first']);
});

test('open lists follow live membership and titles, retain keyboard control after removal, and reset on project changes', async () => {
  const { user, snapshot, member, update, located } = fixture();
  await user.click(await screen.findByRole('button', { name: summaryEntryName(2, 'done') }));
  requireValue(member('second').run, 'the second run').title = renamed;
  member('first').status = 'busy';
  await update();
  assert.ok(screen.getByRole('button', { name: summaryEntryName(1, 'done') }));
  const list = screen.getByRole('dialog');
  assert.equal(within(list).queryByRole('button', { name: titled('first') }), null);
  assert.ok(document.activeElement === within(list).getByRole('button', { name: nameIncluding(renamed) }));
  member('second').status = 'ready';
  await update();
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: summaryEntryName(0, 'done') }).disabled, true);
  assert.ok(document.activeElement === screen.getByRole('button', { name: t('closePanelList') }));
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  snapshot.activeProjectId = null;
  await update();
  assert.ok(!screen.queryByRole('dialog'));
  assert.ok(!screen.queryByRole('region', { name: t('projectSummary') }));
  assert.deepEqual(located, []);
  snapshot.activeProjectId = 'project';
  await update();
  assert.ok(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  assert.ok(!screen.queryByRole('dialog'));
});

test('clicking blank space in the summary dismisses the list', async () => {
  const { user } = fixture();
  const done = await screen.findByRole('button', { name: summaryEntryName(2, 'done') });
  await user.click(done);
  await user.click(requireValue(done.parentElement, 'the summary'));
  assert.ok(!screen.queryByRole('dialog'));
});

test('language changes update an open list without replacing it or translating real session titles', async () => {
  const { user, snapshot, member, update, located } = fixture();
  await screen.findByRole('button', { name: summaryEntryName(2, 'done') });
  delete requireValue(member('first').run, 'the first run').title;
  requireValue(member('second').run, 'the second run').title = t('untitled');
  await update();
  await user.click(screen.getByRole('button', { name: summaryEntryName(2, 'done') }));
  const list = screen.getByRole('dialog', { name: t('done') });
  const members = within(list).getAllByRole('listitem');
  assert.deepEqual(shownTextParts(members[0]), [t('untitled'), agentNames.codex]);
  assert.deepEqual(shownTextParts(members[1]), [t('untitled'), agentNames.codex]);
  await user.keyboard('{ArrowDown}');
  snapshot.settings.language = 'zh-CN';
  await update();
  assert.equal(screen.getByRole('dialog', { name: zh('done') }), list);
  assert.equal(within(list).getAllByRole('listitem')[0], members[0]);
  assert.deepEqual(shownTextParts(members[0]), [zh('untitled'), agentNames.codex]);
  assert.deepEqual(shownTextParts(members[1]), [t('untitled'), agentNames.codex]);
  assert.equal(document.activeElement, members[1].querySelector('button'));
  assert.ok(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input', zh) }));
  await user.keyboard('{Enter}');
  assert.deepEqual(located, ['second']);
});

test('an open list stays centred under the summary inside the window, also after the window resizes', async () => {
  const width = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetWidth');
  const box = window.HTMLElement.prototype.getBoundingClientRect;
  const innerWidth = window.innerWidth;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? 200 : 0;
    },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? new window.DOMRect(700, 0, 100, 24) : new window.DOMRect();
  };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
  try {
    const { user } = fixture();
    await user.click(await screen.findByRole('button', { name: summaryEntryName(2, 'done') }));
    const list = screen.getByRole('dialog', { name: t('done') });
    assert.equal(list.style.left, '-108px');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    act(() => {
      window.dispatchEvent(new window.Event('resize'));
    });
    assert.equal(list.style.left, '-50px');
  } finally {
    if (width) Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', width);
    window.HTMLElement.prototype.getBoundingClientRect = box;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
  }
});
