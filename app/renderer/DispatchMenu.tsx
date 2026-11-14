import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useLocalization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { RelativeTime } from './ForgeDisplay';
import { agentIcons } from './agent-icons';
import { agentNames, liveRun, projectPanels, type AgentType, type PanelView, type ProjectView, type Settings } from '../shared/model';
import { commandDelivery, commandText, invertedDelivery, workflows, type Delivery, type WorkflowCommand } from '../shared/workflows';
import { latestLocatable, type DispatchRecordView, type DispatchRequest, type DispatchTarget } from '../shared/dispatch';
import { displayShortcut } from '../shared/shortcuts';
import type { IssueSummary } from '../shared/forge';
import './dispatch.css';

/** What dispatching needs from the sidebar around it. */
export interface DispatchHost {
  workflows: Settings['workflows'];
  /** The binding that opens the dispatch menu from the sidebar. */
  openMenuBinding: string;
  /** The target each command was last dispatched to while the app runs, by {@link commandKey}. */
  lastTargets: ReadonlyMap<string, DispatchTarget>;
  /** Remembers the target a command was dispatched to. */
  rememberLastTarget(commandKey: string, target: DispatchTarget): void;
  /** Locates a panel; an ephemeral one opens as its temporary maximize. */
  locate(projectId: string, panelId: string): void;
  /** A dispatch went through: the sidebar refreshes once; `fill` also closes the detail. */
  dispatched(delivery: Delivery): void;
  report(message: string): void;
}

/** A command of an enabled workflow, as the menu lists it. */
interface MenuCommand { workflowId: string; command: WorkflowCommand }
/** Names a command of a workflow across the app's lifetime. */
export const commandKey = ({ workflowId, command }: MenuCommand) => `${workflowId}/${command.id}`;
/** Names a target among a menu's targets. */
const targetKey = (target: DispatchTarget) => target.kind === 'new' ? `new ${target.agent}` : `panel ${target.panelId}`;

/** New-panel targets, in this order. */
const newPanelAgents: AgentType[] = ['claude', 'codex', 'pi'];
const deliveryText = { submit: 'deliverySubmit', fill: 'deliveryFill' } as const;
/** Moves a cursor by a step within a list's length, without wrapping. */
const step = (count: number, by: number) => (index: number) => Math.max(0, Math.min(count - 1, index + by));

/** One Dispatch button with no default command. It opens a cascade beside it: the commands of the enabled workflows,
 * then, leftwards, the targets: new panels of each Agent type, and the project's panels that have a run, whatever
 * they are doing. The open menu holds focus, so no key reaches a terminal: ↑/↓ move, ← enters the targets (Space does
 * the same on a command), → goes back, Space dispatches, Esc closes the whole menu and Enter does nothing. Holding ⌥
 * while dispatching, by Space or by click, inverts the command's delivery for that dispatch only. The targets mark the one
 * the command last went to, and the cursor starts there, without dispatching. Submitting returns focus here, so a new
 * panel stays a card in the tray; filling locates the target panel, which opens a new one as its temporary maximize.
 * The owner holds whether the menu is open, so a shortcut can open it. */
