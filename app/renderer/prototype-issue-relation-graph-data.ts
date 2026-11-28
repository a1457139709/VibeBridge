// PROTOTYPE: every issue, pull request and dispatch record here is invented. Nothing reads GitHub.
import type {
  IssueDetail,
  IssueReference,
  IssueSummary,
  ListedIssue,
  PullRequestDetail,
  PullRequestReference,
  PullRequestSummary,
} from '../shared/forge/forge';
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

export const repoPath = 'example/workbench';
const repo = `https://github.com/${repoPath}`;
const external = 'https://github.com/example/terminal-core';
const links = { issuePrefix: `${repo}/issues/`, pullRequestPrefix: `${repo}/pull/` };
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

interface FakeIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  parent?: number;
  blockedBy?: number[];
  externalBlockers?: { number: number; title: string; state: 'open' | 'closed' }[];
  pulls?: { number: number; title: string; state: TimedPull['state']; checks: TimedPull['checks']; hours: number }[];
  dispatches?: { agent: AgentType; skill: string; hours: number; here?: boolean }[];
  labels?: string[];
  age: number;
}

const world: FakeIssue[] = [
  {
    number: 500,
    title: 'Spec：派发队列：一个面板忙时把派发排进队列',
    state: 'open',
    labels: ['spec'],
    age: 300,
    dispatches: [
      { agent: 'claude', skill: 'to-prd', hours: 280 },
      { agent: 'claude', skill: 'to-issues', hours: 260 },
    ],
  },
  {
    number: 501,
    title: '主进程保存每个面板的派发队列',
    state: 'closed',
    parent: 500,
    age: 250,
    pulls: [
      { number: 611, title: 'Dispatch queue lives in the main process', state: 'merged', checks: 'passed', hours: 200 },
    ],
    dispatches: [{ agent: 'codex', skill: 'tdd', hours: 240 }],
  },
  {
    number: 502,
    title: '队列在重开应用后恢复',
    state: 'closed',
    parent: 500,
    blockedBy: [501],
    age: 250,
    pulls: [
      { number: 615, title: 'Restore queued dispatches on launch', state: 'merged', checks: 'passed', hours: 150 },
    ],
    dispatches: [{ agent: 'claude', skill: 'tdd', hours: 170 }],
  },
  {
    number: 503,
    title: '面板本轮结束时自动取出下一条派发',
    state: 'open',
    parent: 500,
    blockedBy: [501],
    age: 250,
    externalBlockers: [{ number: 88, title: 'Turn-ended hook fires twice on resume', state: 'open' }],
    dispatches: [{ agent: 'pi', skill: 'diagnosing-bugs', hours: 30 }],
  },
  {
    number: 504,
    title: '派发菜单显示「排进队列」',
    state: 'open',
    parent: 500,
    blockedBy: [501],
    age: 250,
    pulls: [{ number: 622, title: 'Dispatch menu offers to queue', state: 'open', checks: 'failed', hours: 5 }],
    dispatches: [
      { agent: 'codex', skill: 'tdd', hours: 26 },
      { agent: 'claude', skill: 'tdd', hours: 6, here: true },
    ],
  },
  { number: 505, title: '临时面板托盘显示排队数量', state: 'open', parent: 500, blockedBy: [502], age: 250 },
  { number: 506, title: '从队列里撤回一条派发', state: 'open', parent: 500, blockedBy: [503, 504], age: 250 },
  {
    number: 507,
    title: '派发记录区分「已排队」和「已交给会话」',
    state: 'open',
    parent: 500,
    blockedBy: [504, 502],
    age: 250,
  },
  { number: 508, title: '队列的验收测试指南', state: 'open', parent: 500, blockedBy: [506, 507, 505], age: 250 },

  { number: 516, title: '设置页的搜索框在 Windows 上失焦', state: 'open', labels: ['bug'], age: 20 },

  {
    number: 520,
    title: '终端字体在高分屏上发虚',
    state: 'closed',
    labels: ['bug'],
    age: 900,
    blockedBy: [521, 522, 523, 524],
    pulls: [
      {
        number: 590,
        title: 'Use device pixel ratio for the terminal canvas',
        state: 'merged',
        checks: 'passed',
        hours: 600,
      },
    ],
    dispatches: [
      { agent: 'pi', skill: 'diagnosing-bugs', hours: 800 },
      { agent: 'claude', skill: 'tdd', hours: 700 },
      { agent: 'codex', skill: 'code-review', hours: 640 },
    ],
  },
  { number: 521, title: '升级 xterm 到 6', state: 'closed', age: 900 },
  { number: 522, title: '渲染器支持 devicePixelRatio 变化事件', state: 'closed', age: 900 },
  { number: 523, title: '字体设置读取改为异步', state: 'closed', age: 900 },
  { number: 524, title: '桌面套件加高分屏截图', state: 'closed', age: 900 },

  {
    number: 530,
    title: 'Forge 接口抽出「读取关系」一项能力',
    state: 'open',
    labels: ['refactor'],
    age: 60,
    pulls: [{ number: 631, title: 'Forge capability: relations', state: 'draft', checks: 'pending', hours: 2 }],
  },
  { number: 531, title: 'GitLab 适配器读取阻塞关系', state: 'open', blockedBy: [530], age: 50 },
  { number: 532, title: 'Gitea 适配器读取阻塞关系', state: 'open', blockedBy: [530], age: 50 },
  { number: 533, title: '列表行的阻塞标记改用能力声明', state: 'open', blockedBy: [530], age: 50 },
  { number: 534, title: 'issue 详情关系图改用能力声明', state: 'open', blockedBy: [530], age: 50 },
  { number: 535, title: '能力声明写进设置页「关于 Forge」', state: 'closed', blockedBy: [530], age: 50 },
  { number: 536, title: '能力缺失时的空状态文案', state: 'open', blockedBy: [530], age: 50 },
];

