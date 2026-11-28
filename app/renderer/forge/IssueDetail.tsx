import type { MouseEvent, ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueDetail, IssueReference, RepositoryReference } from '../../shared/forge/forge';
import type { ProjectView } from '../../shared/model';
import type { DispatchRecordView } from '../../shared/dispatch';
import { IssueActions, type Actions } from './DirectActions';
import { DispatchRecords, type DispatchRecordsHost } from '../dispatch/DispatchRecords';
import { IssueComments } from './IssueComments';
import { SubIssueList } from './SubIssueList';
import { OtherRelations } from './OtherRelations';
import { IssueIcon, issueDisplayState, issueStates, Label, linkedItem, Post, RelativeTime } from './ForgeDisplay';
import type { DetailItem } from '../../shared/forge/sidebar-data';

interface DocumentProps {
  project: ProjectView & { repository: RepositoryReference };
  issue: IssueDetail;
  open(item: DetailItem): void;
  followLink(event: MouseEvent): void;
  actions: Actions;
  dispatch: IssueDispatch;
}

export interface IssueDispatch {
  button: ReactNode;
  records: DispatchRecordView[];
  host: DispatchRecordsHost;
}

export function IssueDocument({ project, issue, open, followLink, actions, dispatch }: DocumentProps) {
  const { t } = useLocalization();
  const { capabilities } = project;
  const openReference = (reference: IssueReference) => {
    const item = linkedItem(reference.url, issue.links);
    if (item) open(item);
    else window.open(reference.url, '_blank');
  };
  const ownSubIssues = capabilities.subIssues && !!issue.subIssues.length;
  const parent = capabilities.subIssues && !ownSubIssues && issue.parent?.subIssues.length ? issue.parent : null;
  return (
    <div className="forge-doc" onClick={followLink}>
      <h2>
        {issue.title} <span className="forge-row-number">#{issue.number}</span>
      </h2>
      <div className="forge-doc-head">
        <StatePill issue={issue} />
        {issue.labels.map(label => (
          <Label key={label.name} label={label} />
        ))}
        <span className="forge-spacer" />
        {issue.state === 'open' && dispatch.button}
      </div>
      <div className="forge-doc-meta">
        <b>{issue.author ?? t('deletedAccount')}</b> {t('issueOpened')} <RelativeTime iso={issue.createdAt} />
        {' · '}
        {issue.commentCount === 1 ? t('oneComment') : t('commentCount', { count: issue.commentCount })}
        {!!issue.assignees.length && (
          <>
            {' · '}
            {t('assigneeList', { names: issue.assignees.join(', ') })}
          </>
        )}
      </div>
      {!!dispatch.records.length && (
        <DispatchRecords key={issue.number} records={dispatch.records} host={dispatch.host} />
      )}
      {ownSubIssues && (
        <SubIssueList
          key={`${issue.number} ${issue.state}`}
          owner={issue}
          subIssues={issue.subIssues}
          progress={issue.subIssueProgress}
          current={null}
          blocking={capabilities.blocking}
          forge={project.forge.name}
          open={openReference}
        />
      )}
      {parent && (
        <SubIssueList
          key={`${issue.number} siblings`}
          owner={parent}
          subIssues={parent.subIssues}
          progress={parent.progress}
          current={issue.number}
          blocking={capabilities.blocking}
          forge={project.forge.name}
          open={openReference}
        />
      )}
      <OtherRelations issue={issue} siblings={parent?.subIssues ?? null} blocking={capabilities.blocking} open={open} />
      <div className="forge-doc-main">
        <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
        <IssueComments key={issue.number} issue={issue} forge={project.forge.name} />
        <IssueActions issue={issue} actions={actions} />
      </div>
    </div>
  );
}

function StatePill({ issue }: { issue: IssueDetail }) {
  const { t } = useLocalization();
  const { tone, short } = issueStates[issueDisplayState(issue)];
  return (
    <span className={`forge-pill forge-bg-${tone}`}>
      <IssueIcon issue={issue} decorative />
      {t(short)}
    </span>
  );
}
