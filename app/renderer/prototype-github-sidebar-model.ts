// PROTOTYPE — throwaway, lives only on branch `prototype/github-sidebar`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). Snapshot shape, indexes and filtering shared by the right-sidebar variants (#139).

export interface Issue { number: number; title: string; state: 'open' | 'closed'; reason: string; createdAt: string; updatedAt: string; author?: string; assignees: string[]; labels: string[]; comments: number; parent: number | null; blockedBy: number[]; prs: number[]; body: string }
export interface Pull { number: number; title: string; state: 'open' | 'closed' | 'merged' | 'draft'; createdAt: string; updatedAt: string; author?: string; branch: string; additions: number; deletions: number; review: string; checks: string; closes: number[] }
export interface Snapshot { repo: string; fetchedAt: string; labels: { name: string; color: string }[]; issues: Issue[]; pulls: Pull[] }

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

export function index(snapshot: Snapshot): Repo {
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

export type StateFilter = 'open' | 'closed' | 'all';
export type Sort = 'updated' | 'created' | 'created-asc';
export interface Filter { q: string; state: StateFilter; labels: string[]; sort: Sort }
export const emptyFilter: Filter = { q: '', state: 'open', labels: [], sort: 'updated' };

const textMatch = (q: string, number: number, title: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if (/^#?\d+$/.test(t)) return String(number).startsWith(t.replace('#', ''));
  return title.toLowerCase().includes(t);
};
const isOpenPull = (p: Pull) => p.state === 'open' || p.state === 'draft';

/** Text and label match, ignoring the open/closed filter (the graph handles closed nodes on its own). */
export const issueMatchesText = (i: Issue, f: Filter) => textMatch(f.q, i.number, i.title) && f.labels.every(l => i.labels.includes(l));
export const issueMatches = (i: Issue, f: Filter) => issueMatchesText(i, f) && (f.state === 'all' || i.state === f.state);
/** PRs carry no labels in the snapshot: a label filter keeps a PR when an issue it closes has those labels. */
export const pullMatchesText = (repo: Repo, p: Pull, f: Filter) => textMatch(f.q, p.number, p.title)
  && (!f.labels.length || p.closes.some(n => { const i = repo.issues.get(n); return !!i && f.labels.every(l => i.labels.includes(l)); }));
export const pullMatches = (repo: Repo, p: Pull, f: Filter) => pullMatchesText(repo, p, f) && (f.state === 'all' || (f.state === 'open') === isOpenPull(p));
export const pullIsOpen = isOpenPull;

export const sorted = <T extends { createdAt: string; updatedAt: string; number: number }>(list: T[], sort: Sort) => [...list].sort((a, b) =>
  sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));

export const openBlockers = (repo: Repo, i: Issue) => i.blockedBy.filter(n => repo.issues.get(n)?.state === 'open');
export const childProgress = (repo: Repo, n: number) => {
  const list = (repo.children.get(n) ?? []).map(c => repo.issues.get(c)!).filter(Boolean);
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

/** Fake dispatch records: a dispatch points at a session, shown here by the session title it went to. */
export interface DispatchRecord { issue: number; session: string; step: string; at: string; located: boolean }
export const steps = ['/grill-with-docs', '/to-spec', '/to-tickets', '/implement', '自由指令'];
export const initialDispatches: DispatchRecord[] = [
  { issue: 139, session: '原型：临时面板呈现', step: '/wayfinder', at: new Date(Date.now() - 40 * 60e3).toISOString(), located: true },
  { issue: 140, session: 'grill：底栏汇总位置', step: '/grill-with-docs', at: new Date(Date.now() - 26 * 3600e3).toISOString(), located: false },
];

export type Selected = { kind: 'issue' | 'pull'; number: number } | undefined;

export const variants = [
  { key: 'list', name: '列表 + 局部关系图' },
  { key: 'tree', name: '树形大纲' },
  { key: 'graph', name: '全图' },
] as const;
export type Variant = typeof variants[number]['key'];
export const places = [{ key: 'full', name: '贯通到底' }, { key: 'below', name: '工具栏下方' }] as const;
export const fits = [{ key: 'auto', name: '自动（窄窗口覆盖）' }, { key: 'push', name: '总是挤压' }, { key: 'overlay', name: '总是覆盖' }] as const;
export type Place = typeof places[number]['key'];
export type Fit = typeof fits[number]['key'];

export const param = <T extends string>(name: string, keys: readonly T[], fallback: T): T => {
  const value = new URLSearchParams(location.search).get(name);
  return keys.includes(value as T) ? value as T : fallback;
};
export const cycle = <T extends string>(list: readonly { key: T }[], current: T, step: number) => list[(list.findIndex(i => i.key === current) + step + list.length) % list.length].key;
export const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]');
