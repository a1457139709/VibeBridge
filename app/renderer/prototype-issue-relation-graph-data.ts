import type { IssueDetail, IssueReference, PullRequestDetail, PullRequestReference } from '../shared/forge/forge';
import type { DetailItem } from '../shared/forge/sidebar-data';
import type { DispatchRecordView } from '../shared/dispatch';
import type { AgentType } from '../shared/model';

export type TimedPull = PullRequestReference & {
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: string | null;
};
export type SubIssue = IssueReference & { blockedBy: IssueReference[] };
export type FocusIssue = Omit<IssueDetail, 'closingPullRequests' | 'subIssues'> & {
  closedAt: string | null;
  closingPullRequests: TimedPull[];
  subIssues: SubIssue[];
};

export type Loaded =
  | { kind: 'issue'; repo: string; issue: FocusIssue }
  | { kind: 'pullRequest'; repo: string; pullRequest: PullRequestDetail };

export async function loadItem(item: DetailItem): Promise<Loaded> {
  const response = await fetch(`/proto-api/${item.kind}/${item.number}`);
  if (!response.ok) throw new Error(await response.text());
  const loaded: Loaded = await response.json();
  return loaded;
}

const plan: { agent: AgentType; skill: string }[][] = [
  [
    { agent: 'claude', skill: 'to-prd' },
    { agent: 'codex', skill: 'tdd' },
    { agent: 'claude', skill: 'code-review' },
  ],
  [
    { agent: 'pi', skill: 'diagnosing-bugs' },
    { agent: 'claude', skill: 'tdd' },
  ],
  [
    { agent: 'codex', skill: 'prototype' },
    { agent: 'claude', skill: 'tdd' },
    { agent: 'codex', skill: 'tdd' },
    { agent: 'pi', skill: 'code-review' },
  ],
];

export function fakeDispatchRecords(issue: FocusIssue): DispatchRecordView[] {
  const steps = plan[issue.number % plan.length];
  const start = new Date(issue.createdAt).getTime();
  const end = issue.closedAt ? new Date(issue.closedAt).getTime() : Date.now();
  return steps.map((step, index) => ({
    issueNumber: issue.number,
    dispatchedAt: new Date(start + ((end - start) * (index + 0.6)) / (steps.length + 0.4)).toISOString(),
    agent: step.agent,
    skill: step.skill,
    sessionId: `${(issue.number * 7919 + index * 104729).toString(16).padStart(8, '0')}-fake-session`,
    location: index === steps.length - 1 ? { projectId: 'p1', panelId: `panel-${index}` } : null,
  }));
}

export function fakeOpenState(issue: FocusIssue): FocusIssue {
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3600_000).toISOString();
  const reopen = <T extends { state: string; closedAs: unknown }>(item: T) => ({
    ...item,
    state: 'open' as const,
    closedAs: null,
  });
  const reopened = new Set(issue.subIssues.slice(-Math.ceil(issue.subIssues.length / 2)).map(item => item.number));
  return {
    ...issue,
    title: `（编造：模拟打开）${issue.title}`,
    state: 'open',
    closedAs: null,
    closedAt: null,
    blockedBy: issue.blockedBy.map((item, index) => (index === 0 ? reopen(item) : item)),
    blocking: issue.blocking.map(reopen),
    subIssues: issue.subIssues.map(item =>
      reopened.has(item.number)
        ? {
            ...reopen(item),
            blockedBy: item.blockedBy.map(blocker => (reopened.has(blocker.number) ? reopen(blocker) : blocker)),
          }
        : item,
    ),
    subIssueProgress: {
      total: issue.subIssueProgress.total,
      closed: issue.subIssues.length - reopened.size,
    },
    closingPullRequests: [
      ...issue.closingPullRequests,
      {
        number: 9901,
        title: '（编造）open PR with checks still running',
        url: `${issue.links.pullRequestPrefix}9901`,
        state: 'open',
        checks: 'pending',
        createdAt: ago(3),
        mergedAt: null,
        closedAt: null,
        author: issue.author,
      },
      {
        number: 9902,
        title: '（编造）draft PR whose checks failed',
        url: `${issue.links.pullRequestPrefix}9902`,
        state: 'draft',
        checks: 'failed',
        createdAt: ago(1),
        mergedAt: null,
        closedAt: null,
        author: issue.author,
      },
    ],
  };
}
