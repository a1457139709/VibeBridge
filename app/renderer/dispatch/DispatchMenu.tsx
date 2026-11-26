import { Fragment, useId, useRef, useState, type RefObject } from 'react';
import { useLocalization } from '../common/Localization';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { agentIcons } from '../common/agent-icons';
import { useDocumentEvent } from '../common/document-events';
import { useWindowEvent } from '../common/window-events';
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

function watchShownPanels(project: ProjectView) {
  let shown: ProjectView | undefined = project;
  let awaited: { panelId: string; locate(): void } | undefined;
  const settle = () => {
    if (!shown) stop();
    else if (awaited && projectPanels(shown).some(panel => panel.id === awaited?.panelId)) {
      stop();
      awaited.locate();
    }
  };
  const stop = window.workbench.subscribe(event => {
    if (event.kind !== 'snapshot') return;
    shown = event.snapshot.projects.find(item => item.id === project.id);
    settle();
  });
  return {
    locateOnceShown(panelId: string, locate: () => void) {
      awaited = { panelId, locate };
      settle();
    },
    stop,
  };
}

interface Issue {
  issue: Pick<IssueSummary, 'number' | 'title'>;
}

export function DispatchButton({
  project,
  issue,
  host,
  open,
  setOpen,
}: Issue & {
  project: ProjectView;
  host: DispatchHost;
  open: boolean;
  setOpen(open: boolean): void;
}) {
  const { t } = useLocalization();
  const button = useRef<HTMLButtonElement>(null);
  const openMenuLabel = displayShortcut(host.openMenuShortcut);
  return (
    <div className={dispatchClass} onClick={event => event.stopPropagation()}>
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
        <DispatchMenu project={project} issue={issue} host={host} button={button} close={() => setOpen(false)} />
      )}
    </div>
  );
}

function DispatchMenu({
  project,
  issue,
  host,
  button,
  close,
}: Issue & {
  project: ProjectView;
  host: DispatchHost;
  button: RefObject<HTMLButtonElement | null>;
  close(): void;
}) {
  const { t } = useLocalization();
  const [level, setLevel] = useState<'commands' | 'targets'>('commands');
  const [commandIndex, setCommandIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [inverting, setInverting] = useState(false);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const place = () => {
    if (button.current && menu.current) placeMenu(button.current, menu.current);
  };
  const attach = (element: HTMLDivElement | null) => {
    menu.current = element;
    if (!element) return;
    place();
    if (focused.current) return;
    focused.current = true;
    element.focus();
  };
  useDocumentEvent('pointerdown', event => {
    const target = event.target instanceof Node ? event.target : null;
    if (!(menu.current?.contains(target) || button.current?.contains(target))) close();
  });
  const trackAlt = (event: KeyboardEvent) => setInverting(event.altKey);
  useWindowEvent('keydown', trackAlt, { capture: true });
  useWindowEvent('keyup', trackAlt, { capture: true });
  useWindowEvent('resize', place);
  useDocumentEvent('scroll', place, { capture: true });

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
    close();
    const shownPanels = watchShownPanels(project);
    try {
      const { delivery, panelId } = await window.workbench.dispatch(project.id, request);
      host.rememberLastTarget(commandKey(menuCommand), target);
      if (delivery === 'fill') shownPanels.locateOnceShown(panelId, () => host.locate(project.id, panelId));
      else {
        shownPanels.stop();
        button.current?.focus();
      }
      host.onDispatched(delivery);
    } catch (error) {
      shownPanels.stop();
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
      close();
      button.current?.focus();
    } else if (event.key !== 'Enter') return;
    event.preventDefault();
  }

  const commandElementId = (index: number) => `${menuId}-command-${index}`,
    targetElementId = (index: number) => `${menuId}-target-${index}`;
  const cursorTarget = expanded && targets[targetIndex];
  return (
    <div
      ref={attach}
      className="dispatch-menu"
      role="menu"
      tabIndex={-1}
      aria-label={t('dispatchMenu', { number: issue.number })}
      aria-describedby={commands.length ? undefined : `${menuId}-empty`}
      aria-activedescendant={
        commands.length ? (expanded ? targetElementId(targetIndex) : commandElementId(commandIndex)) : undefined
      }
      onKeyDown={keydown}
      onMouseDown={event => event.preventDefault()}
    >
      {!commands.length && (
        <p className="dispatch-empty" id={`${menuId}-empty`}>
          {t('noEnabledWorkflows')}
        </p>
      )}
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
                      {panel.status && (
                        <>
                          <span>{t(panel.status)}</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      )}
                      <span>{t(resident(panel) ? 'residentPanel' : 'ephemeralPanel')}</span>
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
  );
}
