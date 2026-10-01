import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AgentType, Layout, Panel, Project, ShortcutAction, Variant } from './bridge.prototype';
import { AGENTS, AGENT_TYPES, DEFAULT_SHORTCUTS, leafIds, layoutMinimum, model, PANEL_GAP, panelRects } from './model.prototype';
import type { PrototypeState } from './model.prototype';
import { AgentMark, BridgeMark, Icon } from './icons.prototype';
import type { IconName } from './icons.prototype';
import { MockTerminal } from './Terminal.prototype';
import { PrototypeSwitcher } from './PrototypeSwitcher';

type Modal = 'directory' | 'add' | 'quit' | null;
type ModalRequest = Modal | 'settings';
type SetupDraft = { total: number; counts: Record<AgentType, number> };
const usePrototype = () => useSyncExternalStore(model.subscribe, model.getState);
const shortcutLabels: Record<ShortcutAction, string> = { nextProject: '切换到下一个项目', nextPanel: '切换到下一个面板', maximize: '放大 / 还原面板', addAgent: '添加 Agent' };
const keySymbols: Record<string, string> = { Meta: '⌘', Control: '⌃', Shift: '⇧', Alt: '⌥', Enter: '↵', ' ': '空格' };
const shortcutText = (binding: string) => binding.split('+').map(key => keySymbols[key] ?? (key.length === 1 ? key.toUpperCase() : key)).join('');
function keyboardBinding(event: KeyboardEvent | React.KeyboardEvent) {
  const key = event.code === 'BracketRight' ? ']' : event.code === 'BracketLeft' ? '[' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...(event.metaKey ? ['Meta'] : []), ...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}

function ToolButton({ icon, label, onClick, active, children }: { icon: IconName; label: string; onClick: () => void; active?: boolean; children?: ReactNode }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} onClick={onClick} title={label} aria-label={label}><Icon name={icon} />{children}</button>;
}
function TrafficLights({ onQuit }: { onQuit: () => void }) {
  return <div className="traffic-lights"><button className="traffic-close" title="关闭工作台" aria-label="关闭工作台" onClick={onQuit}><span>×</span></button><span className="traffic-yellow" /><span className="traffic-green" /></div>;
}
function ProjectBadge({ project, size = 'normal' }: { project: Project; size?: 'normal' | 'large' }) {
  return <span className={`project-badge ${size}`} style={{ '--project-color': project.color } as CSSProperties}>{project.initials}</span>;
}

