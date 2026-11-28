// PROTOTYPE: three variants of the issue-detail relation card, all on invented data, switchable via ?variant=.
import { useEffect, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Localization, useLocalization } from './common/Localization';
import { HoverHints } from './common/HoverHints';
import { requireValue } from './common/required';
import { agentNames } from '../shared/model';
import type { DetailItem } from '../shared/forge/sidebar-data';
import { linkedItem } from './forge/ForgeDisplay';
import { fakeDispatchRecords, fakeIssue, knows } from './prototype-issue-relation-graph-data';
import type { Act, VariantProps } from './prototype-issue-relation-graph-parts';
import { PlanVariant, SpecVariant, verdictOf, VerdictVariant } from './prototype-issue-relation-graph-variants';
import './style.css';
import './forge/forge-sidebar.css';
import './forge/direct-actions.css';
import './dispatch/dispatch.css';
import './prototype-issue-relation-graph.css';
import './prototype-issue-relation-graph-light.css';
import './prototype-issue-relation-graph-scenarios.css';

const variants: { key: string; name: string; Component: ComponentType<VariantProps> }[] = [
  { key: 'A', name: 'spec #341 原样：三栏关系图', Component: SpecVariant },
  { key: 'B', name: '结论行 + 标签行', Component: VerdictVariant },
  { key: 'C', name: '结论行 + 子 issue 执行顺序', Component: PlanVariant },
];

const scenarios = [
  { issue: 500, title: '进行中的 spec', ask: '下一个能派发的子 issue 是哪个？' },
  { issue: 504, title: 'spec 里的一个子 issue', ask: '它被谁挡着、PR 怎么样、上次派给了谁？' },
  { issue: 506, title: '被两个兄弟挡着的子 issue', ask: '还要等多久才能开始？' },
  { issue: 530, title: '阻塞 6 个 issue', ask: '做完它能解开什么？' },
  { issue: 516, title: '没有任何关系', ask: '卡片只剩一两行时还清楚吗？' },
  { issue: 520, title: '已关闭，曾被 4 个挡过', ask: '已完成的 issue，卡片是否退到背景？' },
];

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

