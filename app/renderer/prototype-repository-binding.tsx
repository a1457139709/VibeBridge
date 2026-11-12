// PROTOTYPE — throwaway, lives only on branch `prototype/repository-binding`. Never import or adapt into production (AGENTS.md「Prototype scope」).
// #181 question: how does the edit-project dialog change or remove a repository binding, and when is it written?
// Chosen design: the repository field is part of the form, like name and directory.
// - Bound: the field shows the repository with 「更换」 and 「解绑」. 更换 opens the list; 解绑 marks it for removal.
//   Either shows at once in the field as 「A → B」 or 「A → 不绑定」 with 「撤销」.
// - Unbound: the list is open and origin's repository is selected by default; saving binds it. 「不绑定」 clears the pick.
// - Nothing is written until the bottom button: 「保存更改」, or 「更改但不重启」/「更改并重启」 when the directory changed.
//   Those are the only buttons that save. A directory change and a change or removal of a binding are listed together,
//   with what each one does, in one 「保存后」 section above them; that section is the confirmation, so no second
//   confirm or save button appears. One call saves name, directory and repository together; it checks everything
//   (including the re-read list for a new repository) before writing, so it either saves all of them or none.
//   「取消」 drops all of them.
// - gh unavailable: unbinding, name and directory still save; choosing a repository shows the failure and 「重试」.
// The box at the bottom left shows what is stored, what is pending and every call the dialog made.
import { useEffect, useState, type ReactNode } from 'react';
import type { GhState } from './prototype-workbench-settings';

export const listCheckStates = [{ key: 'ok', name: '成功' }, { key: 'fail', name: '失败' }] as const;
export interface StoredProject { name: string; directory: string; bound?: string }

const RUNNING = 3;
type Pending = { kind: 'keep' } | { kind: 'bind'; repository: string } | { kind: 'unbind' };

interface Props {
  gh: GhState; listCheck: 'ok' | 'fail'; repo: string; stored: StoredProject;
  onStore(next: StoredProject): void; onClose(): void;
}

