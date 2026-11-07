// PROTOTYPE — throwaway, lives only on branch `prototype/workbench`. Never import or adapt into production (AGENTS.md「Prototype scope」).
// #160: one window that shows every decision of map #136 — resident and ephemeral panels, the tray, temporary maximize,
// drag-to-rearrange, the toolbar summary, the GitHub sidebar with detail, dispatch and dispatch records, repo binding,
// the two new settings and the new shortcuts. Run: `npm run prototype:workbench` (pulls a read-only `gh` snapshot first).
// Merge decisions made in #160: in 覆盖 mode the toolbar and tray yield to the sidebar and only the layout area is covered;
// 提交 to a new panel only puts a card in the tray; Esc always belongs to the terminal (temporary maximize closes by button only);
// the issue detail covers only the layout area, between the workspace toolbar and the tray.
import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarCollapseIcon, SidebarExpandIcon, SyncIcon } from '@primer/octicons-react';
import { Localization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import type { ProcessingState } from '../shared/processing-status';
import './style.css';
import './processing-status.css';
import './project-summary.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import './prototype-github-sidebar-pull.css';
import './prototype-workbench.css';
import { agentName, chunk, initialEphemeral, initialPersistent, initialTree, log, pane, questions, statusName, type Agent, type Pane } from './prototype-ephemeral-panels-data';
import { boxes, dropOf, removeFrom, ROOT, setRatio, splitAt, splitList, swap, type Box, type Drop, type Path, type Side, type Tree } from './prototype-ephemeral-panels-layout';
import { NavLink, PanelView, ToolbarSummary } from './prototype-ephemeral-panels-views';
import { emptyFilter, index, initialDispatches, issueMatches, pullMatches, sameSelection,
  type DispatchRecord, type Filter, type Issue, type Pane as SidePane, type Repo, type Selected, type Snapshot } from './prototype-github-sidebar-model';
import { FilterBar } from './prototype-github-sidebar-common';
import { IssueList, PullList } from './prototype-github-sidebar-lists';
import { DetailPane } from './prototype-github-sidebar-detail';
import { DispatchButton, initialWorkflow, inputFor, type Command, type Mode, type Target, type WorkflowSettings } from './prototype-workbench-dispatch';
import { EditProjectDialog, ghStates, SettingsPage, type Fit, type GhState } from './prototype-workbench-settings';

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
const newTitles = ['to-spec：面板角色', '查 Electron 44 变更', '补测试：撤回新增面板', '研究 gh 限额'];

function Prototype() {
  // ---- chrome & settings ----
  const [theme, setTheme] = useState(() => new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark');
  const [barHidden, setBarHidden] = useState(false);
  const [running, setRunning] = useState(true);
  const [page, setPage] = useState<'workspace' | 'settings'>('workspace');
  const [navOpen, setNavOpen] = useState(true);
  const [fit, setFit] = useState<Fit>('push'); // #160: sidebar defaults to 挤压
  const [detailFit, setDetailFit] = useState<Fit>('overlay'); // #160: detail defaults to 覆盖
  const [workflow, setWorkflow] = useState<WorkflowSettings>(initialWorkflow);
  const [writes, setWrites] = useState<'ok' | 'fail' | 'readonly'>('ok');
  // ---- GitHub side ----
  const [repo, setRepo] = useState<Repo>();
  const [error, setError] = useState<string>();
  const [gh, setGh] = useState<GhState>('bound');
  const [bound, setBound] = useState<string | undefined>('a1457139709/VibeBridge');
  const [dialog, setDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideWidth, setSideWidth] = useState(380);
  const [detailWidth, setDetailWidth] = useState(640);
  const [winW, setWinW] = useState(window.innerWidth);
  const [tab, setTab] = useState<'issue' | 'pull'>('issue');
  const [filters, setFilters] = useState<Record<'issue' | 'pull', Filter>>({ issue: emptyFilter, pull: emptyFilter });
  const [cursors, setCursors] = useState<{ issue?: number; pull?: number }>({});
  const [history, setHistory] = useState<NonNullable<Selected>[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>(initialDispatches);
  const [lastTarget, setLastTarget] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ issue: number; where: 'row' | 'detail' }>();
  const listRef = useRef<HTMLDivElement>(null);
  // ---- workspace ----
  const [persistent, setPersistent] = useState(initialPersistent);
  const [ephemeral, setEphemeral] = useState(initialEphemeral);
  const [tree, setTree] = useState<Tree | null>(initialTree);
  const [max, setMax] = useState<string>(); // temporary maximize (ephemeral) or 放大面板 (resident)
  const [focused, setFocused] = useState('p1');
  const [focusReq, setFocusReq] = useState<{ id: string; n: number }>();
  const [flash, setFlash] = useState<string>();
  const [trayGroupOpen, setTrayGroupOpen] = useState(false); // #125: 「临时 · N」 starts collapsed
  const [drag, setDrag] = useState<{ id: string; from: 'tray' | 'layout' }>();
  const [drop, setDrop] = useState<{ target: string; side: Drop } | 'tray'>();
  const canvas = useRef<HTMLDivElement>(null);

  const selected = history[history.length - 1];
  const all = [...persistent, ...ephemeral];
  const sidePanes: SidePane[] = all.map(p => ({ id: p.id, title: p.title, agent: p.agent, status: p.status, ephemeral: ephemeral.includes(p) }));
  const repoName = bound ?? repo?.snapshot.repo ?? 'a1457139709/VibeBridge';
  const overlay = fit === 'overlay';

  useEffect(() => {
    fetch('./prototype-github-sidebar.snapshot.json').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((s: Snapshot) => setRepo(index(s))).catch(e => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { const resize = () => setWinW(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);

  // Busy panes keep printing; when their budget runs out they land on Needs input or Turn ended.
  useEffect(() => {
    if (!running) return;
    const advance = (list: Pane[]) => list.map(p => {
      if (p.status !== 'busy') return p;
      const lines = [...p.lines, ...chunk(p.tick)];
      if (p.remaining > 1) return { ...p, lines, remaining: p.remaining - 1, tick: p.tick + 1 };
      const question = p.next === 'needs-input' ? questions[p.tick % questions.length] : undefined;
      return { ...p, lines: question ? [...lines, '', `? ${question}`] : [...lines, '', '⏺ 本轮完成。'], status: p.next, question, tick: p.tick + 1 };
    });
    const timer = setInterval(() => { setEphemeral(advance); setPersistent(advance); }, 1400);
    return () => clearInterval(timer);
  }, [running]);

  const update = (id: string, f: (p: Pane) => Pane) => { const u = (l: Pane[]) => l.map(p => p.id === id ? f(p) : p); setEphemeral(u); setPersistent(u); };
  const reply = (id: string, text: string) => update(id, p => ({ ...p, status: 'busy', question: undefined, lines: [...p.lines, '', `> ${text}`], remaining: 4 + p.tick % 5, next: (p.tick % 2 ? 'done' : 'needs-input') as ProcessingState }));
  const interrupt = (id: string) => update(id, p => p.status !== 'busy' ? p : { ...p, status: 'ready', remaining: 0, lines: [...p.lines, '  ⎿  Interrupted · 用户按了 Esc（Esc 交给 CLI，不收起面板）'] });
  const focusPane = (id: string) => setFocusReq(r => ({ id, n: (r?.n ?? 0) + 1 }));
  const blink = (id: string) => { setFlash(id); setTimeout(() => setFlash(f => f === id ? undefined : f), 1600); };

  // #153: the toolbar ＋ is the only way to add a panel: a new ephemeral one, opened at once; the one that was open goes back to the tray.
  const addEphemeral = () => {
    const n = Date.now() % 97, id = `e${Date.now()}`, title = newTitles[n % newTitles.length];
    setEphemeral(list => [...list, pane(id, (['claude', 'codex', 'pi'] as const)[n % 3], title, 'ready', n, { lines: log(n, title, 1) })]);
    setMax(id); focusPane(id);
  };
  const exitPane = (id: string) => { setEphemeral(l => l.filter(p => p.id !== id)); setPersistent(l => l.filter(p => p.id !== id)); setTree(t => removeFrom(t, id)); if (max === id) setMax(undefined); };
  const toggleMax = (id: string) => setMax(m => m === id ? undefined : id);
  const locate = (id: string) => {
    setPage('workspace'); setHistory([]);
    if (ephemeral.some(p => p.id === id)) setMax(id);
    else { setMax(undefined); setFocused(id); blink(id); }
  };

  // ---- dispatch (#142, #157, and #160: 提交 to a new panel only lands in the tray) ----
  const dispatch = (issue: number) => (command: Command, target: Target, mode: Mode, back: () => void) => {
    const url = `https://github.com/${repoName}/issues/${issue}`;
    const at = new Date().toISOString();
    if (target.kind === 'new') {
      const id = `d${Date.now()}`, agent: Agent = target.agent, text = inputFor(agent, command, url), seed = issue % 50;
      const fresh = pane(id, agent, '未命名任务', mode === 'submit' ? 'busy' : 'ready', seed, mode === 'submit'
        ? { lines: [`╭─ ${agentName[agent]}（启动参数：${text}）`, '', `> ${text}`, '', '⏺ 读取 issue…'], remaining: 5, next: 'needs-input' }
        : { lines: [`╭─ ${agentName[agent]}`, '╰─ 就绪'], draft: text, draftKey: 1 });
      setEphemeral(l => [...l, fresh]);
      // The record waits for the instance to report its first session; here that is one second later.
      setTimeout(() => { update(id, p => ({ ...p, title: `处理 #${issue}` })); setDispatches(d => [...d, { issue, pane: id, command: command.skill, text, agent, title: `处理 #${issue}`, at }]); }, 1000);
      setLastTarget(l => ({ ...l, [command.skill]: `new:${agent}` }));
      if (mode === 'fill') { setHistory([]); setPage('workspace'); setMax(id); focusPane(id); } else setTimeout(back);
      return;
    }
    const p = all.find(x => x.id === target.id)!;
    const text = inputFor(p.agent, command, url);
    if (mode === 'submit') { update(p.id, x => ({ ...x, status: 'busy', question: undefined, lines: [...x.lines, '', `> ${text}`], remaining: 5, next: 'done' })); setTimeout(back); }
    else { update(p.id, x => ({ ...x, draft: text, draftKey: (x.draftKey ?? 0) + 1 })); locate(p.id); focusPane(p.id); }
    setDispatches(d => [...d, { issue, pane: p.id, command: command.skill, text, agent: p.agent, title: p.title, at }]);
    setLastTarget(l => ({ ...l, [command.skill]: p.id }));
  };
  const dispatchButton = (where: 'row' | 'detail') => (issue: Issue, weak: boolean) =>
    <DispatchButton issue={issue} panes={sidePanes} workflow={workflow} lastTarget={lastTarget} weak={weak} size={where}
      open={menu?.issue === issue.number && menu.where === where} onOpen={() => setMenu({ issue: issue.number, where })} onClose={() => setMenu(undefined)}
      onDispatch={dispatch(issue.number)} />;

  // ---- sidebar selection ----
  const openDetail = (kind: 'issue' | 'pull') => (n: number) => setHistory(h => sameSelection(h[h.length - 1], { kind, number: n }) && h.length === 1 ? [] : [{ kind, number: n }]);
  const openInside = (s: Selected) => { if (s) { setHistory(h => [...h, s]); setTab(s.kind); } };
  const closeDetail = () => { setHistory([]); setTimeout(() => listRef.current?.focus()); };
  const toggleSidebar = () => {
    if (sideOpen) { setSideOpen(false); setHistory([]); setMenu(undefined); return; }
    setSideOpen(true); setTimeout(() => listRef.current?.focus()); // focus goes in; it never comes back by rule
  };
  const refresh = () => { if (refreshing) return; setRefreshing(true); setTimeout(() => { setRefreshing(false); setGh(g => g === 'bound' || g === 'unbound' ? g : 'bound'); }, 800); };

  // ---- shortcuts (#157). Browsers keep ⌘L for the address bar, so ⌃ works too here. ----
  const latestLocatable = (n: number) => [...dispatches].reverse().find(d => d.issue === n && all.some(p => p.id === d.pane));
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (mod(e) && e.altKey && e.code === 'KeyB') { e.preventDefault(); toggleSidebar(); return; }
      const inSidebar = (document.activeElement as HTMLElement | null)?.closest('.gh-sidebar');
      if (!mod(e) || e.altKey || !inSidebar || (e.code !== 'KeyD' && e.code !== 'KeyL')) return; // otherwise the key goes to the terminal
      const inDetail = (document.activeElement as HTMLElement).closest('.gh-detail');
      const issue = inDetail ? (selected?.kind === 'issue' ? selected.number : undefined) : tab === 'issue' ? cursors.issue : undefined;
      if (issue === undefined || repo?.issues.get(issue)?.state !== 'open') return;
      e.preventDefault();
      if (e.code === 'KeyD') setMenu({ issue, where: inDetail ? 'detail' : 'row' });
      else { const r = latestLocatable(issue); if (r) locate(r.pane); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });

  // ---- drag (#153) ----
  const layout = tree ? boxes(tree) : new Map<string, Box>();
  const startDrag = (id: string, from: 'tray' | 'layout') => (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id);
    setMax(undefined); setTimeout(() => setDrag({ id, from }));
  };
  const endDrag = () => { setDrag(undefined); setDrop(undefined); };
  const dropOnPanel = (target: string, side: Drop) => {
    if (!drag || drag.id === target) return endDrag();
    const p = ephemeral.find(e => e.id === drag.id);
    if (side === 'center' && target !== ROOT) {
      if (p) { // a tray card swaps with a resident panel: they trade places, the resident one goes to the tray
        const out = persistent.find(x => x.id === target)!;
        setEphemeral(l => [...l.filter(e => e.id !== p.id), out]); setPersistent(l => [...l.filter(x => x.id !== target), p]);
      }
      setTree(t => t && swap(t, target, drag.id));
    } else {
      if (p) { setEphemeral(l => l.filter(e => e.id !== p.id)); setPersistent(l => [...l, p]); }
      setTree(t => splitAt(removeFrom(t, drag.id), target, drag.id, side as Side));
    }
    setFocused(drag.id); endDrag();
  };
  const dropOnTray = () => {
    const p = drag?.from === 'layout' ? persistent.find(e => e.id === drag.id) : undefined;
    if (p) { setPersistent(l => l.filter(e => e.id !== p.id)); setEphemeral(l => [...l, p]); setTree(t => removeFrom(t, p.id)); }
    endDrag();
  };
  const startResize = (path: Path, axis: 'row' | 'column', box: Box) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = canvas.current!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add('resizing');
    const move = (e: PointerEvent) => {
      const at = axis === 'row' ? ((e.clientX - rect.left) / rect.width - box.x) / box.w : ((e.clientY - rect.top) / rect.height - box.y) / box.h;
      setTree(t => t && setRatio(t, path, Math.min(0.9, Math.max(0.1, at))));
    };
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const startSideResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
    e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = (m: PointerEvent) => setSideWidth(Math.round(Math.min(Math.max(300, right - m.clientX), 560)));
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // ---- sidebar ----
  const filter = filters[tab];
  const setFilter = (u: (f: Filter) => Filter) => setFilters(f => ({ ...f, [tab]: u(f[tab]) }));
  const counts = repo && (tab === 'issue'
    ? { open: repo.snapshot.issues.filter(i => issueMatches(i, { ...filter, state: 'open' })).length, closed: repo.snapshot.issues.filter(i => issueMatches(i, { ...filter, state: 'closed' })).length }
    : { open: repo.snapshot.pulls.filter(p => pullMatches(p, { ...filter, state: 'open' })).length, closed: repo.snapshot.pulls.filter(p => pullMatches(p, { ...filter, state: 'closed' })).length });
  const openCount = (k: 'issue' | 'pull') => !repo ? '–' : k === 'issue' ? repo.snapshot.issues.filter(i => i.state === 'open').length : repo.snapshot.pulls.filter(p => p.state === 'open' || p.state === 'draft').length;
  const showData = gh === 'bound' || gh === 'stale';
  const fullState = (body: React.ReactNode) => <div className="wb-gh-state">{body}</div>;
  const detailW = Math.min(detailWidth, winW - sideWidth - 40);
  const detailShown = !!(sideOpen && repo && showData && selected);
  const sidebar = sideOpen && <aside className={`gh-sidebar ${overlay ? 'overlay' : ''} wb-tree`} style={{ width: sideWidth }} aria-label="GitHub">
    <div className="gh-resize" onPointerDown={startSideResize} title="拖动调整宽度（300–560px）" />
    {repo && showData && selected && <DetailPane repo={repo} selected={selected} width={detailW} onWidth={setDetailWidth} canBack={history.length > 1}
      onBack={() => setHistory(h => h.slice(0, -1))} onClose={closeDetail} onOpen={openInside} panes={sidePanes} dispatches={dispatches} onLocate={locate}
      dispatchButton={dispatchButton('detail')} writes={writes} />}
    <header className="gh-head"><span className="gh-repo">{gh === 'unbound' ? '未绑定仓库' : repoName}</span><span className="gh-spacer" />
      <button className={`wb-refresh ${refreshing ? 'spin' : ''}`} disabled={refreshing || gh === 'unbound'} title="刷新" onClick={refresh}><SyncIcon size={14} /></button></header>
    {gh === 'unbound' && fullState(<><p>这个项目还没有绑定 GitHub 仓库。</p><button className="gh-btn primary" onClick={() => setDialog(true)}>绑定仓库</button></>)}
    {gh === 'no-gh' && fullState(<><p>没有找到 <code>gh</code>。安装 GitHub CLI 后才能使用侧边栏。</p><a href="https://cli.github.com" target="_blank" rel="noreferrer">安装说明 ↗</a><button className="gh-btn" onClick={refresh}>重试</button></>)}
    {gh === 'logged-out' && fullState(<><p><code>gh</code> 未登录或登录已失效。</p><button className="gh-btn" onClick={() => navigator.clipboard?.writeText('gh auth login')}>复制 gh auth login</button><button className="gh-btn" onClick={refresh}>重试</button></>)}
    {gh === 'no-access' && fullState(<><p>无法访问 <b>{repoName}</b>：仓库不存在，或当前 gh 账号 <b>{repo?.snapshot.viewer ?? '—'}</b> 没有权限。</p><button className="gh-btn" onClick={refresh}>重试</button><button className="gh-btn" onClick={() => setDialog(true)}>修改绑定</button></>)}
    {showData && <>
      {gh === 'stale' && <div className="wb-stale">数据可能已过期（网络或限流）<button className="gh-text-button" onClick={refresh}>重试</button></div>}
      <nav className="gh-tabs">{(['issue', 'pull'] as const).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k === 'issue' ? 'Issues' : 'Pull requests'} <span>{openCount(k)}</span></button>)}</nav>
      {error && <p className="gh-empty">读不到快照（{error}）。先运行 <code>npm run prototype:workbench</code>，它会用 gh 拉取数据。</p>}
      {!repo && !error && <p className="gh-empty">载入中…</p>}
      {repo && counts && <FilterBar repo={repo} filter={filter} setFilter={setFilter} counts={counts} />}
      {repo && tab === 'issue' && <IssueList repo={repo} filter={filter} setFilter={setFilter} cursor={cursors.issue} onCursor={n => setCursors(c => ({ ...c, issue: n }))} onOpenDetail={openDetail('issue')}
        panes={sidePanes} dispatches={dispatches} onLocate={locate} dispatchButton={dispatchButton('row')} listRef={listRef} />}
      {repo && tab === 'pull' && <PullList repo={repo} filter={filter} setFilter={setFilter} cursor={cursors.pull} onCursor={n => setCursors(c => ({ ...c, pull: n }))} onOpenDetail={openDetail('pull')} listRef={listRef} />}
    </>}
  </aside>;

  // ---- workspace ----
  const opened = all.find(p => p.id === max);
  const openedIsEphemeral = !!opened && ephemeral.includes(opened);
  const attention = (['needs-input', 'error', 'done'] as const).map(s => ({ s, n: ephemeral.filter(p => p.status === s).length })).filter(x => x.n);
  const workspace = <div className="workbench-page"><div className="workspace">
    <header className="workspace-toolbar proto-toolbar-summary"><span className="proto-tb-left" />
      <ToolbarSummary panes={all} ephemeralIds={new Set(ephemeral.map(p => p.id))} onLocate={locate} />
      <span className="gh-tb-right"><button className="proto-tb-add" title="新建临时面板并直接打开" onClick={addEphemeral}>＋</button></span>
    </header>
    <div className="gh-stage">
      <div className="canvas proto-canvas" ref={canvas} onDragOver={e => { if (drag && !tree) e.preventDefault(); }}
        onDrop={() => { if (drag && !tree) { const p = ephemeral.find(x => x.id === drag.id); if (p) { setEphemeral(l => l.filter(x => x.id !== p.id)); setPersistent(l => [...l, p]); setTree({ panel: p.id }); } endDrag(); } }}>
        {!tree && <div className="proto-empty">{drag ? '松手放进布局' : '布局为空：从托盘拖一个面板上来'}</div>}
        {persistent.map(p => {
          const b = layout.get(p.id);
          if (!b) return null;
          const preview = drop && drop !== 'tray' && drop.target === p.id ? drop.side : undefined;
          return <section key={p.id} className={`panel-slot ${p.agent} ${flash === p.id ? 'gh-flash' : ''}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, visibility: opened ? 'hidden' : 'visible' }}
            onDragOver={e => { if (!drag || drag.id === p.id) return; e.preventDefault(); const side = dropOf(e); setDrop(d => d && d !== 'tray' && d.target === p.id && d.side === side ? d : { target: p.id, side }); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(d => d !== 'tray' && d?.target === p.id ? undefined : d); }}
            onDrop={e => { e.preventDefault(); dropOnPanel(p.id, dropOf(e)); }}>
            <PanelView pane={p} focused={!opened && focused === p.id} onFocus={() => setFocused(p.id)} onReply={reply} onInterrupt={interrupt} focusKey={focusReq?.id === p.id ? focusReq.n : undefined}
              onHeaderDragStart={startDrag(p.id, 'layout')} onDragEnd={endDrag}
              actions={<><button title="放大面板" onClick={() => setMax(p.id)}>⤢</button><button title="关闭面板（Agent 退出）" onClick={() => exitPane(p.id)}>×</button></>} />
            {preview && <div className={`proto-drop proto-drop-${preview}`}>{preview === 'center' ? `与「${p.title}」交换` : drag?.from === 'tray' ? '放到这一侧，成为常驻面板' : '移到这一侧'}</div>}
          </section>;
        })}
        {tree && !opened && splitList(tree).map(d => {
          const at = d.axis === 'row' ? d.box.x + d.box.w * d.ratio : d.box.y + d.box.h * d.ratio;
          const style: CSSProperties = d.axis === 'row'
            ? { left: `calc(${at * 100}% - 4px)`, top: `${d.box.y * 100}%`, height: `${d.box.h * 100}%`, width: 8, cursor: 'col-resize' }
            : { top: `calc(${at * 100}% - 4px)`, left: `${d.box.x * 100}%`, width: `${d.box.w * 100}%`, height: 8, cursor: 'row-resize' };
          return <div key={d.path.join('.') || 'root'} className="divider proto-divider" style={style} onPointerDown={startResize(d.path, d.axis, d.box)} />;
        })}
        {drag && tree && (['left', 'right', 'top', 'bottom'] as const).map(side => <div key={side} className={`proto-edge proto-edge-${side}`}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDrop(d => d && d !== 'tray' && d.target === ROOT && d.side === side ? d : { target: ROOT, side }); }}
          onDragLeave={() => setDrop(d => d !== 'tray' && d?.target === ROOT && d.side === side ? undefined : d)}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); dropOnPanel(ROOT, side); }} />)}
        {drop && drop !== 'tray' && drop.target === ROOT && <div className={`proto-drop proto-drop-${drop.side} proto-drop-root`}>占满布局区域的{({ left: '左侧', right: '右侧', top: '上方', bottom: '下方', center: '' })[drop.side]}</div>}
        {opened && <section className={`panel-slot ${opened.agent} proto-pop`} style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 3 }}>
          <PanelView pane={opened} ephemeral={openedIsEphemeral} focused onReply={reply} onInterrupt={interrupt} focusKey={focusReq?.id === opened.id ? focusReq.n : undefined}
            actions={<><button title={openedIsEphemeral ? '收起，回到托盘（Esc 留给终端）' : '还原'} onClick={() => setMax(undefined)}>⌄</button>
              {openedIsEphemeral && <button title="关闭（等同 Agent 退出）" onClick={() => exitPane(opened.id)}>×</button>}</>} />
        </section>}
      </div>
    </div>
    <div className={`proto-tray ${drop === 'tray' ? 'proto-tray-drop' : ''}`} aria-label="临时面板托盘"
      onDragOver={e => { if (drag?.from !== 'layout') return; e.preventDefault(); setDrop('tray'); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(d => d === 'tray' ? undefined : d); }}
      onDrop={e => { e.preventDefault(); dropOnTray(); }}>
      {drop === 'tray' && <span className="proto-tray-hint">松手放回托盘，成为临时面板</span>}
      {ephemeral.map(p => <button key={p.id} draggable onDragStart={startDrag(p.id, 'tray')} onDragEnd={endDrag} className={`proto-card ${p.agent} status-${p.status} ${max === p.id ? 'open' : ''}`}
        title={`${agentName[p.agent]} · ${p.title}`} onClick={() => toggleMax(p.id)}>
        <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span>
        <span className="session-title">{p.title}</span><small>{statusName[p.status]}</small></button>)}
      {!ephemeral.length && !drop && <span className="muted wb-tray-empty">没有临时面板</span>}
    </div>
  </div></div>;

  const group = <K extends string>(label: string, items: readonly { key: K; name: string }[], value: K, set: (k: K) => void) =>
    <span className="proto-group"><span>{label}</span><select value={value} onChange={e => set(e.target.value as K)}>{items.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}</select></span>;
  return <Localization language="zh-CN"><div className="app proto proto-top">
    <header className="system-bar"><div className="system-brand">
      <button className={`gh-sys-toggle ${navOpen ? 'on' : ''}`} title={navOpen ? '收起项目导航' : '展开项目导航'} aria-pressed={navOpen} onClick={() => setNavOpen(o => !o)}>
        {navOpen ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}</button><span className="wordmark">VibeBridge</span></div>
      <button className={`gh-sys-toggle right ${sideOpen ? 'on' : ''}`} title={`${sideOpen ? '收起' : '打开'} GitHub 侧边栏（⌘⌥B）`} aria-pressed={sideOpen} onClick={toggleSidebar}>
        {sideOpen ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}</button></header>
    {barHidden ? <button className="proto-bar proto-bar-mini" onClick={() => setBarHidden(false)}>PROTOTYPE ▴</button> : <div className="proto-bar" role="toolbar" aria-label="原型开关">
      <span className="proto-tag">PROTOTYPE · 合并版</span>
      {group('仓库', ghStates, gh, setGh)}
      {group('直接操作', [{ key: 'ok', name: '成功' }, { key: 'fail', name: '失败' }, { key: 'readonly', name: '无写权限' }] as const, writes, setWrites)}
      <button onClick={() => setRunning(r => !r)}>{running ? '暂停模拟' : '继续模拟'}</button>
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
      <span className="proto-state">侧边栏{overlay ? '覆盖' : '挤压'} · 详情{detailFit === 'overlay' ? '覆盖' : '挤压'} · 放大：{opened?.title ?? '—'} · 焦点面板：{all.find(p => p.id === focused)?.title ?? '—'}</span>
      <button title="隐藏原型开关条" onClick={() => setBarHidden(true)}>▾</button>
    </div>}
    <div className={`app-body wb-body ${overlay && sideOpen ? 'wb-yield' : ''} ${page === 'workspace' ? 'wb-on-workspace' : ''} ${detailShown && detailFit === 'push' ? 'wb-detail-push' : ''}`} style={{ '--side-w': `${sideWidth}px`, '--detail-w': `${detailW}px` } as CSSProperties}>
      {navOpen && <nav className="navigation" style={{ '--navigation-width': '230px' } as CSSProperties}>
        <div className="navigation-projects"><div className="nav-heading">项目</div>
          <section className="project-group">
            <div className="proto-project-row wb-project-row"><button className="project-disclosure">⌄</button><button className="project-link selected" onClick={() => setPage('workspace')}><span className="project-initial">V</span><span className="project-name">VibeBridge</span><small>{all.length}</small></button>
              <button className="wb-edit" title="编辑项目（仓库绑定在这里）" onClick={() => setDialog(true)}>✎</button></div>
            <div className="project-panels">
              {persistent.filter(p => layout.has(p.id)).map(p => <NavLink key={p.id} pane={p} selected={page === 'workspace' && !opened && focused === p.id} onClick={() => locate(p.id)} />)}
              {!!ephemeral.length && <button className="proto-nav-sub wb-nav-sub" onClick={() => setTrayGroupOpen(o => !o)}>{trayGroupOpen ? '▾' : '▸'} 临时 · {ephemeral.length}
                {!trayGroupOpen && attention.map(a => <span key={a.s} className="wb-nav-attn" title={`${a.n} 个${statusName[a.s]}`}><ProcessingStatusIcon state={a.s} />{a.n}</span>)}</button>}
              {trayGroupOpen && ephemeral.map(p => <NavLink key={p.id} pane={p} ephemeral selected={max === p.id} onClick={() => { setPage('workspace'); toggleMax(p.id); }} />)}
            </div>
          </section>
          <section className="project-group"><div className="proto-project-row"><button className="project-disclosure">›</button><button className="project-link"><span className="project-initial">B</span><span className="project-name">blog</span><small>2</small></button></div></section>
          <button className="add-project"><span>＋</span>添加项目</button>
        </div>
        <div className="nav-footer"><span>本地工作台</span><button className={`settings-entry ${page === 'settings' ? 'selected' : ''}`} title="设置" onClick={() => setPage(p => p === 'settings' ? 'workspace' : 'settings')}>⚙</button></div>
      </nav>}
      <main>{page === 'settings' ? <SettingsPage fit={fit} setFit={setFit} detailFit={detailFit} setDetailFit={setDetailFit} workflow={workflow} setWorkflow={setWorkflow} /> : workspace}</main>
      {sidebar}
    </div>
    {dialog && <EditProjectDialog repo={repo?.snapshot.repo ?? 'a1457139709/VibeBridge'} bound={gh === 'unbound' ? undefined : bound} gh={gh}
      onSave={r => { setBound(r); setGh(r ? 'bound' : 'unbound'); }} onClose={() => setDialog(false)} />}
  </div></Localization>;
}

createRoot(document.getElementById('root')!).render(<Prototype />);