const byNumber = new Map(world.map(issue => [issue.number, issue]));
const find = (number: number) => {
  const found = byNumber.get(number);
  if (!found) throw new Error(`prototype world has no #${number}`);
  return found;
};
export const knows = (number: number) => byNumber.has(number);

const reference = (issue: FakeIssue): IssueReference => ({
  number: issue.number,
  title: issue.title,
  state: issue.state,
  closedAs: issue.state === 'closed' ? 'completed' : null,
  url: `${links.issuePrefix}${issue.number}`,
});
const blockersOf = (issue: FakeIssue): IssueReference[] => [
  ...(issue.blockedBy ?? []).map(number => reference(find(number))),
  ...(issue.externalBlockers ?? []).map(blocker => ({
    ...blocker,
    closedAs: null,
    url: `${external}/issues/${blocker.number}`,
  })),
];
const childrenOf = (number: number) => world.filter(issue => issue.parent === number);
const discussion: Record<number, [string, string][]> = {
  500: [
    ['red', '先把队列放在主进程，渲染进程只读快照。'],
    ['mika', '面板关掉时队列里的派发怎么办？直接丢弃还是转给别的面板？'],
    ['red', '先丢弃并在派发记录里标出来，转派以后再说。'],
    ['ollie', '#503 依赖 terminal-core 的「本轮结束」事件，那边 #88 还没合。'],
    ['red', '好，#503 先挂着，#504 和 #505 可以并行做。'],
  ],
  504: [
    ['mika', '菜单里「排进队列」和「立即派发」放一起会不会误点？'],
    ['red', '面板忙的时候才出现「排进队列」，空闲时不显示。'],
    ['ollie', 'PR #622 的检查挂在快照测试上，我看一下。'],
  ],
};
const commentsOf = (number: number, age: number) =>
  (discussion[number] ?? [['red', '先做主进程那部分。']]).map(([author, text], index, all) => ({
    author,
    createdAt: ago((age * (all.length - index)) / (all.length + 1)),
    html: `<p>（编造的评论）${text}</p>`,
  }));

const progressOf = (number: number) => {
  const children = childrenOf(number);
  return { closed: children.filter(child => child.state === 'closed').length, total: children.length };
};

export function fakeIssue(number: number): FocusIssue {
  const issue = find(number);
  const parent = issue.parent ? find(issue.parent) : null;
  return {
    ...reference(issue),
    createdAt: ago(issue.age),
    closedAt: issue.state === 'closed' ? ago(issue.age / 2) : null,
    labels: (issue.labels ?? []).map(name => ({
      name,
      color: name === 'bug' ? 'd73a4a' : name === 'spec' ? '5319e7' : '0e8a16',
    })),
    author: 'red',
    assignees: [],
    body: `<p>（编造的正文）${issue.title}。这里是 Forge 上 issue 的原文，用来看卡片和正文之间的分界。</p><p>验收：见子 issue 和关联的 pull request。</p>`,
    comments: commentsOf(number, issue.age),
    commentCount: commentsOf(number, issue.age).length,
    parent: parent && { ...reference(parent), progress: progressOf(parent.number) },
    subIssues: childrenOf(number).map(child => ({ ...reference(child), blockedBy: blockersOf(child) })),
    subIssueProgress: progressOf(number),
    blockedBy: blockersOf(issue),
    blocking: world.filter(other => other.blockedBy?.includes(number)).map(reference),
    closingPullRequests: (issue.pulls ?? []).map(pull => ({
      ...pull,
      url: `${links.pullRequestPrefix}${pull.number}`,
      createdAt: ago(pull.hours),
      mergedAt: pull.state === 'merged' ? ago(pull.hours / 2) : null,
      closedAt: pull.state === 'merged' || pull.state === 'closed' ? ago(pull.hours / 2) : null,
      author: 'red',
    })),
    links,
    canWrite: true,
  };
}

