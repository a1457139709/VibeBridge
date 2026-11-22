import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useLocalization } from '../common/Localization';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { agentIcons } from '../common/agent-icons';
import {
  agentNames,
  isLiveRun,
  projectPanels,
  type AgentType,
  type PanelView,
  type ProjectView,
  type Settings,
} from '../../shared/model';
import {
  commandDelivery,
  commandText,
  invertedDelivery,
  workflows,
  type Delivery,
  type WorkflowCommand,
} from '../../shared/settings/workflows';
import type { DispatchRequest, DispatchTarget } from '../../shared/dispatch';
import { displayShortcut } from '../../shared/settings/shortcuts';
import type { IssueSummary } from '../../shared/forge/forge';
import type { DispatchRecordsHost } from './DispatchRecords';
import { errorMessage } from '../../shared/caught-error';
import { requireValue } from '../common/required';
import './dispatch.css';

export interface DispatchHost extends DispatchRecordsHost {
  workflows: Settings['workflows'];
  openMenuShortcut: string;
  lastTargets: ReadonlyMap<string, DispatchTarget>;
  rememberLastTarget(commandKey: string, target: DispatchTarget): void;
  onDispatched(delivery: Delivery): void;
}

const dispatchClass = 'dispatch';
export const holdsDispatch = (scope: Element) => !!scope.querySelector(`.${dispatchClass}`);

interface MenuCommand {
  workflowId: string;
  command: WorkflowCommand;
}
export const commandKey = ({ workflowId, command }: MenuCommand) => `${workflowId}/${command.id}`;
const targetKey = (target: DispatchTarget) =>
  target.kind === 'new' ? `new ${target.agent}` : `panel ${target.panelId}`;

const newPanelAgents: AgentType[] = ['claude', 'codex', 'pi'];
const deliveryText = { submit: 'deliverySubmit', fill: 'deliveryFill' } as const;
const step = (count: number, by: number) => (index: number) => Math.max(0, Math.min(count - 1, index + by));
const gap = 4,
  margin = 8;

function placeMenu(button: HTMLElement, menu: HTMLElement) {
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  const anchor = button.getBoundingClientRect();
  const below = anchor.bottom + gap;
  const top =
    below + menu.offsetHeight <= height - margin ? below : Math.max(margin, anchor.top - gap - menu.offsetHeight);
  const right = width - anchor.right;
  Object.assign(menu.style, { top: `${top}px`, right: `${right}px` });
  const targets = menu.querySelector<HTMLElement>('.dispatch-targets'),
    command = menu.querySelector<HTMLElement>('[role=menuitem].expanded');
  if (!targets || !command) return;
  const fitted = Math.min(command.offsetTop - gap, height - margin - top - targets.offsetHeight);
  targets.style.top = `${Math.max(margin - top, fitted)}px`;
  targets.classList.toggle('rightwards', width - right - menu.offsetWidth - gap - targets.offsetWidth < margin);
}

