// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding-entry`. Never import or adapt into production (AGENTS.md「Prototypes」).
// #218: hosts the variants of prototype-repository-binding-entry*.tsx. Run: `npm run prototype:repository-binding-entry`.
// ?variant=A|B|C|D|E picks the variant; ?theme=light starts light.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ghStates, type GhState } from './prototype-workbench-settings';
import { listCheckStates, type StoredProject } from './prototype-repository-binding';
import { BindingEntryDialog, VariantSwitcher, variants, type Entry, type Variant } from './prototype-repository-binding-entry';
import { SidebarBinding } from './prototype-repository-binding-entry-sidebar';
import './style.css';
import './prototype-ephemeral-panels.css';
import './prototype-github-sidebar.css';
import './prototype-github-sidebar-pull.css';
import './prototype-workbench.css';
import './prototype-repository-binding.css';
import './prototype-repository-binding-entry.css';

const dialogGhStates = ghStates.filter(s => s.key !== 'no-access');
const originStates = [{ key: 'repo', name: '指向本仓库' }, { key: 'none', name: '不指向 GitHub' }] as const;
const REPO = 'a1457139709/VibeBridge';

function Page() {
  const params = new URLSearchParams(location.search);
  // The web build follows the viewer's theme (an explicit data-theme, else the system setting); ?theme= still wins.
  const [theme, setTheme] = useState(() => params.get('theme') ?? document.documentElement.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // The variant comes from #variant-c (the web build keeps only the hash) or ?variant=C.
  const fromLocation = () => (location.hash.match(/^#variant-([a-e])$/)?.[1].toUpperCase() ?? params.get('variant')) as Variant;
  const initial = fromLocation();
  const [variant, setVariantState] = useState<Variant>(variants.some(v => v.key === initial) ? initial : 'A');
  useEffect(() => {
    const follow = () => { const v = fromLocation(); if (variants.some(x => x.key === v)) setVariant(v); };
    window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow);
  });
  const [gh, setGh] = useState<GhState>('unbound');
  const [listCheck, setListCheck] = useState<'ok' | 'fail'>('ok');
  const [originState, setOriginState] = useState<'repo' | 'none'>('repo');
  const origin = originState === 'repo' ? REPO : undefined;
  const [project, setProject] = useState<StoredProject>({ name: 'VibeBridge', directory: '/Users/red/Project/VibeBridge' });
  const [entry, setEntry] = useState<Entry>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [run, setRun] = useState(0);
  const [calls, setCalls] = useState<string[]>([]);
  const call = (text: string) => setCalls(list => [...list, text]);

  const setVariant = (v: Variant) => {
    if (v === variant) return;
    setVariantState(v); history.replaceState(null, '', `#variant-${v.toLowerCase()}`);
    setEntry(undefined); setMenuOpen(false); setRun(n => n + 1);
  };
  const setGhState = (state: GhState) => {
    setGh(state);
    if (state === 'bound') setProject(p => ({ ...p, bound: p.bound ?? REPO }));
    if (state === 'unbound') setProject(p => ({ ...p, bound: undefined }));
    setRun(n => n + 1);
  };
  const store = (next: StoredProject) => { setProject(next); if (gh === 'bound' || gh === 'unbound') setGh(next.bound ? 'bound' : 'unbound'); };
  const open = (e: Entry) => { setEntry(e); setRun(n => n + 1); };
  const group = <K extends string>(label: string, items: readonly { key: K; name: string }[], value: K, set: (k: K) => void) =>
    <span className="proto-group"><span>{label}</span><select value={value} onChange={e => set(e.target.value as K)}>{items.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}</select></span>;

  return <div className="app proto pb-page pe-page">
    <div className="proto-bar" role="toolbar" aria-label="原型开关">
      <span className="proto-tag">PROTOTYPE · #218 绑定入口</span>
      {group('gh', dialogGhStates, gh, setGhState)}
      {group('origin', originStates, originState, v => { setOriginState(v); setRun(n => n + 1); })}
      {group('绑定时重新读取列表', listCheckStates, listCheck, setListCheck)}
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
    </div>
    <div className="pe-shell">
      <nav className="pe-nav"><b className="muted">项目</b>
        <div className="pe-nav-row"><span>{project.name}</span><span className="gh-spacer" /><button className="gh-btn" onClick={() => open('edit')}>⋯ 编辑项目</button></div></nav>
      <main className="pe-main muted">终端区域</main>
      <SidebarBinding key={`sb-${run}`} variant={variant} gh={gh} listCheck={listCheck} repo={REPO} origin={origin} project={project}
        onStore={store} call={call} openDialog={() => open('sidebar')} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
    </div>
    {entry && <BindingEntryDialog key={`dlg-${run}`} variant={variant} entry={entry} gh={gh} listCheck={listCheck} repo={REPO} origin={origin}
      stored={project} onStore={store} onClose={() => setEntry(undefined)} call={call} openSidebarMenu={() => setMenuOpen(true)} />}
    <aside className="pb-state">
      <b>PROTOTYPE 状态 · 变体 {variant}</b>
      <div>已存：{project.name} · 绑定 {project.bound ?? '无'}</div>
      <div>调用：</div><ol>{calls.length ? calls.map((c, i) => <li key={i}>{c}</li>) : <li className="muted">还没有</li>}</ol>
      <div className="muted">试：gh 切到「已绑定」看更换和解绑；origin 切到「不指向 GitHub」看 D 的退路。</div>
    </aside>
    <VariantSwitcher current={variant} set={setVariant} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<Page />);
