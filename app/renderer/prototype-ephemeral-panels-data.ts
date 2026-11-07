// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
import type { ProcessingState } from '../shared/processing-status';
import type { Tree } from './prototype-ephemeral-panels-layout';

export type Agent = 'claude' | 'codex' | 'pi';
export interface Pane { id: string; agent: Agent; title: string; status: ProcessingState; lines: string[]; question?: string; remaining: number; next: ProcessingState; tick: number; draft?: string; draftKey?: number }
export const statusName: Record<ProcessingState, string> = { ready: '就绪', busy: '处理中', 'needs-input': '等待输入', done: '本轮结束', error: '异常' };
export const agentName: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'pi' };

// ---- fake terminal output ---------------------------------------------------------------------------------
export const files = ['app/renderer/Workspace.tsx', 'app/shared/model.ts', 'app/shared/layout.ts', 'app/renderer/panel-location.ts', 'app/main/workbench.ts', 'tests/workspace.test.tsx', 'plans/GLOSSARY.md', 'app/renderer/ProjectSummary.tsx'];
export const prose = [
  '先看一下现有的布局插入逻辑，确认新增面板时会切开哪个区域。',
  '这里的面积比较只看相对尺寸，与焦点无关，所以当前正在用的面板经常被选中。',
  '我会把改动限制在渲染层，不碰布局树的持久化格式。',
  '测试覆盖了交换预览和最小尺寸，但没有覆盖临时放大时新增面板的情况。',
  '下面列出三个可选方案，并说明各自对面板位置关系的影响。',
  '确认一下词汇表里「临时放大」的定义：退出后返回原布局，不修改保存布局。',
  '这一段输出比较长，主要是逐个文件的阅读记录，可以直接跳到最后的结论。',
  '运行全部测试，确认没有引入回归。',
];
export function chunk(k: number): string[] {
  switch (k % 6) {
    case 0: return ['', `⏺ ${prose[k % prose.length]}`];
    case 1: return [`⏺ Read(${files[k % files.length]})`, `  ⎿  Read ${40 + (k * 37) % 300} lines`];
    case 2: return [`⏺ Bash(npm test -- --grep "${['layout', 'panel', 'summary', 'status'][k % 4]}")`, `  ⎿  ✓ ${100 + (k * 13) % 90} passed`, '     0 failed', `     Duration ${1 + k % 7}.${k % 10}s`];
    case 3: return [`⏺ Update(${files[(k + 3) % files.length]})`, `  ⎿  Updated with ${1 + k % 9} additions and ${k % 4} removals`,
      `      ${70 + k % 20}  -  let target = { panel: '', area: 0 };`, `      ${70 + k % 20}  +  let target = pickTarget(layout, focus);`,
      `      ${71 + k % 20}     for (const [panel, box] of boxes) {`, `      ${72 + k % 20}  +    if (panel === focus) continue;`];
    case 4: return [`⏺ Grep("${['insertIntoLayout', 'maximized', 'onRunExited', 'removePanel'][k % 4]}")`, `  ⎿  Found ${1 + k % 6} files`];
    default: return ['', `  ${prose[(k + 2) % prose.length]}`, `  ${prose[(k + 5) % prose.length]}`];
  }
}
export const log = (seed: number, topic: string, count: number) => [`╭─ ${topic}`, '╰─ cwd: ~/Project/VibeBridge', ...Array.from({ length: count }, (_, i) => chunk(seed + i)).flat()];
export const questions = ['要我把这个结论直接写进 issue 吗？还是先给你看草稿？', '两个方案都能过测试。要保留旧的插入规则作为回退吗？', '发现 3 个文件命名不一致，要一并改掉吗？'];

export const pane = (id: string, agent: Agent, title: string, status: ProcessingState, seed: number, extra: Partial<Pane> = {}): Pane =>
  ({ id, agent, title, status, lines: log(seed, title, 40 + seed % 15), remaining: 5 + seed % 6, next: 'done', tick: seed * 7, ...extra });
export const initialPersistent = [
  pane('p1', 'claude', '日常：VibeBridge 主线', 'busy', 3, { next: 'done' }),
  pane('p2', 'codex', '评审 PR：Shift+Enter 换行', 'ready', 11),
  pane('p3', 'pi', '周报草稿', 'done', 17),
];
export const initialEphemeral = [
  pane('e1', 'claude', '原型：临时面板呈现', 'busy', 23, { remaining: 9, next: 'needs-input' }),
  pane('e2', 'codex', '研究 xterm 滚动性能', 'needs-input', 31, { question: questions[0] }),
  pane('e3', 'claude', 'grill：底栏汇总位置', 'done', 41),
  pane('e4', 'pi', '修复 IME 组合偏移', 'error', 53, { lines: [...log(53, '修复 IME 组合偏移', 30), '', '✗ Error: spawn node-pty ENOENT', '  at ChildProcess._handle.onexit (node:internal/child_process:286:19)'] }),
];
export const newTitles = ['to-spec：面板角色', '查 Electron 44 变更', '补测试：撤回新增面板', 'grill：派发记录', '研究 gh 限额'];
export const initialTree: Tree = { axis: 'row', ratio: 0.58, first: { panel: 'p1' }, second: { axis: 'column', ratio: 0.5, first: { panel: 'p2' }, second: { panel: 'p3' } } };
