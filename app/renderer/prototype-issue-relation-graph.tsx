import { useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Localization, useLocalization } from './common/Localization';
import { HoverHints } from './common/HoverHints';
import { requireValue } from './common/required';
import { agentNames, type ProjectView } from '../shared/model';
import type { RepositoryReference } from '../shared/forge/forge';
import type { DetailItem } from '../shared/forge/sidebar-data';
import { linkedItem } from './forge/ForgeDisplay';
import { idleActions } from './forge/DirectActions';
import { PullRequestDocument } from './forge/PullRequestDetail';
import { fakeDispatchRecords, fakeOpenState, loadItem, type Loaded } from './prototype-issue-relation-graph-data';
import type { Act, VariantProps } from './prototype-issue-relation-graph-parts';
import { BlockedAtEndVariant, BlockedLeadVariant, BlockedLineVariant } from './prototype-issue-relation-graph-variants';
import './style.css';
import './forge/forge-sidebar.css';
import './forge/direct-actions.css';
import './forge/pull-request-detail.css';
import './dispatch/dispatch.css';
import './prototype-issue-relation-graph.css';
import './prototype-issue-relation-graph-light.css';
import './prototype-issue-relation-graph-scenarios.css';

const variants: { key: string; name: string; Component: ComponentType<VariantProps> }[] = [
  { key: 'A', name: '阻塞标志放在行尾', Component: BlockedAtEndVariant },
  { key: 'B', name: '阻塞标志替换行首的状态图标', Component: BlockedLeadVariant },
  { key: 'C', name: '阻塞标志在标题下方单独一行', Component: BlockedLineVariant },
];

interface Scenario {
  title: string;
  task: string;
  issue: number;
  width: number;
  open: boolean;
  look: string[];
}
const scenarios: Scenario[] = [
  {
    title: '进行中的 spec（编造）',
    task: '下一个能派发的子 issue 是哪个？点它进去看看',
    issue: 232,
    width: 480,
    open: true,
    look: [
      '编造：后一半子 issue 被设为打开，阻塞关系是真实的',
      '点子 issue、阻塞项、父 issue、PR 都会打开它们的详情，‹ 返回',
    ],
  },
  {
    title: '没有任何关系的 issue',
    task: '卡片只剩一行时，和正文的分界还清楚吗？',
    issue: 316,
    width: 480,
    open: false,
    look: ['没有关系图，只有「关闭本 issue · 还没有 pull request」', '卡片下方仍是「GitHub 原文」分界'],
  },
  {
    title: '被 4 个 issue 阻塞 · 窄 · 已关闭',
    task: '已关闭的 issue，关系图是否退到背景里？',
    issue: 284,
    width: 320,
    open: false,
    look: ['已关闭时整张图变淡', '左栏 4 个阻塞都已完成：连线是灰色'],
  },
  {
    title: '阻塞 6 个 issue · 宽',
    task: '720px 时本 issue 节点是否只占内容的宽度？',
    issue: 298,
    width: 720,
    open: false,
    look: ['中间节点不再被拉宽', '左右两栏的标题显示得更完整'],
  },
];

const repoPath = 'a1457139709/VibeBridge';
const project: ProjectView & { repository: RepositoryReference } = {
  id: 'prototype',
  name: 'VibeBridge',
  directory: '',
  layout: null,
  panels: [],
  tray: [],
  dispatches: [],
  repository: { forge: 'github', host: 'github.com', id: repoPath, path: repoPath },
  forge: { name: 'GitHub', cli: 'gh', installUrl: '', loginCommand: '' },
  capabilities: {
    subIssues: true,
    blocking: true,
    requiredChecks: true,
    mergeQueue: false,
    mergeMethods: ['merge', 'squash', 'rebase'],
  },
};

const readParam = (name: string) => new URLSearchParams(location.search).get(name);
const writeParam = (name: string, value: string) => {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(null, '', url);
};

function Switcher({ current, set }: { current: string; set(key: string): void }) {
  const index = variants.findIndex(variant => variant.key === current);
  const step = (by: number) => set(variants[(index + by + variants.length) % variants.length].key);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  return (
    <div className="proto-switcher" role="toolbar" aria-label="原型变体">
      <button onClick={() => step(-1)} aria-label="上一个变体">
        ‹
      </button>
      <span>
        <b>{current}</b> ({variants[index].name})
      </span>
      <button onClick={() => step(1)} aria-label="下一个变体">
        ›
      </button>
    </div>
  );
}

const initial = scenarios[Number(readParam('scenario') ?? 0)] ?? scenarios[0];