export function DispatchButton({
  project,
  issue,
  host,
  open,
  setOpen,
}: {
  project: ProjectView;
  issue: Pick<IssueSummary, 'number' | 'title'>;
  host: DispatchHost;
  open: boolean;
  setOpen(open: boolean): void;
}) {
  const { t } = useLocalization();
  const [level, setLevel] = useState<'commands' | 'targets'>('commands');
  const [commandIndex, setCommandIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [inverting, setInverting] = useState(false);
  const [panelToLocate, setPanelToLocate] = useState<string>();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panelToLocate || !projectPanels(project).some(panel => panel.id === panelToLocate)) return;
    setPanelToLocate(undefined);
    host.locate(project.id, panelToLocate);
  }, [panelToLocate, project, host]);
  useLayoutEffect(() => {
    if (!open) return;
    setLevel('commands');
    setCommandIndex(0);
    menu.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
    };
    const trackAlt = (event: KeyboardEvent) => setInverting(event.altKey);
    const place = () => {
      if (button.current && menu.current) placeMenu(button.current, menu.current);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', trackAlt, true);
    window.addEventListener('keyup', trackAlt, true);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', trackAlt, true);
      window.removeEventListener('keyup', trackAlt, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      setInverting(false);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && button.current && menu.current) placeMenu(button.current, menu.current);
  });

  const commands: MenuCommand[] = workflows
    .filter(workflow => host.workflows[workflow.id]?.enabled)
    .flatMap(workflow => workflow.commands.map(command => ({ workflowId: workflow.id, command })));
  const workflowCount = new Set(commands.map(command => command.workflowId)).size;
  const shownDelivery = ({ workflowId, command }: MenuCommand) => {
    const configured = commandDelivery(host.workflows, workflowId, command.id);
    return inverting ? invertedDelivery(configured) : configured;
  };
  const lastTargetOf = (command: MenuCommand) => host.lastTargets.get(commandKey(command));
  const panels = projectPanels(project).filter(panel => isLiveRun(panel.run));
  const resident = (panel: PanelView) => project.panels.includes(panel);
  const targets: { target: DispatchTarget; agent: AgentType; panel?: PanelView }[] = [
    ...newPanelAgents.map(agent => ({ target: { kind: 'new', agent } as const, agent })),
    ...panels.map(panel => ({ target: { kind: 'panel', panelId: panel.id } as const, agent: panel.agent, panel })),
  ];
  const expanded = level === 'targets' ? commands[commandIndex] : undefined;
  const lastTarget = expanded && lastTargetOf(expanded);
  const lastTargetKey = lastTarget && targetKey(lastTarget);

  function showTargets(index: number) {
    const menuCommand = commands[index];
    if (!menuCommand) return;
    if (level === 'targets' && index === commandIndex) return;
    const last = lastTargetOf(menuCommand),
      key = last && targetKey(last);
    setCommandIndex(index);
    setTargetIndex(
      Math.max(
        0,
        targets.findIndex(({ target }) => targetKey(target) === key),
      ),
    );
    setLevel('targets');
  }
  async function dispatch(index: number, invert: boolean) {
    const menuCommand = expanded,
      target = targets[index]?.target;
    if (!menuCommand || !target) return;
    const request: DispatchRequest = {
      issue: { number: issue.number, title: issue.title },
      workflowId: menuCommand.workflowId,
      commandId: menuCommand.command.id,
      target,
      invertDelivery: invert,
    };
    setOpen(false);
    try {
      const { delivery, panelId } = await window.workbench.dispatch(project.id, request);
      host.rememberLastTarget(commandKey(menuCommand), target);
      if (delivery === 'fill') setPanelToLocate(panelId);
      else button.current?.focus();
      host.onDispatched(delivery);
    } catch (error) {
      host.report(errorMessage(error));
      button.current?.focus();
    }
  }
  function keydown(event: React.KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const by = event.key === 'ArrowDown' ? 1 : -1;
      if (level === 'commands') setCommandIndex(step(commands.length, by));
      else setTargetIndex(step(targets.length, by));
    } else if (event.key === 'ArrowLeft') {
      if (level === 'commands') showTargets(commandIndex);
    } else if (event.key === 'ArrowRight') setLevel('commands');
    else if (event.code === 'Space') {
      if (level === 'commands') showTargets(commandIndex);
      else void dispatch(targetIndex, event.altKey);
    } else if (event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else if (event.key !== 'Enter') return;
    event.preventDefault();
  }

  const commandElementId = (index: number) => `${menuId}-command-${index}`,
    targetElementId = (index: number) => `${menuId}-target-${index}`;
  const cursorTarget = expanded && targets[targetIndex];
  const openMenuLabel = displayShortcut(host.openMenuShortcut);
  return (
    <div className={dispatchClass} ref={root} onClick={event => event.stopPropagation()}>
      <button
        ref={button}
        className="dispatch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-hint={`${t('dispatchHint')} (${openMenuLabel})`}
        onClick={() => setOpen(!open)}
      >
        {t('dispatch')}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div
          ref={menu}
          className="dispatch-menu"
          role="menu"
          tabIndex={-1}
          aria-label={t('dispatchMenu', { number: issue.number })}
          aria-activedescendant={
            commands.length ? (expanded ? targetElementId(targetIndex) : commandElementId(commandIndex)) : undefined
          }
          onKeyDown={keydown}
          onMouseDown={event => event.preventDefault()}
        >
          {!commands.length && <p className="dispatch-empty">{t('noEnabledWorkflows')}</p>}
          {commands.map((item, index) => {
            const { workflowId, command } = item;
            const mode = shownDelivery(item);
            const startsWorkflow = commands.findIndex(other => other.workflowId === workflowId) === index;
            return (
              <Fragment key={commandKey(item)}>
                {workflowCount > 1 && startsWorkflow && (
                  <h4 className="dispatch-workflow">
                    {t(
                      requireValue(
                        workflows.find(workflow => workflow.id === workflowId),
                        "the command's workflow",
                      ).name,
                    )}
                  </h4>
                )}
                {command.separatorBefore && <hr />}
                <button
                  id={commandElementId(index)}
                  role="menuitem"
                  tabIndex={-1}
                  className={[index === commandIndex && 'cursor', expanded === item && 'expanded']
                    .filter(Boolean)
                    .join(' ')}
                  aria-haspopup="menu"
                  aria-expanded={expanded === item}
                  onMouseEnter={() => showTargets(index)}
                  onClick={() => showTargets(index)}
                >
                  <span className="dispatch-caret" aria-hidden="true">
                    ‹
                  </span>
                  <code>{command.skill}</code>
                  <small className={`dispatch-delivery ${mode}`}>{t(deliveryText[mode])}</small>
                </button>
              </Fragment>
            );
          })}
          {expanded && (
            <div
              className="dispatch-targets"
              role="menu"
              aria-label={t('dispatchTargets', { command: expanded.command.skill })}
            >
              {targets.map(({ target, agent, panel }, index) => (
                <Fragment key={targetKey(target)}>
                  {index === newPanelAgents.length && <hr />}
                  <button
                    id={targetElementId(index)}
                    role="menuitem"
                    tabIndex={-1}
                    className={index === targetIndex ? 'cursor' : ''}
                    onMouseEnter={() => setTargetIndex(index)}
                    onClick={event => void dispatch(index, event.altKey)}
                  >
                    {panel ? (
                      <>
                        <span className={`agent-mark ${agent}`} role="img" aria-label={agentNames[agent]}>
                          {agentIcons[agent]}
                        </span>
                        <ProcessingStatusIcon state={panel.status} />
                        <span className="dispatch-title">{panel.run?.title ?? t('untitled')}</span>
                        <small>
                          {[panel.status && t(panel.status), t(resident(panel) ? 'residentPanel' : 'ephemeralPanel')]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </>
                    ) : (
                      <>
                        <span className={`agent-mark ${agent}`} aria-hidden="true">
                          {agentIcons[agent]}
                        </span>
                        {t('dispatchNew', { agent: agentNames[agent] })}
                        <small>{t('ephemeralPanel')}</small>
                      </>
                    )}
                    {targetKey(target) === lastTargetKey && <span className="dispatch-last">{t('lastTarget')}</span>}
                  </button>
                </Fragment>
              ))}
              {cursorTarget && (
                <div className="dispatch-preview">
                  <code>
                    {commandText(cursorTarget.agent, expanded.command, {
                      url: `…#${issue.number}`,
                      number: issue.number,
                      title: issue.title,
                    })}
                  </code>
                  <span>
                    {t(deliveryText[shownDelivery(expanded)])}
                    {inverting && ` ${t('dispatchInverted')}`}
                  </span>
                </div>
              )}
            </div>
          )}
          <p className="dispatch-keys">{t('dispatchMenuKeys')}</p>
        </div>
      )}
    </div>
  );
}
