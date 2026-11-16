// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding-entry`. Never import or adapt into production (AGENTS.md「Prototypes」).
// #218 question: what does the sidebar's 「绑定仓库」 open, and how does an unbound project's repository field say
// "saving will bind X" without reading as "already bound"? (QA #1, #2)
// Four variants, switched with ?variant=A|B|C|D (bottom bar, or ←/→):
// - A 现状: main today. Sidebar opens a dialog with the repository field alone; unbound reads 「保存后绑定 X」 + 「不绑定」.
// - B 箭头: unbound uses the bound grammar: 「未绑定 → X」 + 「撤销」; after 撤销 it reads 「未绑定」 until a pick.
// - C 单选: the field asks a choice: ○ 不绑定 / ● 绑定到：[list]. The sidebar reuses Edit project with name and directory
//   folded into one read-only line (「编辑名称和目录」 unfolds them).
// - D 按钮说话: the field states only the present (「未绑定」) and highlights the pick in the list; the primary button names
//   the act (「绑定 X」). Edit project lists the first binding in 「保存后」 too; 「清除选择」 under the list keeps it unbound.
// Bound projects keep #181's grammar in every variant: 「更换」/「解绑」, 「A → B」 + 「撤销」, 「保存后」 consequences.
import { useEffect, useState, type ReactNode } from 'react';
import type { GhState } from './prototype-workbench-settings';
import type { StoredProject } from './prototype-repository-binding';

export const variants = [
  { key: 'A', name: '现状：保存后绑定 X + 不绑定' },
  { key: 'B', name: '箭头：未绑定 → X + 撤销' },
  { key: 'C', name: '单选：不绑定 / 绑定到' },
  { key: 'D', name: '按钮说话：主按钮「绑定 X」' },
] as const;
export type Variant = typeof variants[number]['key'];
export type Entry = 'sidebar' | 'edit';

interface Props {
  variant: Variant; entry: Entry; gh: GhState; listCheck: 'ok' | 'fail'; repo: string; stored: StoredProject;
  onStore(next: StoredProject): void; onClose(): void;
}

