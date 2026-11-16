// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding-entry`. Never import or adapt into production (AGENTS.md「Prototypes」).
// #218: the Forge sidebar's header and body per variant (see prototype-repository-binding-entry.tsx for the variants).
// In C, D and E the button names the act and binds at once: there is no "saved later" state to misread.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GhState } from './prototype-workbench-settings';
import type { StoredProject } from './prototype-repository-binding';
import { FailureBlock, RepoList, failureOf, repositoryChoices, type Variant } from './prototype-repository-binding-entry';

interface Props {
  variant: Variant; gh: GhState; listCheck: 'ok' | 'fail'; repo: string; origin?: string; project: StoredProject;
  onStore(next: StoredProject): void; call(text: string): void; openDialog(): void;
  menuOpen: boolean; setMenuOpen(open: boolean): void;
}

const consequence = (to: string | null) => to ? '旧仓库的派发记录隐藏但保留，换回来后重新显示。' : '派发记录保留；侧边栏显示未绑定。';

export function SidebarBinding({ variant, gh, listCheck, repo, origin, project, onStore, call, openDialog, menuOpen, setMenuOpen }: Props) {
  const choices = repositoryChoices(repo);
  const bound = project.bound;
  const [retried, setRetried] = useState(false);
  const failure = failureOf(gh, retried);
  const [picking, setPicking] = useState(false); // C/D bound: 「修改绑定」 turned the body into the picker
  const [others, setOthers] = useState(false); // D unbound: 「选择其他仓库…」
  const [picked, setPicked] = useState<string>();
  const [confirm, setConfirm] = useState<{ to: string | null }>(); // a rebind or unbind waiting for its button
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { setPicking(false); setOthers(false); setPicked(undefined); setConfirm(undefined); setError(undefined); }, [variant, bound]);

  function bind(to: string | null) {
    setBusy(true); setError(undefined);
    setTimeout(() => { // slower than the app, so 「正在绑定…」 can be seen
      setBusy(false);
      if (to && listCheck === 'fail') {
        call(`editProject(repository: ${to}) → 重新读取列表失败，什么都没写`);
        setError('没有绑定：无法读取仓库列表（HTTP 502）。可以再试一次。');
        return;
      }
      call(`editProject(name: ${project.name}, directory: ${project.directory}, repository: ${to ?? 'null'}, restart: false)`);
      onStore({ ...project, bound: to ?? undefined });
      setMenuOpen(false);
    }, 500);
  }

  const failureBlock = failure && <FailureBlock failure={failure} retry={() => { call('repositoryChoices() → 重试成功'); setRetried(true); }} />;
  const errorLine = error && <p className="error-text pb-error">{error}</p>;

  // ---- A, B: the dialog entry ----
  if (variant === 'A' || variant === 'B') return <aside className="pe-sidebar">
    <header className="gh-head"><span className="gh-repo">{bound ?? '未绑定仓库'}</span><span className="gh-spacer" />
      {bound && <button className="gh-btn" onClick={openDialog}>修改绑定</button>}</header>
    {bound ? <p className="muted pe-empty">（issue 列表）</p>
      : <div className="pe-empty"><p>这个项目还没有绑定 GitHub 仓库。</p><button className="gh-btn primary" onClick={openDialog}>绑定仓库</button></div>}
  </aside>;

  // ---- E: the header's repository menu ----
  if (variant === 'E') return <aside className="pe-sidebar">
    <header className="gh-head pe-head-menu">
      <button className={`pe-repo-button ${bound ? '' : 'muted'}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setConfirm(undefined); setMenuOpen(!menuOpen); }}>
        <span className="gh-ellipsis">{bound ?? '未绑定仓库'}</span> ▾</button>
      {menuOpen && <RepoMenu close={() => setMenuOpen(false)}>
        {confirm ? <div className="pe-confirm">
          <b>{confirm.to ? `改绑到 ${confirm.to}？` : `解绑 ${bound}？`}</b>
          <p className="muted">{consequence(confirm.to)}</p>
          {errorLine}
          <div className="pe-row"><span className="gh-spacer" /><button className="gh-btn" onClick={() => setConfirm(undefined)}>取消</button>
            <button className={`gh-btn ${confirm.to ? 'primary' : 'danger'}`} disabled={busy} onClick={() => bind(confirm.to)}>{busy ? '正在处理…' : confirm.to ? '改绑' : '解绑'}</button></div>
        </div> : <>
          {failureBlock || <RepoList choices={choices} origin={origin} bound={bound} mark autoFocus
            pick={c => { if (c === bound) return; if (bound) setConfirm({ to: c }); else bind(c); }} />}
          {busy && <p className="muted pe-pad">正在绑定…</p>}{errorLine}
          {bound && <div className="pe-menu-foot"><button className="pe-link danger-text" onClick={() => setConfirm({ to: null })}>解绑 {bound}</button></div>}
        </>}
      </RepoMenu>}
    </header>
    {bound ? <p className="muted pe-empty">（issue 列表）</p>
      : <div className="pe-empty"><p>这个项目还没有绑定 GitHub 仓库。</p><button className="gh-btn primary" onClick={() => setMenuOpen(true)}>选择仓库</button>
        <p className="muted pe-hint">也可以随时从顶部的仓库菜单更换或解绑。</p></div>}
  </aside>;

  // ---- C, D: in the sidebar body ----
  const selection = picked ?? (bound ? undefined : failure ? undefined : origin);
  const pickerBody = (actions: ReactNode, autoFocus = false) => <>
    {failureBlock || <RepoList choices={choices} origin={origin} bound={bound} selection={selection} pick={c => { setPicked(c); setConfirm(undefined); }} autoFocus={autoFocus} />}
    {errorLine}{actions}</>;
  const bindButton = <div className="pe-row"><span className="gh-spacer" />
    <button className="gh-btn primary" disabled={!selection || busy || !!failure} onClick={() => bind(selection!)}>
      {busy ? '正在绑定…' : selection ? <>绑定 <b>{selection}</b></> : '绑定'}</button></div>;

  let body: ReactNode;
  if (bound && picking) {
    const to = confirm ? confirm.to : selection && selection !== bound ? selection : undefined;
    body = <div className="pe-pane">
      <button className="pe-link" onClick={() => { setPicking(false); setPicked(undefined); setConfirm(undefined); }}>← 返回</button>
      <div className="pe-now">当前绑定：<b>{bound}</b></div>
      {pickerBody(<>
        {to !== undefined && <p className="pe-consequence">{to ? `改绑到 ${to}：` : '解绑：'}{consequence(to)}</p>}
        <div className="pe-row">
          {!confirm && <button className="pe-link danger-text" onClick={() => { setPicked(undefined); setConfirm({ to: null }); }}>解绑</button>}
          <span className="gh-spacer" />
          {confirm ? <><button className="gh-btn" onClick={() => setConfirm(undefined)}>取消</button>
            <button className="gh-btn danger" disabled={busy} onClick={() => bind(null)}>{busy ? '正在处理…' : '解绑'}</button></>
            : <button className="gh-btn primary" disabled={!to || busy} onClick={() => bind(to!)}>{busy ? '正在处理…' : to ? `改绑到 ${to}` : '改绑'}</button>}
        </div></>, true)}
    </div>;
  } else if (bound) {
    body = <p className="muted pe-empty">（issue 列表）</p>;
  } else if (variant === 'D' && origin && !others && !failure) {
    body = <div className="pe-pane pe-card">
      <p>这个项目还没有绑定 GitHub 仓库。</p>
      <div className="pe-origin"><span className="muted">项目目录的 origin 指向</span><b className="gh-ellipsis">{origin}</b></div>
      {errorLine}
      <button className="gh-btn primary" disabled={busy} onClick={() => bind(origin)}>{busy ? '正在绑定…' : `绑定 ${origin}`}</button>
      <button className="pe-link" onClick={() => setOthers(true)}>选择其他仓库…</button>
    </div>;
  } else {
    body = <div className="pe-pane">
      <b>绑定一个 GitHub 仓库</b>
      <p className="muted pe-hint">{variant === 'D' && !origin ? '项目目录的 origin 不指向 GitHub 仓库，请从列表中选择。' : '绑定后这里显示它的 issue 和 pull request；以后可以从顶部「修改绑定」更换或解绑。'}</p>
      {variant === 'D' && others && <button className="pe-link" onClick={() => { setOthers(false); setPicked(undefined); }}>← 返回</button>}
      {pickerBody(bindButton, variant === 'D')}
    </div>;
  }

  return <aside className="pe-sidebar">
    <header className="gh-head"><span className="gh-repo">{bound ?? '未绑定仓库'}</span><span className="gh-spacer" />
      {bound && !picking && <button className="gh-btn" onClick={() => setPicking(true)}>修改绑定</button>}</header>
    {body}
  </aside>;
}

/** A popover under the header; Escape or a click outside closes it. */
function RepoMenu({ close, children }: { close(): void; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!element.current?.parentElement?.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, [close]);
  return <div className="pe-menu" ref={element} role="menu">{children}</div>;
}
