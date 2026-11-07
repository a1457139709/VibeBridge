// PROTOTYPE — throwaway, lives only on branch `prototype/github-sidebar`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). v2 (#139): snapshot shape, indexes, filtering and the fake dispatch state.
import type { ProcessingState } from '../shared/processing-status';

export interface Comment { author?: string; body: string; at: string }
export interface Issue { number: number; title: string; state: 'open' | 'closed'; reason: string; createdAt: string; updatedAt: string; author?: string; assignees: string[]; labels: string[]; parent: number | null; blockedBy: number[]; prs: number[]; body: string; comments: Comment[] }
export interface Review { author?: string; state: string; body: string; at: string }
export interface CheckRun { name: string; state: string; required?: boolean; url?: string }
export interface Pull {
  number: number; title: string; state: 'open' | 'closed' | 'merged' | 'draft'; createdAt: string; updatedAt: string; author?: string; branch: string; additions: number; deletions: number;
  review: string; checks: string; closes: number[]; body: string; changedFiles: number; comments: Comment[]; reviews: Review[]; checkRuns: CheckRun[];
  // v3 (#159): base branch, labels, who was asked to review, mergeability and what the repo allows.
  base?: string; labels?: string[]; requested?: string[]; mergeable?: 'mergeable' | 'conflicting' | 'unknown'; requiredApprovals?: number;
  mergeQueue?: boolean; mergeMethods?: string[]; codeComments?: number; demo?: boolean;
}
export interface Snapshot { repo: string; fetchedAt: string; viewer?: string; labels: { name: string; color: string }[]; issues: Issue[]; pulls: Pull[] }

export interface Repo {
  snapshot: Snapshot;
  issues: Map<number, Issue>;
  pulls: Map<number, Pull>;
  children: Map<number, number[]>;
  blocks: Map<number, number[]>; // issue -> issues it blocks
  prsOf: Map<number, number[]>; // issue -> PRs that close it
  labelColor: Map<string, string>;
}

const push = (map: Map<number, number[]>, key: number, value: number) => {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
};

// v3 (#159): the real repo has almost no checks or reviews, so a few labelled sample PRs cover every merge-box state.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
function samples(viewer: string, issues: Issue[]): Pull[] {
  const near = issues.filter(i => i.state === 'open').slice(0, 3).map(i => i.number);
  const base = { base: 'main', comments: [] as Comment[], updatedAt: hoursAgo(1), mergeMethods: ['squash', 'merge', 'rebase'], demo: true, requiredApprovals: 1 };
  const ci = (states: [string, string, boolean?][]): CheckRun[] => states.map(([name, state, required]) => ({ name, state, required, url: 'https://github.com' }));
  return [
    { ...base, number: 9005, title: '【示例】检查失败、有冲突、被要求修改', state: 'open', createdAt: hoursAgo(2), author: 'codex-agent', branch: 'feat/dispatch-menu', additions: 412, deletions: 38, changedFiles: 9,
      review: 'changes_requested', checks: 'failure', closes: near.slice(0, 1), labels: ['enhancement'], requested: ['alice'], mergeable: 'conflicting', codeComments: 7,
      checkRuns: ci([['typecheck', 'success', true], ['unit tests', 'failure', true], ['e2e (macOS)', 'in_progress'], ['lint', 'success', true], ['build', 'success']]),
      reviews: [{ author: 'bob', state: 'changes_requested', body: '派发菜单的 Space 执行和 ⌥ 反转还没处理，见代码评论。', at: hoursAgo(1.5) }, { author: 'carol', state: 'commented', body: '', at: hoursAgo(1.2) }],
      body: '实现派发级联菜单。\n\nCloses #' + (near[0] ?? 1) },
    { ...base, number: 9004, title: '【示例】检查通过、已批准，可以合并', state: 'open', createdAt: hoursAgo(5), author: 'claude-agent', branch: 'fix/tray-maximize', additions: 64, deletions: 12, changedFiles: 3,
      review: 'approved', checks: 'success', closes: near.slice(1, 2), labels: ['bug'], requested: [], mergeable: 'mergeable', codeComments: 0,
      checkRuns: ci([['typecheck', 'success', true], ['unit tests', 'success', true], ['lint', 'success', true], ['build', 'success']]),
      reviews: [{ author: 'alice', state: 'approved', body: 'LGTM', at: hoursAgo(3) }], body: '修复临时放大后托盘按钮错位。' },
    { ...base, number: 9003, title: '【示例】草稿，检查进行中，等待 review', state: 'draft', createdAt: hoursAgo(9), author: 'pi-agent', branch: 'spike/sidebar-refresh', additions: 120, deletions: 4, changedFiles: 5,
      review: 'review_required', checks: 'pending', closes: [], labels: [], requested: ['alice', 'frontend-team'], mergeable: 'mergeable', codeComments: 0,
      checkRuns: ci([['typecheck', 'success', true], ['unit tests', 'queued', true], ['lint', 'in_progress', true]]), reviews: [], body: '先看看刷新的事件来源。' },
    { ...base, number: 9002, title: '【示例】我自己的 PR，还缺一个批准', state: 'open', createdAt: hoursAgo(20), author: viewer, branch: 'docs/glossary', additions: 30, deletions: 2, changedFiles: 1,
      review: 'review_required', checks: 'success', closes: [], labels: ['documentation'], requested: ['bob'], mergeable: 'mergeable', codeComments: 2,
      checkRuns: ci([['typecheck', 'success', true], ['unit tests', 'success', true]]),
      reviews: [{ author: 'carol', state: 'commented', body: '术语「派发记录」的 Avoid 再想想。', at: hoursAgo(10) }], body: '补充词汇表。' },
    { ...base, number: 9001, title: '【示例】仓库要求走 merge queue', state: 'open', createdAt: hoursAgo(30), author: 'codex-agent', branch: 'chore/deps', additions: 210, deletions: 190, changedFiles: 2,
      review: 'approved', checks: 'success', closes: [], labels: ['dependencies'], requested: [], mergeable: 'mergeable', mergeQueue: true, codeComments: 0,
      checkRuns: ci([['typecheck', 'success', true], ['unit tests', 'success', true]]),
      reviews: [{ author: 'alice', state: 'approved', body: '', at: hoursAgo(26) }], body: '升级依赖。' },
  ];
}