function Page() {
  const { t } = useLocalization();
  const [variant, setVariant] = useState(() => {
    const found = readParam('variant')?.toUpperCase() ?? 'C';
    return variants.some(item => item.key === found) ? found : 'C';
  });
  const [width, setWidth] = useState(() => Number(readParam('width')) || 420);
  const [theme, setTheme] = useState(() => readParam('theme') ?? 'light');
  const [trail, setTrail] = useState<number[]>(() => {
    const start = Number(readParam('issue'));
    return [knows(start) ? start : 500];
  });
  const [toast, setToast] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const number = trail.at(-1) ?? 500;
  const issue = fakeIssue(number);
  const records = fakeDispatchRecords(number);
  const siblings = issue.parent ? fakeIssue(issue.parent.number).subIssues : undefined;
  const verdict = verdictOf(issue);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  const go = (next: number) => {
    setTrail(items => [...items, next]);
    writeParam('issue', String(next));
    scroller.current?.scrollTo({ top: 0 });
  };
  const start = (next: number) => {
    setTrail([next]);
    writeParam('issue', String(next));
    scroller.current?.scrollTo({ top: 0 });
  };
  const back = () => {
    const items = trail.length > 1 ? trail.slice(0, -1) : trail;
    setTrail(items);
    writeParam('issue', String(items.at(-1)));
  };
  const act: Act = {
    openIssue: reference =>
      knows(reference.number) && reference.url.includes('/example/workbench/')
        ? go(reference.number)
        : setToast(`（原型）在浏览器打开 ${reference.url}`),
    openPull: pull => setToast(`（原型）在侧边栏打开 PR #${pull.number}`),
    locate: record =>
      setToast(
        record.location
          ? `（原型）定位到 ${agentNames[record.agent]} 所在的面板`
          : '（原型）这个会话已不在打开的面板里，只显示记录',
      ),
  };
  const followLink = (event: MouseEvent) => {
    const href = event.target instanceof Element ? event.target.closest('a')?.getAttribute('href') : undefined;
    const linked: DetailItem | null = href ? linkedItem(href, issue.links) : null;
    if (!linked) return;
    event.preventDefault();
    if (linked.kind === 'issue') go(linked.number);
  };
  const chooseVariant = (key: string) => {
    setVariant(key);
    writeParam('variant', key);
  };
  const { Component } = variants.find(entry => entry.key === variant) ?? variants[0];
  const openSubs = issue.subIssues.filter(sub => sub.state === 'open');
  return (
    <div className="pp-page">
      <aside className="pp-side">
        <header>
          <b>原型 · issue 详情的结论卡片</b>
          <span>数据全部编造 · 不读 GitHub</span>
        </header>
        <nav className="pp-scenarios" aria-label="场景">
          {scenarios.map(entry => (
            <button
              key={entry.issue}
              className={trail[0] === entry.issue ? 'on' : ''}
              onClick={() => start(entry.issue)}
            >
              <span className="pp-scenario-title">
                #{entry.issue} {entry.title}
              </span>
              <span className="pp-scenario-ask">{entry.ask}</span>
            </button>
          ))}
        </nav>
        <section className="pp-state" aria-label="当前状态">
          <div className="pp-state-head">当前状态</div>
          <dl>
            <dt>变体</dt>
            <dd>{variant}</dd>
            <dt>issue</dt>
            <dd>
              #{issue.number} · {issue.state}
            </dd>
            <dt>结论</dt>
            <dd>
              {verdict.tone} · {verdict.head}
            </dd>
            <dt>阻塞项</dt>
            <dd>
              {issue.blockedBy.map(item => `#${item.number}${item.state === 'open' ? '●' : '✓'}`).join(' ') || '—'}
            </dd>
            <dt>解锁</dt>
            <dd>{issue.blocking.map(item => `#${item.number}`).join(' ') || '—'}</dd>
            <dt>子 issue</dt>
            <dd>{issue.subIssues.length ? `${openSubs.length} 开 / ${issue.subIssues.length}` : '—'}</dd>
            <dt>PR</dt>
            <dd>
              {issue.closingPullRequests.map(pull => `#${pull.number} ${pull.state}/${pull.checks}`).join(' ') || '—'}
            </dd>
            <dt>派发</dt>
            <dd>{records.length} 次</dd>
            <dt>返回栈</dt>
            <dd>{trail.map(item => `#${item}`).join(' › ')}</dd>
          </dl>
        </section>
        <section className="pp-knobs">
          <label>
            侧边栏宽度 {width}px
            <input
              type="range"
              min={300}
              max={720}
              step={10}
              value={width}
              onChange={event => {
                setWidth(Number(event.target.value));
                writeParam('width', event.target.value);
              }}
            />
          </label>
          <div className="pp-presets">
            {[320, 420, 560].map(value => (
              <button
                key={value}
                className={width === value ? 'on' : ''}
                onClick={() => {
                  setWidth(value);
                  writeParam('width', String(value));
                }}
              >
                {value}
              </button>
            ))}
            <button
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                writeParam('theme', next);
              }}
            >
              {theme === 'dark' ? '☾ 深色' : '☀ 浅色'}
            </button>
          </div>
        </section>
      </aside>
      <section className="proto-pane" style={{ width }} aria-label={t('issueDetail')}>
        <header className="forge-detail-bar">
          <button aria-label={t('detailBack')} disabled={trail.length < 2} onClick={back}>
            ‹
          </button>
          <span className="forge-detail-crumb">{t('issueCrumb', { number: issue.number })}</span>
          <span className="forge-spacer" />
          <a href={issue.url} onClick={event => (event.preventDefault(), setToast('（原型）在 GitHub 打开'))}>
            {t('openOnForge', { forge: 'GitHub' })}
          </a>
          <button aria-label={t('closeDetail')}>×</button>
        </header>
        <div className="forge-detail-scroll" ref={scroller}>
          <div onClick={followLink}>
            <Component
              key={`${variant} ${issue.number}`}
              issue={issue}
              records={records}
              width={width}
              act={act}
              siblings={siblings}
            />
          </div>
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