type ShellProps = { state: PrototypeState; children: ReactNode; onModal: (modal: ModalRequest) => void; onProject: (id: string) => void; light: boolean };
function Sidebar({ state, onModal, onProject, mode }: Pick<ShellProps, 'state' | 'onModal' | 'onProject'> & { mode: 'list' | 'rail' | 'context' }) {
  const active = model.active(), collapsed = state.sidebarCollapsed;
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''} sidebar-${mode}`}>
    {!collapsed && <div className="nav-section-label"><span>项目</span>{mode === 'list' && <ToolButton icon="plus" label="添加项目" onClick={() => onModal('directory')} />}</div>}
    <nav className="project-nav" aria-label="项目导航">
      {state.projects.map((project, index) => <button key={project.id} className={`project-row ${project.id === active.id ? 'selected' : ''}`} onClick={() => onProject(project.id)} title={`${project.name}\n${project.directory}`} aria-label={`切换到 ${project.name}`} aria-current={project.id === active.id ? 'page' : undefined}>
        <ProjectBadge project={project} />
        {!collapsed && <span className="project-row-text"><span>{project.name}</span>{mode === 'list' && <small>{project.panels.length} 个面板</small>}</span>}
        {!collapsed && <span className="project-key">⌘{index + 1}</span>}
      </button>)}
    </nav>
    {(collapsed || mode !== 'list') && <button className="new-project-button" onClick={() => onModal('directory')} aria-label="添加项目"><Icon name="plus" size={17} />{!collapsed && <span>添加项目</span>}</button>}
    {mode === 'context' && !collapsed && <div className="project-context">
      <span className="eyebrow">当前项目</span>
      <ProjectBadge project={active} size="large" />
      <strong>{active.name}</strong><code>{active.directory.replace('/Users/red/', '~/')}</code>
      <div className="context-agents">{AGENT_TYPES.map(agent => <span key={agent}><AgentMark agent={agent} size={17} />{active.panels.filter(p => p.agent === agent).length}</span>)}</div>
    </div>}
    <div className="sidebar-bottom">
      {!collapsed && mode === 'list' && <div className="local-label"><span className="local-dot" />本地工作台<small>macOS</small></div>}
    </div>
  </aside>;
}
function HeaderActions({ onModal, light, settingsOpen }: Pick<ShellProps, 'onModal' | 'light'> & { settingsOpen?: boolean }) {
  return <div className="header-actions">
    <ToolButton icon={light ? 'moon' : 'sun'} label={light ? '切换深色主题' : '切换浅色主题'} onClick={() => model.setTheme(light ? 'dark' : 'light')} />
    <ToolButton icon="settings" label="设置" active={settingsOpen} onClick={() => onModal('settings')} />
  </div>;
}
function SystemBar(props: Pick<ShellProps, 'onModal' | 'state' | 'light'> & { settingsOpen?: boolean }) {
  const collapsed = props.state.sidebarCollapsed;
  return <header className="system-bar" aria-label="系统栏">
    <div className="system-bar-leading">
      <TrafficLights onQuit={() => props.onModal('quit')} />
      <div className="brand-lockup"><BridgeMark size={20} /><span>VibeBridge</span></div>
      {!props.settingsOpen && <ToolButton icon="sidebar" label={collapsed ? '展开项目导航' : '折叠项目导航'} onClick={() => model.toggleSidebar()} />}
    </div>
    <HeaderActions {...props} />
  </header>;
}
function LayoutThumbnail({ project, state }: { project: Project; state: PrototypeState }) {
  const width = Math.max(1, state.viewport.width), height = Math.max(1, state.viewport.height);
  return <div className="layout-overview" title={`自动排布 · ${project.panels.length} 个面板`}>
    <span className="layout-overview-label">自动排布</span>
    <div className="layout-thumbnail" role="img" aria-label={`${project.panels.length} 个面板的自动排布缩略图`}>
      {panelRects(project.layout, width, height).map(rect => {
        const panel = project.panels.find(p => p.id === rect.panelId)!;
        return <span key={panel.id} className={`layout-thumbnail-panel ${state.focusId === panel.id ? 'is-focused' : ''}`} data-panel-id={panel.id} data-agent={panel.agent} style={{ left: `${rect.x / width * 100}%`, top: `${rect.y / height * 100}%`, width: `${rect.width / width * 100}%`, height: `${rect.height / height * 100}%` }} />;
      })}
    </div>
  </div>;
}
function WorkspaceHeader({ onModal, state }: Pick<ShellProps, 'onModal' | 'state'>) {
  const project = model.active(), path = project.directory.replace('/Users/red/', '~/');
  const lastSlash = path.lastIndexOf('/');
  return <header className="workspace-header" aria-label="工作区工具栏">
    <div className="workspace-heading">
      <strong className="workspace-project-name" title={project.name}>{project.name}</strong>
      <code className="workspace-path" title={project.directory} aria-label={project.directory}><span className="workspace-path-start">{path.slice(0, lastSlash + 1)}</span><span className="workspace-path-end">{path.slice(lastSlash + 1)}</span></code>
    </div>
    <div className="workspace-actions"><LayoutThumbnail project={project} state={state} /><span className="terminal-count">{project.panels.length} 个终端</span><ToolButton icon="plus" label="添加 Agent" onClick={() => onModal('add')} /></div>
  </header>;
}
export function VariantA(props: ShellProps) {
  return <div className={`shell quiet-shell ${props.state.sidebarCollapsed ? 'with-rail' : ''}`}>
    <SystemBar {...props} />
    <Sidebar {...props} mode="list" />
    <section className="main-workspace">
      <WorkspaceHeader onModal={props.onModal} state={props.state} />
      {props.children}
    </section>
  </div>;
}
export function VariantB(props: ShellProps) {
  return <div className={`shell focus-shell ${props.state.sidebarCollapsed ? 'with-rail' : ''}`}>
    <SystemBar {...props} />
    <Sidebar {...props} mode="rail" />
    <section className="main-workspace">
      <WorkspaceHeader onModal={props.onModal} state={props.state} />
      {props.children}
    </section>
  </div>;
}
export function VariantC(props: ShellProps) {
  return <div className={`shell studio-shell ${props.state.sidebarCollapsed ? 'with-rail' : ''}`}>
    <SystemBar {...props} />
    <Sidebar {...props} mode="context" />
    <section className="main-workspace">
      <WorkspaceHeader onModal={props.onModal} state={props.state} />
      {props.children}
    </section>
  </div>;
}

function PanelView({ panel, state, light }: { panel: Panel; state: PrototypeState; light: boolean }) {
  const [menu, setMenu] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const selected = state.focusId === panel.id, maximized = state.maximizedId === panel.id;
  const project = model.active();
  const startSwap = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || maximized || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const source = event.currentTarget.closest('.agent-panel');
    const startX = event.clientX, startY = event.clientY;
    let moving = false, targetId: string | null = null;
    const clearTargets = () => document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    const move = (e: PointerEvent) => {
      if (!moving && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      if (!moving) { moving = true; document.body.classList.add('moving-panel'); source?.classList.add('is-drag-source'); }
      clearTargets();
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.agent-panel');
      targetId = target?.dataset.panelId ?? null;
      if (targetId && targetId !== panel.id) target?.classList.add('is-drop-target');
    };
    const end = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel);
      dragCleanup.current = null;
      document.body.classList.remove('moving-panel'); source?.classList.remove('is-drag-source'); clearTargets();
      if (moving && targetId && targetId !== panel.id) model.swapPanels(panel.id, targetId);
    };
    const cancel = () => { targetId = null; end(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    dragCleanup.current = cancel;
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end, { once: true }); document.addEventListener('pointercancel', cancel, { once: true });
    document.addEventListener('keydown', key, true); window.addEventListener('blur', cancel, { once: true });
  };
  return <section className={`agent-panel ${selected ? 'is-selected' : ''} ${maximized ? 'is-maximized' : ''}`} data-panel-id={panel.id} data-agent={panel.agent} aria-label={`${AGENTS[panel.agent].name} 面板`} onPointerDown={() => { if (!selected) model.focus(panel.id); }}>
    <header className="panel-header" onPointerDown={startSwap}>
      <span className="panel-agent-label"><AgentMark agent={panel.agent} size={17} /><span>{AGENTS[panel.agent].name}</span></span>
      <div className={`panel-controls ${menu ? 'menu-open' : ''}`}>
        <ToolButton icon={maximized ? 'collapse' : 'expand'} label={maximized ? '还原面板' : '放大面板'} onClick={() => model.maximize(panel.id)} />
        <ToolButton icon="more" label="面板更多操作" active={menu} onClick={() => setMenu(!menu)} />
        <ToolButton icon="close" label="关闭面板" onClick={() => model.closePanel(panel.id)} />
      </div>
      {menu && <><button className="menu-dismiss" aria-label="关闭面板菜单" onClick={() => setMenu(false)} /><div className="panel-menu"><button onClick={() => { void navigator.clipboard.writeText(project.directory); setMenu(false); }}>复制项目目录</button><button onClick={() => { const setting = state.agentSettings[panel.agent]; void navigator.clipboard.writeText(`${setting.command} ${setting.args}`.trim()); setMenu(false); }}>复制启动命令</button></div></>}
    </header>
    {panel.runId && <MockTerminal runId={panel.runId} selected={selected} light={light} />}
  </section>;
}
type Rect = { x: number; y: number; width: number; height: number };
type SplitNode = Extract<Layout, { kind: 'split' }>;
function dividerRects(node: Layout | null, width: number, height: number, x = 0, y = 0): Array<{ node: SplitNode; bounds: Rect; rect: Rect }> {
  if (!node || node.kind === 'panel') return [];
  const w = node.axis === 'x' ? (width - PANEL_GAP) * node.ratio : width;
  const h = node.axis === 'y' ? (height - PANEL_GAP) * node.ratio : height;
  const rect = node.axis === 'x' ? { x: x + w, y, width: PANEL_GAP, height } : { x, y: y + h, width, height: PANEL_GAP };
  return [
    { node, bounds: { x, y, width, height }, rect },
    ...dividerRects(node.first, w, h, x, y),
    ...dividerRects(node.second, node.axis === 'x' ? width - PANEL_GAP - w : width, node.axis === 'y' ? height - PANEL_GAP - h : height, node.axis === 'x' ? x + w + PANEL_GAP : x, node.axis === 'y' ? y + h + PANEL_GAP : y),
  ];
}
function PanelSlot({ rect, panel, state, light, animateLayout, entering, reducedMotion }: { rect: Rect; panel: Panel; state: PrototypeState; light: boolean; animateLayout: boolean; entering: boolean; reducedMotion: boolean }) {
  const element = useRef<HTMLDivElement>(null), previous = useRef<Rect | null>(null), animation = useRef<Animation | null>(null);
  const maximized = state.maximizedId === panel.id;
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = rect;
    if (reducedMotion) animation.current?.cancel();
    const moved = before && (before.x !== rect.x || before.y !== rect.y || before.width !== rect.width || before.height !== rect.height);
    if (!moved && !(!before && entering)) return;
    animation.current?.cancel();
    if (!element.current || reducedMotion || !animateLayout || maximized || document.body.matches('.resizing-x, .resizing-y') || !rect.width || !rect.height) return;
    const frames = before ? [
      { transform: `translate(${before.x - rect.x}px, ${before.y - rect.y}px) scale(${before.width / rect.width}, ${before.height / rect.height})` },
      { transform: 'none' },
    ] : [{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
    animation.current = element.current.animate(frames, { duration: 200, easing: 'cubic-bezier(.2, 0, .2, 1)' });
    animation.current.id = `panel-layout:${panel.id}`;
  }, [rect.x, rect.y, rect.width, rect.height, animateLayout, reducedMotion, maximized]);
  useEffect(() => () => animation.current?.cancel(), []);
  return <div ref={element} className={`panel-slot ${maximized ? 'is-maximized' : ''} ${state.maximizedId && !maximized ? 'is-hidden' : ''} ${state.focusId === panel.id ? 'is-focused' : ''}`} data-layout-duration={reducedMotion ? 0 : 200} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}><PanelView panel={panel} state={state} light={light} /></div>;
}
function SplitDivider({ node, bounds, rect, state }: { node: SplitNode; bounds: Rect; rect: Rect; state: PrototypeState }) {
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const length = (node.axis === 'x' ? bounds.width : bounds.height) - PANEL_GAP;
    const start = node.axis === 'x' ? event.clientX : event.clientY;
    const minA = layoutMinimum(node.first, state.minPanel), minB = layoutMinimum(node.second, state.minPanel);
    const lower = (node.axis === 'x' ? minA.width : minA.height) / length;
    const upper = 1 - (node.axis === 'x' ? minB.width : minB.height) / length;
    if (lower > upper) return;
    let ratio = node.ratio;
    const move = (e: PointerEvent) => {
      const offset = length * node.ratio + (node.axis === 'x' ? e.clientX : e.clientY) - start;
      ratio = Math.max(lower, Math.min(upper, offset / length)); model.resizeSplit(node.id, ratio);
    };
    const end = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); document.body.classList.remove('resizing-x', 'resizing-y'); model.resizeSplit(node.id, ratio, true); };
    document.body.classList.add(`resizing-${node.axis}`);
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end, { once: true });
    document.addEventListener('pointercancel', end, { once: true });
  };
  return <div className={`split-divider divider-${node.axis}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} role="separator" aria-label={node.axis === 'x' ? '调整左右面板宽度' : '调整上下区域高度'} aria-orientation={node.axis === 'x' ? 'vertical' : 'horizontal'} onPointerDown={startResize}><span /></div>;
}
function WorkArea({ state, light, onAdd }: { state: PrototypeState; light: boolean; onAdd: () => void }) {
  const ref = useRef<HTMLDivElement>(null), project = model.active();
  const [systemReducedMotion, setSystemReducedMotion] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reducedMotion = systemReducedMotion || state.debugReducedMotion;
  const previous = useRef({ projectId: project.id, width: state.viewport.width, height: state.viewport.height, maximizedId: state.maximizedId, panelIds: new Set(project.panels.map(p => p.id)) });
  const animateLayout = previous.current.projectId === project.id && previous.current.width === state.viewport.width && previous.current.height === state.viewport.height && !state.maximizedId && !previous.current.maximizedId;
  useLayoutEffect(() => { previous.current = { projectId: project.id, ...state.viewport, maximizedId: state.maximizedId, panelIds: new Set(project.panels.map(p => p.id)) }; }, [project.id, project.layout, state.viewport.width, state.viewport.height, state.maximizedId]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setSystemReducedMotion(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => model.setViewport(entry.contentRect.width, entry.contentRect.height));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return <div className={`work-area ${state.maximizedId ? 'is-maximized' : ''}`} data-motion={reducedMotion ? 'reduced' : 'full'} ref={ref}>
    {project.layout ? <>
      {panelRects(project.layout, state.viewport.width, state.viewport.height).map(rect => {
        const panel = project.panels.find(p => p.id === rect.panelId)!;
        return <PanelSlot key={panel.id} rect={state.maximizedId === panel.id ? { x: 0, y: 0, ...state.viewport } : rect} panel={panel} state={state} light={light} animateLayout={animateLayout} entering={!previous.current.panelIds.has(panel.id)} reducedMotion={reducedMotion} />;
      })}
      {dividerRects(project.layout, state.viewport.width, state.viewport.height).map(divider => <SplitDivider key={divider.node.id} {...divider} state={state} />)}
    </> : <div className="empty-workspace"><div className="empty-symbol"><BridgeMark size={44} /></div><h2>留一点空间，开始新的工作。</h2><p>为 {project.name} 添加一个 Agent。</p><button className="primary-button" onClick={onAdd}><Icon name="plus" size={17} />添加 Agent</button></div>}
  </div>;
}

function ModalFrame({ children, className = '', onClose, label }: { children: ReactNode; className?: string; onClose: () => void; label: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className={`modal-backdrop ${className}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={dialog} className="modal-surface" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div></div>;
}
function AddAgentDialog({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  return <ModalFrame label="添加 Agent" className={`add-agent-modal add-variant-${variant}`} onClose={onClose}>
    <ToolButton icon="close" label="关闭添加 Agent" onClick={onClose} />
    <div className="agent-options">{AGENT_TYPES.map(agent => <button key={agent} className={`agent-option option-${agent}`} aria-label={`添加 ${AGENTS[agent].name}`} onClick={() => { if (model.addPanel(agent)) onClose(); }}><AgentMark agent={agent} size={variant === 'B' ? 42 : 62} /><span>{AGENTS[agent].name}</span></button>)}</div>
  </ModalFrame>;
}
function DirectoryDialog({ initial, onContinue, onClose }: { initial: string; onContinue: (directory: string) => void; onClose: () => void }) {
  const [directory, setDirectory] = useState(initial), [error, setError] = useState('');
  const submit = () => {
    const value = directory.trim().replace(/\/+$/, '') || '/';
    if (!directory.trim() || !value.startsWith('/') || model.state.faults.directory) { setError('目录无效，请选择有效的本地目录'); return; }
    onContinue(value);
  };
  return <ModalFrame label="选择项目目录" className="directory-modal" onClose={onClose}><div className="dialog-header"><h2>添加项目</h2><ToolButton icon="close" label="关闭" onClick={onClose} /></div><p className="dialog-description">从一个本地目录开始。</p><label className="field-label" htmlFor="directory-input">项目目录</label><div className="directory-input-wrap"><Icon name="folder" /><input id="directory-input" autoFocus value={directory} placeholder="/Users/red/Project/MyProject" onChange={e => { setDirectory(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} /></div>{error && <p className="form-error" role="alert">{error}</p>}<p className="prototype-inline-note">原型中手动输入目录；不会访问本地文件。</p><div className="dialog-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit}>继续<Icon name="arrow" size={16} /></button></div></ModalFrame>;
}
function Stepper({ value, minus, plus, minusDisabled, plusDisabled, label }: { value: number; minus: () => void; plus: () => void; minusDisabled: boolean; plusDisabled: boolean; label: string }) {
  return <div className="stepper"><button onClick={minus} disabled={minusDisabled} aria-label={`减少${label}`}><span>−</span></button><output aria-label={label}>{value}</output><button onClick={plus} disabled={plusDisabled} aria-label={`增加${label}`}><Icon name="plus" size={16} /></button></div>;
}
function SetupPage({ directory, draft, onDraft, onBack, onCreated }: { directory: string; draft: SetupDraft; onDraft: (draft: SetupDraft) => void; onBack: () => void; onCreated: () => void }) {
  const { total, counts } = draft;
  const setTotal = (total: number) => onDraft({ ...draft, total });
  const setCounts = (counts: Record<AgentType, number>) => onDraft({ ...draft, counts });
  const assigned = AGENT_TYPES.reduce((sum, agent) => sum + counts[agent], 0);
  const difference = total - assigned;
  return <main className="setup-page"><div className="setup-content"><div className="setup-kicker"><Icon name="folder" size={18} /><span>新项目</span></div><h1>创建项目</h1><div className="setup-project"><strong>{directory.split('/').filter(Boolean).at(-1) || 'Project'}</strong><code>{directory}</code></div>
    <div className="setup-total"><div><h3>窗口数量</h3><p>设置这个项目的终端窗口总数</p></div><Stepper value={total} minus={() => setTotal(total - 1)} plus={() => setTotal(total + 1)} minusDisabled={total <= 1} plusDisabled={total >= 10} label="窗口数量" /></div>
    <div className="setup-allocation"><h3>分配 Agent</h3>{AGENT_TYPES.map(agent => <div className="allocation-row" key={agent}><span><AgentMark agent={agent} size={27} /><strong>{AGENTS[agent].name}</strong></span><Stepper value={counts[agent]} minus={() => setCounts({ ...counts, [agent]: counts[agent] - 1 })} plus={() => setCounts({ ...counts, [agent]: counts[agent] + 1 })} minusDisabled={!counts[agent]} plusDisabled={assigned >= total} label={`${AGENTS[agent].name} 数量`} /></div>)}</div>
    <div className={`allocation-progress ${difference < 0 ? 'overallocated' : ''}`}><div><span>已分配 <b>{assigned}</b> / {total}</span><span>{difference > 0 ? `还需分配 ${difference} 个` : difference < 0 ? `多分配了 ${-difference} 个` : '分配完成'}</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, assigned / total * 100)}%` }} /></div></div>
    <div className="setup-footer"><button className="text-button" onClick={onBack}><Icon name="left" size={16} />返回</button><button className="primary-button" disabled={difference !== 0} onClick={() => { if (model.createProject(directory, total, counts)) onCreated(); }}>创建并启动<Icon name="arrow" size={16} /></button></div>
  </div></main>;
}

function ShortcutsSettings({ state }: { state: PrototypeState }) {
  const [query, setQuery] = useState('');
  const [issue, setIssue] = useState<{ action: ShortcutAction; binding: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const normalize = (value: string) => value.toLowerCase().replace(/\s/g, '');
  const matches = (label: string, binding: string) => normalize(`${label} ${binding} ${shortcutText(binding)} ${binding.replace('Meta', 'Command').replace('Control', 'Ctrl').replace('Alt', 'Option')} ${binding.replace('Meta', 'Cmd')}`).includes(normalize(query));
  const actions = (Object.keys(shortcutLabels) as ShortcutAction[]).filter(action => matches(shortcutLabels[action], state.shortcuts[action]));
  const showFixed = matches('直接选择项目 固定快捷键 ⌘1–9', 'Meta+1–9') || Array.from({ length: 9 }, (_, index) => index + 1).some(index => matches('直接选择项目 固定快捷键', `Meta+${index}`));
  const record = (event: React.KeyboardEvent<HTMLInputElement>, action: ShortcutAction) => {
    if (event.key === 'Tab' || ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); setNotice('');
    if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { setIssue(null); event.currentTarget.blur(); return; }
    const binding = keyboardBinding(event);
    if (!event.metaKey && !event.ctrlKey && !event.altKey) { setIssue({ action, binding, message: '请包含 ⌘、⌃ 或 ⌥ 组合键。' }); return; }
    const conflict = model.shortcutConflict(action, binding);
    if (conflict) {
      const other = 'action' in conflict ? shortcutLabels[conflict.action] : '直接选择项目（⌘1–9）';
      setIssue({ action, binding, message: `${shortcutText(binding)} 与「${other}」冲突，原快捷键未更改。` }); return;
    }
    model.setShortcut(action, binding); setIssue(null); setNotice(`已更新「${shortcutLabels[action]}」的快捷键。`); event.currentTarget.blur();
  };
  return <section className="shortcuts-settings" aria-label="快捷键设置">
    <p className="settings-description">搜索操作或快捷键，点击右侧输入框后按下新的组合键。</p>
    <div className="shortcuts-toolbar"><div className="shortcut-search"><Icon name="search" size={17} /><input aria-label="搜索快捷键" placeholder="搜索操作或快捷键" value={query} onChange={event => { setQuery(event.target.value); setIssue(null); setNotice(''); }} />{query && <ToolButton icon="close" label="清除搜索" onClick={() => setQuery('')} />}</div><button className="shortcut-reset" onClick={() => { model.resetShortcuts(); setIssue(null); setNotice('已恢复全部默认快捷键。'); }}><Icon name="reset" size={16} />恢复默认</button></div>
    <p className="shortcut-results">{actions.length + (showFixed ? 1 : 0)} 项操作</p>
    <div className="shortcut-list">{actions.map(action => <div className={`shortcut-row ${issue?.action === action ? 'has-conflict' : ''}`} key={action}>
      <label htmlFor={`shortcut-${action}`}><span>{shortcutLabels[action]}</span><small id={`shortcut-default-${action}`}>默认：<kbd>{shortcutText(DEFAULT_SHORTCUTS[action])}</kbd></small></label>
      <input id={`shortcut-${action}`} data-shortcut-editor aria-label={`${shortcutLabels[action]}快捷键`} aria-invalid={issue?.action === action} aria-describedby={`shortcut-default-${action}${issue?.action === action ? ` shortcut-error-${action}` : ''}`} readOnly value={issue?.action === action ? shortcutText(issue.binding) : shortcutText(state.shortcuts[action])} onKeyDown={event => record(event, action)} />
      {issue?.action === action && <p className="shortcut-error" id={`shortcut-error-${action}`} role="alert">{issue.message}</p>}
    </div>)}{showFixed && <div className="shortcut-row fixed-shortcut"><div><span>直接选择项目</span><small>固定快捷键</small></div><kbd>⌘1–9</kbd></div>}</div>
    {!actions.length && !showFixed && <div className="shortcut-empty"><p>没有匹配的快捷键。</p><button className="text-button" onClick={() => setQuery('')}>清空搜索</button></div>}
    {notice && <p className="shortcut-notice" role="status">{notice}</p>}
    <p className="settings-footnote">快捷键仅在工作台前台生效；Esc 取消当前编辑。</p>
  </section>;
}
function AgentSettings({ state }: { state: PrototypeState }) {
  return <>
    <p className="settings-description">所有项目共用这些启动设置。</p>
    {AGENT_TYPES.map(agent => {
      const setting = state.agentSettings[agent], checked = state.checks[agent];
      return <section className="agent-setting" key={agent}>
        <div className="agent-setting-heading"><span><AgentMark agent={agent} size={25} /><strong>{AGENTS[agent].name}</strong></span><button className="check-command" aria-label={`检查 ${AGENTS[agent].name} 命令`} onClick={() => model.checkAgent(agent)}><Icon name="check" size={14} />检查命令</button></div>
        <div className="setting-fields">
          <label>启动命令<input value={setting.command} placeholder={AGENTS[agent].command} onChange={e => model.setAgentSettings(agent, { ...setting, command: e.target.value })} /></label>
          <label>启动参数<input value={setting.args} placeholder="可选" onChange={e => model.setAgentSettings(agent, { ...setting, args: e.target.value })} /></label>
        </div>
        {checked !== undefined && <p className={`command-check-result ${checked ? 'is-available' : 'is-unavailable'}`} role="status"><Icon name={checked ? 'check' : 'close'} size={14} /><span>{checked ? '模拟检查通过' : '模拟检查未通过'} · {setting.command.trim() ? <code>{setting.command.trim()}</code> : '请输入启动命令'}</span></p>}
      </section>;
    })}
    <p className="settings-footnote">设置应用于之后启动的实例。此原型中的命令检查为模拟结果。</p>
  </>;
}
function SettingsContent({ state, onClose }: { state: PrototypeState; onClose: () => void }) {
  const [tab, setTab] = useState<'agents' | 'appearance' | 'shortcuts'>('agents');
  return <div className="settings-content">
    <header className="settings-header"><button className="settings-back-button" aria-label="返回工作台" onClick={onClose}><Icon name="left" size={16} />返回</button><h2>全局设置</h2></header>
    <div className="settings-navigation" role="tablist" aria-label="设置分类">{([{ key: 'agents', icon: 'terminal', label: 'Agent' }, { key: 'appearance', icon: 'sun', label: '外观' }, { key: 'shortcuts', icon: 'keyboard', label: '快捷键' }] as const).map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'selected' : ''} onClick={() => setTab(item.key)}><Icon name={item.icon} size={16} />{item.label}</button>)}</div>
    <div className="settings-body">
      {tab === 'agents' && <AgentSettings state={state} />}
      {tab === 'appearance' && <><h3>主题</h3><p className="settings-description">柔和的边框，清晰的输入焦点。</p><div className="theme-options">{([{ key: 'system', name: '跟随系统', icon: 'monitor' }, { key: 'dark', name: '深色', icon: 'moon' }, { key: 'light', name: '浅色', icon: 'sun' }] as const).map(theme => <button className={state.theme === theme.key ? 'selected' : ''} key={theme.key} onClick={() => model.setTheme(theme.key)}><Icon name={theme.icon} size={23} /><span>{theme.name}</span>{state.theme === theme.key && <Icon name="check" size={14} />}</button>)}</div><div className="appearance-preview"><span>Codex</span><div><code>› Ready for your next idea.</code><span className="preview-cursor" /></div></div></>}
      {tab === 'shortcuts' && <ShortcutsSettings state={state} />}
    </div><div className="settings-save-note"><Icon name="check" size={13} />自动保存在原型内存中</div>
  </div>;
}
function GlobalSettings({ state, light, onModal, onClose }: Pick<ShellProps, 'state' | 'light' | 'onModal'> & { onClose: () => void }) {
  return <div className="shell global-settings-shell">
    <SystemBar state={state} light={light} onModal={onModal} settingsOpen />
    <main className="global-settings-page" aria-label="全局设置"><SettingsContent state={state} onClose={onClose} /></main>
  </div>;
}
function QuitDialog({ onClose }: { onClose: () => void }) {
  const count = Object.keys(model.state.runs).length;
  return <ModalFrame label="退出确认" className="quit-modal" onClose={onClose}><div className="quit-symbol"><Icon name="power" size={26} /></div><h2>退出 VibeBridge？</h2><p>退出将结束全部项目中的 {count} 个运行实例。<br />项目、面板和布局会保留。</p><div className="dialog-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => { model.quit(); onClose(); }}>退出工作台</button></div></ModalFrame>;
}
function ClosedScene({ state }: { state: PrototypeState }) {
  return <div className="closed-scene"><BridgeMark size={56} /><span className="eyebrow">原型演示</span><h1>{state.closed === 'crash' ? '模拟主进程故障' : '工作台已退出'}</h1><p>全部运行实例已结束，项目配置和布局仍在内存中。</p><button className="primary-button" onClick={() => model.reopen()}><Icon name="reset" size={16} />重新打开（模拟）</button><span className="closed-detail">只启动上次查看项目的 CLI，终端输出重新开始。</span></div>;
}

