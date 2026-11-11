import type { IssueReference, IssueSummary } from '../shared/code-hosting';
import { useLocalization } from './Localization';

/** GitHub's blocked octicon and the blockers' numbers, with how many more there are; hovering names them. */
export function BlockedMark({ blockers, more }: { blockers: IssueReference[]; more: number }) {
  const { t } = useLocalization();
  const numbers = [...blockers.map(blocker => `#${blocker.number}`), ...(more ? [`+${more}`] : [])].join(', ');
  return <span className="issue-blocked" role="img" aria-label={t('blockedBy', { numbers })}
    title={[...blockers.map(blocker => `#${blocker.number} ${blocker.title}`), ...(more ? [t('moreBlockers', { count: more })] : [])].join('\n')}>
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4.467.22a.749.749 0 0 1 .53-.22h6.006c.199 0 .389.079.53.22l4.247 4.247c.141.14.22.331.22.53v6.006a.749.749 0 0 1-.22.53l-4.247 4.247a.749.749 0 0 1-.53.22H4.997a.749.749 0 0 1-.53-.22L.22 11.533a.749.749 0 0 1-.22-.53V4.997c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.308v5.384l3.807 3.808h5.384l3.808-3.808V5.308L10.692 1.5ZM4 7.75A.75.75 0 0 1 4.75 7h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 7.75Z" /></svg>
    <span aria-hidden="true">{numbers}</span>
  </span>;
}

// GitHub's own octicons: issue-opened, issue-closed and skip.
const stateIcons = {
  open: ['M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z'],
  completed: ['M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z', 'M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z'],
  skipped: ['M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z'],
};

export function IssueStateIcon({ issue }: { issue: Pick<IssueSummary, 'state' | 'closedAs'> }) {
  const { t } = useLocalization();
  const [icon, name] = issue.state === 'open' ? ['open', t('issueOpen')] as const
    : issue.closedAs === 'notPlanned' ? ['skipped', t('issueNotPlanned')] as const
    : issue.closedAs === 'duplicate' ? ['skipped', t('issueDuplicate')] as const
    : issue.closedAs === 'completed' ? ['completed', t('issueCompleted')] as const
    : ['completed', t('issueClosed')] as const;
  return <svg className={`issue-state issue-state-${icon}`} role="img" aria-label={name} viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    {stateIcons[icon].map(path => <path key={path} d={path} />)}
  </svg>;
}
