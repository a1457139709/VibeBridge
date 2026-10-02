// THROWAWAY. Compare real CLI rendering in the existing visual language.
// A/B/C are typography probes, not another round of workbench layout decisions.
import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RealTerminal } from './Terminal.prototype';
import type { Appearance, RunState } from './Terminal.prototype';
import type { AgentType, Boot, ThemePreference } from './types.prototype';
import { AgentMark, BridgeMark, Icon } from './icons.prototype';
import './style.prototype.css';

const profiles: Record<string, { name: string } & Appearance> = {
  A: { name: '当前基准', fontSize: 13, lineHeight: 1.55, contrast: 4.5, scrollbar: false },
  B: { name: '紧凑阅读', fontSize: 13, lineHeight: 1.2, contrast: 4.5, scrollbar: true },
  C: { name: '较大字号', fontSize: 15, lineHeight: 1.4, contrast: 4.5, scrollbar: true },
};
type Panel = { id: string; agent: AgentType };
const themes: { id: ThemePreference; name: string }[] = [
  { id: 'system', name: '跟随系统' }, { id: 'dark', name: '深色' }, { id: 'light', name: '浅色' },
];
const startupPreference = (new URLSearchParams(location.search).get('preference') ?? 'system') as ThemePreference;
const themeName = (id: ThemePreference) => themes.find(theme => theme.id === id)!.name;
const initialVariant = new URLSearchParams(location.search).get('variant') ?? 'A';
function App() {
  const [boot, setBoot] = useState<Boot>();
  const [error, setError] = useState('');
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selected, setSelected] = useState('');
  const [maximized, setMaximized] = useState<string | null>(null);
  const [density, setDensity] = useState(2);
  const [states, setStates] = useState<Record<string, RunState>>({});
  const [variant, setVariant] = useState(profiles[initialVariant] ? initialVariant : 'A');
  const [appearance, setAppearance] = useState<Appearance>(profiles[initialVariant] ?? profiles.A);
  const [light] = useState(new URLSearchParams(location.search).get('theme') === 'light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedTheme, setSavedTheme] = useState<ThemePreference>(startupPreference);
  const [draftTheme, setDraftTheme] = useState<ThemePreference>(startupPreference);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const restartPending = savedTheme !== startupPreference;
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);
  const add = (agent: AgentType) => {
    const id = crypto.randomUUID();
    setPanels(items => [...items, { id, agent }]); setSelected(id); setMaximized(null);
  };
  useLayoutEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; }, [light]);
  useEffect(() => {
    if (!window.terminalPrototype) { setError('请使用 npm run prototype:terminal 打开 Electron 原型。'); return; }
    window.terminalPrototype.boot().then(info => {
      setBoot(info); setSavedTheme(info.savedTheme); setDraftTheme(info.savedTheme);
      const first = info.agents.find(agent => agent.path);
      if (first) add(first.id);
    }).catch(err => setError(String(err)));
  }, []);
  const count = Math.max(density, panels.length > 2 ? 4 : panels.length);
  const close = async (id: string) => {
    try { await window.terminalPrototype.stop(id); }
    catch (err) { setError(String(err)); }
    setPanels(items => items.filter(item => item.id !== id));
    setStates(items => { const next = { ...items }; delete next[id]; return next; });
    if (selected === id) setSelected(panels.find(item => item.id !== id)?.id ?? '');
    if (maximized === id) setMaximized(null);
  };
  const changeProfile = (key: string) => {
    setVariant(key); setAppearance(profiles[key]);
    const url = new URL(location.href); url.searchParams.set('variant', key); history.replaceState(null, '', url);
  };
  const saveTheme = async () => {
    setSaving(true); setSaveError('');
    try { await window.terminalPrototype.saveTheme(draftTheme); setSavedTheme(draftTheme); }
    catch (err) { setSaveError(String(err)); }
    finally { setSaving(false); }
  };
  const record = () => [
    '# VibeBridge 真实终端体验记录（待用户判定）', `时间：${new Date().toISOString()}`,
    `平台：${boot?.platform}；Electron ${boot?.electron}；Node ${boot?.node}；Chromium ${boot?.chrome}`,
    'xterm.js 6.0.0；WebGL addon 0.19.0；node-pty 1.1.0；直接启动 PATH 中的 CLI，PTY 不继承 NO_COLOR。',
    `本次工作台与终端：${light ? '浅色' : '深色'}；启动偏好：${themeName(startupPreference)}；已保存：${themeName(savedTheme)}${restartPending ? '（重启后生效）' : ''}；CLI 自身主题请补充；字体：SFMono-Regular；字号 ${appearance.fontSize}px；行高 ${appearance.lineHeight}；最小对比度 ${appearance.contrast}；滚动条 ${appearance.scrollbar ? '显示' : '隐藏'}`,
    `窗口内容区：${innerWidth}×${innerHeight}px；设备像素比：${devicePixelRatio}；布局：${count} 格；临时放大：${maximized ? '是' : '否'}`,
    ...panels.map(panel => { const info = boot?.agents.find(a => a.id === panel.agent), state = states[panel.id]; return `- ${info?.name} / ${info?.version}：${state?.cols ?? 0}列 × ${state?.rows ?? 0}行，${state?.status ?? '启动中'}，${state?.renderer ?? '初始化'}，PID ${state?.pid ?? '—'}`; }),
    '', '## 体验观察', notes || '尚未填写；没有用户结论。', '',
    '本记录不自动复制终端内容；不代表正式集成、命令环境覆盖或异常清理验收。',
  ].join('\n');
  return <div className="app">
    <header className="system-bar"><BridgeMark size={22}/><strong>VibeBridge</strong><span className="prototype-badge">真实终端原型</span><div className="header-end"><button disabled={!boot} onClick={() => { setDraftTheme(savedTheme); setSaveError(''); setSettingsOpen(true); }} title="设置" aria-label="设置"><Icon name="settings"/></button><button className="text-button" onClick={() => setNotesOpen(!notesOpen)}>体验记录</button></div></header>
    <aside className="sidebar"><span className="eyebrow">项目</span><div className="project selected-project"><Icon name="folder"/><span>终端体验目录<small>临时示例 · 本机</small></span></div><div className="sidebar-bottom"><span className="status-dot"/>原生 Agent CLI</div></aside>
    <main className="workspace">
      <header className="workspace-header"><span title={boot?.cwd} className="directory">{boot?.cwd ?? '准备真实终端…'}</span><div className="add-actions">{boot?.agents.map(agent => <button key={agent.id} className="add-agent" disabled={!agent.path || panels.length >= 4} title={agent.path ? `${agent.version}\n${agent.path}` : '未在 PATH 找到'} onClick={() => add(agent.id)}><AgentMark agent={agent.id} size={16}/><span>＋ {agent.name}</span></button>)}</div></header>
      {error && <div role="alert" className="error-banner">{error}</div>}
      <section className={`board slots-${count} ${maximized ? 'has-maximized' : ''}`} aria-label="真实 Agent 布局区域">
        {panels.map(panel => {
          const info = boot?.agents.find(agent => agent.id === panel.agent), state = states[panel.id];
          return <article key={panel.id} data-run-id={panel.id} className={`agent-panel ${selected === panel.id ? 'is-selected' : ''} ${maximized === panel.id ? 'is-maximized' : ''}`} onFocusCapture={() => setSelected(panel.id)} onMouseDown={() => setSelected(panel.id)}>
            <header className="panel-header"><div className="agent-label"><AgentMark agent={panel.agent} size={17}/><span>{info?.name}</span><small>{info?.version}</small></div><div className="panel-controls"><code title="有效终端网格">{state?.cols ?? '—'} × {state?.rows ?? '—'}</code><button onClick={() => setMaximized(maximized === panel.id ? null : panel.id)} title={maximized === panel.id ? '还原面板' : '临时放大'} aria-label={maximized === panel.id ? '还原面板' : '临时放大'}><Icon name={maximized === panel.id ? 'collapse' : 'expand'} size={14}/></button><button onClick={() => void close(panel.id)} title="结束并关闭面板" aria-label="结束并关闭面板"><Icon name="close" size={14}/></button></div></header>
            <RealTerminal id={panel.id} agent={panel.agent} light={light} appearance={appearance} selected={selected === panel.id} report={next => setStates(old => ({ ...old, [panel.id]: { ...(old[panel.id] ?? { status: '启动中', cols: 0, rows: 0 }), ...next } }))}/>
            {state?.error && <div role="alert" className="error-banner">{state.error}</div>}
            <footer className="panel-status"><span>{state?.status ?? '启动中'}</span><span>{state?.renderer} {state?.pid ? `· PID ${state.pid}` : ''}</span></footer>
          </article>;
        })}
        {Array.from({ length: Math.max(0, count - panels.length) }, (_, i) => <div key={`empty-${i}`} className="empty-slot"><Icon name="terminal" size={25}/><span>保留分屏尺寸</span><small>可从右上角添加真实 Agent</small></div>)}
      </section>
    </main>
    <footer className="controls">
      <div className="control-group"><label htmlFor="profile">排版</label><select id="profile" value={variant} onChange={event => changeProfile(event.target.value)}>{Object.entries(profiles).map(([key, value]) => <option key={key} value={key}>{key} · {value.name}</option>)}</select></div>
      <label className="control-group">字号<input aria-label="字号" type="number" min="10" max="24" value={appearance.fontSize} onChange={e => setAppearance(a => ({ ...a, fontSize: Math.min(24, Math.max(10, Number(e.target.value) || 13)) }))}/></label>
      <label className="control-group">行高<input aria-label="行高" type="number" min="1" max="2" step="0.05" value={appearance.lineHeight} onChange={e => setAppearance(a => ({ ...a, lineHeight: Math.min(2, Math.max(1, Number(e.target.value) || 1)) }))}/></label>
      <label className="check"><input type="checkbox" checked={appearance.scrollbar} onChange={e => setAppearance(a => ({ ...a, scrollbar: e.target.checked }))}/>滚动条</label>
      <label className="control-group">对比度<select aria-label="最小对比度" value={appearance.contrast} onChange={e => setAppearance(a => ({ ...a, contrast: Number(e.target.value) }))}><option value="4.5">当前 4.5</option><option value="1">原始颜色</option></select></label>
      <div className="control-group density"><span>尺寸</span>{[1, 2, 4].map(size => <button key={size} aria-pressed={density === size} onClick={() => { setDensity(size); setMaximized(null); }}>{size} 格</button>)}</div>
    </footer>
    {settingsOpen && <div className="record-backdrop" onClick={() => !saving && setSettingsOpen(false)}><section className="record theme-settings" role="dialog" aria-modal="true" aria-label="设置" onClick={e => e.stopPropagation()}><header><h2>外观</h2><button disabled={saving} aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><Icon name="close"/></button></header>
      <label className="theme-field">主题<select aria-label="主题" value={draftTheme} disabled={saving} onChange={e => setDraftTheme(e.target.value as ThemePreference)}>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
      <p>更改主题需要重启应用后生效。跟随系统仅在启动时读取系统外观。</p>
      <p>当前使用：{light ? '浅色' : '深色'}。重启会结束正在运行的 Agent，请在任务结束后自行重启。</p>
      {restartPending && <p className="theme-notice" role="status">已保存“{themeName(savedTheme)}”，重启应用后生效。</p>}
      {saveError && <p role="alert" className="error-banner">{saveError}</p>}
      <button className="primary" disabled={saving || draftTheme === savedTheme} onClick={() => void saveTheme()}>{saving ? '保存中…' : '保存主题'}</button>
    </section></div>}
    {notesOpen && <div className="record-backdrop" onClick={() => setNotesOpen(false)}><section className="record" role="dialog" aria-modal="true" aria-label="体验记录" onClick={e => e.stopPropagation()}><header><h2>体验记录</h2><button aria-label="关闭体验记录" onClick={() => setNotesOpen(false)}><Icon name="close"/></button></header><p>请在终端里实际尝试以下场景，再记录你的感受。</p><ol><li>长中文回答、代码块和工具执行输出。</li><li>连续输入、方向键、Ctrl+C、中文输入法与多行粘贴。</li><li>权限确认提示与原生 CLI 选择菜单。</li><li>向上滚动回看，切换分屏尺寸、临时放大；重启应用后比较不同主题。</li></ol><textarea aria-label="体验观察" value={notes} onChange={e => setNotes(e.target.value)} placeholder="例如：Claude 深色主题，四格时文字偏小；放大后可读。中文输入是否正常…"/><details><summary>本次环境与终端参数</summary><pre>{record()}</pre></details><button className="primary" onClick={() => { void window.terminalPrototype.copy(record()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}>{copied ? '已复制' : '复制记录'}</button></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
