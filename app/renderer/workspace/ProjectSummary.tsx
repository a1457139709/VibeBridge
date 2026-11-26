import { useLocalization } from '../common/Localization';
import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { agentNames, type PanelView } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';
import { agentIcons } from '../common/agent-icons';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { useWindowEvent } from '../common/window-events';
import { useDismissal } from '../common/popover';
import { focusAfterUpdate } from '../common/focus';

const summaryStates = ['ready', 'needs-input', 'done', 'error'] as const satisfies readonly ProcessingState[];
type SummaryState = (typeof summaryStates)[number];

export interface ProjectSummaryActions {
  membersChanged(): void;
}

export function ProjectSummary({
  panels,
  locate,
  ref,
}: {
  panels: PanelView[];
  locate(panel: PanelView): void;
  ref?: Ref<ProjectSummaryActions>;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState<SummaryState>();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<SummaryState, HTMLButtonElement>());
  const focusedRun = useRef<string>(undefined);
  const members = (state: SummaryState) => panels.filter(panel => panel.status === state);
  function close(restoreFocus = false) {
    setOpen(undefined);
    if (restoreFocus && open) {
      const trigger = triggers.current.get(open);
      if (trigger && !trigger.disabled) trigger.focus();
      else container.current?.focus();
    }
  }
  function placeList(popup: HTMLElement) {
    const summary = container.current;
    if (!summary) return;
    const box = summary.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(box.left + (box.width - popup.offsetWidth) / 2, window.innerWidth - popup.offsetWidth - 8),
    );
    popup.style.left = `${left - box.left}px`;
  }
  function openList(state: SummaryState, fromEnd = false) {
    focusAfterUpdate(
      () => setOpen(state),
      () => {
        const members = list.current?.querySelectorAll<HTMLButtonElement>('li button');
        return members?.[fromEnd ? members.length - 1 : 0];
      },
    );
  }
  useImperativeHandle(ref, () => ({
    membersChanged() {
      const run = focusedRun.current;
      const shown = list.current;
      if (!run || !shown || document.activeElement !== document.body) return;
      if (shown.querySelector(`[data-run-id="${CSS.escape(run)}"]`)) return;
      (
        shown.querySelector<HTMLButtonElement>('li button') ?? shown.querySelector<HTMLButtonElement>('header button')
      )?.focus();
    },
  }));
  useWindowEvent('resize', () => {
    if (list.current) placeList(list.current);
  });
  useDismissal({
    open: !!open,
    inside: target =>
      !!list.current?.contains(target) || [...triggers.current.values()].some(button => button.contains(target)),
    dismiss: by => close(by === 'escape'),
  });
  return (
    <div ref={container} className="project-summary" role="region" aria-label={t('projectSummary')} tabIndex={-1}>
      {summaryStates.map(state => {
        const count = members(state).length;
        const label = t('summaryEntry', { count, state: t(state) });
        return (
          <button
            key={state}
            className="summary-entry"
            aria-label={label}
            data-hint={label}
            ref={button => {
              if (button) triggers.current.set(state, button);
              else triggers.current.delete(state);
            }}
            disabled={!count}
            aria-expanded={open === state}
            aria-controls={open === state ? id : undefined}
            aria-haspopup="dialog"
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (open !== state) openList(state, event.key === 'ArrowUp');
              }
            }}
            onClick={() => (open === state ? setOpen(undefined) : openList(state))}
          >
            <ProcessingStatusIcon state={state} />
            <span>
              {count}
              <span className="summary-name"> {t(state)}</span>
            </span>
          </button>
        );
      })}
      {open && (
        <section
          ref={popup => {
            list.current = popup;
            if (popup) placeList(popup);
          }}
          id={id}
          className="summary-list"
          role="dialog"
          aria-label={t(open)}
          onFocus={event => {
            focusedRun.current = event.target.closest<HTMLElement>('[data-run-id]')?.dataset.runId;
          }}
          onBlur={event => {
            if (event.relatedTarget) focusedRun.current = undefined;
          }}
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const members = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('li button')];
            if (!members.length) return;
            const index = members.findIndex(member => member === document.activeElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? members.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + members.length) % members.length;
            event.preventDefault();
            members[next].focus();
            members[next].scrollIntoView({ block: 'nearest' });
          }}
        >
          <header>
            <strong>{t(open)}</strong>
            <button aria-label={t('closePanelList')} onClick={() => close(true)}>
              ×
            </button>
          </header>
          <ul>
            {members(open).map(panel => {
              const title = panel.run?.title ?? t('untitled');
              return (
                <li key={panel.run?.id} data-run-id={panel.run?.id}>
                  <button
                    className={`summary-panel ${panel.agent}`}
                    data-hint={t('agentPanelTitle', { agent: agentNames[panel.agent], title })}
                    onClick={() => {
                      setOpen(undefined);
                      locate(panel);
                    }}
                  >
                    <span className="agent-mark" aria-hidden="true">
                      {agentIcons[panel.agent]}
                    </span>
                    <span className="session-title">{title}</span>
                    <small>{agentNames[panel.agent]}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          {!members(open).length && <p className="muted">{t('noMatchingPanels')}</p>}
        </section>
      )}
    </div>
  );
}
