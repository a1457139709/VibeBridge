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

export interface DispatchRecordsHost {
  locate(projectId: string, panelId: string): void;
  locateBinding: string;
  report: ReportNotice;
}

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

export function LatestDispatchSkill({ records, host }: { records: DispatchRecordView[]; host: DispatchRecordsHost }) {
  const latest = records.at(-1);
  return latest ? <DispatchSkill record={latest} host={host} /> : null;
}

const shownSessionIdLength = 8;

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

export function DispatchRecords({ records, host }: { records: DispatchRecordView[]; host: DispatchRecordsHost }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const heading = t('dispatchRecords', { count: records.length });
  const shown = open ? records.toReversed() : records.slice(-1);
  return (
    <section className="forge-box dispatch-records" aria-label={heading}>
      <header>
        <button className="dispatch-records-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden>{open ? '▾' : '▸'}</span> {heading}
        </button>
      </header>
      <ul>
        {shown.map(record => (
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
    </section>
  );
}
