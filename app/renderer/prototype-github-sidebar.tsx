// PROTOTYPE — throwaway, lives only on branch `prototype/github-sidebar`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). Question (#139): what the right sidebar looks like — issue list / search / labels / detail / PR state —
// and how it sits next to project navigation, the layout area and the ephemeral panel tray.
// Three variants switchable with ?variant= (list | tree | graph) and ← →; data is a real read-only `gh` snapshot of the repo.
import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Localization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import './style.css';
import './processing-status.css';
import './project-summary.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import { initialEphemeral, initialPersistent, initialTree, statusName } from './prototype-ephemeral-panels-data';
import { boxes } from './prototype-ephemeral-panels-layout';
import { NavLink, PanelView, ToolbarSummary } from './prototype-ephemeral-panels-views';
import { cycle, emptyFilter, fits, index, initialDispatches, param, places, typing, variants, type DispatchRecord, type Filter, type Fit, type Place, type Repo, type Selected, type Snapshot, type Variant } from './prototype-github-sidebar-model';
import { Filters, IssueDetail, PullDetail, type Pane } from './prototype-github-sidebar-common';
import { ListVariant } from './prototype-github-sidebar-list';
import { TreeVariant } from './prototype-github-sidebar-tree';
import { GraphOptionsBar, GraphView, defaultGraphOptions, type GraphOptions } from './prototype-github-sidebar-graph';

