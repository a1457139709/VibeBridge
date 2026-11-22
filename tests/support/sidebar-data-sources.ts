import { fromPartial } from '@total-typescript/shoehorn';
import { ForgeSidebarData } from '../../app/main/forge/forge-sidebar-data';
import type { ForgeSidebarSources } from '../../app/main/forge/sidebar-reads';
import type {
  IssueDetail,
  IssueDetailResult,
  IssuePage,
  IssuesByNumber,
  ListQuery,
  ListedIssue,
} from '../../app/shared/forge/forge';
import type { DetailItem, ForgeLists, ForgeSidebarEvent, ShownDetail } from '../../app/shared/forge/sidebar-data';
import { openNoFilter } from './bound-workbench';
import { lastOf } from './expected';

export const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
export const issue = (number: number): ListedIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  labels: [],
  blockedBy: [],
  unlistedBlockers: 0,
  parent: null,
  subIssues: { closed: 0, total: 0, issues: [] },
});
/** An issue's detail as the forge answers it, titled `title`, with `extra`. */
export const detail = (
  number: number,
  title = `Issue ${number}`,
  extra: Partial<IssueDetail> = {},
): IssueDetailResult => ({
  ok: true,
  issue: fromPartial<IssueDetail>({
    number,
    title,
    state: 'open',
    closedAs: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    labels: [],
    parent: null,
    subIssues: [],
    blockedBy: [],
    ...extra,
  }),
});
export const page = (numbers: number[], cursor: string | null = null): Extract<IssuePage, { ok: true }> => ({
  ok: true,
  items: numbers.map(issue),
  nextCursor: cursor,
  labels: [],
  counts: { open: numbers.length, closed: 0 },
});
/** The forge's answer to a read of issues by number. */
export const byNumber = (items: ListedIssue[]): IssuesByNumber => ({ ok: true, items });
/** Resolves once the answers given so far are taken in: every promise callback they set off has run. */
export const answersTakenIn = () => new Promise<void>(resolve => setImmediate(resolve));

/** What any of the sources' reads resolves to. */
type SourceAnswer = {
  [Read in keyof ForgeSidebarSources]: ForgeSidebarSources[Read] extends (...args: never[]) => Promise<infer Answer>
    ? Answer
    : never;
}[keyof ForgeSidebarSources];

/** The module over sources whose every read waits until the test answers it. */
export function sidebarData() {
  const reads: {
    projectId: string;
    query?: ListQuery;
    item?: DetailItem;
    /** The numbers a read by number asks for, of `item`'s kind. */
    byNumber?: { kind: DetailItem['kind']; numbers: number[] };
    /** Resolves the read with an answer one of the sources gives: the test gives each read what the source behind it
     * returns. Method shorthand, so each read's resolver, which takes its own source's answer, is stored here. */
    answer(value: SourceAnswer): void;
    fail(error: Error): void;
  }[] = [];
  const waiting: (() => void)[] = [];
  const read = <Answer extends SourceAnswer>(
    projectId: string,
    query?: ListQuery,
    item?: DetailItem,
    byNumber?: { kind: DetailItem['kind']; numbers: number[] },
  ) =>
    new Promise<Answer>((answer, fail) => {
      // Every source shares this read; each one's type gives `Answer`, what the test answers it with.
      reads.push({ projectId, query, item, byNumber, answer: (value: Answer) => answer(value), fail });
      for (const wake of waiting.splice(0)) wake();
    });
  /** The `count`th read, once it is made. */
  const readNumber = async (count: number) => {
    while (reads.length < count) await new Promise<void>(wake => waiting.push(wake));
    return reads[count - 1];
  };
  const events: ForgeSidebarEvent[] = [];
  const data = new ForgeSidebarData({
    issuePage: read,
    pullRequestPage: read,
    issuesByNumber: (projectId, numbers) => read(projectId, undefined, undefined, { kind: 'issue', numbers }),
    pullRequestsByNumber: (projectId, numbers) =>
      read(projectId, undefined, undefined, { kind: 'pullRequest', numbers }),
    repositoryChoices: projectId => read(projectId),
    issueDetail: (projectId, number) => read(projectId, undefined, { kind: 'issue', number }),
    pullRequestDetail: (projectId, number) => read(projectId, undefined, { kind: 'pullRequest', number }),
    forge: () => forge,
    emit: event => events.push(event),
  });
  const lists = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'forgeLists' }> =>
        event.kind === 'forgeLists' && event.projectId === projectId,
    )?.lists;
  const choices = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'repositoryChoices' }> =>
        event.kind === 'repositoryChoices' && event.projectId === projectId,
    )?.choices;
  const shownDetail = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'forgeDetail' }> =>
        event.kind === 'forgeDetail' && event.projectId === projectId,
    )?.detail;
  return { data, reads, readNumber, events, lists, choices, shownDetail };
}
export const numbers = (lists: ForgeLists | undefined) => lists?.issues.loaded?.items.map(item => item.number);
/** The title of the issue the detail shows, as last pushed. */
export const detailTitle = (shown: ShownDetail | undefined) =>
  shown?.result.ok && 'issue' in shown.result ? shown.result.issue.title : undefined;

/** Shows the project's issues on the default view while the sidebar shows it in the foreground, answering the first
 * page with `numbers`. */
export async function shownIssues(
  { data, reads }: ReturnType<typeof sidebarData>,
  numbers: number[],
  projectId = 'alpha',
) {
  void data.reportPresence({ visible: true, foreground: true, projectId });
  const shown = data.showList(projectId, { tab: 'issues', filter: openNoFilter });
  lastOf(reads).answer(page(numbers));
  await shown;
}