export function BindingEntryDialog({ variant, entry, gh, listCheck, repo, stored, onStore, onClose }: Props) {
  const owner = repo.split('/')[0];
  const choices = [repo, `${owner}/blog`, `${owner}/dotfiles`, `${owner}/notes`, 'acme-org/platform', 'acme-org/design-system'];
  const origin = repo;
  const [calls, setCalls] = useState<string[]>([]);
  const call = (text: string) => setCalls(list => [...list, text]);

  const [name, setName] = useState(stored.name);
  const [path, setPath] = useState(stored.directory);
  const [unfolded, setUnfolded] = useState(false); // C, sidebar entry: name and directory unfolded
  const nameError = !name.trim() ? '名称不能为空' : '';

  const bound = stored.bound;
  const [retried, setRetried] = useState(false);
  const failure = retried ? undefined : gh === 'no-gh' ? 'no-gh' : gh === 'logged-out' ? 'logged-out' : gh === 'stale' ? 'stale' : undefined;
  const [changing, setChanging] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  // undefined: follow the default (origin when unbound); null: 不绑定 / 撤销 / 清除选择.
  const [picked, setPicked] = useState<string | null>();
  const [lastPick, setLastPick] = useState<string>(); // C: the 绑定 radio returns to the last pick
  const [query, setQuery] = useState('');
  const selection = picked !== undefined ? picked : bound ?? (failure ? null : origin);
  const pick = (c: string) => { setPicked(c); setLastPick(c); };

  const target: string | null | undefined = bound // what saving does to the binding: undefined keeps it
    ? unbinding ? null : changing && !failure && selection && selection !== bound ? selection : undefined
    : !failure && selection ? selection : undefined;
  const edited = name.trim() !== stored.name || path !== stored.directory || target !== undefined;
  const [error, setError] = useState<ReactNode>();
  const undo = () => { setChanging(false); setUnbinding(false); setPicked(undefined); setQuery(''); };

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

  const failureBlock = failure && <div className="wb-gh-error">
    {failure === 'no-gh' ? <span>没有找到 <code>gh</code>，安装后才能绑定。</span>
      : failure === 'logged-out' ? <span>gh 未登录。在终端运行 <code>gh auth login</code> 后重试。</span>
      : <span>无法读取仓库列表：HTTP 502（GitHub 暂时不可用）</span>}
    <button className="gh-btn" onClick={() => { call('repositoryChoices() → 重试成功'); setRetried(true); }}>重试</button></div>;
  const list = (footer?: ReactNode, disabled = false) => <div className={`wb-picker ${disabled ? 'pe-disabled' : ''}`}>
    <input placeholder="搜索仓库" value={query} disabled={disabled} onChange={e => setQuery(e.target.value)} />
    <div className="wb-picker-list">
      {choices.filter(c => c.toLowerCase().includes(query.trim().toLowerCase())).map(c =>
        <button key={c} disabled={disabled} className={selection === c && !disabled ? 'on' : ''} onClick={() => pick(c)}>
          <span className="gh-ellipsis">{c}</span>{c === origin && <small>origin</small>}{c === bound && <small>当前</small>}</button>)}</div>
    <span className="muted pe-list-foot">列表来自 gh 当前账号自己的、作为协作者的、所在组织的仓库。{footer}</span></div>;

  // ---- the repository field ----
  let field: ReactNode;
  if (bound) {
    const to = target === null ? '不绑定' : target;
    field = <>
      <div className={`pb-current ${to ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis"><b>{bound}</b>{to ? <> → <b>{to}</b></> : <small> 当前</small>}</span><span className="gh-spacer" />
        {changing || unbinding ? <button className="gh-btn" onClick={undo}>撤销</button>
          : <><button className="gh-btn" onClick={() => setChanging(true)}>更换</button><button className="gh-btn danger" onClick={() => setUnbinding(true)}>解绑</button></>}
      </div>
      {changing && !unbinding && (failureBlock || list())}
    </>;
  } else if (variant === 'A') {
    field = <>
      <div className={`pb-current ${target ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis">{target ? <>保存后绑定 <b>{target}</b></> : '未绑定'}</span><span className="gh-spacer" />
        {target && <button className="gh-btn" onClick={() => setPicked(null)}>不绑定</button>}
      </div>
      {failureBlock || list()}
    </>;
  } else if (variant === 'B') {
    field = <>
      <div className={`pb-current ${target ? 'pb-changed' : ''}`}>
        <span className="gh-ellipsis"><b>未绑定</b>{target ? <> → <b>{target}</b></> : <small> 当前</small>}</span><span className="gh-spacer" />
        {target && <button className="gh-btn" onClick={() => setPicked(null)}>撤销</button>}
      </div>
      {failureBlock || list()}
    </>;
  } else if (variant === 'C') {
    const binding = picked !== null && !failure;
    field = <>
      <div className="pe-now">当前：<b>未绑定</b></div>
      <label className="pe-radio"><input type="radio" checked={!binding} onChange={() => setPicked(null)} /> 不绑定<span className="muted">（侧边栏只显示空状态）</span></label>
      <label className="pe-radio"><input type="radio" checked={binding} disabled={!!failure} onChange={() => setPicked(lastPick ?? origin)} /> 绑定到{binding && target ? <b>：{target}</b> : '…'}</label>
      <div className="pe-indent">{failureBlock || list(undefined, !binding)}</div>
    </>;
  } else {
    field = <>
      <div className="pe-now">当前：<b>未绑定</b>{target && <span className="muted">　· 列表中选中的仓库在保存时绑定</span>}</div>
      {failureBlock || list(target && <> <button className="pe-link" onClick={() => setPicked(null)}>清除选择</button></>)}
    </>;
  }

  // ---- 保存后 ----
  const showsFirstBinding = variant === 'D' && entry === 'edit' && !bound && !!target;
  const impact = (bound && target !== undefined) || showsFirstBinding;
  const impactBlock = impact && <section className="pb-impact" aria-label="保存后"><b>保存后</b><dl>
    <dt>仓库</dt><dd><span className="gh-ellipsis">{bound ?? '未绑定'} → {target ?? '不绑定'}</span>
      <p>{!bound ? '侧边栏显示这个仓库的 issue 和 pull request。' : target ? '旧仓库的派发记录隐藏但保留，换回来后重新显示。' : '派发记录保留；侧边栏显示未绑定。'}</p></dd></dl></section>;

  // ---- the dialog shell: what each entry opens ----
  const sidebarAlone = entry === 'sidebar' && variant !== 'C';
  const title = sidebarAlone ? (bound ? '修改绑定' : '绑定仓库') : '编辑项目';
  const primary = variant === 'D' && entry === 'sidebar'
    ? (bound ? (target === null ? '解绑' : target ? `改绑到 ${target}` : '保存更改') : target ? `绑定 ${target}` : '绑定')
    : '保存更改';
  const nameDir = <>
    <label className="wb-field"><span>名称</span><input value={name} onChange={e => setName(e.target.value)} />{nameError && <small className="error-text">{nameError}</small>}</label>
    <label className="wb-field"><span>目录</span><input value={path} onChange={e => setPath(e.target.value)} /></label></>;
  const folded = <div className="pe-folded"><span className="gh-ellipsis"><b>{name}</b> · {path}</span><span className="gh-spacer" />
    <button className="pe-link" onClick={() => setUnfolded(true)}>编辑名称和目录</button></div>;

  return <div className="wb-modal-back" onMouseDown={onClose}>
    <div className="wb-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {sidebarAlone ? null : entry === 'sidebar' && !unfolded ? folded : nameDir}
      <div className="wb-field"><span>GitHub 仓库</span>{field}</div>
      {impactBlock}
      {error && <p className="error-text pb-error">{error}</p>}
      <footer><span className="gh-spacer" />
        <button className="gh-btn" onClick={onClose}>取消</button>
        <button className="gh-btn primary" disabled={!!nameError || !edited} onClick={save}>{primary}</button></footer>
    </div>
    <aside className="pb-state" onMouseDown={e => e.stopPropagation()}>
      <b>PROTOTYPE 状态 · 变体 {variant} · 入口 {entry === 'sidebar' ? '侧边栏' : '编辑项目'}</b>
      <div>已存：{stored.name} · 绑定 {stored.bound ?? '无'}</div>
      <div>保存后仓库：{target === undefined ? '不变' : target === null ? '解绑' : `绑定 ${target}`}</div>
      <div>调用：</div><ol>{calls.length ? calls.map((c, i) => <li key={i}>{c}</li>) : <li className="muted">还没有</li>}</ol>
    </aside>
  </div>;
}

/** Floating variant switcher: ←/→ buttons and keys, writes ?variant= with replaceState. */
export function VariantSwitcher({ current, set }: { current: Variant; set(v: Variant): void }) {
  const index = variants.findIndex(v => v.key === current);
  const go = (step: number) => set(variants[(index + step + variants.length) % variants.length].key);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return <div className="pe-switcher"><button onClick={() => go(-1)}>←</button>
    <span>{current} · {variants[index].name}</span><button onClick={() => go(1)}>→</button></div>;
}