function Prototype() {
  const [variant, setVariant] = useState<Variant>(() => param('variant', variants.map(v => v.key), 'list'));
  const [place, setPlace] = useState<Place>(() => param('place', places.map(p => p.key), 'full'));
  const [fit, setFit] = useState<Fit>(() => param('fit', fits.map(f => f.key), 'auto'));
  const [theme, setTheme] = useState(() => param('theme', ['dark', 'light'], 'dark'));
  const [repo, setRepo] = useState<Repo>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(360);
  const [winW, setWinW] = useState(window.innerWidth);
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [selected, setSelected] = useState<Selected>();
  const [dispatches, setDispatches] = useState<DispatchRecord[]>(initialDispatches);
  const [graphOptions, setGraphOptions] = useState<GraphOptions>(defaultGraphOptions);
  const [graphBig, setGraphBig] = useState(false);
  const [maximized, setMaximized] = useState<string>();
  const [barHidden, setBarHidden] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('./prototype-github-sidebar.snapshot.json').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((s: Snapshot) => setRepo(index(s))).catch(e => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('variant', variant); url.searchParams.set('place', place); url.searchParams.set('fit', fit); url.searchParams.set('theme', theme);
    history.replaceState(null, '', url);
  }, [variant, place, fit, theme]);
  useEffect(() => { const resize = () => setWinW(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === 'Escape') { if (graphBig) setGraphBig(false); else if (maximized) setMaximized(undefined); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setGraphBig(false); setVariant(v => cycle(variants, v, e.key === 'ArrowLeft' ? -1 : 1)); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [graphBig, maximized]);

  const overlay = fit === 'overlay' || (fit === 'auto' && winW < 1180);
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const right = (e.currentTarget.parentElement!.parentElement as HTMLElement).getBoundingClientRect().right;
    e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = (m: PointerEvent) => setWidth(Math.round(Math.min(Math.max(280, right - m.clientX), Math.max(320, winW * 0.6))));
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const all = [...initialPersistent, ...initialEphemeral];
  const panes: Pane[] = all.map(p => ({ id: p.id, title: p.title, agent: p.agent, ephemeral: initialEphemeral.includes(p) }));
  const onDispatch = (r: DispatchRecord) => setDispatches(d => [...d, r]);
  const layout = boxes(initialTree);
  const openIssues = repo?.snapshot.issues.filter(i => i.state === 'open').length;
  const shared = repo && { repo, filter, setFilter, selected, setSelected, panes, dispatches, onDispatch };

  const sidebar = open && <aside className={`gh-sidebar ${overlay ? 'overlay' : ''}`} style={{ width }} aria-label="GitHub">
    <div className="gh-resize" onPointerDown={startResize} title="拖动调整宽度" />
    <header className="gh-head"><span className="gh-repo">{repo?.snapshot.repo ?? '…'}</span>
      <small className="muted" title="原型：重新运行 npm run prototype:github-sidebar 更新快照">{repo ? `快照 ${new Date(repo.snapshot.fetchedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</small>
      <button title="收起侧边栏" onClick={() => setOpen(false)}>⇥</button></header>
    {error && <p className="gh-empty">读不到快照（{error}）。先运行 <code>npm run prototype:github-sidebar</code>，它会用 gh 拉取数据。</p>}
    {!repo && !error && <p className="gh-empty">载入中…</p>}
    {shared && variant === 'list' && <ListVariant {...shared} />}
    {shared && variant === 'tree' && <TreeVariant {...shared} />}
    {shared && variant === 'graph' && <>
      <Filters repo={shared.repo} filter={filter} setFilter={setFilter} showState={false} showSort={false} />
      <GraphOptionsBar options={graphOptions} setOptions={setGraphOptions} big={graphBig} onToggleBig={() => setGraphBig(b => !b)} />
      {graphBig ? <p className="gh-graph-away muted">关系图正在布局区域中临时放大 · Esc 或「收回侧边栏」返回</p>
        : <GraphView repo={shared.repo} filter={filter} options={graphOptions} selected={selected} setSelected={setSelected} />}
      {selected && <div className={`gh-graph-detail ${graphBig ? 'tall' : ''}`}><button className="gh-back" onClick={() => setSelected(undefined)}>× 关闭详情</button>
        {selected.kind === 'issue' && shared.repo.issues.get(selected.number) && <IssueDetail repo={shared.repo} issue={shared.repo.issues.get(selected.number)!} compact={!graphBig} onOpen={setSelected} panes={panes} dispatches={dispatches} onDispatch={onDispatch} />}
        {selected.kind === 'pull' && shared.repo.pulls.get(selected.number) && <PullDetail repo={shared.repo} pull={shared.repo.pulls.get(selected.number)!} onOpen={setSelected} />}
      </div>}
    </>}
  </aside>;

  const maxPane = all.find(p => p.id === maximized);
  return <Localization language="zh-CN"><div className="app proto proto-top">
    <header className="system-bar"><div className="system-brand"><button aria-hidden>☷</button><span className="wordmark">VibeBridge</span></div></header>
    {barHidden ? <button className="proto-bar proto-bar-mini" onClick={() => setBarHidden(false)}>PROTOTYPE ▴</button> : <div className="proto-bar" role="toolbar" aria-label="原型切换">
      <span className="proto-tag">PROTOTYPE</span>
      <span className="proto-group"><button onClick={() => { setGraphBig(false); setVariant(v => cycle(variants, v, -1)); }}>‹</button><span>侧边栏 <b>{variants.find(v => v.key === variant)!.name}</b></span><button onClick={() => { setGraphBig(false); setVariant(v => cycle(variants, v, 1)); }}>›</button></span>
      <span className="proto-group"><span>高度</span>{places.map(p => <button key={p.key} className={place === p.key ? 'proto-on' : ''} onClick={() => setPlace(p.key)}>{p.name}</button>)}</span>
      <span className="proto-group"><span>与布局</span>{fits.map(f => <button key={f.key} className={fit === f.key ? 'proto-on' : ''} onClick={() => setFit(f.key)}>{f.name}</button>)}</span>
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
      <span className="proto-state">{overlay ? '覆盖' : '挤压'} · 宽 {width}px · 窗口 {winW}px</span>
      <button title="隐藏原型切换条" onClick={() => setBarHidden(true)}>▾</button>
    </div>}
    <div className={`app-body ${place === 'full' ? 'gh-host' : ''}`} ref={body}>
      <nav className="navigation" style={{ '--navigation-width': '220px' } as CSSProperties}>
        <div className="navigation-projects"><div className="nav-heading">项目</div>
          <section className="project-group">
            <div className="proto-project-row"><button className="project-disclosure">⌄</button><button className="project-link selected"><span className="project-initial">V</span><span className="project-name">VibeBridge</span><small>{all.length}</small></button></div>
            <div className="project-panels">{initialPersistent.map(p => <NavLink key={p.id} pane={p} selected={false} onClick={() => setMaximized(undefined)} />)}</div>
          </section>
          <section className="project-group"><div className="proto-project-row"><button className="project-disclosure">›</button><button className="project-link"><span className="project-initial">B</span><span className="project-name">blog</span><small>2</small></button></div></section>
          <button className="add-project"><span>＋</span>添加项目</button>
        </div>
        <div className="nav-footer"><span>本地工作台</span><button className="settings-entry">⚙</button></div>
      </nav>
      <main><div className="workbench-page"><div className="workspace">
        <header className="workspace-toolbar proto-toolbar-summary"><span className="proto-tb-left" />
          <ToolbarSummary panes={all} ephemeralIds={new Set(initialEphemeral.map(p => p.id))} onLocate={id => setMaximized(initialEphemeral.some(p => p.id === id) ? id : undefined)} />
          <span className="gh-tb-right"><button className="proto-tb-add" title="新增临时面板">＋</button>
            <button className={`gh-toggle ${open ? 'on' : ''}`} title={open ? '收起 GitHub 侧边栏' : '打开 GitHub 侧边栏'} onClick={() => setOpen(o => !o)}>◎ <span>{openIssues ?? '–'}</span></button></span>
        </header>
        <div className={`gh-stage ${place === 'below' ? 'gh-host' : ''}`}>
          <div className="canvas proto-canvas">
            {graphBig && repo && variant === 'graph' ? <section className="panel-slot proto-pop gh-big" style={{ left: 0, top: 0, width: '100%', height: '100%' }}>
              <div className="agent-panel focused"><header className="panel-header"><span className="agent-title"><span className="session-title">关系图 · {repo.snapshot.repo}</span><span className="proto-badge">临时放大</span></span>
                <span className="panel-actions"><button title="收回侧边栏（Esc）" onClick={() => setGraphBig(false)}>⌄</button></span></header>
                <GraphView repo={repo} filter={filter} options={graphOptions} selected={selected} setSelected={setSelected} big /></div></section>
              : maxPane ? <section className={`panel-slot ${maxPane.agent} proto-pop`} style={{ left: 0, top: 0, width: '100%', height: '100%' }}>
                <PanelView pane={maxPane} ephemeral={initialEphemeral.includes(maxPane)} focused onReply={() => {}} actions={<button onClick={() => setMaximized(undefined)}>⌄</button>} /></section>
              : initialPersistent.map(p => { const b = layout.get(p.id)!; return <section key={p.id} className={`panel-slot ${p.agent}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                <PanelView pane={p} focused={false} onReply={() => {}} actions={<button title="放大面板" onClick={() => setMaximized(p.id)}>⤢</button>} /></section>; })}
          </div>
          {place === 'below' && sidebar}
        </div>
        <div className="proto-tray" aria-label="临时面板托盘">
          {initialEphemeral.map(p => <button key={p.id} className={`proto-card ${p.agent} status-${p.status} ${maximized === p.id ? 'open' : ''}`} onClick={() => setMaximized(m => m === p.id ? undefined : p.id)}>
            <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span><span className="session-title">{p.title}</span><small>{statusName[p.status]}</small></button>)}
        </div>
      </div></div></main>
      {place === 'full' && sidebar}
    </div>
  </div></Localization>;
}

createRoot(document.getElementById('root')!).render(<Prototype />);
