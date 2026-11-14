import assert from 'node:assert/strict';
import { screen, waitFor, within } from '@testing-library/react';
import type { DispatchRecordView, DispatchRequest } from '../../../app/shared/dispatch';
import type { Snapshot } from '../../../app/shared/model';
import { issue, page, renderWorkbench, sidebar } from './forge-lists';
import { githubCapabilities } from './forge';

/** Alpha's resident panel runs Codex on "Alpha session"; its tray panel runs Claude Code, Busy on "Fix it"; a second
 * resident panel has no run. Beta's panel belongs to another project. */
export function withPanels(snapshot: Snapshot) {
  const alpha = snapshot.projects[0];
  alpha.panels[0].status = 'ready';
  alpha.panels.push({ id: 'idle', agent: 'pi' });
  alpha.tray.push({ id: 'tray', agent: 'claude', status: 'busy', run: { id: 'tray-run', panelId: 'tray', projectId: 'alpha', state: 'running', title: 'Fix it' } });
}

/** The panel a dispatch goes to: the one it names, or a new one. */
export const panelOf = (request: DispatchRequest) => request.target.kind === 'panel' ? request.target.panelId : 'new-panel';

/** The Workbench with Alpha's issues 9 and 8 listed; `dispatch` answers dispatches. */
export async function listed(dispatch: (projectId: string, request: DispatchRequest) => Promise<{ delivery: 'submit' | 'fill'; panelId: string }> = async (_, request) => ({ delivery: 'submit', panelId: panelOf(request) }),
  change: (snapshot: Snapshot) => void = () => {}) {
  const requests: [string, DispatchRequest][] = [];
  const f = renderWorkbench(githubCapabilities, { dispatch: async (projectId, request) => { requests.push([projectId, request]); return dispatch(projectId, request); },
    // The detail is only opened, never answered.
    issueDetail: () => new Promise(() => {}) });
  const first = await f.request(1);
  // The app has subscribed once it asks for the list.
  withPanels(f.snapshot);
  change(f.snapshot);
  f.publish();
  first.answer(page([issue(9), issue(8, { state: 'closed', closedAs: 'completed' })]));
  await waitFor(() => assert.ok(within(sidebar()).getAllByRole('listitem').length === 2));
  return { ...f, dispatches: requests };
}
export const row = (number: number) => within(sidebar()).getAllByRole('listitem').find(item => within(item).queryByText(`#${number}`))!;
export const dispatchButton = (number: number) => within(row(number)).getByRole('button', { name: 'Dispatch' });
/** A dispatch record of an issue, located on a panel or on none. */
export const record = (issue: number, location: DispatchRecordView['location'], extra: Partial<DispatchRecordView> = {}): DispatchRecordView =>
  ({ issue, dispatchedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), agent: 'codex', text: `/implement ${issue}`, location, ...extra });
/** The open dispatch menu. */
export const menu = (number = 9) => screen.getByRole('menu', { name: `Dispatch #${number}` });
