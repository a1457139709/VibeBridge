// Question: which of three workbench shells + add/settings surfaces best supports
// multi-project CLI work? /prototype/workbench?variant=A|B|C. THROWAWAY / memory only.
import type { AgentSettings, AgentType, Layout, Panel, Project, PrototypeCommand, PrototypeEvent, Shortcuts, Theme, Trace, Variant, WorkspaceSnapshot } from './bridge.prototype';

export const AGENTS = {
  codex: { name: 'Codex', command: 'codex', color: 'var(--brand-codex)' },
  claude: { name: 'Claude Code', command: 'claude', color: 'var(--brand-claude)' },
  pi: { name: 'pi', command: 'pi', color: 'var(--brand-pi)' },
} as const;
export const AGENT_TYPES: AgentType[] = ['codex', 'claude', 'pi'];
export const PANEL_GAP = 8;
export const DEFAULT_SHORTCUTS: Shortcuts = { nextProject: 'Meta+Shift+]', nextPanel: 'Meta+]', maximize: 'Meta+Enter', addAgent: 'Meta+N' };
export const VARIANTS: Record<Variant, { name: string; note: string }> = {
  A: { name: 'Quiet · 经典侧栏', note: '完整项目导航 / 横向 Agent 选择 / 全局设置' },
  B: { name: 'Focus · 紧凑工作区', note: '图标窄栏 / 纵向 Agent 选择 / 全局设置' },
  C: { name: 'Studio · 项目书桌', note: '项目上下文导航 / 三角 Agent 选择 / 全局设置' },
};
export type Run = { id: string; projectId: string; panelId: string; agent: AgentType; output: string; input: string; cols: number; rows: number; startedAt: number };
export type PrototypeState = {
  projects: Project[];
  activeProjectId: string;
  focusId: string | null;
  maximizedId: string | null;
  runs: Record<string, Run>;
  variant: Variant;
  theme: Theme;
  sidebarCollapsed: boolean;
  debugReducedMotion: boolean;
  agentSettings: AgentSettings;
  shortcuts: Shortcuts;
  toast: string | null;
  closed: false | 'quit' | 'crash';
  minPanel: { width: number; height: number };
  viewport: { width: number; height: number };
  faults: { nextStart: boolean; directory: boolean };
  checks: Partial<Record<AgentType, boolean>>;
  traces: Trace[];
  lastSaved: string | null;
};

