import { useLocalization } from '../common/Localization';
import { useCallback, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { agentNames, type PanelView } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';
import { agentIcons } from '../common/agent-icons';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { useWindowEvent } from '../common/window-events';
import { useDocumentEvent } from '../common/document-events';

const summaryStates = ['ready', 'needs-input', 'done', 'error'] as const satisfies readonly ProcessingState[];
type SummaryState = (typeof summaryStates)[number];

export function ProjectSummary({ panels, locate }: { panels: PanelView[]; locate(panel: PanelView): void }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState<SummaryState>();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<SummaryState, HTMLButtonElement>());
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
    flushSync(() => setOpen(state));
    const members = list.current?.querySelectorAll<HTMLButtonElement>('li button');
    members?.[fromEnd ? members.length - 1 : 0]?.focus();
  }
  const keepFocusInList = useCallback((member: HTMLButtonElement) => {
    return () => {
      if (document.activeElement !== member) return;
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return;
        (
          list.current?.querySelector<HTMLButtonElement>('li button') ??
          list.current?.querySelector<HTMLButtonElement>('header button')
        )?.focus();
      });
    };
  }, []);
  useWindowEvent('resize', () => {
    if (list.current) placeList(list.current);
  });
  useDocumentEvent('pointerdown', event => {
    const target = event.target instanceof Node ? event.target : null;
    if (
      open &&
      !list.current?.contains(target) &&
      ![...triggers.current.values()].some(button => button.contains(target))
    )
      close();
  });
  useDocumentEvent('keydown', event => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
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
                    ref={keepFocusInList}
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
