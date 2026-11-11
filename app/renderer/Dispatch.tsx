import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref, type RefObject } from 'react';
import { agentNames, projectPanels, type AgentType, type PanelCreation, type PanelView, type ProjectView } from '../shared/model';
import { message } from '../shared/messages';
import type { IssueSummary } from '../shared/code-hosting';
import type { DispatchLocation, DispatchRecordView, DispatchRequest } from '../shared/dispatch';
import { workflowCatalog, type Delivery, type Workflow, type WorkflowInstruction, type WorkflowSettings } from '../shared/workflows';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import { relativeTime } from './list-row-parts';
import { useLocalization } from './Localization';
import { shortcutFromEvent, type Shortcuts } from '../shared/shortcuts';
import './dispatch.css';

/** A panel the menu can dispatch to: one of the project's panels whose Agent is running. */
interface Target { panel: PanelView; location: DispatchLocation }
const targets = (project: ProjectView): Target[] => projectPanels(project).flatMap(panel => panel.run?.state === 'running'
  ? [{ panel, location: { projectId: project.id, panelId: panel.id, runId: panel.run.id, ephemeral: project.tray.includes(panel) } }] : []);

// The order the spec lists new panels in.
const newPanelAgents: AgentType[] = ['claude', 'codex', 'pi'];
const flipped = (delivery: Delivery): Delivery => delivery === 'submit' ? 'fill' : 'submit';
// The target each instruction last went to, an existing panel or a new one of an Agent type, remembered while the app
// runs, keyed by workflow and instruction.
const lastTargets = new Map<string, string>();
const targetKey = (target: Target | AgentType) => typeof target === 'string' ? `new:${target}` : `panel:${target.panel.id}`;
const instructionKey = (workflow: Workflow, instruction: WorkflowInstruction) => `${workflow.id}/${instruction.id}`;
const isSpace = (event: KeyboardEvent) => event.code === 'Space' || event.key === ' ';
const menuKeys = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']);

/** The enabled items of one menu layer, not of the layer nested in it. */
const items = (layer: HTMLElement | null) => [...layer?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []]
  .filter(item => item.parentElement?.closest('[role=menu]') === layer);
/** The latest of an open issue's dispatches whose session a panel is on now. */
const locatable = (issue: Pick<IssueSummary, 'state'>, records: DispatchRecordView[]) => issue.state === 'closed' ? undefined : records.find(record => record.location)?.location;

/** Opens the menu from the keyboard, with focus on its first instruction. */
export interface DispatchMenuActions { open(): void }

/**
 * The issue's 派发 button and its cascading menu: the instructions of enabled workflows, then, to the left, the targets
 * for the chosen one: a new panel of each Agent type, then the project's panels with a running Agent, the one it last went
 * to highlighted. Nothing is preselected. Opening the menu moves focus into it: ↑/↓ move, ← or Space opens an
 * instruction's targets, → returns to the instructions, Space dispatches, Escape closes the whole menu and Enter does
 * nothing. ⌥ with Space or a click inverts the delivery once. A submitted dispatch returns focus to the button, leaving
 * a new panel as a card in the tray; a filled one shows its panel, a new one once the snapshot has it.
 */