let serial = 0;
const id = (prefix: string) => `${prefix}-${++serial}`;
export const leafIds = (node: Layout | null): string[] => !node ? [] : node.kind === 'panel' ? [node.panelId] : [...leafIds(node.first), ...leafIds(node.second)];
const split = (axis: 'x' | 'y', ratio: number, first: Layout, second: Layout): Layout => ({ kind: 'split', id: id('split'), axis, ratio, first, second });
export const layoutMinimum = (node: Layout | null, min: { width: number; height: number }): { width: number; height: number } => {
  if (!node || node.kind === 'panel') return min;
  const a = layoutMinimum(node.first, min), b = layoutMinimum(node.second, min);
  return node.axis === 'x'
    ? { width: Math.ceil(Math.max(a.width / node.ratio, b.width / (1 - node.ratio))) + PANEL_GAP, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: Math.ceil(Math.max(a.height / node.ratio, b.height / (1 - node.ratio))) + PANEL_GAP };
};
export function buildLayout(panels: string[], width: number, height: number, min: { width: number; height: number }, preferThree = true): Layout | null {
  if (!panels.length || width < min.width || height < min.height) return null;
  if (panels.length === 1) return { kind: 'panel', panelId: panels[0] };
  if (preferThree && panels.length === 3) {
    const lower = buildLayout(panels.slice(1), width, (height - PANEL_GAP) * .44, min, false);
    if ((height - PANEL_GAP) * .56 >= min.height && lower) return split('y', .56, { kind: 'panel', panelId: panels[0] }, lower);
  }
  const axes: ('x' | 'y')[] = width / height > min.width / min.height ? ['x', 'y'] : ['y', 'x'];
  const divisions = Array.from({ length: panels.length - 1 }, (_, i) => i + 1).sort((a, b) => Math.abs(a - panels.length / 2) - Math.abs(b - panels.length / 2));
  for (const axis of axes) for (const count of divisions) {
    for (const ratio of [...new Set([.5, count / panels.length, 1 / 3, 2 / 3])]) {
      const aw = axis === 'x' ? (width - PANEL_GAP) * ratio : width;
      const ah = axis === 'y' ? (height - PANEL_GAP) * ratio : height;
      const bw = axis === 'x' ? (width - PANEL_GAP) * (1 - ratio) : width;
      const bh = axis === 'y' ? (height - PANEL_GAP) * (1 - ratio) : height;
      const a = buildLayout(panels.slice(0, count), aw, ah, min, false);
      if (!a) continue;
      const b = buildLayout(panels.slice(count), bw, bh, min, false);
      if (b) return split(axis, ratio, a, b);
    }
  }
  return null;
}
export function panelRects(node: Layout | null, width: number, height: number, x = 0, y = 0, gap = PANEL_GAP): Array<{ panelId: string; x: number; y: number; width: number; height: number }> {
  if (!node) return [];
  if (node.kind === 'panel') return [{ panelId: node.panelId, x, y, width, height }];
  const firstWidth = node.axis === 'x' ? (width - gap) * node.ratio : width;
  const firstHeight = node.axis === 'y' ? (height - gap) * node.ratio : height;
  return node.axis === 'x'
    ? [...panelRects(node.first, firstWidth, height, x, y, gap), ...panelRects(node.second, width - gap - firstWidth, height, x + firstWidth + gap, y, gap)]
    : [...panelRects(node.first, width, firstHeight, x, y, gap), ...panelRects(node.second, width, height - gap - firstHeight, x, y + firstHeight + gap, gap)];
}
function replaceLeaf(node: Layout, panelId: string, replacement: Layout): Layout {
  if (node.kind === 'panel') return node.panelId === panelId ? replacement : node;
  return { ...node, first: replaceLeaf(node.first, panelId, replacement), second: replaceLeaf(node.second, panelId, replacement) };
}
function removeLeaf(node: Layout | null, panelId: string): Layout | null {
  if (!node) return null;
  if (node.kind === 'panel') return node.panelId === panelId ? null : node;
  const first = removeLeaf(node.first, panelId), second = removeLeaf(node.second, panelId);
  return !first ? second : !second ? first : { ...node, first, second };
}
function mapLayout(node: Layout, fn: (node: Layout) => Layout): Layout {
  const next = node.kind === 'split' ? { ...node, first: mapLayout(node.first, fn), second: mapLayout(node.second, fn) } : node;
  return fn(next);
}

const defaults = (): PrototypeState => {
  const project = (name: string, directory: string, initials: string, color: string, agents: AgentType[]): Project => {
    const panels = agents.map(agent => ({ id: id('panel'), agent, runId: null }));
    return { id: id('project'), name, directory, initials, color, panels, layout: buildLayout(panels.map(p => p.id), 1000, 680, { width: 240, height: 160 }), opened: false };
  };
  const projects = [
    project('VibeBridge', '/Users/red/Project/VibeBridge', 'VB', 'var(--avatar-blue)', ['codex', 'claude', 'pi']),
    project('Fieldnotes', '/Users/red/Project/Fieldnotes', 'Fn', 'var(--avatar-amber)', ['claude', 'codex']),
    project('Pocket Lab', '/Users/red/Project/PocketLab', 'PL', 'var(--avatar-green)', []),
  ];
  const query = new URLSearchParams(location.search);
  const variant = query.get('variant')?.toUpperCase();
  return {
    projects, activeProjectId: projects[0].id, focusId: null, maximizedId: null, runs: {},
    variant: variant === 'B' || variant === 'C' ? variant : 'A',
    theme: query.get('theme') === 'light' ? 'light' : query.get('theme') === 'dark' ? 'dark' : 'system',
    sidebarCollapsed: variant === 'B',
    debugReducedMotion: false,
    agentSettings: { codex: { command: 'codex', args: '' }, claude: { command: 'claude', args: '' }, pi: { command: 'pi', args: '' } },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    toast: null, closed: false, minPanel: { width: 240, height: 160 }, viewport: { width: 1000, height: 680 },
    faults: { nextStart: false, directory: false }, checks: {}, traces: [], lastSaved: null,
  };
};

