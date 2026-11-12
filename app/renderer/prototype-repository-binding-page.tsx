// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding`. Never import or adapt into production (AGENTS.md「Prototype scope」).
// #181: hosts the edit-project dialog of prototype-repository-binding.tsx. Run: `npm run prototype:repository-binding`.
// ?theme=light starts in the light theme.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ghStates, type GhState } from './prototype-workbench-settings';
import { RepositoryBindingDialog, listCheckStates, type StoredProject } from './prototype-repository-binding';
import './style.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import './prototype-github-sidebar-pull.css';
import './prototype-workbench.css';
import './prototype-repository-binding.css';

// gh states the dialog can meet; 「无法访问」 is a sidebar state, not a list failure, so it is left out here.
const dialogGhStates = ghStates.filter(s => s.key !== 'no-access');

function Page() {
  const [theme, setTheme] = useState(new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [gh, setGh] = useState<GhState>('bound');
  const [listCheck, setListCheck] = useState<'ok' | 'fail'>('ok');
  const [project, setProject] = useState<StoredProject>({ name: 'VibeBridge', directory: '/Users/red/Project/VibeBridge', bound: 'a1457139709/VibeBridge' });
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState(0); // remounts the dialog so a switch starts from a fresh dialog

  // 已绑定 / 未绑定 set the stored binding; the failure states keep it as it is.
  const setGhState = (state: GhState) => {
    setGh(state);
    if (state === 'bound') setProject(p => ({ ...p, bound: p.bound ?? 'a1457139709/VibeBridge' }));
    if (state === 'unbound') setProject(p => ({ ...p, bound: undefined }));
    setRun(n => n + 1);
  };
  const group = <K extends string>(label: string, items: readonly { key: K; name: string }[], value: K, set: (k: K) => void) =>
    <span className="proto-group"><span>{label}</span><select value={value} onChange={e => set(e.target.value as K)}>{items.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}</select></span>;

  return <div className="app proto pb-page">
    <div className="proto-bar" role="toolbar" aria-label="原型开关">
      <span className="proto-tag">PROTOTYPE · 仓库绑定</span>
      {group('gh', dialogGhStates, gh, setGhState)}
      {group('保存时重新读取列表', listCheckStates, listCheck, setListCheck)}
      <button onClick={() => { setOpen(true); setRun(n => n + 1); }}>重新打开对话框</button>
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
    </div>
    {!open && <p className="pb-closed muted">对话框已关闭。已存：{project.name} · {project.directory} · 绑定 {project.bound ?? '无'}</p>}
    {open && <RepositoryBindingDialog key={run} gh={gh} listCheck={listCheck} repo="a1457139709/VibeBridge"
      stored={project} onStore={next => { setProject(next); if (gh === 'bound' || gh === 'unbound') setGh(next.bound ? 'bound' : 'unbound'); }}
      onClose={() => setOpen(false)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Page />);