export function DispatchMenu({ issue, project, workflows, dispatch, filled, ref }: {
  issue: Pick<IssueSummary, 'number' | 'title'>; project: ProjectView; workflows: WorkflowSettings;
  dispatch(request: DispatchRequest): Promise<PanelCreation | null>; filled(location: DispatchLocation): void; ref?: Ref<DispatchMenuActions>;
}) {
  const { t, text } = useLocalization();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ workflow: Workflow; instruction: WorkflowInstruction }>();
  const [failure, setFailure] = useState<string>();
  // A new panel filled into: the dispatch resolves before the snapshot showing the panel may have arrived.
  const [opening, setOpening] = useState<DispatchLocation>();
  useEffect(() => {
    if (!opening || !project.tray.some(panel => panel.id === opening.panelId && panel.run?.id === opening.runId)) return;
    setOpening(undefined);
    filled(opening);
  }, [opening, project]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const targetMenu = useRef<HTMLDivElement>(null);
  // Set when the keyboard opens an instruction's targets, which then take focus.
  const focusTargets = useRef(false);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }));
  useLayoutEffect(() => { if (open) (items(menu.current)[0] ?? menu.current)?.focus(); }, [open]);
  useLayoutEffect(() => {
    if (focusTargets.current) items(targetMenu.current)[0]?.focus();
    focusTargets.current = false;
  }, [chosen]);
  const enabled = workflowCatalog.filter(workflow => workflows[workflow.id]?.enabled);
  const close = () => { setOpen(false); setChosen(undefined); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const delivery = (workflow: Workflow, instruction: WorkflowInstruction): Delivery => workflows[workflow.id]?.instructions[instruction.id]?.delivery ?? 'submit';
  async function send(target: Target | AgentType, invert: boolean) {
    if (!chosen) return;
    const effective = invert ? flipped(delivery(chosen.workflow, chosen.instruction)) : delivery(chosen.workflow, chosen.instruction);
    lastTargets.set(instructionKey(chosen.workflow, chosen.instruction), targetKey(target));
    close(); setFailure(undefined);
    try {
      const creation = await dispatch({ issue: { number: issue.number, title: issue.title }, workflow: chosen.workflow.id, instruction: chosen.instruction.id,
        target: typeof target === 'string' ? { agent: target } : { panelId: target.panel.id }, invert });
      const launch = creation?.launch;
      if (launch && launch.outcome !== 'started') {
        setFailure(launch.outcome === 'failed' ? message('launchFailed') : launch.reason); button.current?.focus();
      } else if (effective === 'submit') button.current?.focus();
      else if (creation) setOpening({ projectId: project.id, panelId: creation.panel.id, runId: creation.launch.run.id, ephemeral: true });
      else if (typeof target !== 'string') filled(target.location);
    } catch (error) { setFailure((error as Error).message); button.current?.focus(); }
  }
  const instructions = (workflow: Workflow) => workflow.instructions.map(instruction => {
    const mode = delivery(workflow, instruction);
    const current = chosen?.instruction === instruction;
    const enter = () => { focusTargets.current = true; setChosen({ workflow, instruction }); };
    return [instruction.separatorBefore && <hr key={`${instruction.id}-separator`} />,
      <button key={instruction.id} role="menuitem" aria-haspopup="menu" aria-expanded={current} className={current ? 'chosen' : undefined}
        onMouseEnter={() => setChosen({ workflow, instruction })} onClick={() => setChosen({ workflow, instruction })}
        onKeyUp={event => { if (isSpace(event)) enter(); }} onKeyDown={event => { if (event.key === 'ArrowLeft') enter(); }}>
        <code>{instruction.skill}</code><small className={`dispatch-delivery ${mode}`}>{t(mode === 'submit' ? 'deliverySubmit' : 'deliveryFill')}</small>
      </button>];
  });
  // The menu's keys stay in the open menu, handled, so none reaches a terminal or scrolls or leaves what holds the menu,
  // even where they do nothing; Space acts on its release, after the press it belongs to.
  function keys(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || (!menuKeys.has(event.key) && !isSpace(event))) return;
    if (event.type === 'keydown' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const layer = items((event.target as Element).closest<HTMLElement>('[role=menu]'));
      const next = layer[layer.indexOf(event.target as HTMLButtonElement) + (event.key === 'ArrowDown' ? 1 : -1)];
      next?.focus();
    } else if (event.type === 'keydown' && event.key === 'ArrowRight' && chosen) {
      menu.current?.querySelector<HTMLElement>('[aria-expanded=true]')?.focus(); setChosen(undefined);
    } else if (event.type === 'keydown' && event.key === 'Escape') { close(); button.current?.focus(); }
    event.preventDefault(); event.stopPropagation();
  }
  return <div className="dispatch" ref={root}>
    <button ref={button} className="dispatch-button" aria-haspopup="menu" aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>{t('dispatch')}</button>
    {open && <div ref={menu} tabIndex={-1} className="dispatch-menu" role="menu" aria-label={t('dispatchIssue', { number: issue.number })} onKeyDown={keys} onKeyUp={keys}>
      {!enabled.length && <p className="dispatch-empty">{t('noEnabledWorkflows')}</p>}
      {enabled.length === 1 && instructions(enabled[0])}
      {enabled.length > 1 && enabled.map(workflow => <div key={workflow.id} role="group" aria-label={workflow.name}>
        <div className="dispatch-heading" aria-hidden="true">{workflow.name}</div>{instructions(workflow)}</div>)}
      {chosen && <div ref={targetMenu} className="dispatch-targets" role="menu" aria-label={t('dispatchTargets', { instruction: chosen.instruction.skill })}>
        {newPanelAgents.map(agent => {
          const last = lastTargets.get(instructionKey(chosen.workflow, chosen.instruction)) === targetKey(agent);
          return <button key={agent} role="menuitem" aria-label={t('newPanelTarget', { agent: agentNames[agent] })}
            aria-current={last || undefined} className={last ? 'last-target' : undefined}
            onClick={event => void send(agent, event.altKey)} onKeyUp={event => { if (isSpace(event)) void send(agent, event.altKey); }}>
            <span className="agent-mark">{agentIcons[agent]}</span><span className="dispatch-target-title">{t('newPanelTarget', { agent: agentNames[agent] })}</span>
          </button>;
        })}
        <hr />
        {targets(project).map(target => {
          const last = lastTargets.get(instructionKey(chosen.workflow, chosen.instruction)) === targetKey(target);
          const { panel } = target;
          const title = panel.run?.title ?? t('untitled');
          const side = t(target.location.ephemeral ? 'ephemeralPanel' : 'residentPanel');
          return <button key={panel.id} role="menuitem" aria-label={`${title} · ${t(panel.status ?? 'error')} · ${agentNames[panel.agent]} · ${side}`}
            aria-current={last || undefined} className={last ? 'last-target' : undefined}
            onClick={event => void send(target, event.altKey)} onKeyUp={event => { if (isSpace(event)) void send(target, event.altKey); }}>
            <span className="agent-mark">{agentIcons[panel.agent]}</span><ProcessingStatusIcon state={panel.status} />
            <span className="dispatch-target-title">{title}</span><small>{side}</small>
          </button>;
        })}
      </div>}
    </div>}
    {failure && <p className="error-text" role="alert">{text(failure)}</p>}
  </div>;
}

