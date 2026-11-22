import { useState } from 'react';
import { useLocalization } from '../common/Localization';
import type { ReportNotice } from '../common/Notices';
import { RelativeTime, relativeTime } from '../forge/ForgeDisplay';
import { agentIcons } from '../common/agent-icons';
import { agentNames } from '../../shared/model';
import { displayShortcut } from '../../shared/settings/shortcuts';
import type { DispatchRecordView } from '../../shared/dispatch';
import { errorMessage } from '../../shared/caught-error';
import './dispatch.css';

/** What showing Dispatch Records needs from the sidebar around them. */
export interface DispatchRecordsHost {
  /** Locates a panel; an ephemeral one opens as its temporary maximize. */
  locate(projectId: string, panelId: string): void;
  /** The binding that locates the panel of the issue focus is on. */
  locateBinding: string;
  report: ReportNotice;
}

/** A record's skill: a link that locates the panel on its session, or grey text when no open panel is on it. The hint
 * gives its age, and how to locate the panel or that it cannot be. */
function DispatchSkill({ record, host }: { record: DispatchRecordView; host: DispatchRecordsHost }) {
  const localization = useLocalization();
  const { t } = localization;
  const { skill, location } = record;
  const age = relativeTime(record.dispatchedAt, localization);
  if (!location)
    return (
      <span className="dispatch-skill gone" data-hint={t('dispatchSkillGone', { skill, age })}>
        {skill}
      </span>
    );
  return (
    <button
      className="dispatch-skill"
      data-hint={t('dispatchSkillLocatable', { skill, age, shortcut: displayShortcut(host.locateBinding) })}
      onClick={event => {
        event.stopPropagation();
        host.locate(location.projectId, location.panelId);
      }}
    >
      {skill}
    </button>
  );
}

/** An issue's latest dispatch on its row: only its skill (docs/adr/0003-dispatch-records-point-to-sessions.md). */
export function LatestDispatchSkill({ records, host }: { records: DispatchRecordView[]; host: DispatchRecordsHost }) {
  const latest = records.at(-1);
  return latest ? <DispatchSkill record={latest} host={host} /> : null;
}

/** How much of a session ID a record shows. */
const shownSessionIdLength = 8;

/** A session ID's first characters; clicking copies the whole ID, which the hint gives. */
function SessionId({ id, report }: { id: string; report: ReportNotice }) {
  const { t } = useLocalization();
  return (
    <button
      className="dispatch-session-id"
      aria-label={t('copySessionId', { id })}
      data-hint={id}
      onClick={() =>
        void navigator.clipboard.writeText(id).then(
          () => report(t('sessionIdCopied'), 'success'),
          error => report(errorMessage(error)),
        )
      }
    >
      {id.slice(0, shownSessionIdLength)}
    </button>
  );
}

/** An issue's Dispatch Records in its detail, newest first, one line each: when, the Agent type, the skill, and the
 * session ID once the session is known. A closed issue's records start folded as a whole, to their count. */
export function DispatchRecords({
  records,
  startFolded,
  host,
}: {
  records: DispatchRecordView[];
  startFolded: boolean;
  host: DispatchRecordsHost;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(!startFolded);
  const heading = t('dispatchRecords', { count: records.length });
  return (
    <section className="forge-box dispatch-records" aria-label={heading}>
      <header>
        <button className="dispatch-records-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden>{open ? '▾' : '▸'}</span> {heading}
        </button>
      </header>
      {open && (
        <ul>
          {records.toReversed().map(record => (
            <li key={`${record.dispatchedAt} ${record.sessionId}`} className="dispatch-record">
              <span className="dispatch-record-when">
                <RelativeTime iso={record.dispatchedAt} />
              </span>
              <span className={`agent-mark ${record.agent}`} role="img" aria-label={agentNames[record.agent]}>
                {agentIcons[record.agent]}
              </span>
              <DispatchSkill record={record} host={host} />
              {record.sessionId && <SessionId id={record.sessionId} report={host.report} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
