// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// #160: an English preview of the prototype. The prototype's strings are hard-coded Chinese, so this swaps text nodes and
// title / placeholder / aria-label attributes in the rendered DOM. Repository data (issue titles, bodies) and fake terminal output stay as they are.

const exact: Record<string, string> = {
  '项目': 'Projects', '添加项目': 'Add project', '本地工作台': 'Local workbench', '设置': 'Settings', '临时': 'Ephemeral',
  '就绪': 'Ready', '处理中': 'Working', '等待输入': 'Needs input', '本轮结束': 'Turn done', '异常': 'Error',
  '常驻': 'Resident', '临时 · 临时放大': 'Ephemeral · temporary maximize', '没有面板': 'No panels', '没有临时面板': 'No ephemeral panels',
  '临时面板托盘': 'Ephemeral panel tray', '新建临时面板并直接打开': 'New ephemeral panel, opened at once',
  '放大面板': 'Maximize panel', '关闭面板（Agent 退出）': 'Close panel (Agent exits)', '关闭（等同 Agent 退出）': 'Close (Agent exits)',
  '还原': 'Restore', '收起，回到托盘（Esc 留给终端）': 'Collapse back to the tray (Esc stays with the terminal)',
  '回复后按 Enter': 'Reply, then press Enter', '处理中，按 Esc 中断': 'Working — Esc interrupts', '输入给 Agent…': 'Message the Agent…',
  '布局为空：从托盘拖一个面板上来': 'Layout is empty: drag a panel up from the tray', '松手放进布局': 'Drop into the layout',
  '松手放回托盘，成为临时面板': 'Drop on the tray to make it ephemeral', '放到这一侧，成为常驻面板': 'Drop on this side to make it resident',
  '移到这一侧': 'Move to this side', '左侧': 'left', '右侧': 'right', '上方': 'top', '下方': 'bottom',
  '展开项目导航': 'Show project navigation', '收起项目导航': 'Hide project navigation', '编辑项目（仓库绑定在这里）': 'Edit project (repository binding lives here)',
  // proto bar
  '原型开关': 'Prototype switches', '合并版': 'merged', '仓库': 'Repository', '直接操作': 'Direct actions', '成功': 'Succeeds', '失败': 'Fails',
  '无写权限': 'No write access', '暂停模拟': 'Pause simulation', '继续模拟': 'Resume simulation', '隐藏原型开关条': 'Hide the prototype bar',
  '已绑定': 'Bound', '未绑定': 'Unbound', '未安装 gh': 'gh not installed', '未登录': 'Logged out', '无法访问': 'No access', '暂时失败': 'Temporarily failing',
  '覆盖': 'Overlay', '挤压': 'Push', '语言': 'Language',
  // sidebar
  '侧边栏（⌘⌥B）': 'Sidebar (⌘⌥B)', '刷新': 'Refresh', '未绑定仓库': 'No repository bound', '搜索标题，或输入 #编号': 'Search titles, or type #number',
  '开放': 'Open', '已关闭': 'Closed', '标签': 'Labels', '清除': 'Clear', '点标签移除': 'Click a label to remove it',
  '没有符合条件的 issue': 'No matching issues', '没有符合条件的 PR': 'No matching pull requests', '子 issue': 'Sub-issues',
  '展开子 issue': 'Show sub-issues', '收起子 issue': 'Hide sub-issues', '收起已关闭': 'Hide closed',
  '这个项目还没有绑定 GitHub 仓库。': 'This project has no GitHub repository bound.', '绑定仓库': 'Bind repository',
  '安装 GitHub CLI 后才能使用侧边栏。': 'Install the GitHub CLI to use the sidebar.', '安装说明 ↗': 'Install guide ↗',
  '未登录或登录已失效。': 'Not logged in, or the login expired.', '复制 gh auth login': 'Copy gh auth login', '重试': 'Retry',
  '数据可能已过期（网络或限流）': 'Data may be stale (network or rate limit)', '载入中…': 'Loading…', '读取 issue…': 'Loading issues…',
  '修改绑定': 'Change binding', '刚刚': 'just now',
  // dispatch
  '派发 ▾': 'Dispatch ▾', '提交': 'Submit', '只填入': 'Fill only', '选择指令和目标（⌘D）': 'Pick a command and target (⌘D)',
  '（⌥ 反转）': '(⌥ flips)', '↑↓ 移动 · ← 进入 · → 退回 · Space 执行 · ⌥ 反转 · Esc 关闭': '↑↓ move · ← in · → back · Space runs · ⌥ flips · Esc closes',
  '没有开启的工作流，可在 设置 › 工作流 中开启': 'No workflows enabled. Turn one on in Settings › Workflows',
  '已派发 · ': 'Dispatched · ', '（点击定位面板，⌘L）': '(click to locate the panel, ⌘L)', '定位到正处在这个会话上的面板': 'Locate the panel on this session',
  '没有面板处在这个会话上': 'No panel is on this session', '派发去的会话已不在任何打开的面板上': 'The dispatched session is no longer on any open panel',
  '收起指令': 'Hide command', '上次': 'last',
  // detail
  '详情': 'Detail', '返回上一个': 'Back', '在 GitHub 打开 ↗': 'Open on GitHub ↗', '收起（→ 或 Esc）': 'Close (→ or Esc)', '拖动调整宽度': 'Drag to resize',
  '拖动调整宽度（300–560px）': 'Drag to resize (300–560px)', '不在快照里': 'not in the snapshot', '没有描述。': 'No description.',
  '关闭 issue': 'Close issue', '重新打开 issue': 'Reopen issue', '关闭为已完成': 'Close as completed', '关闭为不做（not planned）': 'Close as not planned',
  '处理中…': 'Working…', '（原型：没有写权限时这里不显示任何按钮）': '(Prototype: with no write access, no buttons show here)',
  '（原型：不会真的改动 GitHub，真实实现会触发一次刷新）': '(Prototype: GitHub is not really changed; the real app refreshes once)',
  '（原型：不会真的合并，真实实现会触发一次刷新）': '(Prototype: nothing is really merged; the real app refreshes once)',
  '被阻塞于': 'Blocked by', '阻塞了': 'Blocking', '已完成': 'Completed', '不做': 'Not planned', '已合并': 'Merged', '草稿': 'Draft',
  '合并后关闭本 issue 的 PR': 'PRs that close this issue on merge', '本 issue': 'this issue',
  '检查': 'Checks', '检查通过': 'Checks passed', '检查失败': 'Checks failed', '检查中': 'Checks running', '没有检查': 'No checks', '收起通过的检查': 'Hide passing checks',
  '已批准': 'Approved', '需要修改': 'Changes requested', '待 review': 'Review pending', '已评论': 'Commented', '不要求 review': 'No review required',
  '有冲突': 'conflicts', '必需的检查没通过': 'required checks failing', '没有冲突': 'No conflicts', '合并': 'Merge', '合并中…': 'Merging…', '创建合并提交': 'Create a merge commit',
  '压缩合并': 'Squash and merge', '变基合并': 'Rebase and merge', '关闭 PR': 'Close PR', '重新打开': 'Reopen', '日志 ↗': 'Log ↗',
  '在 GitHub 查看 ↗': 'View on GitHub ↗', '在 GitHub 查看改动 ↗': 'View changes on GitHub ↗', '已跳过': 'Skipped', '必需': 'Required', '没通过': 'Failed',
  '还在运行': 'Still running', '这是草稿': 'This is a draft', '有人要求修改': 'Changes were requested',
  '有人要求修改，需要重新 review': 'Changes were requested; needs another review', '有冲突，需要先解决': 'has conflicts; resolve them first', '和': 'Conflicts with', '冲突': 'Conflicts', '想把': 'wants to merge', '合并进': 'into',
  '合并后关闭': 'Closes on merge', '条代码评论': 'code comments', '实现派发级联菜单。': 'Implement the cascading dispatch menu.',
  '派发菜单的 Space 执行和 ⌥ 反转还没处理，见代码评论。': 'Space to run and ⌥ to flip in the dispatch menu are not handled yet; see the code comments.',
  '已关闭，没有合并': 'Closed without merging', '标记为可以 review 之后才能合并（在 GitHub 上操作）': 'Mark it ready for review before merging (on GitHub)',
  '不能合并：': 'Cannot merge: ', '没有权限。': 'No permission.', '仓库要求通过 merge queue 合并，': 'This repository merges through a merge queue; ',
  // settings
  '通用': 'General', '工作流': 'Workflows', '外观': 'Appearance', '快捷键': 'Shortcuts', '（现有设置，原型不展开。）': '(Existing settings, not shown in the prototype.)',
  '工作流由工作台内置。派发菜单只列出已开启工作流的指令；派发时按住 ⌥ 只反转这一次的「提交 / 只填入」。':
    'Workflows are built into the workbench. The dispatch menu lists only commands of enabled workflows; hold ⌥ while dispatching to flip Submit / Fill only for that one time.',
  'Matt 的流程': "Matt's workflow", '已开启': 'On', '已关闭 ': 'Off', '（默认布局等现有设置略。）': '(Existing settings such as the default layout are omitted.)',
  '打开 GitHub 侧边栏时': 'When the GitHub sidebar opens', '打开 issue / PR 详情时': 'When an issue / PR detail opens',
  '（默认）：布局区域变窄，面板跟着重新排布。': ' (default): the layout area narrows and panels re-flow.',
  '：侧边栏盖在布局区域右侧，面板尺寸不变；工作区工具栏和托盘让出位置。': ': the sidebar covers the right of the layout area and panels keep their size; the workspace toolbar and tray make room.',
  '（默认）：详情盖在布局区域上，面板尺寸不变。': ' (default): the detail covers the layout area and panels keep their size.',
  '：布局区域再让出详情的宽度，面板跟着重新排布；关掉详情后恢复。': ': the layout area also gives up the detail\'s width and panels re-flow; closing the detail restores it.',
  '不论选哪种，详情都只占工作区工具栏和托盘之间。': 'Either way, the detail sits only between the workspace toolbar and the tray.',
  '聚焦上一个 / 下一个面板': 'Focus previous / next panel', '现有': 'existing', '开关 GitHub 侧边栏': 'Toggle the GitHub sidebar', '新增 · 任何时候': 'new · any time',
  '打开派发菜单': 'Open the dispatch menu', '新增 · 焦点在侧边栏且选中了 issue': 'new · focus in the sidebar with an issue selected',
  '定位派发的面板': 'Locate the dispatched panel', '新增 · 同上': 'new · same as above',
  '编辑项目': 'Edit project', '名称': 'Name', '目录': 'Directory', '搜索仓库': 'Search repositories', '当前': 'current', '取消': 'Cancel', '保存': 'Save',
  '修改': 'Change', '解绑': 'Unbind', '列表来自 gh 当前账号自己的、作为协作者的、所在组织的仓库。': "Lists repositories the active gh account owns, collaborates on, or sees through its organizations.",
  '，安装后才能绑定。': '; install it to bind a repository.', '没有找到 ': 'Could not find ', '后重试。': ', then retry.',
  '未登录。在终端运行 ': 'logged out. Run ', '？旧仓库的派发记录会隐藏但保留。': '? Dispatch records for the old repository are hidden but kept.', '？派发记录保留。': '? Dispatch records are kept.',
  '焦点面板：': 'focused: ', '侧边栏': 'sidebar ', '· 详情': '· detail ', '· 放大：': '· maximized:', '· 焦点面板：': '· focused:',
  '派发记录 (': 'Dispatch records (', '＋': '+',
  // fake session titles
  '日常：VibeBridge 主线': 'Daily: VibeBridge main', '评审 PR：Shift+Enter 换行': 'Review PR: Shift+Enter newline', '周报草稿': 'Weekly report draft',
  '原型：临时面板呈现': 'Prototype: ephemeral panels', '研究 xterm 滚动性能': 'Research xterm scroll performance', 'grill：底栏汇总位置': 'grill: summary bar position',
  '修复 IME 组合偏移': 'Fix IME composition offset', '研究 gh 限额': 'Research gh rate limits', '查 Electron 44 变更': 'Check Electron 44 changes',
  '补测试：撤回新增面板': 'Add tests: undo adding a panel', '未命名任务': 'Untitled task',
  '临时 ·': 'Ephemeral ·', '已派发 ·': 'Dispatched ·', '被': 'Blocked by', '阻塞': '', '放大：': 'maximized: ', '用户按了 Esc（Esc 交给 CLI，不收起面板）': 'User pressed Esc (Esc goes to the CLI; the panel stays)',
};

