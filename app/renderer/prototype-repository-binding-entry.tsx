// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding-entry`. Never import or adapt into production (AGENTS.md「Prototypes」).
// #218 question: how does a project get bound from the Forge sidebar, and how does an unbound repository field avoid
// reading as "already bound"? (QA #1, #2). Five variants on ?variant= (bottom bar, or ←/→):
// - A 现状: main today. Sidebar 「绑定仓库」 opens a dialog of the repository field alone; unbound reads 「保存后绑定 X」 + 「不绑定」.
// - B 对话框·箭头: same dialog; unbound uses the bound grammar 「未绑定 → X」 + 「撤销」, so the pending state reads as a change.
// - C 侧边栏内联: no dialog. The sidebar's empty state is the picker; the button names the act (「绑定 X」) and binds at once.
//   「修改绑定」 turns the sidebar into the picker with 「← 返回」; a rebind or unbind states its consequence above the button.
// - D origin 一键: the empty state leads with origin's repository: 「绑定 X」, or 「选择其他仓库…」 unfolds the list.
//   Without an origin on GitHub, the list shows directly.
// - E 标题菜单: the sidebar header's repository name is a menu (like a branch switcher): pick to bind, ✓ marks the current,
//   「解绑」 at the bottom; a rebind or unbind asks inside the menu. Binding lives only here: Edit project shows it read-only.
// In C, D and E no dialog holds a pending binding, so nothing needs 「撤销」/「不绑定」 beside the dialog's 「取消」
// (user feedback): Edit project shows the binding read-only and links to the sidebar, where the button binds at once.
// A and B keep #181's dialog grammar: 「更换」/「解绑」, 「A → B」 + 「撤销」.
import { useEffect, useState, type ReactNode } from 'react';
import type { GhState } from './prototype-workbench-settings';
import type { StoredProject } from './prototype-repository-binding';

export const variants = [
  { key: 'A', name: '现状：对话框，保存后绑定 X + 不绑定' },
  { key: 'B', name: '对话框，未绑定 → X + 撤销' },
  { key: 'C', name: '侧边栏内联选择，按钮即绑定' },
  { key: 'D', name: 'origin 一键绑定，其他再展开' },
  { key: 'E', name: '标题仓库菜单，绑定只在这里' },
] as const;
export type Variant = typeof variants[number]['key'];
export type Entry = 'sidebar' | 'edit';
export const dialogVariants: Variant[] = ['A', 'B'];

export function repositoryChoices(repo: string) {
  const owner = repo.split('/')[0];
  return [repo, `${owner}/blog`, `${owner}/dotfiles`, `${owner}/notes`, 'acme-org/platform', 'acme-org/design-system'];
}

export function failureOf(gh: GhState, retried: boolean) {
  return retried ? undefined : gh === 'no-gh' ? 'no-gh' : gh === 'logged-out' ? 'logged-out' : gh === 'stale' ? 'stale' : undefined;
}
export function FailureBlock({ failure, retry }: { failure: string; retry(): void }) {
  return <div className="wb-gh-error">
    {failure === 'no-gh' ? <span>没有找到 <code>gh</code>，安装后才能绑定。</span>
      : failure === 'logged-out' ? <span>gh 未登录。在终端运行 <code>gh auth login</code> 后重试。</span>
      : <span>无法读取仓库列表：HTTP 502（GitHub 暂时不可用）</span>}
    <button className="gh-btn" onClick={retry}>重试</button></div>;
}