export function fakeDispatchRecords(number: number): DispatchRecordView[] {
  return (find(number).dispatches ?? []).map((record, index) => ({
    issueNumber: number,
    dispatchedAt: ago(record.hours),
    agent: record.agent,
    skill: record.skill,
    sessionId: `${(number * 7919 + index * 104729).toString(16).padStart(8, '0')}-fake-session`,
    location: record.here ? { projectId: 'p1', panelId: `panel-${index}` } : null,
  }));
}

const summaryOf = (issue: FakeIssue): IssueSummary => ({
  number: issue.number,
  title: issue.title,
  state: issue.state,
  closedAs: issue.state === 'closed' ? 'completed' : null,
  createdAt: ago(issue.age),
  labels: fakeIssue(issue.number).labels,
  blockedBy: blockersOf(issue)
    .filter(blocker => blocker.state === 'open')
    .map(blocker => ({
      path: blocker.url.includes(repoPath) ? null : 'example/terminal-core',
      number: blocker.number,
      title: blocker.title,
    })),
  unlistedBlockers: 0,
});

export function fakeListedIssues(state: 'open' | 'closed'): ListedIssue[] {
  return world
    .filter(issue => issue.state === state)
    .toSorted((a, b) => b.number - a.number)
    .map(issue => {
      const children = childrenOf(issue.number);
      return {
        ...summaryOf(issue),
        url: `${links.issuePrefix}${issue.number}`,
        parent: issue.parent ?? null,
        subIssues: { ...progressOf(issue.number), issues: children.map(summaryOf), unlisted: 0 },
      };
    });
}

const allPulls = () => world.flatMap(issue => (issue.pulls ?? []).map(pull => ({ ...pull, issue })));

export function fakePullRequests(state: 'open' | 'closed'): PullRequestSummary[] {
  return allPulls()
    .filter(pull => (state === 'open') === (pull.state === 'open' || pull.state === 'draft'))
    .toSorted((a, b) => b.number - a.number)
    .map(pull => ({
      number: pull.number,
      title: pull.title,
      state: pull.state,
      createdAt: ago(pull.hours),
      author: 'red',
      checks: pull.checks,
      labels: [],
    }));
}

export function fakePullRequestDetail(number: number): PullRequestDetail | null {
  const pull = allPulls().find(item => item.number === number);
  if (!pull) return null;
  return {
    number,
    title: pull.title,
    state: pull.state,
    createdAt: ago(pull.hours),
    author: 'red',
    labels: [],
    url: `${links.pullRequestPrefix}${number}`,
    changesUrl: `${links.pullRequestPrefix}${number}/files`,
    head: `issue-${pull.issue.number}`,
    base: 'main',
    body: `<p>（编造的 PR 正文）Closes #${pull.issue.number}</p>`,
    timeline: [],
    earlierEntries: 0,
    closingIssues: [reference(pull.issue)],
    links,
    reviewDecision: null,
    checks: { state: null, counts: [], total: 0, url: `${links.pullRequestPrefix}${number}/checks`, listed: [] },
    mergeState: pull.state === 'open' ? (pull.checks === 'failed' ? 'unstable' : 'clean') : null,
    mergeOptions: { methods: ['merge', 'squash', 'rebase'], defaultMethod: 'squash', queue: false },
    canWrite: true,
  };
}

export function fakeDispatchesForProject(
  projectId: string,
  panelOf: (agent: AgentType) => string | null,
): DispatchRecordView[] {
  return world.flatMap(issue =>
    (issue.dispatches ?? []).map((record, index) => {
      const panelId = record.here ? panelOf(record.agent) : null;
      return {
        issueNumber: issue.number,
        dispatchedAt: ago(record.hours),
        agent: record.agent,
        skill: record.skill,
        sessionId: `${(issue.number * 7919 + index * 104729).toString(16).padStart(8, '0')}-fake-session`,
        location: panelId ? { projectId, panelId } : null,
      };
    }),
  );
}