const rules: [RegExp, (...m: string[]) => string][] = [
  [/^PROTOTYPE · 合并版$/, () => 'PROTOTYPE · merged'], [/^(收起|打开) GitHub 侧边栏（⌘⌥B）$/, a => `${a === '收起' ? 'Hide' : 'Show'} the GitHub sidebar (⌘⌥B)`],
  [/^([#\d、]+)$/, x => x.replace(/、/g, ', ')],
  [/^(就绪|处理中|等待输入|本轮结束|异常) · (.+)$/, (a, b) => `${exact[a]} · ${tr(b)}`],
  [/^子 issue：(\d+) \/ (\d+) 已关闭$/, (a, b) => `Sub-issues: ${a} / ${b} closed`],
  [/^([\s\S]*)（点击定位面板，⌘L）$/, a => `${a.replace(/→ (.+)$/, (_m, t) => `→ ${tr(t)}`)} (click to locate the panel, ⌘L)`],
  [/^(Claude Code|Codex|pi) · (.+)$/, (a, b) => `${a} · ${tr(b)}`],
  [/^(\d+ 项(?:失败|进行中|通过)(?:，\d+ 项(?:失败|进行中|通过))*)$/, x => x.split('，').map(p => p.replace(/(\d+) 项失败/, '$1 failed').replace(/(\d+) 项进行中/, '$1 running').replace(/(\d+) 项通过/, '$1 passed')).join(', ')],
  [/^不能合并：(.+)$/, x => `Cannot merge: ${x.split('、').map(tr).join(', ')}`],
  [/^(.+、.+)$/, x => x.split('、').every(p => tr(p) !== p) ? x.split('、').map(tr).join(', ') : x],
  [/^(\d+) 分钟前$/, n => `${n}m ago`], [/^(\d+) 小时前$/, n => `${n}h ago`], [/^(\d+) 天前$/, n => `${n}d ago`],
  [/^已关闭 (\d+) 个$/, n => `${n} closed`], [/^临时 · (\d+)$/, n => `Ephemeral · ${n}`], [/^派发记录 \((\d+)\)$/, n => `Dispatch records (${n})`],
  [/^新建 · (.+)$/, a => `New · ${a}`], [/^被 (.+) 阻塞$/, x => `Blocked by ${x.replace(/、/g, ', ')}`], [/^已派发 · (.+)$/, t => `Dispatched · ${t}`],
  [/^(\d+) 个$/, n => `${n}`], [/^(\d+) 项通过 ▸$/, n => `${n} passed ▸`], [/^(\d+) 项通过$/, n => `${n} passed`], [/^(\d+) 项失败$/, n => `${n} failed`],
  [/^(\d+) 项进行中$/, n => `${n} running`], [/^(\d+) 条指令 · 每条都用 issue 的$/, n => `${n} commands · each takes the issue's`],
  [/^作参数$/, () => 'as argument'], [/^与「(.+)」交换$/, t => `Swap with “${t}”`], [/^占满布局区域的(.*)$/, s => `Fill the layout area's ${exact[s] ?? s}`],
  [/^侧边栏(覆盖|挤压) · 详情(覆盖|挤压) · 放大：/, (a, b) => `sidebar ${exact[a]} · detail ${exact[b]} · maximized: `],
  [/^(.+)失败：HTTP 502（GitHub 暂时不可用）$/, a => `${tr(a)} failed: HTTP 502 (GitHub temporarily unavailable)`],
  [/^已(.+)（原型：不会真的改动 GitHub，真实实现会触发一次刷新）$/, a => `${tr(a)} (Prototype: GitHub is not really changed; the real app refreshes once)`],
  [/^把绑定从 (.+) 改为 (.+)？旧仓库的派发记录会隐藏但保留。$/, (a, b) => `Change the binding from ${a} to ${b}? Dispatch records for the old repository are hidden but kept.`],
  [/^解绑 (.+)？派发记录保留。$/, a => `Unbind ${a}? Dispatch records are kept.`],
  [/^(\d+) (就绪|处理中|等待输入|本轮结束|异常)$/, (n, s) => `${n} ${exact[s]}`],
  [/^(\d+) 个(就绪|处理中|等待输入|本轮结束|异常)$/, (n, s) => `${n} ${exact[s]}`],
];

export function tr(text: string): string {
  const core = text.trim();
  if (!core || !/[　-〿一-鿿＀-￯]/.test(core)) return text;
  let out = exact[core];
  if (out === undefined) for (const [re, f] of rules) { const m = core.match(re); if (m) { out = f(...m.slice(1)); break; } }
  if (out === undefined) return text;
  return text.slice(0, text.indexOf(core)) + out + text.slice(text.indexOf(core) + core.length);
}

const skip = '.proto-term, .gh-markdown, .wb-record-text, code, pre';
const attrs = ['title', 'placeholder', 'aria-label'];

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { const el = root.parentElement; if (el && !el.closest(skip)) { const t = tr(root.nodeValue ?? ''); if (t !== root.nodeValue) root.nodeValue = t; } return; }
  if (!(root instanceof Element)) return;
  if (root.closest(skip)) return;
  for (const a of attrs) { const v = root.getAttribute(a); if (v) { const t = tr(v); if (t !== v) root.setAttribute(a, t); } }
  for (const c of Array.from(root.childNodes)) walk(c);
}

/** Starts translating the page in place; returns a stop function. Reload the page to get Chinese back. */
export function translatePage(): () => void {
  walk(document.body);
  const observer = new MutationObserver(list => {
    observer.disconnect();
    for (const m of list) { if (m.type === 'characterData' || m.type === 'attributes') walk(m.target); else m.addedNodes.forEach(walk); }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrs });
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrs });
  return () => observer.disconnect();
}