export function DispatchButton({ project, issue, host, open, setOpen }: {
  project: ProjectView; issue: Pick<IssueSummary, 'number' | 'title'>; host: DispatchHost; open: boolean; setOpen(open: boolean): void;
}) {
  const { t } = useLocalization();
  /** Whether the targets show, the command under the cursor, and the target under the cursor while they show. */
  const [level, setLevel] = useState<'commands' | 'targets'>('commands');
  const [commandIndex, setCommandIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  /** Whether ⌥ is held: the deliveries shown are inverted. */
  const [inverting, setInverting] = useState(false);
  /** A filled panel to locate once the snapshot has it: a new panel can be answered before the snapshot adding it arrives. */
  const [filled, setFilled] = useState<string>();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const commandRows = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!filled || !projectPanels(project).some(panel => panel.id === filled)) return;
    setFilled(undefined);
    host.locate(project.id, filled);
  }, [filled, project, host]);
  // Each opening starts on the first command, with focus in the menu.
  useLayoutEffect(() => {
    if (!open) return;
    setLevel('commands'); setCommandIndex(0); menu.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const trackAlt = (event: KeyboardEvent) => setInverting(event.altKey);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', trackAlt, true); window.addEventListener('keyup', trackAlt, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', trackAlt, true); window.removeEventListener('keyup', trackAlt, true);
      setInverting(false);
    };
  }, [open]);

  const commands: MenuCommand[] = workflows.filter(workflow => host.workflows[workflow.id]?.enabled)
    .flatMap(workflow => workflow.commands.map(command => ({ workflowId: workflow.id, command })));
  const workflowCount = new Set(commands.map(command => command.workflowId)).size;
  /** A command's delivery as shown: inverted while ⌥ is held. */
  const shownDelivery = ({ workflowId, command }: MenuCommand) => {
    const configured = commandDelivery(host.workflows, workflowId, command.id);
    return inverting ? invertedDelivery(configured) : configured;
  };
  const lastTargetOf = (command: MenuCommand) => host.lastTargets.get(commandKey(command));
  const panels = projectPanels(project).filter(panel => liveRun(panel.run));
  const resident = (panel: PanelView) => project.panels.includes(panel);
  const targets: { target: DispatchTarget; agent: AgentType; panel?: PanelView }[] = [
    ...newPanelAgents.map(agent => ({ target: { kind: 'new', agent } as const, agent })),
    ...panels.map(panel => ({ target: { kind: 'panel', panelId: panel.id } as const, agent: panel.agent, panel })),
  ];
  const expanded = level === 'targets' ? commands[commandIndex] : undefined;
  const lastTarget = expanded && lastTargetOf(expanded);
  const lastTargetKey = lastTarget && targetKey(lastTarget);

  /** Shows a command's targets, with the cursor on the one it last went to, else the first. */
  function showTargets(index: number) {
    const menuCommand = commands[index];
    if (!menuCommand) return;
    if (level === 'targets' && index === commandIndex) return;
    const last = lastTargetOf(menuCommand), key = last && targetKey(last);
    setCommandIndex(index); setTargetIndex(Math.max(0, targets.findIndex(({ target }) => targetKey(target) === key))); setLevel('targets');
  }
  async function dispatch(index: number, invert: boolean) {
    const menuCommand = expanded, target = targets[index]?.target;
    if (!menuCommand || !target) return;
    const request: DispatchRequest = { issue: { number: issue.number, title: issue.title }, workflowId: menuCommand.workflowId,
      commandId: menuCommand.command.id, target, invert };
    setOpen(false);
    try {
      const { delivery, panelId } = await window.workbench.dispatch(project.id, request);
      host.rememberLastTarget(commandKey(menuCommand), target);
      if (delivery === 'fill') setFilled(panelId); else button.current?.focus();
      host.dispatched(delivery);
    } catch (error) { host.report((error as Error).message); button.current?.focus(); }
  }
  function keydown(event: React.KeyboardEvent) {
    // The menu answers its own keys; none of them goes further.
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const by = event.key === 'ArrowDown' ? 1 : -1;
      if (level === 'commands') setCommandIndex(step(commands.length, by)); else setTargetIndex(step(targets.length, by));
    } else if (event.key === 'ArrowLeft') { if (level === 'commands') showTargets(commandIndex); }
    else if (event.key === 'ArrowRight') setLevel('commands');
    // ⌥+Space types another character on macOS: the key is the Space key whatever it types.
    else if (event.code === 'Space') { if (level === 'commands') showTargets(commandIndex); else void dispatch(targetIndex, event.altKey); }
    else if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    else if (event.key !== 'Enter') return;
    event.preventDefault();
  }

  const commandElementId = (index: number) => `${menuId}-command-${index}`, targetElementId = (index: number) => `${menuId}-target-${index}`;
  const cursorTarget = expanded && targets[targetIndex];
  const openMenuShortcut = displayShortcut(host.openMenuBinding);
  return <div className="dispatch" ref={root} onClick={event => event.stopPropagation()}>
    <button ref={button} className="dispatch-button" aria-haspopup="menu" aria-expanded={open} data-hint={`${t('dispatchHint')} (${openMenuShortcut})`}
      onClick={() => setOpen(!open)}>{t('dispatch')}<span aria-hidden="true"> ▾</span></button>
    {/* Pressing an item keeps focus on the menu, where its keys are answered. */}
    {open && <div ref={menu} className="dispatch-menu" role="menu" tabIndex={-1} aria-label={t('dispatchMenu', { number: issue.number })}
      aria-activedescendant={commands.length ? expanded ? targetElementId(targetIndex) : commandElementId(commandIndex) : undefined}
      onKeyDown={keydown} onMouseDown={event => event.preventDefault()}>
      {!commands.length && <p className="dispatch-empty">{t('noEnabledWorkflows')}</p>}
      {commands.map((item, index) => {
        const { workflowId, command } = item;
        const mode = shownDelivery(item);
        const startsWorkflow = commands.findIndex(other => other.workflowId === workflowId) === index;
        return <Fragment key={commandKey(item)}>
          {workflowCount > 1 && startsWorkflow && <h4 className="dispatch-workflow">{t(workflows.find(workflow => workflow.id === workflowId)!.name)}</h4>}
          {command.separatorBefore && <hr />}
          <button ref={row => { commandRows.current[index] = row; }} id={commandElementId(index)} role="menuitem" tabIndex={-1}
            className={[index === commandIndex && 'cursor', expanded === item && 'expanded'].filter(Boolean).join(' ')}
            aria-haspopup="menu" aria-expanded={expanded === item} onMouseEnter={() => showTargets(index)} onClick={() => showTargets(index)}>
            <span className="dispatch-caret" aria-hidden="true">‹</span><code>{command.skill}</code>
            <small className={`dispatch-delivery ${mode}`}>{t(deliveryText[mode])}</small>
          </button>
        </Fragment>;
      })}
      {expanded && <div className="dispatch-targets" role="menu" aria-label={t('dispatchTargets', { command: expanded.command.skill })}
        style={{ top: Math.max(0, (commandRows.current[commandIndex]?.offsetTop ?? 0) - 4) }}>
        {targets.map(({ target, agent, panel }, index) => <Fragment key={targetKey(target)}>
          {index === newPanelAgents.length && <hr />}
          <button id={targetElementId(index)} role="menuitem" tabIndex={-1} className={index === targetIndex ? 'cursor' : ''}
            onMouseEnter={() => setTargetIndex(index)} onClick={event => void dispatch(index, event.altKey)}>
            {panel ? <>
              <span className="dispatch-agent" role="img" aria-label={agentNames[agent]}>{agentIcons[agent]}</span>
              <ProcessingStatusIcon state={panel.status} />
              <span className="dispatch-title">{panel.run?.title ?? t('untitled')}</span>
              <small>{[panel.status && t(panel.status), t(resident(panel) ? 'residentPanel' : 'ephemeralPanel')].filter(Boolean).join(' · ')}</small>
            </> : <>
              <span className="dispatch-agent" aria-hidden="true">{agentIcons[agent]}</span>{t('dispatchNew', { agent: agentNames[agent] })}<small>{t('ephemeralPanel')}</small>
            </>}
            {targetKey(target) === lastTargetKey && <span className="dispatch-last">{t('lastTarget')}</span>}
          </button>
        </Fragment>)}
        {/* The issue URL is the forge's; the preview elides it, as the text the target receives starts the same way. */}
        {cursorTarget && <div className="dispatch-preview"><code>{commandText(cursorTarget.agent, expanded.command, { url: `…#${issue.number}`, number: issue.number, title: issue.title })}</code>
          <span>{t(deliveryText[shownDelivery(expanded)])}{inverting && ` ${t('dispatchInverted')}`}</span></div>}
      </div>}
      <p className="dispatch-keys">{t('dispatchMenuKeys')}</p>
    </div>}
  </div>;
}

