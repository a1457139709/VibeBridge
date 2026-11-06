// PROTOTYPE — throwaway, lives only on branch `prototype/github-sidebar`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). v2 (#139): snapshot shape, indexes, filtering and the fake dispatch state.
import type { ProcessingState } from '../shared/processing-status';

export interface Comment { author?: string; body: string; at: string }
export interface Issue { number: number; title: string; state: 'open' | 'closed'; reason: string; createdAt: string; updatedAt: string; author?: string; assignees: string[]; labels: string[]; parent: number | null; blockedBy: number[]; prs: number[]; body: string; comments: Comment[] }
export interface Review { author?: string; state: string; body: string; at: string }
export interface Pull {
  number: number; title: string; state: 'open' | 'closed' | 'merged' | 'draft'; createdAt: string; updatedAt: string; author?: string; branch: string; additions: number; deletions: number;
  review: string; checks: string; closes: number[]; body: string; changedFiles: number; comments: Comment[]; reviews: Review[]; checkRuns: { name: string; state: string }[];
}
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
export const pullMatches = (p: Pull, f: Filter) => textMatch(f.q, p.number, p.title) && (f.state === 'open') === pullIsOpen(p);
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