/**
 * The issue's latest Dispatch Record: the panel now on its session, with its processing state, session title and how
 * many dispatches the issue had, or a grey dispatched time. Clicking locates the latest dispatch a panel is on now.
 * A closed issue shows none.
 */
export function DispatchStatus({ issue, records, locate }: { issue: IssueSummary; records: DispatchRecordView[]; locate(location: DispatchLocation): void }) {
  const { t, language } = useLocalization();
  const [latest] = records;
  if (issue.state === 'closed' || !latest) return null;
  const time = new Date(latest.time);
  const dispatched = t('dispatchedAt', { time: relativeTime(time, language) });
  const summary = t('dispatchSummary', { title: latest.location ? latest.location.title ?? t('untitled') : dispatched,
    agent: agentNames[latest.agent], time: time.toLocaleString(language), text: latest.text });
  const target = locatable(issue, records);
  return <button className="issue-dispatch" aria-label={t('locateDispatch', { summary })} data-hint={summary}
    onClick={() => { if (target) locate(target); }}>
    {latest.location ? <>
      <ProcessingStatusIcon state={latest.location.status} />
      <span className="issue-dispatch-title">{latest.location.title ?? t('untitled')}</span>
      {records.length > 1 && <span className="issue-dispatch-count">{t('dispatchCount', { count: records.length })}</span>}
    </> : <span className="issue-dispatched">{dispatched}</span>}
  </button>;
}

/**
 * Every Dispatch Record of the issue, newest first: when, which Agent type, the session (locatable while a panel is on
 * it) and the instruction sent, folded. A closed issue folds the whole section to its count.
 */
export function DispatchRecords({ issue, records, locate }: {
  issue: Pick<IssueSummary, 'state'>; records: DispatchRecordView[]; locate(location: DispatchLocation): void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(issue.state === 'open');
  if (!records.length) return null;
  const heading = t('dispatchRecords', { count: records.length });
  return <section className="dispatch-records" aria-label={heading}>
    <button className="dispatch-records-fold" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span>{heading}</button>
    {open && <ul>{records.map((record, index) => <DispatchRecordItem key={`${record.time}:${index}`} record={record} locate={locate} />)}</ul>}
  </section>;
}

function DispatchRecordItem({ record, locate }: { record: DispatchRecordView; locate(location: DispatchLocation): void }) {
  const { t, language } = useLocalization();
  const [shown, setShown] = useState(false);
  const time = new Date(record.time);
  const { location } = record;
  const title = location?.title ?? t('untitled');
  return <li className="dispatch-record">
    <div className="dispatch-record-line">
      <time dateTime={record.time} title={time.toLocaleString(language)}>{relativeTime(time, language)}</time>
      <span className="agent-mark" aria-hidden="true">{agentIcons[record.agent]}</span><span>{agentNames[record.agent]}</span>
      {location ? <button className="dispatch-record-session" aria-label={t('locateSession', { title })} onClick={() => locate(location)}>
        <ProcessingStatusIcon state={location.status} /><span>{title}</span></button>
        : <span className="dispatch-record-session unlocated">{t('noPanelOnSession')}</span>}
      <button className="dispatch-record-fold" aria-expanded={shown} onClick={() => setShown(current => !current)}>
        <span aria-hidden="true">{shown ? '▾' : '▸'}</span>{t('dispatchInstruction')}</button>
    </div>
    {shown && <pre className="dispatch-record-text">{record.text}</pre>}
  </li>;
}

/**
 * The dispatch and locate shortcuts while focus is within an issue: open its dispatch menu, or locate the latest of its
 * dispatches a panel is on now. Every other key passes on, as both do outside an issue, so they reach a focused terminal.
 */
export function issueShortcutKeys({ issue, records, shortcuts, menu, locate }: {
  issue: Pick<IssueSummary, 'state'>; records: DispatchRecordView[]; shortcuts: Shortcuts; menu: RefObject<DispatchMenuActions | null>; locate(location: DispatchLocation): void;
}) {
  return (event: KeyboardEvent) => {
    const binding = shortcutFromEvent(event.nativeEvent);
    if (!binding || (binding !== shortcuts.dispatch && binding !== shortcuts.locateDispatch)) return;
    event.preventDefault(); event.stopPropagation();
    if (binding === shortcuts.dispatch) menu.current?.open();
    else { const target = locatable(issue, records); if (target) locate(target); }
  };
}