/** Where an issue's latest dispatch is now: the processing state of the panel on its session and that session's title,
 * with ×N for several dispatches. Grey with its age when no panel is on the latest one's session. Clicking locates the
 * latest dispatch a panel is on now, which may be an earlier one; with none, the status is not clickable. The hint gives
 * the latest record in full: its Agent type, when, and the text sent. */
export function DispatchStatus({ records, locate }: { records: DispatchRecordView[]; locate(projectId: string, panelId: string): void }) {
  const { t, language } = useLocalization();
  const latest = records.at(-1);
  if (!latest) return null;
  const times = records.length > 1 ? <span className="dispatch-times"> ×{records.length}</span> : null;
  const details = { agent: agentNames[latest.agent], when: new Date(latest.dispatchedAt).toLocaleString(language), text: latest.text };
  const target = latestLocatable(records)?.location;
  const onClick = (event: React.MouseEvent) => { event.stopPropagation(); if (target) locate(target.projectId, target.panelId); };
  if (!latest.location) {
    const content = <>{t('dispatched')} <RelativeTime iso={latest.dispatchedAt} />{times}</>;
    return target
      ? <button className="dispatch-status gone" data-hint={t('dispatchedGoneLocatable', details)} onClick={onClick}>{content}</button>
      : <span className="dispatch-status gone" data-hint={t('dispatchedGone', details)}>{content}</span>;
  }
  const { status } = latest.location;
  const title = latest.location.title ?? t('untitled');
  const state = status ? t(status) : '';
  return <button className={`dispatch-status ${status ? `status-${status}` : ''}`} aria-label={[state, title].filter(Boolean).join(' · ')}
    data-hint={t('dispatchStatusHint', { status: state, title, ...details })} onClick={onClick}>
    <ProcessingStatusIcon state={status} /><span className="dispatch-session">{title}</span>{times}
  </button>;
}