class PrototypeModel {
  state = defaults();
  private listeners = new Set<() => void>();
  private commandListeners = new Set<(command: PrototypeCommand) => void>();
  private sequence = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  subscribeCommands = (fn: (command: PrototypeCommand) => void) => { this.commandListeners.add(fn); return () => { this.commandListeners.delete(fn); }; };
  getState = () => this.state;
  active = () => this.state.projects.find(p => p.id === this.state.activeProjectId)!;
  private publish() { this.state = { ...this.state }; this.listeners.forEach(fn => fn()); }
  private trace(direction: Trace['direction'], type: string, payload: unknown) {
    this.state.traces = [...this.state.traces.slice(-199), { sequence: ++this.sequence, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), direction, type, payload }];
  }
  private command(command: PrototypeCommand) {
    this.trace('command', command.type, command);
    this.commandListeners.forEach(fn => fn(command));
  }
  snapshot = (): WorkspaceSnapshot => ({
    activeProjectId: this.state.activeProjectId,
    projects: this.state.projects.map(({ opened: _opened, panels, ...project }) => ({ ...project, panels: panels.map(({ runId: _runId, ...panel }) => panel) })),
    agentSettings: structuredClone(this.state.agentSettings), theme: this.state.theme, shortcuts: { ...this.state.shortcuts },
  });
  private save() {
    this.state.lastSaved = new Date().toISOString();
    this.command({ type: 'workspace.save', snapshot: this.snapshot() });
  }
  private start(project: Project, panel: Panel, sample = false) {
    const runId = id('run'), setting = this.state.agentSettings[panel.agent];
    this.command({ type: 'run.start', projectId: project.id, panelId: panel.id, runId, agent: panel.agent, cwd: project.directory, ...setting });
    if (this.state.faults.nextStart || !setting.command.trim()) {
      this.state.faults.nextStart = false;
      this.trace('event', 'run.start-failed', { runId });
      this.notify('Agent 无法启动');
      return false;
    }
    panel.runId = runId;
    const prompt = panel.agent === 'claude' ? '❯' : panel.agent === 'pi' ? '>' : '›';
    const colored = '\x1b[90m';
    const title = `\x1b[1m${AGENTS[panel.agent].name}\x1b[0m  ${colored}· mock terminal\x1b[0m`;
    const sampleLines: Record<AgentType, string> = {
      codex: `\r\n${prompt} Read plans/SPEC.md\r\n\r\n${colored}• Read SPEC.md, CONTEXT.md\x1b[0m\r\n\r\nProject setup → Terminal workspace → Settings\r\n\r\n\x1b[32m+ Keep panel identity stable during layout changes.\r\n+ Let the CLI own session history and recovery.\x1b[0m\r\n`,
      claude: `\r\n${colored}Window count: 3 · Assigned: 0 / 3\x1b[0m\r\n\r\nCreate only when assigned count equals total.\r\n`,
      pi: `\r\nSwitch project    keep runs alive\r\nClose panel       stop the run\r\nQuit app          keep configuration\r\n`,
    };
    const output = `${title}\r\n${colored}${project.directory}\x1b[0m\r\n${sample ? sampleLines[panel.agent] : '\r\nLocal simulation. Type /help for sample input.\r\n'}\r\n${prompt} `;
    this.state.runs[runId] = { id: runId, projectId: project.id, panelId: panel.id, agent: panel.agent, output, input: '', cols: 80, rows: 24, startedAt: Date.now() };
    this.trace('event', 'run.output', { runId, data: output });
    return true;
  }
  initialize(sample = true) {
    const project = this.active();
    if (project.opened) return;
    project.opened = true;
    for (const panel of [...project.panels]) if (!this.start(project, panel, sample)) {
      project.panels = project.panels.filter(p => p.id !== panel.id);
      project.layout = removeLeaf(project.layout, panel.id);
    }
    this.state.focusId = project.panels[0]?.id ?? null;
    this.publish();
  }
  notify(message: string) {
    this.state.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.state.toast = null; this.publish(); }, 3600);
    this.publish();
  }
  setVariant(variant: Variant) {
    this.state.variant = variant;
    this.state.sidebarCollapsed = variant === 'B';
    const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url);
    this.trace('ui', 'prototype.variant', { variant, activeProjectId: this.state.activeProjectId, panels: this.active().panels, layout: this.active().layout });
    if (import.meta.env.DEV) console.info('[VibeBridge prototype] variant state', { variant, focusId: this.state.focusId, maximizedId: this.state.maximizedId, ...this.snapshot(), runs: structuredClone(this.state.runs) });
    this.publish();
  }
  setTheme(theme: Theme) { this.state.theme = theme; this.save(); this.publish(); }
  toggleSidebar() { this.state.sidebarCollapsed = !this.state.sidebarCollapsed; this.publish(); }
  focus(panelId: string, restore = false) {
    this.state.focusId = panelId;
    if (restore || this.state.maximizedId) this.state.maximizedId = restore ? null : panelId;
    this.publish();
  }
  maximize(panelId: string) {
    this.state.focusId = panelId;
    this.state.maximizedId = this.state.maximizedId === panelId ? null : panelId;
    this.trace('ui', 'panel.maximize', { panelId, maximizedId: this.state.maximizedId });
    this.publish();
  }
  switchProject(projectId: string) {
    if (this.state.closed || projectId === this.state.activeProjectId) return;
    this.state.activeProjectId = projectId; this.state.maximizedId = null; this.state.focusId = null;
    this.initialize(false);
    this.state.focusId = leafIds(this.active().layout)[0] ?? null;
    const minimum = layoutMinimum(this.active().layout, this.state.minPanel);
    this.command({ type: 'window.ensure-size', projectId,
      width: minimum.width + Math.max(0, window.innerWidth - this.state.viewport.width),
      height: minimum.height + Math.max(0, window.innerHeight - this.state.viewport.height),
    });
    this.save(); this.publish();
  }
  selectDirectory() { this.command({ type: 'directory.select' }); this.publish(); }
  createProject(directory: string, count: number, allocation: Record<AgentType, number>, projectName?: string) {
    if (AGENT_TYPES.reduce((n, a) => n + allocation[a], 0) !== count || count < 1 || count > 10) return false;
    const existing = this.state.projects.find(p => p.directory === directory);
    if (existing) { this.switchProject(existing.id); return true; }
    const panels: Panel[] = AGENT_TYPES.flatMap(agent => Array.from({ length: allocation[agent] }, () => ({ id: id('panel'), agent, runId: null })));
    const { width, height } = this.state.viewport;
    const layout = buildLayout(panels.map(p => p.id), width, height, this.state.minPanel);
    if (!layout) { this.notify('空间不足，请扩大主窗口或关闭其他面板后重试'); return false; }
    const name = projectName?.trim() || directory.split('/').filter(Boolean).at(-1) || 'Project';
    const project: Project = { id: id('project'), name, directory, initials: name.slice(0, 2), color: 'var(--avatar-blue)', panels, layout, opened: false };
    this.state.projects.push(project); this.state.activeProjectId = project.id; this.state.maximizedId = null;
    this.initialize(false); this.save(); this.publish(); return true;
  }
  addPanel(agent: AgentType) {
    const project = this.active();
    if (project.panels.length >= 10) { this.notify('每个项目最多 10 个面板'); return false; }
    const panel: Panel = { id: id('panel'), agent, runId: null };
    const { width, height } = this.state.viewport, min = this.state.minPanel;
    let layout: Layout | null = null;
    if (!project.layout) layout = buildLayout([panel.id], width, height, min);
    else {
      const rects = panelRects(project.layout, width, height).sort((a, b) => b.width * b.height - a.width * a.height);
      for (const rect of rects) {
        const axes: ('x' | 'y')[] = rect.width / rect.height > min.width / min.height ? ['x', 'y'] : ['y', 'x'];
        for (const axis of axes) {
          if ((axis === 'x' ? (rect.width - PANEL_GAP) / 2 >= min.width && rect.height >= min.height : rect.width >= min.width && (rect.height - PANEL_GAP) / 2 >= min.height)) {
            layout = replaceLeaf(project.layout, rect.panelId, split(axis, .5, { kind: 'panel', panelId: rect.panelId }, { kind: 'panel', panelId: panel.id }));
            break;
          }
        }
        if (layout) break;
      }
      if (!layout) layout = buildLayout([...leafIds(project.layout), panel.id], width, height, min, false);
    }
    if (!layout) { this.notify('空间不足，请扩大主窗口或关闭其他面板后重试'); return false; }
    if (!this.start(project, panel)) { this.publish(); return false; }
    project.panels.push(panel); project.layout = layout;
    this.state.focusId = panel.id; this.state.maximizedId = null;
    this.save(); this.publish(); return true;
  }
  closePanel(panelId: string, reason: 'panel-close' | 'process-exit' = 'panel-close') {
    const project = this.state.projects.find(p => p.panels.some(panel => panel.id === panelId));
    const panel = project?.panels.find(p => p.id === panelId);
    if (!project || !panel) return;
    if (panel.runId) { this.command({ type: 'run.stop', runId: panel.runId, reason }); delete this.state.runs[panel.runId]; }
    project.panels = project.panels.filter(p => p.id !== panelId); project.layout = removeLeaf(project.layout, panelId);
    if (this.state.focusId === panelId) this.state.focusId = leafIds(project.layout)[0] ?? null;
    if (this.state.maximizedId === panelId) this.state.maximizedId = null;
    this.save(); this.publish();
  }
  swapPanels(a: string, b: string) {
    const project = this.active();
    if (!project.layout || a === b || !project.panels.some(p => p.id === a) || !project.panels.some(p => p.id === b)) return;
    project.layout = mapLayout(project.layout, node => node.kind === 'panel' ? { ...node, panelId: node.panelId === a ? b : node.panelId === b ? a : node.panelId } : node);
    this.trace('ui', 'layout.swap', { a, b }); this.save(); this.publish();
  }
  resizeSplit(splitId: string, ratio: number, save = false) {
    const project = this.active(); if (!project.layout) return;
    project.layout = mapLayout(project.layout, node => node.kind === 'split' && node.id === splitId ? { ...node, ratio } : node);
    if (save) this.save(); this.publish();
  }
  setViewport(width: number, height: number) {
    if (Math.abs(width - this.state.viewport.width) < 1 && Math.abs(height - this.state.viewport.height) < 1) return;
    this.state.viewport = { width, height }; this.publish();
  }
  resizeRun(runId: string, cols: number, rows: number) {
    const run = this.state.runs[runId]; if (!run || cols === run.cols && rows === run.rows) return;
    run.cols = cols; run.rows = rows; this.command({ type: 'run.resize', runId, cols, rows }); this.publish();
  }
  input(runId: string, data: string) {
    const run = this.state.runs[runId]; if (!run || this.state.closed) return;
    const previousOutput = run.output;
    this.command({ type: 'run.input', runId, data });
    const prompt = run.agent === 'claude' ? '❯' : run.agent === 'pi' ? '>' : '›';
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const input = run.input.trim(); run.input = '';
        if (input === '/exit' || input === 'exit') { this.emit({ type: 'run.exit', runId, exitCode: 0 }); return; }
        if (input === 'clear' || input === '/clear') { run.output = `\x1b[2J\x1b[H${prompt} `; continue; }
        let answer = input ? 'Mock reply: input received by this Agent Run.\r\nNo command or model request was executed.' : '';
        if (input === 'pwd') answer = this.state.projects.find(p => p.id === run.projectId)!.directory;
        if (input === '/help' || input === 'help') answer = 'Prototype input: pwd, /clear, /exit.\r\nOther text receives a simulated reply. CLI history belongs to the real CLI.';
        run.output += `\r\n${answer ? '\r\n' + answer + '\r\n' : ''}\r\n${prompt} `;
      } else if (char === '\x7f' || char === '\b') {
        if (run.input) { run.input = run.input.slice(0, -1); run.output += '\b \b'; }
      } else if (char === '\x03') { run.input = ''; run.output += `^C\r\n${prompt} `; }
      else if (char === '\x0c') { run.output = `\x1b[2J\x1b[H${prompt} ${run.input}`; }
      else if (char >= ' ' && char !== '\x7f') { run.input += char; run.output += char; }
    }
    const delta = run.output.startsWith(previousOutput) ? run.output.slice(previousOutput.length) : run.output;
    run.output = run.output.slice(-32000);
    this.trace('event', 'run.output', { runId, data: delta }); this.publish();
  }
  emit = (event: PrototypeEvent) => {
    this.trace('event', event.type, event);
    if (event.type === 'run.output') {
      const run = this.state.runs[event.runId]; if (run) run.output = (run.output + event.data).slice(-32000);
    } else if (event.type === 'run.exit') {
      const run = this.state.runs[event.runId]; if (run) { this.closePanel(run.panelId, 'process-exit'); return; }
    } else if (event.type === 'run.start-failed') {
      const run = this.state.runs[event.runId];
      if (run) this.closePanel(run.panelId, 'process-exit');
      this.notify('Agent 无法启动');
    } else if (event.type === 'agent.check-result') this.state.checks[event.agent] = event.available;
    this.publish();
  };
  setAgentSettings(agent: AgentType, value: { command: string; args: string }) {
    if (this.state.agentSettings[agent].command !== value.command) delete this.state.checks[agent];
    this.state.agentSettings[agent] = value; this.save(); this.publish();
  }
  checkAgent(agent: AgentType) {
    this.command({ type: 'agent.check', agent, command: this.state.agentSettings[agent].command });
    this.emit({ type: 'agent.check-result', agent, available: !!this.state.agentSettings[agent].command.trim() });
  }
  shortcutConflict(action: keyof Shortcuts, binding: string): { action: keyof Shortcuts } | { reserved: true } | null {
    if (/^meta\+[1-9]$/i.test(binding)) return { reserved: true };
    const other = (Object.entries(this.state.shortcuts) as [keyof Shortcuts, string][]).find(([key, value]) => key !== action && value.toLowerCase() === binding.toLowerCase());
    return other ? { action: other[0] } : null;
  }
  setShortcut(action: keyof Shortcuts, binding: string) {
    if (this.shortcutConflict(action, binding)) return false;
    this.state.shortcuts[action] = binding; this.save(); this.publish(); return true;
  }
  resetShortcuts() { this.state.shortcuts = { ...DEFAULT_SHORTCUTS }; this.trace('ui', 'shortcuts.reset', this.state.shortcuts); this.save(); this.publish(); }
  setDebugReducedMotion(value: boolean) { this.state.debugReducedMotion = value; this.trace('ui', 'prototype.motion', { reducedMotion: value }); this.publish(); }
  setFault(key: 'nextStart' | 'directory', value: boolean) { this.state.faults = { ...this.state.faults, [key]: value }; this.publish(); }
  setMinimum(width: number, height: number) { this.state.minPanel = { width, height }; this.publish(); }
  clearTrace() { this.state.traces = []; this.publish(); }
  seedPanels(count: number) {
    const project = this.active(), { width, height } = this.state.viewport;
    const panels: Panel[] = Array.from({ length: count }, (_, i) => ({ id: id('panel'), agent: AGENT_TYPES[i % 3], runId: null }));
    const layout = buildLayout(panels.map(p => p.id), width, height, this.state.minPanel);
    if (count && !layout) { this.notify('空间不足，请扩大主窗口或关闭其他面板后重试'); return; }
    for (const panel of project.panels) if (panel.runId) { this.command({ type: 'run.stop', runId: panel.runId, reason: 'panel-close' }); delete this.state.runs[panel.runId]; }
    project.panels = panels; project.layout = layout;
    this.state.maximizedId = null; project.opened = false;
    this.initialize(); this.save(); this.publish();
  }
  quit(crash = false) {
    this.save();
    for (const run of Object.values(this.state.runs)) this.command({ type: 'run.stop', runId: run.id, reason: crash ? 'main-crash' : 'app-quit' });
    this.state.runs = {};
    this.state.projects.forEach(p => { p.opened = false; p.panels.forEach(panel => { panel.runId = null; }); });
    this.state.maximizedId = null; this.state.focusId = null; this.state.closed = crash ? 'crash' : 'quit';
    if (!crash) this.command({ type: 'app.quit' });
    this.publish();
  }
  reopen() { this.state.closed = false; this.initialize(false); this.publish(); }
  reset() { this.state = defaults(); this.initialize(); }
}

export const model = new PrototypeModel();
model.initialize();

declare global {
  interface Window {
    __VIBEBRIDGE_PROTOTYPE__: {
      getState: () => PrototypeState;
      getSnapshot: () => WorkspaceSnapshot;
      getTrace: () => Trace[];
      emit: (event: PrototypeEvent) => void;
      subscribeCommands: (listener: (command: PrototypeCommand) => void) => () => void;
      reset: () => void;
    };
  }
}
window.__VIBEBRIDGE_PROTOTYPE__ = {
  getState: () => structuredClone(model.state), getSnapshot: model.snapshot,
  getTrace: () => structuredClone(model.state.traces), emit: model.emit,
  subscribeCommands: model.subscribeCommands, reset: () => model.reset(),
};
