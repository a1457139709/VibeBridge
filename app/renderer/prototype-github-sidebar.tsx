// PROTOTYPE — throwaway, lives only on branch `prototype/github-sidebar`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). Question (#139): what the right sidebar looks like and how it sits beside navigation, the
// layout area and the ephemeral panel tray. v2 — replaces visiting GitHub: find an issue, read it, dispatch, come back later.
// Data is a real read-only `gh` snapshot (npm run prototype:github-sidebar). v1 variants live in this branch's history.
import React, { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react';
import { Localization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import './style.css';
import './processing-status.css';
import './project-summary.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import './prototype-github-sidebar-pull.css';
import { initialEphemeral, initialPersistent, initialTree, pane, statusName, type Pane as FakePane } from './prototype-ephemeral-panels-data';
import { boxes } from './prototype-ephemeral-panels-layout';
import { NavLink, PanelView, ToolbarSummary } from './prototype-ephemeral-panels-views';
import { emptyFilter, fits, index, initialDispatches, issueMatches, param, places, pullMatches, sameSelection, typing,
  type DispatchRecord, type Filter, type Fit, type Pane, type Place, type Repo, type Selected, type Snapshot } from './prototype-github-sidebar-model';
import { FilterBar } from './prototype-github-sidebar-common';
import { IssueList, PullList } from './prototype-github-sidebar-lists';
import { DetailPane } from './prototype-github-sidebar-detail';

function Prototype() {
  const [place, setPlace] = useState<Place>(() => param('place', places.map(p => p.key), 'full'));
  const [fit, setFit] = useState<Fit>(() => param('fit', fits.map(f => f.key), 'push'));
  const [theme, setTheme] = useState(() => param('theme', ['dark', 'light'], 'dark'));
  const [repo, setRepo] = useState<Repo>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  const [width, setWidth] = useState(380);
  const [detailWidth, setDetailWidth] = useState(640);
  const [winW, setWinW] = useState(window.innerWidth);
  const [tab, setTab] = useState<'issue' | 'pull'>('issue');
  const [filters, setFilters] = useState<Record<'issue' | 'pull', Filter>>({ issue: emptyFilter, pull: emptyFilter });
  const [history, setHistory] = useState<NonNullable<Selected>[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>(initialDispatches);
  const [ephemeral, setEphemeral] = useState<FakePane[]>(initialEphemeral);
  const [maximized, setMaximized] = useState<string>();
  const [flash, setFlash] = useState<string>();
  const [barHidden, setBarHidden] = useState(false);
  const selected = history[history.length - 1];

  useEffect(() => {
    fetch('./prototype-github-sidebar.snapshot.json').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((s: Snapshot) => setRepo(index(s))).catch(e => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete('row'); url.searchParams.set('place', place); url.searchParams.set('fit', fit); url.searchParams.set('theme', theme);
    window.history.replaceState(null, '', url);
  }, [place, fit, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const resize = () => setWinW(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || typing(e.target)) return;
      if (history.length) setHistory([]); else if (maximized) setMaximized(undefined);
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [history.length, maximized]);

  const overlay = fit === 'overlay'; // mirrors the one setting: squeeze or cover, never switched by window width
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
    e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = (m: PointerEvent) => setWidth(Math.round(Math.min(Math.max(300, right - m.clientX), 560)));
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const all = [...initialPersistent, ...ephemeral];
  const panes: Pane[] = all.map(p => ({ id: p.id, title: p.title, agent: p.agent, status: p.status, ephemeral: ephemeral.includes(p) }));
  // Clicking a row opens it; clicking the open row closes the pane. Links inside the pane push onto a small back stack.
  const select = (s: Selected) => setHistory(h => !s || sameSelection(h[h.length - 1], s) ? [] : [s]);
  const openInside = (s: Selected) => { if (s) { setHistory(h => [...h, s]); setTab(s.kind); } };
  const locate = (id: string) => {
    setHistory([]);
    if (ephemeral.some(p => p.id === id)) setMaximized(id);
    else { setMaximized(undefined); setFlash(id); setTimeout(() => setFlash(f => f === id ? undefined : f), 1600); }
  };
  const dispatch = (issue: number, step: string, target: string | 'new') => {
    let id = target;
    if (target === 'new') {
      id = `d${Date.now()}`;
      const seed = issue % 50;
      setEphemeral(list => [...list, pane(id, 'claude', '未命名任务', 'busy', seed, { lines: [`> ${step} #${issue}`, '', '⏺ 读取 issue…'] })]);
      // The fake run asks a question after a while so the row's status visibly changes.
      setTimeout(() => setEphemeral(list => list.map(p => p.id === id ? { ...p, title: `处理 #${issue}`, status: 'needs-input', question: '要按这个方案继续吗？' } : p)), 5000);
    }
    setDispatches(d => [...d, { issue, pane: id, step, at: new Date().toISOString() }]);
  };

  const filter = filters[tab];
  const setFilter = (update: (f: Filter) => Filter) => setFilters(f => ({ ...f, [tab]: update(f[tab]) }));
  const counts = repo && (tab === 'issue'
    ? { open: repo.snapshot.issues.filter(i => issueMatches(i, { ...filter, state: 'open' })).length, closed: repo.snapshot.issues.filter(i => issueMatches(i, { ...filter, state: 'closed' })).length }
    : { open: repo.snapshot.pulls.filter(p => pullMatches(p, { ...filter, state: 'open' })).length, closed: repo.snapshot.pulls.filter(p => pullMatches(p, { ...filter, state: 'closed' })).length });
  const openCount = (kind: 'issue' | 'pull') => !repo ? '–' : kind === 'issue' ? repo.snapshot.issues.filter(i => i.state === 'open').length : repo.snapshot.pulls.filter(p => p.state === 'open' || p.state === 'draft').length;

  const sidebar = open && <aside className={`gh-sidebar ${overlay ? 'overlay' : ''}`} style={{ width }} aria-label="GitHub">
    <div className="gh-resize" onPointerDown={startResize} title="拖动调整宽度" />
    {repo && selected && <DetailPane repo={repo} selected={selected} width={Math.min(detailWidth, winW - width - 40)} onWidth={setDetailWidth} canBack={history.length > 1}
      onBack={() => setHistory(h => h.slice(0, -1))} onClose={() => setHistory([])} onOpen={openInside} panes={panes} dispatches={dispatches} onDispatch={dispatch} onLocate={locate} />}
    <header className="gh-head"><span className="gh-repo">{repo?.snapshot.repo ?? '…'}</span><span className="gh-spacer" />
      <button title="收起侧边栏" onClick={() => { setOpen(false); setHistory([]); }}>×</button></header>
    <nav className="gh-tabs">{(['issue', 'pull'] as const).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
      {k === 'issue' ? 'Issues' : 'Pull requests'} <span>{openCount(k)}</span></button>)}</nav>
    {error && <p className="gh-empty">读不到快照（{error}）。先运行 <code>npm run prototype:github-sidebar</code>，它会用 gh 拉取数据。</p>}
    {!repo && !error && <p className="gh-empty">载入中…</p>}
    {repo && counts && <FilterBar repo={repo} filter={filter} setFilter={setFilter} counts={counts} />}
    {repo && tab === 'issue' && <IssueList repo={repo} filter={filter} setFilter={setFilter} selected={selected} onSelect={select} panes={panes} dispatches={dispatches} onDispatch={dispatch} onLocate={locate} />}
    {repo && tab === 'pull' && <PullList repo={repo} filter={filter} setFilter={setFilter} selected={selected} onSelect={select} />}
    {repo && <footer className="gh-foot">快照 {new Date(repo.snapshot.fetchedAt).toLocaleString('zh-CN', { hour12: false })} · 按创建时间排序</footer>}
  </aside>;

  const layout = boxes(initialTree);
  const maxPane = all.find(p => p.id === maximized);
  const group = <K extends string>(label: string, items: readonly { key: K; name: string }[], value: K, set: (k: K) => void) =>
    <span className="proto-group"><span>{label}</span>{items.map(i => <button key={i.key} className={value === i.key ? 'proto-on' : ''} onClick={() => set(i.key)}>{i.name}</button>)}</span>;
  return <Localization language="zh-CN"><div className="app proto proto-top">
    <header className="system-bar"><div className="system-brand">
      <button className={`gh-sys-toggle ${navOpen ? 'on' : ''}`} title={navOpen ? '收起项目导航' : '展开项目导航'} aria-pressed={navOpen} onClick={() => setNavOpen(o => !o)}>
        {navOpen ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}</button><span className="wordmark">VibeBridge</span></div>
      <button className={`gh-sys-toggle right ${open ? 'on' : ''}`} title={open ? '收起 GitHub 侧边栏' : '打开 GitHub 侧边栏'} aria-pressed={open} onClick={() => { setOpen(o => !o); setHistory([]); }}>
        {open ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}</button></header>
    {barHidden ? <button className="proto-bar proto-bar-mini" onClick={() => setBarHidden(false)}>PROTOTYPE ▴</button> : <div className="proto-bar" role="toolbar" aria-label="原型切换">
      <span className="proto-tag">PROTOTYPE v2</span>
      {group('高度', places, place, setPlace)}{group('与布局', fits, fit, setFit)}
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
      <span className="proto-state">{overlay ? '覆盖' : '挤压'} · 侧栏 {width}px · 窗口 {winW}px</span>
      <button title="隐藏原型切换条" onClick={() => setBarHidden(true)}>▾</button>
    </div>}
    <div className={`app-body ${place === 'full' ? 'gh-host' : ''}`}>
      {navOpen && <nav className="navigation" style={{ '--navigation-width': '220px' } as CSSProperties}>
        <div className="navigation-projects"><div className="nav-heading">项目</div>
          <section className="project-group">
            <div className="proto-project-row"><button className="project-disclosure">⌄</button><button className="project-link selected"><span className="project-initial">V</span><span className="project-name">VibeBridge</span><small>{all.length}</small></button></div>
            <div className="project-panels">{initialPersistent.map(p => <NavLink key={p.id} pane={p} selected={false} onClick={() => setMaximized(undefined)} />)}</div>
          </section>
          <section className="project-group"><div className="proto-project-row"><button className="project-disclosure">›</button><button className="project-link"><span className="project-initial">B</span><span className="project-name">blog</span><small>2</small></button></div></section>
          <button className="add-project"><span>＋</span>添加项目</button>
        </div>
        <div className="nav-footer"><span>本地工作台</span><button className="settings-entry">⚙</button></div>
      </nav>}
      <main><div className="workbench-page"><div className="workspace">
        <header className="workspace-toolbar proto-toolbar-summary"><span className="proto-tb-left" />
          <ToolbarSummary panes={all} ephemeralIds={new Set(ephemeral.map(p => p.id))} onLocate={locate} />
          <span className="gh-tb-right"><button className="proto-tb-add" title="新增临时面板">＋</button></span>
        </header>
        <div className={`gh-stage ${place === 'below' ? 'gh-host' : ''}`}>
          <div className="canvas proto-canvas">
            {maxPane ? <section className={`panel-slot ${maxPane.agent} proto-pop`} style={{ left: 0, top: 0, width: '100%', height: '100%' }}>
              <PanelView pane={maxPane} ephemeral={ephemeral.includes(maxPane)} focused onReply={() => {}} actions={<button title="收起（Esc）" onClick={() => setMaximized(undefined)}>⌄</button>} /></section>
              : initialPersistent.map(p => { const b = layout.get(p.id)!; return <section key={p.id} className={`panel-slot ${p.agent} ${flash === p.id ? 'gh-flash' : ''}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                <PanelView pane={p} focused={flash === p.id} onReply={() => {}} actions={<button title="放大面板" onClick={() => setMaximized(p.id)}>⤢</button>} /></section>; })}
          </div>
          {place === 'below' && sidebar}
        </div>
        <div className="proto-tray" aria-label="临时面板托盘">
          {ephemeral.map(p => <button key={p.id} className={`proto-card ${p.agent} status-${p.status} ${maximized === p.id ? 'open' : ''}`} onClick={() => setMaximized(m => m === p.id ? undefined : p.id)}>
            <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span><span className="session-title">{p.title}</span><small>{statusName[p.status]}</small></button>)}
        </div>
      </div></div></main>
      {place === 'full' && sidebar}
    </div>
  </div></Localization>;
}

createRoot(document.getElementById('root')!).render(<Prototype />);
