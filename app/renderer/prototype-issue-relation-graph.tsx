// PROTOTYPE: the real workbench on an invented project, with the issue document swapped per ?variant=.
// Nothing reads GitHub or starts an Agent: window.workbench is a stub that answers from invented data.
import { useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './Workbench';
import { requireValue } from './common/required';
import { defaultSettings } from '../shared/settings/settings';
import type { DesktopAPI } from '../shared/api';
import type { AgentType, PanelView, ProjectView, Snapshot, WorkbenchEvent } from '../shared/model';
import type { ForgeCapabilities, RepositoryReference } from '../shared/forge/forge';
import { ForgeSidebarData } from '../main/forge/forge-sidebar-data';
import { CurrentIssueDocument, type DocumentProps } from './forge/IssueDetail';
import { prototypeIssueDocument } from './forge/prototype-issue-document';
import {
  fakeDispatchesForProject,
  fakeIssue,
  fakeListedIssues,
  fakePullRequestDetail,
  fakePullRequests,
  knows,
  repoPath,
} from './prototype-issue-relation-graph-data';
import type { Act, VariantProps } from './prototype-issue-relation-graph-parts';
import { TimelineVariant } from './prototype-issue-relation-graph-variants';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './panels/agent-panel.css';
import './settings/settings-page.css';
import './panels/terminal.css';
import './common/processing-status.css';
import './workspace/project-summary.css';
import './workspace/panel-tray.css';
import './projects/project-navigation.css';
import './prototype-issue-relation-graph.css';
import './prototype-issue-relation-graph-light.css';
import './prototype-issue-relation-graph-scenarios.css';

// ───────────── variants ─────────────

const variants: { key: string; name: string; Component: ComponentType<VariantProps> | null }[] = [
  { key: '0', name: '现在线上的样子', Component: null },
  { key: 'H1', name: '定稿：子 issue 列表即关系图 · 评论时间线', Component: TimelineVariant },
];
const variantStore = (() => {
  const listeners = new Set<() => void>();
  const initial = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  let current = variants.some(variant => variant.key === initial) ? initial! : 'H1';
  return {
    get: () => current,
    set(key: string) {
      current = key;
      const url = new URL(window.location.href);
      url.searchParams.set('variant', key);
      window.history.replaceState(null, '', url);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
})();
const useVariant = () => useSyncExternalStore(variantStore.subscribe, variantStore.get);

function PrototypeIssueDocument(props: DocumentProps) {
  const key = useVariant();
  const { Component } = variants.find(variant => variant.key === key) ?? variants[0];
  if (!Component || !knows(props.issue.number)) return <CurrentIssueDocument {...props} />;
  const issue = fakeIssue(props.issue.number);
  const siblings = issue.parent ? fakeIssue(issue.parent.number).subIssues : undefined;
  const act: Act = {
    openIssue: reference =>
      reference.url.startsWith(issue.links.issuePrefix)
        ? props.open({ kind: 'issue', number: reference.number })
        : window.open(reference.url, '_blank'),
    openPull: pull => props.open({ kind: 'pullRequest', number: pull.number }),
    locate: record => record.location && props.dispatch.host.locate(record.location.projectId, record.location.panelId),
  };
  return (
    <div className="forge-doc-host" onClick={props.followLink}>
      <Component
        key={`${key} ${issue.number}`}
        issue={issue}
        records={props.dispatch.records}
        width={0}
        act={act}
        siblings={siblings}
        dispatchButton={props.dispatch.button}
        actions={props.actions}
        dispatchHost={props.dispatch.host}
        dispatchFor={
          props.dispatch.buttonFor && props.dispatch.openMenuFor
            ? { button: props.dispatch.buttonFor, open: props.dispatch.openMenuFor }
            : undefined
        }
      />
    </div>
  );
}
prototypeIssueDocument.current = PrototypeIssueDocument;

function Switcher() {
  const current = useVariant();
  const index = variants.findIndex(variant => variant.key === current);
  const step = (by: number) => variantStore.set(variants[(index + by + variants.length) % variants.length].key);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], .xterm'))
        return;
      if (!event.altKey) return;
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  return (
    <div className="proto-switcher" role="toolbar" aria-label="原型变体" data-hint="⌥← / ⌥→ 切换">
      <button onClick={() => step(-1)} aria-label="上一个变体">
        ‹
      </button>
      <span>
        <b>{current}</b> ({variants[index].name}) · 数据全部编造
      </span>
      <button onClick={() => step(1)} aria-label="下一个变体">
        ›
      </button>
    </div>
  );
}

// ───────────── the invented workbench ─────────────

const capabilities: ForgeCapabilities = {
  subIssues: true,
  blocking: true,
  requiredChecks: true,
  mergeQueue: false,
  mergeMethods: ['merge', 'squash', 'rebase'],
};
const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
const repository: RepositoryReference = { forge: 'github', host: 'github.com', id: 'R_fake', path: repoPath };

const panel = (
  projectId: string,
  id: string,
  agent: AgentType,
  title: string,
  status: PanelView['status'],
): PanelView => ({
  id,
  agent,
  status,
  run: { id: `${id}-run`, panelId: id, projectId, state: 'running', title },
});

const mainPanels = [
  panel('workbench', 'p-claude', 'claude', '派发菜单显示「排进队列」', 'busy'),
  panel('workbench', 'p-codex', 'codex', '主进程保存派发队列', 'done'),
  panel('workbench', 'p-pi', 'pi', '诊断本轮结束重复触发', 'needs-input'),
];
const panelOf = (agent: AgentType) => mainPanels.find(item => item.agent === agent)?.id ?? null;

const project = (
  id: string,
  name: string,
  panels: PanelView[],
  layout: ProjectView['layout'],
  bound: boolean,
): ProjectView => ({
  id,
  name,
  directory: `/Users/me/Project/${name}`,
  panels,
  tray: [],
  layout,
  repository: bound ? repository : null,
  forge,
  capabilities,
  dispatches: bound ? fakeDispatchesForProject(id, panelOf) : [],
});

const snapshot: Snapshot = {
  navigation: { visible: true, width: 212 },
  forgeSidebar: { visible: true, width: 440 },
  activeProjectId: 'workbench',
  settings: { ...defaultSettings(), language: 'zh-CN', theme: 'light' },
  settingsConflicts: [],
  startupTheme: 'light',
  resolvedTheme: 'light',
  errors: [],
  projects: [
    project(
      'workbench',
      'workbench',
      mainPanels,
      {
        axis: 'column',
        ratio: 0.58,
        first: { panel: 'p-claude' },
        second: { axis: 'row', ratio: 0.5, first: { panel: 'p-codex' }, second: { panel: 'p-pi' } },
      },
      true,
    ),
    project(
      'dotfiles',
      'dotfiles',
      [panel('dotfiles', 'd-claude', 'claude', '整理 zsh 配置', 'ready')],
      { panel: 'd-claude' },
      false,
    ),
  ],
};

const listeners = new Set<(event: WorkbenchEvent) => void>();
const emit = (event: WorkbenchEvent) => {
  for (const listener of listeners) listener(event);
};
const publish = () => emit({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
const activeProject = (id: string) =>
  requireValue(
    snapshot.projects.find(item => item.id === id),
    `project ${id}`,
  );

const later = <T,>(value: T, ms = 180) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const filtered = <T extends { title: string }>(items: T[], search: string) =>
  items.filter(item => item.title.toLowerCase().includes(search.toLowerCase()));

const data = new ForgeSidebarData({
  issuePage: (_, query) => {
    const items = filtered(fakeListedIssues(query.filter.state), query.filter.search);
    return later({
      ok: true,
      items,
      nextCursor: null,
      labels: [],
      counts: { open: fakeListedIssues('open').length, closed: fakeListedIssues('closed').length },
    });
  },
  pullRequestPage: (_, query) =>
    later({
      ok: true,
      items: filtered(fakePullRequests(query.filter.state), query.filter.search),
      nextCursor: null,
      labels: [],
      counts: { open: fakePullRequests('open').length, closed: fakePullRequests('closed').length },
    }),
  issuesByNumber: (_, numbers) =>
    later({
      ok: true,
      items: [...fakeListedIssues('open'), ...fakeListedIssues('closed')].filter(item => numbers.includes(item.number)),
    }),
  pullRequestsByNumber: (_, numbers) =>
    later({
      ok: true,
      items: [...fakePullRequests('open'), ...fakePullRequests('closed')].filter(item => numbers.includes(item.number)),
    }),
  repositoryChoices: () => later({ ok: true, forge, account: 'me', origin: null, repositories: [repository] }),
  issueDetail: (_, number) =>
    knows(number)
      ? later({ ok: true, issue: fakeIssue(number) }, 260)
      : later({ ok: false, failure: { kind: 'notFound', message: `原型里没有 #${number}` } } as never),
  pullRequestDetail: (_, number) => {
    const pullRequest = fakePullRequestDetail(number);
    return pullRequest
      ? later({ ok: true, pullRequest }, 260)
      : later({ ok: false, failure: { kind: 'notFound', message: `原型里没有 PR #${number}` } } as never);
  },
  forge: () => forge,
  emit,
});

const greeting: Record<string, string> = {
  'p-claude-run':
    '\x1b[2m╭──────────────────────────────────────────╮\r\n│ ✻ Claude Code（原型里编造的终端画面）     │\r\n╰──────────────────────────────────────────╯\x1b[0m\r\n\r\n> /tdd https://github.com/example/workbench/issues/504\r\n\r\n● 读取 #504 和父 issue #500…\r\n● 写第一个失败的测试：派发菜单出现「排进队列」\r\n\x1b[33m  ✗ tests/components/DispatchQueue.test.tsx\x1b[0m\r\n',
  'p-codex-run':
    '\x1b[2mCodex（原型里编造的终端画面）\x1b[0m\r\n\r\n› $tdd https://github.com/example/workbench/issues/501\r\n\r\n\x1b[32m✓ 12 tests passed\x1b[0m\r\nPR #611 已创建。\r\n',
  'p-pi-run':
    '\x1b[2mpi（原型里编造的终端画面）\x1b[0m\r\n\r\n> /skill:diagnosing-bugs https://github.com/example/workbench/issues/503\r\n\r\n复现了：恢复会话时本轮结束触发两次。\r\n\x1b[36m? 要先在 terminal-core 修 #88 吗？(y/n)\x1b[0m ',
  'd-claude-run': '\x1b[2mClaude Code（原型里编造的终端画面）\x1b[0m\r\n\r\n> \r\n',
};

const quiet = async () => {};
const api: Partial<DesktopAPI> = {
  fetchSnapshot: async () => structuredClone(snapshot),
  reportRendererReady: async () => {
    setTimeout(() => {
      for (const [runId, text] of Object.entries(greeting)) emit({ kind: 'output', runId, data: text });
    }, 400);
  },
  subscribe: listener => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  saveSidebar: async (sidebar, preferences) => {
    snapshot[sidebar] = preferences;
    publish();
  },
  saveLayout: async (projectId, layout) => {
    activeProject(projectId).layout = layout;
    publish();
  },
  activateProject: async id => {
    snapshot.activeProjectId = id;
    publish();
  },
  showForgeList: (id, view) => data.showList(id, view),
  reportForgeSidebarPresence: presence => data.reportPresence(presence),
  loadMoreForgeList: id => data.loadMore(id),
  showForgeRows: (id, numbers) => data.showRows(id, numbers),
  refreshForgeList: id => data.refresh(id),
  showRepositoryChoices: id => data.showRepositoryChoices(id),
  showForgeDetail: (id, item) => data.showDetail(id, item),
  reportForgeRowResting: (id, item) => data.reportRestingOn(id, item),
  reportForgeItemChanged: (id, item) => data.reloadChanged(id, item),
  dispatch: async (projectId, request) => {
    const target = activeProject(projectId);
    const panelId = request.target.kind === 'panel' ? request.target.panelId : (target.panels[0]?.id ?? 'p-claude');
    const agent = target.panels.find(item => item.id === panelId)?.agent ?? 'claude';
    target.dispatches = [
      ...target.dispatches,
      {
        issueNumber: request.issue.number,
        dispatchedAt: new Date().toISOString(),
        agent,
        skill: request.commandId,
        sessionId: `${Date.now().toString(16)}-fake-session`,
        location: { projectId, panelId },
      },
    ];
    publish();
    emit({
      kind: 'output',
      runId: `${panelId}-run`,
      data: `\r\n\x1b[35m（原型）派发 #${request.issue.number} → ${request.commandId}\x1b[0m\r\n`,
    });
    return { delivery: 'submit', panelId };
  },
  sendInput: async (run, input) => emit({ kind: 'output', runId: run, data: input === '\r' ? '\r\n' : input }),
  resizeRun: quiet,
  acknowledgeOutput: () => {},
  performDirectAction: async () => ({ ok: true, detail: '（原型）没有真的执行' }),
};

window.workbench = new Proxy(api, {
  get(target, key) {
    if (key in target) return Reflect.get(target, key);
    return async () => {
      console.warn(`（原型）没有实现 workbench.${String(key)}`);
      return undefined;
    };
  },
}) as DesktopAPI;

const root = requireValue(document.getElementById('root'), 'the #root element');
createRoot(root).render(<App />);
const bar = document.createElement('div');
document.body.append(bar);
createRoot(bar).render(<Switcher />);
