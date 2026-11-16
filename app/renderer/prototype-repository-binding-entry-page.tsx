// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding-entry`. Never import or adapt into production (AGENTS.md「Prototypes」).
// #218: hosts the variants of prototype-repository-binding-entry.tsx. Run: `npm run prototype:repository-binding-entry`.
// ?variant=A|B|C|D picks the variant; ?theme=light starts light.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ghStates, type GhState } from './prototype-workbench-settings';
import { listCheckStates, type StoredProject } from './prototype-repository-binding';
import { BindingEntryDialog, VariantSwitcher, variants, type Entry, type Variant } from './prototype-repository-binding-entry';
import './style.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import './prototype-github-sidebar-pull.css';
import './prototype-workbench.css';
import './prototype-repository-binding.css';
import './prototype-repository-binding-entry.css';

const dialogGhStates = ghStates.filter(s => s.key !== 'no-access');
const REPO = 'a1457139709/VibeBridge';

function Page() {
  const params = new URLSearchParams(location.search);
  const [theme, setTheme] = useState(params.get('theme') === 'light' ? 'light' : 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const initial = params.get('variant') as Variant;
  const [variant, setVariantState] = useState<Variant>(variants.some(v => v.key === initial) ? initial : 'A');
  const setVariant = (v: Variant) => {
    setVariantState(v); const p = new URLSearchParams(location.search); p.set('variant', v);
    history.replaceState(null, '', `?${p}`); setRun(n => n + 1);
  };
  const [gh, setGh] = useState<GhState>('unbound');
  const [listCheck, setListCheck] = useState<'ok' | 'fail'>('ok');
  const [project, setProject] = useState<StoredProject>({ name: 'VibeBridge', directory: '/Users/red/Project/VibeBridge' });
  const [entry, setEntry] = useState<Entry | undefined>('sidebar');
  const [run, setRun] = useState(0);

  const setGhState = (state: GhState) => {
    setGh(state);
    if (state === 'bound') setProject(p => ({ ...p, bound: p.bound ?? REPO }));
    if (state === 'unbound') setProject(p => ({ ...p, bound: undefined }));
    setRun(n => n + 1);
  };
  const open = (e: Entry) => { setEntry(e); setRun(n => n + 1); };
  const group = <K extends string>(label: string, items: readonly { key: K; name: string }[], value: K, set: (k: K) => void) =>
    <span className="proto-group"><span>{label}</span><select value={value} onChange={e => set(e.target.value as K)}>{items.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}</select></span>;

  return <div className="app proto pb-page pe-page">
    <div className="proto-bar" role="toolbar" aria-label="原型开关">
      <span className="proto-tag">PROTOTYPE · #218 绑定入口</span>
      {group('gh', dialogGhStates, gh, setGhState)}
      {group('保存时重新读取列表', listCheckStates, listCheck, setListCheck)}
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
    </div>
    <div className="pe-shell">
      <nav className="pe-nav"><b className="muted">项目</b>
        <div className="pe-nav-row"><span>{project.name}</span><span className="gh-spacer" /><button className="gh-btn" onClick={() => open('edit')}>⋯ 编辑项目</button></div></nav>
      <main className="pe-main muted">终端区域</main>
      <aside className="pe-sidebar">
        <header className="gh-head"><span className="gh-repo">{project.bound ?? '未绑定仓库'}</span><span className="gh-spacer" />
          {project.bound && <button className="gh-btn" onClick={() => open('sidebar')}>修改绑定</button>}</header>
        {project.bound ? <p className="muted pe-empty">（issue 列表）</p>
          : <div className="pe-empty"><p>这个项目还没有绑定 GitHub 仓库。</p><button className="gh-btn primary" onClick={() => open('sidebar')}>绑定仓库</button></div>}
      </aside>
    </div>
    {entry && <BindingEntryDialog key={`${run}-${variant}-${entry}`} variant={variant} entry={entry} gh={gh} listCheck={listCheck} repo={REPO}
      stored={project} onStore={next => { setProject(next); if (gh === 'bound' || gh === 'unbound') setGh(next.bound ? 'bound' : 'unbound'); }}
      onClose={() => setEntry(undefined)} />}
    <VariantSwitcher current={variant} set={setVariant} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<Page />);