function DebugInspector({ state, setupDraft, onClose }: { state: PrototypeState; setupDraft: (SetupDraft & { directory: string }) | null; onClose: () => void }) {
  const [tab, setTab] = useState<'state' | 'events' | 'scenarios'>('state');
  const [sequence, setSequence] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const active = model.active();
  const focused = active.panels.find(p => p.id === state.focusId);
  const selectedRun = focused?.runId ? state.runs[focused.runId] : undefined;
  const backgroundRun = Object.values(state.runs).find(r => r.projectId !== active.id);
  const diagnostic = {
    prototype: true, persistence: 'memory only', variant: state.variant, activeProjectId: state.activeProjectId,
    focusId: state.focusId, maximizedId: state.maximizedId, closed: state.closed,
    projects: state.projects, agentSettings: state.agentSettings, theme: state.theme, shortcuts: state.shortcuts,
    viewport: state.viewport, minPanel: state.minPanel, requiredLayoutSize: layoutMinimum(active.layout, state.minPanel),
    panelRects: panelRects(active.layout, state.viewport.width, state.viewport.height).map(r => ({ ...r, width: Math.round(r.width), height: Math.round(r.height) })),
    runs: Object.values(state.runs).map(({ output, ...run }) => ({ ...run, outputCharacters: output.length })),
    faults: state.faults, lastSaved: state.lastSaved,
    ui: { panelRadius: 10, outerMargin: 8, panelGap: PANEL_GAP, terminalPadding: 13, fonts: [13, 12, 11], hoverDuration: 140, layoutDuration: 200, systemReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, debugReducedMotion: state.debugReducedMotion },
    setupDraft,
  };
  const traces = state.traces.filter(trace => trace.type.toLowerCase().includes(filter.toLowerCase()));
  const selectedTrace = state.traces.find(trace => trace.sequence === sequence) ?? state.traces.at(-1);
  const exportState = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ state: window.__VIBEBRIDGE_PROTOTYPE__.getState(), snapshot: model.snapshot(), setupDraft }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'vibebridge-prototype-state.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="debug-inspector" aria-label="原型调试面板">
    <header className="debug-heading"><span><Icon name="debug" size={17} /><strong>对接实验室</strong><b>模拟</b></span><ToolButton icon="close" label="关闭调试面板" onClick={onClose} /></header>
    <div className="debug-tabs">{([{ key: 'state', label: '状态' }, { key: 'events', label: '通信事件' }, { key: 'scenarios', label: '场景' }] as const).map(item => <button key={item.key} className={tab === item.key ? 'selected' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
    {tab === 'state' && <><div className="debug-summary"><span>{Object.keys(state.runs).length}<small>运行实例</small></span><span>{state.projects.length}<small>项目</small></span><span>{Math.round(state.viewport.width)} × {Math.round(state.viewport.height)}<small>布局区域 / px</small></span></div><div className="debug-actions"><button onClick={() => { void navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); }}><Icon name="copy" size={13} />复制状态</button><button onClick={exportState}><Icon name="external" size={13} />导出完整 JSON</button></div><pre className="debug-json">{JSON.stringify(diagnostic, null, 2)}</pre></>}
    {tab === 'events' && <><div className="trace-toolbar"><input placeholder="筛选 run / workspace / layout…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选通信事件" /><button className="text-button" onClick={() => model.clearTrace()}>清空</button></div><div className="trace-list">{[...traces].reverse().map(trace => <button className={trace.sequence === selectedTrace?.sequence ? 'selected' : ''} key={trace.sequence} onClick={() => setSequence(trace.sequence)}><span className={`trace-direction ${trace.direction}`}>{trace.direction === 'command' ? '→' : trace.direction === 'event' ? '←' : '•'}</span><strong>{trace.type}</strong><time>{trace.time}</time></button>)}</div><div className="trace-detail"><span>#{selectedTrace?.sequence ?? '—'} · {selectedTrace?.type ?? '暂无事件'}</span><pre>{JSON.stringify(selectedTrace?.payload ?? {}, null, 2)}</pre></div></>}
    {tab === 'scenarios' && <div className="debug-scenarios">
      <section><h3>快速面板场景</h3><p>替换当前项目的模拟面板。其他项目保留。</p><div className="scenario-presets">{[0, 1, 3, 6, 10].map(count => <button key={count} disabled={!!state.closed} onClick={() => model.seedPanels(count)}>{count} 面板</button>)}</div></section>
      <section><h3>故障注入</h3><label className="debug-toggle"><span>下一次 Agent 启动失败</span><input type="checkbox" checked={state.faults.nextStart} onChange={e => model.setFault('nextStart', e.target.checked)} /></label><label className="debug-toggle"><span>项目目录无效</span><input type="checkbox" checked={state.faults.directory} onChange={e => model.setFault('directory', e.target.checked)} /></label><div className="scenario-buttons"><button disabled={!selectedRun} onClick={() => selectedRun && model.emit({ type: 'run.exit', runId: selectedRun.id, exitCode: 0 })}>当前 CLI 正常退出</button><button disabled={!selectedRun} onClick={() => selectedRun && model.emit({ type: 'run.exit', runId: selectedRun.id, exitCode: 1 })}>当前 CLI 异常退出</button><button disabled={!backgroundRun} onClick={() => backgroundRun && model.emit({ type: 'run.output', runId: backgroundRun.id, data: '\r\n[prototype] Output received while this project was hidden.\r\n' })}>向后台实例注入输出</button><button disabled={!!state.closed} onClick={() => model.quit(true)}>模拟主进程故障</button></div><p className="debug-hint">后台输出场景：先进入 Fieldnotes，再切回 VibeBridge。</p></section>
      <section><h3>面板最小尺寸 · 待确认</h3><label className="minimum-control">宽度 <output>{state.minPanel.width}px</output><input type="range" min="180" max="360" step="10" value={state.minPanel.width} onChange={e => model.setMinimum(+e.target.value, state.minPanel.height)} /></label><label className="minimum-control">高度 <output>{state.minPanel.height}px</output><input type="range" min="120" max="260" step="10" value={state.minPanel.height} onChange={e => model.setMinimum(state.minPanel.width, +e.target.value)} /></label></section>
      <section><h3>动效预览</h3><label className="debug-toggle"><span>模拟减弱动态效果</span><input type="checkbox" checked={state.debugReducedMotion} onChange={e => model.setDebugReducedMotion(e.target.checked)} /></label><p>默认跟随系统。此开关仅用于原型预览，关闭后恢复系统偏好。</p></section>
      <section><h3>原型边界</h3><p>所有启动、输入、结束和保存均为模拟。没有真实进程、文件操作或持久化。浏览器不能限制主窗口缩小；所需窗口尺寸通过 window.ensure-size 命令提供给未来的 Electron 宿主。</p><button className="text-button" onClick={() => model.reset()}><Icon name="reset" size={14} />重置全部演示数据</button></section>
    </div>}
    <footer className="debug-footer">window.__VIBEBRIDGE_PROTOTYPE__<span>内存模拟 · {state.traces.length} / 200 events</span></footer>
  </aside>;
}

export default function App() {
  const state = usePrototype();
  const query = new URLSearchParams(location.search);
  const [modal, setModal] = useState<Modal>(() => {
    const scene = query.get('scene'); return scene === 'add' || scene === 'quit' || scene === 'directory' ? scene : null;
  });
  const [settingsOpen, setSettingsOpen] = useState(query.get('scene') === 'settings');
  const [scene, setScene] = useState<'workbench' | 'setup'>(query.get('scene') === 'setup' ? 'setup' : 'workbench');
  const [directory, setDirectory] = useState('/Users/red/Project/MyProject');
  const [setupDraft, setSetupDraft] = useState<SetupDraft>({ total: 3, counts: { codex: 0, claude: 0, pi: 0 } });
  const [debug, setDebug] = useState(query.get('debug') === '1');
  const [systemLight, setSystemLight] = useState(matchMedia('(prefers-color-scheme: light)').matches);
  const light = state.theme === 'light' || state.theme === 'system' && systemLight;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)'), change = () => setSystemLight(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; document.documentElement.dataset.variant = state.variant; }, [light, state.variant]);
  const openModal = (next: ModalRequest) => { if (next === 'settings') { setSettingsOpen(true); return; } if (next === 'directory') model.selectDirectory(); setModal(next); };
  const selectProject = (projectId: string) => { setScene('workbench'); setSettingsOpen(false); setModal(null); model.switchProject(projectId); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if ((event.target as HTMLElement).closest('[data-shortcut-editor]')) return;
        if (modal) setModal(null);
        else if (settingsOpen) setSettingsOpen(false);
        else if (scene === 'setup') setScene('workbench');
        else if (state.maximizedId) model.maximize(state.maximizedId);
        return;
      }
      if (state.closed || modal || settingsOpen || scene === 'setup') return;
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const project = state.projects[+event.key - 1]; if (project) { event.preventDefault(); selectProject(project.id); } return;
      }
      const binding = keyboardBinding(event).toLowerCase();
      const action = (Object.entries(state.shortcuts) as [ShortcutAction, string][]).find(([, value]) => value.toLowerCase() === binding)?.[0];
      if (!action) return;
      event.preventDefault();
      if (action === 'addAgent') setModal('add');
      if (action === 'maximize' && state.focusId) model.maximize(state.focusId);
      if (action === 'nextProject') selectProject(state.projects[(state.projects.findIndex(p => p.id === state.activeProjectId) + 1) % state.projects.length].id);
      if (action === 'nextPanel') { const panels = leafIds(model.active().layout); if (panels.length) model.focus(panels[(panels.indexOf(state.focusId ?? '') + 1) % panels.length]); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [state, modal, scene, settingsOpen]);
  const content = scene === 'setup'
    ? <SetupPage directory={directory} draft={setupDraft} onDraft={setSetupDraft} onBack={() => { setScene('workbench'); setModal('directory'); }} onCreated={() => { setScene('workbench'); setModal(null); }} />
    : <WorkArea state={state} light={light} onAdd={() => setModal('add')} />;
  const Shell = { A: VariantA, B: VariantB, C: VariantC }[state.variant];
  return <div className={`app-root ${import.meta.env.DEV ? 'development' : ''}`} data-reduced-motion={state.debugReducedMotion ? 'true' : undefined}>
    {state.closed ? <ClosedScene state={state} /> : settingsOpen ? <GlobalSettings state={state} light={light} onModal={openModal} onClose={() => setSettingsOpen(false)} /> : <Shell state={state} light={light} onModal={openModal} onProject={selectProject}>{content}</Shell>}
    {!state.closed && modal === 'add' && <AddAgentDialog variant={state.variant} onClose={() => setModal(null)} />}
    {!state.closed && modal === 'directory' && <DirectoryDialog initial={directory} onClose={() => setModal(null)} onContinue={value => { const existing = state.projects.find(p => p.directory === value); if (existing) { selectProject(existing.id); return; } setDirectory(value); setSetupDraft({ total: 3, counts: { codex: 0, claude: 0, pi: 0 } }); setModal(null); setScene('setup'); }} />}
    {!state.closed && modal === 'quit' && <QuitDialog onClose={() => setModal(null)} />}
    {state.toast && <div className="toast" role="alert">{state.toast}</div>}
    {import.meta.env.DEV && debug && <DebugInspector state={state} setupDraft={scene === 'setup' ? { ...setupDraft, directory } : null} onClose={() => setDebug(false)} />}
    <PrototypeSwitcher state={state} debug={debug} onDebug={() => setDebug(!debug)} />
  </div>;
}