export function index(raw: Snapshot): Repo {
  const viewer = raw.viewer ?? 'me';
  const snapshot: Snapshot = { ...raw, viewer, pulls: [...samples(viewer, raw.issues), ...raw.pulls] };
  const repo: Repo = {
    snapshot, issues: new Map(snapshot.issues.map(i => [i.number, i])), pulls: new Map(snapshot.pulls.map(p => [p.number, p])),
    children: new Map(), blocks: new Map(), prsOf: new Map(), labelColor: new Map(snapshot.labels.map(l => [l.name, `#${l.color}`])),
  };
  for (const i of snapshot.issues) {
    if (i.parent) push(repo.children, i.parent, i.number);
    for (const b of i.blockedBy) push(repo.blocks, b, i.number);
    for (const p of i.prs) if (repo.pulls.has(p)) push(repo.prsOf, i.number, p);
  }
  for (const p of snapshot.pulls) for (const n of p.closes) if (repo.issues.has(n)) push(repo.prsOf, n, p.number);
  for (const list of repo.children.values()) list.sort((a, b) => a - b);
  return repo;
}

export type StateFilter = 'open' | 'closed';
export interface Filter { q: string; state: StateFilter; labels: string[] }
export const emptyFilter: Filter = { q: '', state: 'open', labels: [] };

const textMatch = (q: string, number: number, title: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if (/^#?\d+$/.test(t)) return String(number).startsWith(t.replace('#', ''));
  return title.toLowerCase().includes(t);
};
export const pullIsOpen = (p: Pull) => p.state === 'open' || p.state === 'draft';
export const issueMatches = (i: Issue, f: Filter) => textMatch(f.q, i.number, i.title) && f.labels.every(l => i.labels.includes(l)) && i.state === f.state;
export const pullMatches = (p: Pull, f: Filter) => textMatch(f.q, p.number, p.title) && f.labels.every(l => (p.labels ?? []).includes(l)) && (f.state === 'open') === pullIsOpen(p);
/** Newest created first — the only order the sidebar offers. */
export const newestFirst = <T extends { createdAt: string }>(list: T[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const openBlockers = (repo: Repo, i: Issue) => i.blockedBy.filter(n => repo.issues.get(n)?.state === 'open');
export const childProgress = (repo: Repo, n: number) => {
  const list = (repo.children.get(n) ?? []).map(c => repo.issues.get(c)).filter((c): c is Issue => !!c);
  return { total: list.length, closed: list.filter(c => c.state === 'closed').length };
};

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
export const githubUrl = (repo: Repo, kind: 'issue' | 'pull', n: number) => `https://github.com/${repo.snapshot.repo}/${kind === 'issue' ? 'issues' : 'pull'}/${n}`;

// ---- fake workbench side -----------------------------------------------------------------------------------
export interface Pane { id: string; title: string; agent: 'claude' | 'codex' | 'pi'; status: ProcessingState; ephemeral: boolean }
/** A dispatch points at the session it went to; the prototype keeps the pane id to show where that session is now. */
export interface DispatchRecord { issue: number; pane: string; step: string; at: string }
export const steps = ['/grill-with-docs', '/to-spec', '/to-tickets', '/implement'];
export const defaultStep = steps[0];
export const initialDispatches: DispatchRecord[] = [
  { issue: 139, pane: 'e1', step: '/wayfinder', at: new Date(Date.now() - 40 * 60e3).toISOString() },
  { issue: 140, pane: 'e3', step: '/grill-with-docs', at: new Date(Date.now() - 26 * 3600e3).toISOString() },
];

export type Selected = { kind: 'issue' | 'pull'; number: number } | undefined;
export const sameSelection = (a: Selected, b: Selected) => !!a && !!b && a.kind === b.kind && a.number === b.number;

export const places = [{ key: 'full', name: '贯通到底' }, { key: 'below', name: '工具栏下方' }] as const;
// Mirrors the single setting. An old `fit=auto` in the URL is not a key any more, so param() falls back to the default.
export const fits = [{ key: 'push', name: '挤压' }, { key: 'overlay', name: '覆盖' }] as const;
export type Place = typeof places[number]['key'];
export type Fit = typeof fits[number]['key'];

export const param = <T extends string>(name: string, keys: readonly T[], fallback: T): T => {
  const value = new URLSearchParams(location.search).get(name);
  return keys.includes(value as T) ? value as T : fallback;
};
export const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]');
