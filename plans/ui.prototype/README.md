# VibeBridge UI 原型

**THROWAWAY / 仅用于讨论界面与调试对接。** 依据 [SPEC.md](../SPEC.md) 和 [CONTEXT.md](../CONTEXT.md)，使用 TypeScript、React、Vite 和 xterm.js。所有运行行为均为内存模拟。

本轮问题：在独立系统栏下方，哪一种项目导航、终端工作台和添加弹窗结构更适合日常工作？三套方案共用同一份项目、面板、布局和运行实例数据，使用单一路由与 `?variant=` 切换。已确认设置为应用级页面，三套方案共用；打开时替换系统栏下方的整个内容区，返回后恢复原项目与布局，运行实例继续保留。

## 启动

在项目根目录执行：

```sh
npm run prototype
```

打开 <http://127.0.0.1:4173/prototype/workbench>。首次获取源码后先执行 `npm ci`；当前工作目录已安装依赖。预览服务只监听本机，端口固定为 4173。

底部浮动栏的左右箭头循环切换 A / B / C。键盘左右箭头也可切换，编辑控件和终端获得焦点时不截获方向键。切换方案保留运行实例、布局及未提交的引导分配。浮动栏和调试面板在生产构建中隐藏。

| 方案 | 导航与层级 | 添加 Agent | 统一设置 |
| --- | --- | --- | --- |
| [A · Quiet](http://127.0.0.1:4173/prototype/workbench?variant=A&theme=dark) | 完整侧栏，共用单行项目工具栏 | 横向三个选项 | 独立全局设置页 |
| [B · Focus](http://127.0.0.1:4173/prototype/workbench?variant=B&theme=dark) | 默认图标窄栏，共用单行项目工具栏 | 纵向大列表 | 独立全局设置页 |
| [C · Studio](http://127.0.0.1:4173/prototype/workbench?variant=C&theme=light) | 侧栏提供当前项目上下文，共用单行项目工具栏 | 上一、下二的三角排列 | 独立全局设置页 |

默认跟随系统主题；`theme=dark`、`theme=light`、`theme=system` 可指定预览主题。系统栏横跨窗口，包含 mac 按钮、产品 Logo、导航折叠按钮、主题及最右侧的设置入口。系统栏下的项目工具栏统一为 32 px：左侧项目名与淡色等宽路径，空间不足时从路径中间省略并保留末级目录；右侧自动排布缩略图、终端计数与无底框“＋”。48 × 24 px 的缩略图直接按当前布局比例绘制，面板增删、交换及分隔线调整都会同步更新，颜色对应 Agent 类型并突出焦点。临时放大仍显示完整布局；零面板时显示虚线空框。放大面板后可通过其顶部按钮或快捷键还原。三套方案都保留单行面板顶部及无编号的 Agent 名称。

当前预览：[单行工具栏](./previews/compact-header.jpg)、[设置页返回与命令检查](./previews/settings-command-check.jpg)。快捷键行为参考：[快捷键设置](./previews/shortcut-settings.jpg)、[快捷键冲突提示](./previews/shortcut-conflict.jpg)。此前截图作为设计演变记录保留：[面板焦点与间距](./previews/panel-focus.jpg)、[独立系统栏](./previews/system-bar-C.jpg)、[全局设置](./previews/global-settings.jpg)、[A 工作台](./previews/variant-A.jpg)、[B 工作台](./previews/variant-B.jpg)、[C 工作台](./previews/variant-C.jpg)；添加弹窗：[A](./previews/add-A.jpg)、[B](./previews/add-B.jpg)、[C](./previews/add-C.jpg)；初稿设置：[A 对话框](./previews/settings-A.jpg)、[C 抽屉](./previews/settings-C.jpg)。

## 演示入口

同一路由可以附加 `scene` 参数，直接进入对应界面。例如：

- [创建引导](http://127.0.0.1:4173/prototype/workbench?variant=A&scene=setup&theme=light)
- [添加 Agent](http://127.0.0.1:4173/prototype/workbench?variant=A&scene=add&theme=dark)
- [统一设置](http://127.0.0.1:4173/prototype/workbench?variant=A&scene=settings&theme=dark)
- [零面板项目](http://127.0.0.1:4173/prototype/workbench?variant=A&scene=empty&theme=dark)
- [退出确认](http://127.0.0.1:4173/prototype/workbench?variant=A&scene=quit&theme=dark)
- [状态与对接调试](http://127.0.0.1:4173/prototype/workbench?variant=A&debug=1&theme=dark)

日常流程可直接点击左侧“添加项目”，输入一个绝对目录字符串，再配置窗口总数和 Agent 分配。引导默认总数为 3，各类型均为 0；总数独立于分配合计，超额时保留原分配并禁止创建。输入目录只是原型占位，不验证该目录在磁盘上是否存在。

终端模拟支持 `pwd`、`/help`、`/clear`、`/exit`、普通文字输入、Ctrl+C 和终端文字选择。普通输入会收到明确的模拟回复；`/exit` 会移除面板，最后一个退出后进入项目空状态。

通过顶部区域拖动到其他面板，可以交换位置。分隔线连续调整相邻区域的比例，关闭面板会合并对应空间。新增会先尝试拆分可容纳新面板的区域；必要时扩大重排范围，仍无法满足最小尺寸则保留原布局并拒绝启动。临时放大保留原布局和其他运行实例。

交换拖拽时，源面板透明度降至 70%，目标面板覆盖 10% Agent 强调色填充和距边缘 4 px 的虚线内描边。松开、Esc 取消、窗口失焦或源面板卸载后均清除临时反馈。

全局设置的快捷键页支持搜索操作名、组合键、⌘ 等符号及 Cmd / Command / Ctrl / Option 名称。点击输入框后按新的组合键；重复绑定和固定的 ⌘1–9 会显示冲突对象，原绑定保持不变。Esc 取消当前编辑；“恢复默认”一次恢复全部四项可编辑绑定，即使当前搜索隐藏了部分操作。

设置页的“‹ 返回”位于左上角标题区域，采用幽灵按钮样式。Agent 命令检查采用带图标的小号次级按钮，悬停有底色；检查结果在输入框下方用勾 / 叉和一行淡字显示。修改启动命令后清除旧结果，检查仍为内存模拟。

三套方案共用界面基准：面板圆角 10 px，工作区外边距和分隔间距 8 px，终端四周内边距 13 px，并由面板圆角裁切。焦点采用 Codex 绿、Claude 橙、pi 紫；非焦点终端亮度略低。文字分为 13 / 12 / 11 px，中文优先使用系统 PingFang，路径和命令使用等宽字体；界面小标签统一中文并取消英文大写加字距。

悬停和焦点过渡为 140 ms。增删及交换面板时，矩形位置与尺寸使用 200 ms 缓动；面板按 ID 保留同一个终端视图。拖动分隔线直接跟随指针。系统开启“减弱动态效果”时关闭过渡与位移，并监听系统偏好变化。

## 对接实验室

点击底部“调试”，包含三个页签：

- **状态**：完整项目、面板 ID、运行实例 ID、布局树、焦点、放大状态、尺寸、启动设置、快捷键和引导草稿。可以复制状态，或导出包含终端缓冲的完整 JSON。
- **通信事件**：查看 `command / event / ui` 的方向、类型和完整载荷；可以筛选。队列上限为 200 条。
- **场景**：快速切换当前项目到 0 / 1 / 3 / 6 / 10 个面板，注入下一次启动失败、目录无效、正常或异常进程退出、后台输出、主进程故障，并调整暂定面板最小尺寸。“模拟减弱动态效果”可验证关闭动效的行为；关闭后恢复系统偏好，这个调试开关不进入保存快照。

后台输出场景：先进入 Fieldnotes，再切回 VibeBridge，随后点击“向后台实例注入输出”。切回 Fieldnotes 后仍为原运行实例，并可以查看注入的内容。

面板最小尺寸暂定 240 × 160 px，顶部保持 31 px。统一后的界面基准记录在本原型中，尚未写回 SPEC.md。

## 对接草案

类型定义位于 [bridge.prototype.ts](./bridge.prototype.ts)，内存控制器位于 [model.prototype.ts](./model.prototype.ts)。原型没有真实 CLI 适配器；以下消息用于观察和讨论前后端边界。

| 方向 | 消息 | 用途 |
| --- | --- | --- |
| UI → 宿主 | `directory.select` | 原生目录选择器入口 |
| UI → 宿主 | `agent.check` | 检查统一启动命令 |
| UI → 宿主 | `run.start` | 项目、面板、运行实例身份，以及命令、参数和 cwd |
| UI → 宿主 | `run.input` | 指定运行实例的终端输入数据 |
| UI → 宿主 | `run.resize` | 指定运行实例的 cols / rows |
| UI → 宿主 | `run.stop` | `panel-close / process-exit / app-quit / main-crash` 的清理原因 |
| UI → 宿主 | `workspace.save` | 原子保存项目、面板、布局、启动设置、主题和快捷键的快照 |
| UI → 宿主 | `window.ensure-size` | 显示保存布局所需的窗口尺寸；包含当前界面占用空间 |
| UI → 宿主 | `app.quit` | 完成所有实例的模拟清理后退出 |
| 宿主 → UI | `run.output` | 按运行实例追加终端输出 |
| 宿主 → UI | `run.exit` | 已启动 CLI 结束，移除面板配置并合并布局 |
| 宿主 → UI | `run.start-failed` | 简洁提示“Agent 无法启动” |
| 宿主 → UI | `agent.check-result` | 命令可用性结果 |

调试控制台暴露以下入口，仅操作原型数据：

```js
const prototype = window.__VIBEBRIDGE_PROTOTYPE__;

// 观察命令；不执行任何真实操作。
const unsubscribe = prototype.subscribeCommands(command => console.log(command));

prototype.getState();     // 包括运行中的模拟终端缓冲
prototype.getSnapshot();  // 保存边界：没有 runId、进程状态或终端输出
prototype.getTrace();     // 最多 200 条事件

// 使用 getState 中的真实原型 runId 注入输出。
const runId = Object.keys(prototype.getState().runs)[0];
prototype.emit({ type: 'run.output', runId, data: '\r\n[debug] example output\r\n' });
prototype.emit({ type: 'run.exit', runId, exitCode: 0 });

unsubscribe();
```

正式接入时应将这些职责交给 Electron preload / IPC、独立终端进程、node-pty 和 SQLite，并处理异步启动及清理确认。真实 PTY 必须收到 xterm 原始输入，包括控制键和转义序列；当前模拟 prompt 只处理基本行输入。原型代码不能直接视为 CLI 兼容或子进程清理实现。

## 已检查的原型行为

类型检查及 Vite 构建通过。使用浏览器实际操作检查了：默认 0 / 3 分配、6 / 4 超额校验、六面板创建、十面板布局和数量上限、新增保留已有 runId、分隔线调整、顶部拖动交换、终端输入、放大与还原、跨项目切换、空间不足拒绝新增、启动失败、CLI 退出后的零面板状态、取消退出、确认退出及模拟重开。

补充检查：切换方案保留未提交的引导草稿；快捷键冲突会被拒绝，新的有效组合键可以保存；通信面板展示实际模拟输出片段。浏览器控制台未发现运行错误。

本轮检查：快捷键名称 / Cmd+N / ⌘2 搜索及空状态、重复和保留绑定冲突、Esc 取消编辑、修改后的快捷键生效、搜索过滤下一键恢复全部默认；三套方案的 10 px 圆角与 8 px 外边距 / 分隔、13 px 终端内边距、三级字体和深浅主题焦点。增删 / 交换 / 调整分隔线 / 放大还原后已有 runId 保留；模拟减弱动态效果时过渡为 0、布局位移关闭，关闭模拟后恢复正常动效。

工具栏与设置页补充检查：三套方案顶部统一为 32 px，系统栏没有添加入口；工作区“＋”正常打开添加弹窗；窄窗口路径中间省略并保留末级目录；左上角返回恢复原布局；命令检查成功 / 失败均在输入框下方展示，编辑命令清除旧结果。拖拽交换结束后临时反馈清除，已有 runId 保留；面板顶部放大 / 还原仍可使用。目标覆盖色实际透明度为 10%，内描边为虚线。

十面板场景在 1440 × 900 px 浏览器窗口中均满足暂定 240 × 160 px 下限。将下限调至 360 × 260 px 后，六面板布局仍可显示；新增第七个时提示空间不足，原运行实例保持不变。

```sh
npm run check:prototype
npm run build:prototype
```

构建输出在根目录 `dist.prototype/`；此目录与 `node_modules/` 已忽略。原型不添加测试套件。

## 边界与后续决策

刷新页面会重置所有数据。模拟退出和重开只验证同一页面内的生命周期语义，不构成跨应用重启持久化。没有访问本地目录、启动真实 CLI、接入 SQLite 或执行系统退出与子进程清理；CLI 原生历史、输入法及 PTY 兼容性仍需在 Electron 接入后验收。

浏览器无法像 Electron 一样约束主窗口最小尺寸或自动扩大原生窗口。原型提供尺寸计算和 `window.ensure-size` 消息，实际窗口约束留给宿主。当前布局插入算法也只是用于讨论的候选实现。

**当前结论：系统栏、全局设置以及面板、字体、动效基准已按反馈统一；A / B / C 保留供对比。** 本目录目前不是 Git 仓库，规格也要求本地交付；全部原型源码因此保留在此处作为一手资料，不发布问题单。进入正式实现时，再按照 prototype 技能将完整原型归档到独立临时分支，记录选择理由，并重新实现被采纳的界面。
