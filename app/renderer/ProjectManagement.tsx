import { useEffect, useRef, useState, type ReactNode } from 'react';
import { agentNames, type DirectoryResult, type Project, type ProjectEditResult, type Run } from '../shared/model';
import { projectNameError, projectNameHasControls } from '../shared/project-name';
import './project-management.css';

export function ProjectNavigationItem({ project, runs, openProject, children }: {
  project: Project; runs: Run[]; openProject(id: string): void; children: ReactNode;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [action, setAction] = useState<'edit' | 'delete'>();
  const menuElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menuElement.current?.contains(event.target as Node)) setMenu(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); } };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, [menu]);
  const showMenu = (x: number, y: number) => setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 168)), y: Math.max(8, Math.min(y, window.innerHeight - 92)) });
  return <div className="project-row" onContextMenu={event => { event.preventDefault(); showMenu(event.clientX, event.clientY); }}>
    {children}
    <button className="project-menu-trigger" aria-label={`项目菜单：${project.name}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); showMenu(box.left, box.bottom); }}>⋯</button>
    {menu && <div className="project-menu" ref={menuElement} role="menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" onClick={() => { setMenu(undefined); setAction('edit'); }}>编辑项目</button>
      <button role="menuitem" onClick={() => { setMenu(undefined); setAction('delete'); }}>删除项目</button>
    </div>}
    {action === 'edit' && <ProjectEditor project={project} running={runs.filter(run => run.projectId === project.id && run.state === 'running').length} close={() => setAction(undefined)} openProject={id => { setAction(undefined); openProject(id); }} />}
    {action === 'delete' && <DeleteProject project={project} close={() => setAction(undefined)} />}
  </div>;
}

function ProjectEditor({ project, running, close, openProject }: { project: Project; running: number; close(): void; openProject(id: string): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original] = useState(project);
  const [name, setName] = useState(project.name), [path, setPath] = useState(project.directory);
  const [inspection, setInspection] = useState<{ path: string; result: DirectoryResult }>({ path: project.directory, result: { valid: true, directory: project.directory } });
  const [nameInputError, setNameInputError] = useState('');
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<ProjectEditResult>();
  const directory = inspection.path === path ? inspection.result : undefined;
  const checking = !!path && !directory;
  const duplicate = directory?.existingProjectId && directory.existingProjectId !== project.id;
  const nameError = nameInputError || projectNameError(name);
  const directoryError = !path ? '请选择项目目录' : checking ? '' : !directory?.valid ? '请选择有效的本地目录'
    : duplicate ? `此目录已添加为项目『${directory.existingProjectName}』，无法重复使用` : '';
  const changedDirectory = !!directory?.valid && !duplicate && directory.directory !== original.directory;
  const canSave = !busy && !choosing && !checking && !nameError && !directoryError;
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    let live = true;
    if (!path) return;
    const timer = setTimeout(() => {
      void window.workbench.inspectDirectory(path).then(result => { if (live) setInspection({ path, result }); })
        .catch(error => { if (live) { setInspection({ path, result: { valid: false } }); setError(error.message); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [path]);
  async function save(restart: boolean) {
    if (!canSave) return;
    setBusy(true); setError('');
    try {
      const outcome = await window.workbench.editProject(project.id, { name, directory: path }, restart);
      if (outcome.error || outcome.launches.length) setResult(outcome); else close();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="project-dialog" aria-label="编辑项目" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>{result ? '项目修改结果' : '编辑项目'}</h2>
    {result ? <>
      <p>已保存项目名称和目录：{result.project.name}</p><p className="project-path">{result.project.directory}</p>
      {result.error && <p className="error-text" role="alert">{result.error}</p>}
      {!!result.launches.length && <><p>{result.launches.every(launch => launch.ok) ? '全部面板已从新目录启动。' : '有面板未能确认启动成功；已保存的新目录保持不变。'}</p>
        <ul className="project-launch-results">{result.launches.map(launch => <li key={launch.run.panelId} className={launch.ok ? '' : 'error-text'}>面板 {result.project.panels.findIndex(panel => panel.id === launch.run.panelId) + 1} · {agentNames[result.project.panels.find(panel => panel.id === launch.run.panelId)!.agent]}：{launch.ok ? '启动成功' : launch.error}</li>)}</ul></>}
      <div className="project-dialog-actions"><button className="primary" onClick={close}>完成</button></div>
    </> : <form onSubmit={event => { event.preventDefault(); if (!changedDirectory) void save(false); }}>
      <label htmlFor="edit-project-name">项目名称</label><input id="edit-project-name" autoFocus autoComplete="off" value={name} disabled={busy} aria-invalid={!!nameError} aria-describedby="edit-project-name-status" onChange={event => { setNameInputError(''); setName(event.target.value); }} onPaste={event => {
        if (projectNameHasControls(event.clipboardData.getData('text'))) { event.preventDefault(); setNameInputError('项目名称不能包含换行或控制字符'); }
        else setNameInputError('');
      }} />
      {nameError && <div id="edit-project-name-status" className="field-status error-text">{nameError}</div>}
      <label htmlFor="edit-project-directory">本地目录</label><div className="directory-input"><input id="edit-project-directory" autoComplete="off" value={path} disabled={busy} aria-invalid={!!directoryError} aria-describedby="edit-project-directory-status" onChange={event => setPath(event.target.value)} /><button type="button" disabled={busy || choosing} aria-label="选择新项目目录" onClick={async () => { setChoosing(true); try { const selected = await window.workbench.chooseDirectory(); if (selected !== null) setPath(selected); } catch (error) { setError((error as Error).message); } finally { setChoosing(false); } }}>浏览</button></div>
      {(checking || directoryError) && <div id="edit-project-directory-status" className="field-status" aria-live="polite">{checking ? '检查目录…' : <span className="error-text">{directoryError}</span>}{duplicate && <button type="button" className="open-existing-project" onClick={() => openProject(directory!.existingProjectId!)}>打开已有项目</button>}</div>}
      {changedDirectory && <section className="directory-change" aria-label="目录变更影响"><dl><dt>原目录</dt><dd>{original.directory}</dd><dt>新目录</dt><dd>{directory!.directory}</dd></dl><p>当前运行实例：{running}</p>
        <p><strong>更改并重启：</strong>中断本项目当前任务，保留面板和布局，从新目录启动。尚未启动的项目会在首次进入时启动。</p>
        <p><strong>更改但不重启：</strong>立即更新工作台显示的目录；现有面板的实际工作目录仍可能是旧目录，之后新增或重开的实例使用新目录。</p>
        <p>两种方式都保留本地文件和 CLI 历史。旧会话请在 CLI 内手动恢复。</p>
      </section>}
      {error && <p className="error-text" role="alert">{error.replace(/^Error invoking remote method '[^']+': Error: /, '')}</p>}
      <div className="project-dialog-actions"><button type="button" disabled={busy} onClick={close}>{changedDirectory ? '取消更改' : '取消'}</button>{changedDirectory ? <><button type="button" disabled={!canSave} onClick={() => void save(false)}>更改但不重启</button><button className="primary" type="button" disabled={!canSave} onClick={() => void save(true)}>{busy ? '正在处理…' : '更改并重启'}</button></> : <button type="submit" className="primary" disabled={!canSave}>{busy ? '正在保存…' : '保存修改'}</button>}</div>
    </form>}
  </dialog>;
}

function DeleteProject({ project, close }: { project: Project; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="project-dialog delete-project-dialog" aria-label="删除项目" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>删除项目「{project.name}」？</h2><p>将结束本项目全部受管运行实例及需要清理的子进程，并从工作台移除项目、面板配置和布局。</p><p>本地目录、文件和 CLI 历史全部保留。重新添加此目录时，将按新项目配置。</p>
    {error && <p className="error-text" role="alert">{error.replace(/^Error invoking remote method '[^']+': Error: /, '')}</p>}
    <div className="project-dialog-actions"><button autoFocus disabled={busy} onClick={close}>取消</button><button className="danger" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await window.workbench.deleteProject(project.id); close(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>{busy ? '正在删除…' : '确认删除'}</button></div>
  </dialog>;
}
