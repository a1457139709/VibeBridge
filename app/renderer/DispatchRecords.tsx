import { useState, type ReactNode } from 'react';
import { useLocalization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { RelativeTime } from './ForgeDisplay';
import { agentIcons } from './agent-icons';
import { agentNames } from '../shared/model';
import { latestLocatable, type DispatchLocation, type DispatchRecordView } from '../shared/dispatch';
import './dispatch.css';

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
  if (!latest.location) {
    const target = latestLocatable(records)?.location;
    const content = <>{t('dispatched')} <RelativeTime iso={latest.dispatchedAt} />{times}</>;
    return target
      ? <button className="dispatch-status gone" data-hint={t('dispatchedGoneLocatable', details)}
        onClick={event => { event.stopPropagation(); locate(target.projectId, target.panelId); }}>{content}</button>
      : <span className="dispatch-status gone" data-hint={t('dispatchedGone', details)}>{content}</span>;
  }
  return <SessionStatus location={latest.location} locate={locate} hint={names => t('dispatchStatusHint', { ...names, ...details })}>
    {({ title }) => <><span className="dispatch-session">{title}</span>{times}</>}
  </SessionStatus>;
}

/** The panel on a dispatch's session: its processing state as an icon, then what `children` add from the state's and
 * the session title's names, as a button that locates that panel. Its name is the state and the session title. */
function SessionStatus({ location, locate, hint, children }: {
  location: DispatchLocation; locate(projectId: string, panelId: string): void;
  hint(names: SessionNames): string; children?(names: SessionNames): ReactNode;
}) {
  const { t } = useLocalization();
  const { status } = location;
  const names = { status: status ? t(status) : '', title: location.title ?? t('untitled') };
  return <button className={`dispatch-status ${status ? `status-${status}` : ''}`} aria-label={[names.status, names.title].filter(Boolean).join(' · ')}
    data-hint={hint(names)} onClick={event => { event.stopPropagation(); locate(location.projectId, location.panelId); }}>
    <ProcessingStatusIcon state={status} />{children?.(names)}
  </button>;
}
interface SessionNames { status: string; title: string }

/** An issue's Dispatch Records in its detail, newest first: when, the Agent type, the title of the session that took it,
 * which locates the panel on that session when there is one, then that panel's status, and the text sent, folded until
 * shown. A closed issue's records start folded as a whole, to their count. */
export function DispatchRecords({ records, folded, locate }: { records: DispatchRecordView[]; folded: boolean; locate(projectId: string, panelId: string): void }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(!folded);
  /** The records whose text shows, by when they were dispatched: a record's place shifts as older ones are pruned. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const heading = t('dispatchRecords', { count: records.length });
  const toggleText = (dispatchedAt: string) => setUnfolded(shown => {
    const next = new Set(shown);
    if (!next.delete(dispatchedAt)) next.add(dispatchedAt);
    return next;
  });
  return <section className="forge-box dispatch-records" aria-label={heading}>
    <header><button className="dispatch-records-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {heading}</button></header>
    {open && <ul>{records.toReversed().map(record => {
      const { location, dispatchedAt } = record;
      const textShows = unfolded.has(dispatchedAt);
      return <li key={dispatchedAt} className="dispatch-record">
        <span className="dispatch-record-when"><RelativeTime iso={dispatchedAt} /></span>
        <span className={`agent-mark ${record.agent}`} role="img" aria-label={agentNames[record.agent]}>{agentIcons[record.agent]}</span>
        {location ? <>
          <button className="dispatch-record-session" data-hint={t('locateSessionPanel')}
            onClick={() => locate(location.projectId, location.panelId)}>{location.title ?? t('untitled')}</button>
          <SessionStatus location={location} locate={locate} hint={() => t('locateSessionPanel')} />
        </> : <span className="dispatch-record-gone">{t('noPanelOnSession')}</span>}
        {/* Folded, the text is named by how it invokes the skill: its first word. */}
        <button className="dispatch-record-toggle" aria-expanded={textShows} onClick={() => toggleText(dispatchedAt)}>
          {textShows ? t('hideCommand') : `${record.text.split(/\s/, 1)[0]} ▸`}</button>
        {textShows && <code className="dispatch-record-text">{record.text}</code>}
      </li>;
    })}</ul>}
  </section>;
}