export function RepositoryBindingDialog({ gh, listCheck, repo, stored, onStore, onClose }: Props) {
  const owner = repo.split('/')[0];
  const choices = [repo, `${owner}/blog`, `${owner}/dotfiles`, `${owner}/notes`, 'acme-org/platform', 'acme-org/design-system'];
  const [calls, setCalls] = useState<string[]>([]);
  const call = (text: string) => setCalls(list => [...list, text]);

  // ---- name and directory: the directory is checked 400ms after typing (slower than the app, so 「检查中」 can be seen) ----
  const [name, setName] = useState(stored.name);
  const [path, setPath] = useState(stored.directory);
  const [checked, setChecked] = useState(stored.directory);
  useEffect(() => { const t = setTimeout(() => setChecked(path), 400); return () => clearTimeout(t); }, [path]);
  const checking = checked !== path;
  const nameError = !name.trim() ? '名称不能为空' : '';
  const dirError = checking ? '' : !/^\/.+/.test(path) ? '目录不存在' : '';
  const changedDirectory = !checking && !dirError && path !== stored.directory;
  // origin of the directory being edited: a path containing "blog" points at owner/blog, "scratch" has no origin.
  const originDir = checking || dirError ? stored.directory : path;
  const origin = /scratch/.test(originDir) ? undefined : /blog/.test(originDir) ? `${owner}/blog` : repo;

  // ---- repository field ----
  const bound = stored.bound;
  const [retried, setRetried] = useState(false);
  const failure = retried ? undefined : gh === 'no-gh' ? 'no-gh' : gh === 'logged-out' ? 'logged-out' : gh === 'stale' ? 'stale' : undefined;
  const [changing, setChanging] = useState(false); // bound: 「更换」 opened the list
  const [unbinding, setUnbinding] = useState(false); // bound: 「解绑」 pressed
  const [picked, setPicked] = useState<string | null>(); // undefined: follow origin (unbound) / the bound one (changing); null: 不绑定
  const [query, setQuery] = useState('');
  const listShown = bound ? changing : true;
  const selection = picked !== undefined ? picked : bound ?? (failure ? null : origin ?? null);

  // What the bottom button saves for the repository. A list that failed to load binds nothing.
  const pending: Pending = bound
    ? unbinding ? { kind: 'unbind' } : changing && !failure && selection && selection !== bound ? { kind: 'bind', repository: selection } : { kind: 'keep' }
    : !failure && selection ? { kind: 'bind', repository: selection } : { kind: 'keep' };
  const bindingChanges = !!bound && pending.kind !== 'keep'; // a change or removal; a first binding has no consequence to explain

  const canSave = !nameError && !dirError && !checking;
  const edited = name.trim() !== stored.name || path !== stored.directory || pending.kind !== 'keep';
  const [error, setError] = useState<ReactNode>();
  const [result, setResult] = useState<string[]>();

  const undo = () => { setChanging(false); setUnbinding(false); setPicked(undefined); setQuery(''); };

  function save(restart: boolean) {
    if (!canSave) return;
    setError(undefined);
    const repository = pending.kind === 'keep' ? 'keep' : pending.kind === 'unbind' ? 'null' : pending.repository;
    // Checks first, then one transaction: a failed check writes nothing.
    if (pending.kind === 'bind' && listCheck === 'fail') {
      call(`editProject(name: ${name.trim()}, directory: ${path}, repository: ${repository}, restart: ${restart}) → 重新读取列表失败，什么都没写`);
      setError(<>无法读取仓库列表：HTTP 502（GitHub 暂时不可用）。名称、目录和仓库都没有保存，可以再试一次，或撤销仓库修改后只保存名称和目录。</>);
      return;
    }
    call(`editProject(name: ${name.trim()}, directory: ${path}, repository: ${repository}, restart: ${restart})`);
    onStore({ name: name.trim(), directory: path, bound: pending.kind === 'keep' ? bound : pending.kind === 'unbind' ? undefined : pending.repository });
    if (changedDirectory && restart) {
      const lines = [`已保存：${name.trim()} · ${path}`];
      if (pending.kind === 'bind') lines.push(`已绑定 ${pending.repository}`);
      if (pending.kind === 'unbind') lines.push(`已解绑 ${bound}`);
      lines.push(`已在新目录重启 ${RUNNING} 个面板`);
      setResult(lines);
    } else onClose();
  }

  const failureBlock = failure && <div className="wb-gh-error">
    {failure === 'no-gh' ? <span>没有找到 <code>gh</code>，安装后才能绑定。<a href="https://cli.github.com" target="_blank" rel="noreferrer">安装说明 ↗</a></span>
      : failure === 'logged-out' ? <span>gh 未登录。在终端运行 <code>gh auth login</code> 后重试。</span>
      : <span>无法读取仓库列表：HTTP 502（GitHub 暂时不可用）</span>}
    <button className="gh-btn" onClick={() => { call('repositoryChoices() → 重试成功'); setRetried(true); }}>重试</button></div>;
  const list = <div className="wb-picker">
    <input placeholder="搜索仓库" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="wb-picker-list">
      {choices.filter(c => c.toLowerCase().includes(query.trim().toLowerCase())).map(c =>
        <button key={c} className={selection === c ? 'on' : ''} onClick={() => setPicked(c)}>
          <span className="gh-ellipsis">{c}</span>{c === origin && <small>origin</small>}{c === bound && <small>当前</small>}</button>)}</div>
    <span className="muted">列表来自 gh 当前账号自己的、作为协作者的、所在组织的仓库。</span></div>;

  let summary: ReactNode;
  if (bound) {
    const to = pending.kind === 'unbind' ? '不绑定' : pending.kind === 'bind' ? pending.repository : undefined;
    summary = <div className={`pb-current ${to ? 'pb-changed' : ''}`}>
      <span className="gh-ellipsis"><b>{bound}</b>{to ? <> → <b>{to}</b></> : <small> 当前</small>}</span>
      <span className="gh-spacer" />
      {changing || unbinding ? <button className="gh-btn" onClick={undo}>撤销</button>
        : <><button className="gh-btn" onClick={() => setChanging(true)}>更换</button><button className="gh-btn danger" onClick={() => setUnbinding(true)}>解绑</button></>}
    </div>;
  } else {
    summary = <div className={`pb-current ${selection && !failure ? 'pb-changed' : ''}`}>
      <span className="gh-ellipsis">{selection && !failure ? <>保存后绑定 <b>{selection}</b></> : '未绑定'}</span>
      <span className="gh-spacer" />
      {selection && !failure && <button className="gh-btn" onClick={() => setPicked(null)}>不绑定</button>}
    </div>;
  }

  const pendingText = pending.kind === 'keep' ? '不变' : pending.kind === 'unbind' ? '解绑' : `绑定 ${pending.repository}`;

  return <div className="wb-modal-back" onMouseDown={onClose}>
    <div className="wb-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="编辑项目">
      <h3>{result ? '编辑项目的结果' : '编辑项目'}</h3>
      {result ? <>
        <ul className="pb-result">{result.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <footer><span className="gh-spacer" /><button className="gh-btn primary" onClick={onClose}>关闭</button></footer>
      </> : <>
        <label className="wb-field"><span>名称</span><input value={name} onChange={e => setName(e.target.value)} />{nameError && <small className="error-text">{nameError}</small>}</label>
        <label className="wb-field"><span>目录</span><input value={path} onChange={e => setPath(e.target.value)} />
          {checking ? <small className="muted">正在检查目录…</small> : dirError && <small className="error-text">{dirError}</small>}</label>
        <div className="wb-field"><span>GitHub 仓库</span>{summary}{listShown && !unbinding && (failureBlock || list)}</div>
        {(changedDirectory || bindingChanges) && <section className="pb-impact" aria-label="保存后">
          <b>保存后</b>
          <dl>
            {changedDirectory && <><dt>目录</dt><dd><span className="gh-ellipsis">{stored.directory} → {path}</span>
              <p>{RUNNING} 个面板正在运行。「更改并重启」在新目录重启它们；「更改但不重启」让它们留在原目录，下次启动用新目录。</p></dd></>}
            {bindingChanges && <><dt>仓库</dt><dd><span className="gh-ellipsis">{bound} → {pending.kind === 'bind' ? pending.repository : '不绑定'}</span>
              <p>{pending.kind === 'bind' ? '旧仓库的派发记录隐藏但保留，换回来后重新显示。' : '派发记录保留；侧边栏显示未绑定。'}</p></dd></>}
          </dl></section>}
        {error && <p className="error-text pb-error">{error}</p>}
        <footer><span className="gh-spacer" />
          <button className="gh-btn" onClick={onClose}>{changedDirectory ? '取消更改' : '取消'}</button>
          {changedDirectory
            ? <><button className="gh-btn" disabled={!canSave} onClick={() => save(false)}>更改但不重启</button><button className="gh-btn primary" disabled={!canSave} onClick={() => save(true)}>更改并重启</button></>
            : <button className="gh-btn primary" disabled={!canSave || !edited} onClick={() => save(false)}>保存更改</button>}</footer>
      </>}
    </div>
    <aside className="pb-state" onMouseDown={e => e.stopPropagation()}>
      <b>PROTOTYPE 状态</b>
      <div>已存：{stored.name} · {stored.directory} · 绑定 {stored.bound ?? '无'}</div>
      <div>待保存：{name.trim()} · {path} · 仓库 {pendingText}</div>
      <div>调用：</div><ol>{calls.length ? calls.map((c, i) => <li key={i}>{c}</li>) : <li className="muted">还没有</li>}</ol>
      <div className="muted">试：目录里输入含 blog 的路径，origin 指向另一个仓库；含 scratch 的路径没有 origin。</div>
    </aside>
  </div>;
}