/** The searchable list; `mark` shows ✓ on the bound one instead of a 「当前」 tag. */
export function RepoList({ choices, origin, bound, selection, pick, disabled, foot, mark, autoFocus }: {
  choices: string[]; origin?: string; bound?: string; selection?: string | null; pick(c: string): void;
  disabled?: boolean; foot?: ReactNode; mark?: boolean; autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  // origin's repository first, the bound one right after it.
  const ordered = [...choices].sort((a, b) => Number(b === origin) - Number(a === origin) || Number(b === bound) - Number(a === bound));
  return <div className={`wb-picker ${disabled ? 'pe-disabled' : ''}`}>
    <input placeholder="搜索仓库" value={query} disabled={disabled} autoFocus={autoFocus} onChange={e => setQuery(e.target.value)} />
    <div className="wb-picker-list">
      {ordered.filter(c => c.toLowerCase().includes(query.trim().toLowerCase())).map(c =>
        <button key={c} disabled={disabled} className={selection === c && !disabled ? 'on' : ''} onClick={() => pick(c)}>
          {mark && <span className="pe-check">{c === bound ? '✓' : ''}</span>}
          <span className="gh-ellipsis">{c}</span>{c === origin && <small>origin</small>}{!mark && c === bound && <small>当前</small>}</button>)}</div>
    <span className="muted pe-list-foot">列表来自 gh 当前账号自己的、作为协作者的、所在组织的仓库。{foot}</span></div>;
}

interface Props {
  variant: Variant; entry: Entry; gh: GhState; listCheck: 'ok' | 'fail'; repo: string; origin?: string; stored: StoredProject;
  onStore(next: StoredProject): void; onClose(): void; call(text: string): void; openSidebarMenu(): void;
}

/** Edit project in every variant, and the sidebar's dialog in A and B. */
export function BindingEntryDialog({ variant, entry, gh, listCheck, repo, origin, stored, onStore, onClose, call, openSidebarMenu }: Props) {
  const choices = repositoryChoices(repo);
  // C, D, E bind only in the sidebar, where the button is the act; Edit project shows the binding and links there.
  const readOnly = variant === 'C' || variant === 'D' || variant === 'E';
  const [name, setName] = useState(stored.name);
  const [path, setPath] = useState(stored.directory);
  const nameError = !name.trim() ? '名称不能为空' : '';

  const bound = stored.bound;
  const [retried, setRetried] = useState(false);
  const failure = failureOf(gh, retried);
  const [changing, setChanging] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  // undefined: follow the default (origin when unbound); null: nothing picked.
  const [picked, setPicked] = useState<string | null | undefined>();
  const selection = picked !== undefined ? picked : bound ?? (failure ? null : origin ?? null);

  const target: string | null | undefined = readOnly ? undefined : bound // what saving does to the binding: undefined keeps it
    ? unbinding ? null : changing && !failure && selection && selection !== bound ? selection : undefined
    : !failure && selection ? selection : undefined;
  const edited = name.trim() !== stored.name || path !== stored.directory || target !== undefined;
  const [error, setError] = useState<ReactNode>();
  const undo = () => { setChanging(false); setUnbinding(false); setPicked(undefined); };

  function save() {
    if (nameError || !edited) return;
    const repository = target === undefined ? 'keep' : target === null ? 'null' : target;
    if (typeof target === 'string' && listCheck === 'fail') {
      call(`editProject(repository: ${repository}) → 重新读取列表失败，什么都没写`);
      setError('无法读取仓库列表：HTTP 502（GitHub 暂时不可用）。什么都没有保存，可以再试一次。');
      return;
    }
    call(`editProject(name: ${name.trim()}, directory: ${path}, repository: ${repository}, restart: false)`);
    onStore({ name: name.trim(), directory: path, bound: target === undefined ? bound : target ?? undefined });
    onClose();
  }

  const failureBlock = failure && <FailureBlock failure={failure} retry={() => { call('repositoryChoices() → 重试成功'); setRetried(true); }} />;
  const list = (foot?: ReactNode) => failureBlock || <RepoList choices={choices} origin={origin} bound={bound} selection={selection} pick={setPicked} foot={foot} />;

  let field: ReactNode;
  if (readOnly) {
    field = <div className="pb-current">
      <span className="gh-ellipsis">{bound ? <b>{bound}</b> : '未绑定'}</span><span className="gh-spacer" />
      <button className="pe-link" onClick={() => { onClose(); openSidebarMenu(); }}>{bound ? '在 Forge 侧边栏更换或解绑' : '在 Forge 侧边栏绑定'}</button></div>;
  } else if (bound) {
    const to = target === null ? '不绑定' : target;
    field = <>
      <div className={`pb-current ${to ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis"><b>{bound}</b>{to ? <> → <b>{to}</b></> : <small> 当前</small>}</span><span className="gh-spacer" />
        {changing || unbinding ? <button className="gh-btn" onClick={undo}>撤销</button>
          : <><button className="gh-btn" onClick={() => setChanging(true)}>更换</button><button className="gh-btn danger" onClick={() => setUnbinding(true)}>解绑</button></>}
      </div>
      {changing && !unbinding && list()}
    </>;
  } else if (variant === 'A') {
    field = <>
      <div className={`pb-current ${target ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis">{target ? <>保存后绑定 <b>{target}</b></> : '未绑定'}</span><span className="gh-spacer" />
        {target && <button className="gh-btn" onClick={() => setPicked(null)}>不绑定</button>}
      </div>
      {list()}
    </>;
  } else if (variant === 'B') {
    field = <>
      <div className={`pb-current ${target ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis"><b>未绑定</b>{target ? <> → <b>{target}</b></> : <small> 当前</small>}</span><span className="gh-spacer" />
        {target && <button className="gh-btn" onClick={() => setPicked(null)}>撤销</button>}
      </div>
      {list()}
    </>;
  }

  const impact = !readOnly && bound && target !== undefined;
  const impactBlock = impact && <section className="pb-impact" aria-label="保存后"><b>保存后</b><dl>
    <dt>仓库</dt><dd><span className="gh-ellipsis">{bound} → {target ?? '不绑定'}</span>
      <p>{target ? '旧仓库的派发记录隐藏但保留，换回来后重新显示。' : '派发记录保留；侧边栏显示未绑定。'}</p></dd></dl></section>;

  const sidebarAlone = entry === 'sidebar';
  const title = sidebarAlone ? (bound ? '修改绑定' : '绑定仓库') : '编辑项目';
  return <div className="wb-modal-back" onMouseDown={onClose}>
    <div className="wb-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {!sidebarAlone && <>
        <label className="wb-field"><span>名称</span><input value={name} onChange={e => setName(e.target.value)} />{nameError && <small className="error-text">{nameError}</small>}</label>
        <label className="wb-field"><span>目录</span><input value={path} onChange={e => setPath(e.target.value)} /></label></>}
      <div className="wb-field"><span>GitHub 仓库</span>{field}</div>
      {impactBlock}
      {error && <p className="error-text pb-error">{error}</p>}
      <footer><span className="gh-spacer" />
        <button className="gh-btn" onClick={onClose}>取消</button>
        <button className="gh-btn primary" disabled={!!nameError || !edited} onClick={save}>保存更改</button></footer>
    </div>
  </div>;
}

/** Floating variant switcher: ←/→ buttons and keys, writes ?variant= with replaceState. */
export function VariantSwitcher({ current, set }: { current: Variant; set(v: Variant): void }) {
  const index = variants.findIndex(v => v.key === current);
  const go = (step: number) => set(variants[(index + step + variants.length) % variants.length].key);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return <div className="pe-switcher"><button onClick={() => go(-1)}>←</button>
    <span>{current} · {variants[index].name}</span><button onClick={() => go(1)}>→</button></div>;
}