/** An issue's Dispatch Records in its detail, newest first: when, the Agent type, the title of the session that took it,
 * which locates the panel on that session when there is one, and the text sent, folded until shown. A closed issue's
 * records start folded as a whole, to their count. */
export function DispatchRecords({ records, folded, locate }: { records: DispatchRecordView[]; folded: boolean; locate(projectId: string, panelId: string): void }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(!folded);
  /** The records whose text shows, by their place oldest first. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const heading = t('dispatchRecords', { count: records.length });
  const toggleText = (index: number) => setUnfolded(shown => {
    const next = new Set(shown);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  return <section className="forge-box dispatch-records" aria-label={heading}>
    <header><button className="dispatch-records-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {heading}</button></header>
    {open && <ul>{records.map((record, index) => ({ record, index })).reverse().map(({ record, index }) => {
      const { location } = record;
      const title = location?.title ?? t('untitled');
      const state = location?.status ? t(location.status) : '';
      return <li key={index} className="dispatch-record">
        <span className="dispatch-record-when"><RelativeTime iso={record.dispatchedAt} /></span>
        <span className="dispatch-agent" role="img" aria-label={agentNames[record.agent]}>{agentIcons[record.agent]}</span>
        {location
          ? <button className="dispatch-status" aria-label={[state, title].filter(Boolean).join(' · ')} data-hint={t('locateSessionPanel')}
            onClick={() => locate(location.projectId, location.panelId)}>
            <ProcessingStatusIcon state={location.status} /><span className="dispatch-session">{title}</span></button>
          : <span className="dispatch-record-gone">{t('noPanelOnSession')}</span>}
        {/* Folded, the text is named by how it invokes the skill: its first word. */}
        <button className="dispatch-record-toggle" aria-expanded={unfolded.has(index)} onClick={() => toggleText(index)}>
          {unfolded.has(index) ? t('hideCommand') : `${record.text.split(/\s/, 1)[0]} ▸`}</button>
        {unfolded.has(index) && <code className="dispatch-record-text">{record.text}</code>}
      </li>;
    })}</ul>}
  </section>;
}