type Shown = { item: DetailItem; loaded: Loaded | null; failed: string | null; loading: boolean };

function useLive({ kind, number }: DetailItem) {
  const cache = useRef(new Map<string, Loaded>());
  const key = `${kind} ${number}`;
  const [shown, setShown] = useState<Shown>({ item: { kind, number }, loaded: null, failed: null, loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    const item = { kind, number };
    setShown({ item, loaded: cache.current.get(key) ?? null, failed: null, loading: true });
    loadItem(item).then(
      loaded => {
        cache.current.set(key, loaded);
        if (current) setShown({ item, loaded, failed: null, loading: false });
      },
      (error: unknown) => {
        if (current)
          setShown(state => ({
            ...state,
            failed: error instanceof Error ? error.message : String(error),
            loading: false,
          }));
      },
    );
    return () => {
      current = false;
    };
  }, [kind, number, key, version]);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  return { ...shown, refresh };
}

function Page() {
  const { t } = useLocalization();
  const [variant, setVariant] = useState(() => {
    const found = readParam('variant')?.toUpperCase() ?? 'A';
    return variants.some(item => item.key === found) ? found : 'A';
  });
  const [width, setWidth] = useState(() => Number(readParam('width')) || initial.width);
  const [theme, setTheme] = useState(() => readParam('theme') ?? 'light');
  const [trail, setTrail] = useState<DetailItem[]>(() => [
    { kind: 'issue', number: Number(readParam('issue')) || initial.issue },
  ]);
  const [toast, setToast] = useState<string | null>(null);
  const [fakeOpen, setFakeOpen] = useState(() => (readParam('open') ? readParam('open') === '1' : initial.open));
  const [scenario, setScenario] = useState<number | null>(() =>
    readParam('scenario') ? Number(readParam('scenario')) : 0,
  );
  const [jump, setJump] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const item = trail.at(-1) ?? trail[0];
  const live = useLive(item);
  const set = (name: string, value: string) => writeParam(name, value);
  const open = (next: DetailItem) => {
    setTrail(items => [...items, next]);
    scroller.current?.scrollTo({ top: 0 });
  };
  const back = () => {
    setTrail(items => (items.length > 1 ? items.slice(0, -1) : items));
    scroller.current?.scrollTo({ top: 0 });
  };
  const load = (index: number) => {
    const chosen = scenarios[index];
    setScenario(index);
    setTrail([{ kind: 'issue', number: chosen.issue }]);
    setWidth(chosen.width);
    setFakeOpen(chosen.open);
    setVariant('A');
    set('scenario', String(index));
    set('issue', String(chosen.issue));
    set('width', String(chosen.width));
    set('open', chosen.open ? '1' : '0');
    set('variant', 'A');
    scroller.current?.scrollTo({ top: 0 });
  };
  const chooseVariant = (key: string) => {
    setVariant(key);
    set('variant', key);
  };
  const active = scenario === null ? null : scenarios[scenario];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  const act: Act = {
    openIssue: reference => open({ kind: 'issue', number: reference.number }),
    openPull: pull => open({ kind: 'pullRequest', number: pull.number }),
    locate: record =>
      setToast(
        record.location
          ? `（原型）定位到 ${agentNames[record.agent]} 所在的面板`
          : `（原型）这个会话已不在打开的面板里，只显示记录`,
      ),
  };
  const followLink = (event: MouseEvent) => {
    const loaded = live.loaded;
    if (!loaded) return;
    const links = loaded.kind === 'issue' ? loaded.issue.links : loaded.pullRequest.links;
    const href = event.target instanceof Element ? event.target.closest('a')?.getAttribute('href') : undefined;
    const linked = href ? linkedItem(href, links) : null;
    if (!linked) return;
    event.preventDefault();
    open(linked);
  };
  const { Component } = variants.find(entry => entry.key === variant) ?? variants[0];
  const loaded = live.loaded?.kind === item.kind && live.item === item ? live.loaded : null;
  const faked = fakeOpen && trail.length === 1;
  const issue = loaded?.kind === 'issue' ? (faked ? fakeOpenState(loaded.issue) : loaded.issue) : null;
  const records = loaded?.kind === 'issue' ? fakeDispatchRecords(loaded.issue) : [];
  const url = loaded ? (loaded.kind === 'issue' ? loaded.issue.url : loaded.pullRequest.url) : undefined;
  return (
    <div className="proto-page">
      <div className="proto-controls">
        <b>PROTOTYPE · issue 详情的关系卡片 · 实时数据</b>
        <div className="sc-tabs" role="tablist">
          {scenarios.map((entry, index) => (
            <button key={index} role="tab" aria-selected={scenario === index} onClick={() => load(index)}>
              {index + 1}. {entry.title}
            </button>
          ))}
        </div>
        {active && (
          <div className="sc-card">
            <div className="sc-task">{active.task}</div>
            <div className="sc-setup">
              #{active.issue} · {active.width}px{active.open ? ' · 模拟打开（编造）' : ''}
            </div>
            <div className="sc-variants">
              {variants.map(entry => (
                <button
                  key={entry.key}
                  className={variant === entry.key ? 'on' : ''}
                  onClick={() => chooseVariant(entry.key)}
                >
                  <b>{entry.key}</b> {entry.name}
                </button>
              ))}
            </div>
            <div className="sc-look-head">看什么</div>
            <ul className="sc-look">
              {active.look.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button className="sc-reload" onClick={() => scenario !== null && load(scenario)}>
              重新载入这个场景
            </button>
          </div>
        )}
        <details className="sc-free">
          <summary>自由调节</summary>
          <form
            className="proto-jump"
            onSubmit={event => {
              event.preventDefault();
              const number = Number(jump.replace('#', ''));
              if (!number) return;
              setScenario(null);
              setTrail([{ kind: 'issue', number }]);
              set('issue', String(number));
            }}
          >
            <label>
              打开 issue
              <input value={jump} placeholder="#240" onChange={event => setJump(event.target.value)} />
            </label>
            <button type="submit">打开</button>
          </form>
          <label>
            侧边栏宽度 {width}px
            <input
              type="range"
              min={320}
              max={720}
              step={10}
              value={width}
              onChange={event => {
                setWidth(Number(event.target.value));
                set('width', event.target.value);
              }}
            />
          </label>
          <div className="proto-presets">
            {[320, 420, 560, 720].map(value => (
              <button
                key={value}
                onClick={() => {
                  setWidth(value);
                  set('width', String(value));
                }}
              >
                {value}
              </button>
            ))}
            <button
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                set('theme', next);
              }}
            >
              {theme === 'dark' ? '☾ 深色' : '☀ 浅色'}
            </button>
          </div>
          <label className="proto-check">
            <input
              type="checkbox"
              checked={fakeOpen}
              onChange={event => {
                setFakeOpen(event.target.checked);
                set('open', event.target.checked ? '1' : '0');
              }}
            />
            模拟打开状态（编造，只作用于起始 issue）
          </label>
        </details>
      </div>
      <section className="proto-pane" style={{ width }} aria-label={t('issueDetail')}>
        <header className="forge-detail-bar">
          <button aria-label={t('detailBack')} disabled={trail.length < 2} onClick={back}>
            ‹
          </button>
          <span className="forge-detail-crumb">
            {item.kind === 'issue'
              ? t('issueCrumb', { number: item.number })
              : t('pullRequestCrumb', { number: item.number })}
          </span>
          <button
            className="proto-refresh"
            data-hint="重新从 GitHub 读取"
            onClick={live.refresh}
            disabled={live.loading}
          >
            {live.loading ? '读取中…' : '↻'}
          </button>
          <span className="forge-spacer" />
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              {t('openOnForge', { forge: 'GitHub' })}
            </a>
          )}
          <button aria-label={t('closeDetail')}>×</button>
        </header>
        <div className="forge-detail-scroll" ref={scroller}>
          {live.failed && <div className="proto-failed">读取失败：{live.failed}</div>}
          {!loaded && !live.failed && <div className="proto-loading">从 GitHub 读取 #{item.number}…</div>}
          {issue && (
            <div onClick={followLink}>
              <Component
                key={`${variant} ${issue.number} ${faked}`}
                issue={issue}
                records={records}
                width={width}
                act={act}
              />
            </div>
          )}
          {loaded?.kind === 'pullRequest' && (
            <PullRequestDocument
              project={project}
              pullRequest={loaded.pullRequest}
              open={open}
              followLink={followLink}
              actions={{ ...idleActions, perform: () => setToast('（原型）不执行操作'), dismiss: () => {} }}
            />
          )}
        </div>
      </section>
      {toast && (
        <div className="proto-toast" role="status">
          {toast}
        </div>
      )}
      <Switcher current={variant} set={chooseVariant} />
      <HoverHints />
    </div>
  );
}

createRoot(requireValue(document.getElementById('root'), 'the #root element')).render(
  <Localization language="zh-CN">
    <Page />
  </Localization>,
);
