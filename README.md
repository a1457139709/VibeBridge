# VibeBridge

macOS 本地多项目 Agent CLI 工作台。正式应用代码在 `app/`；产品规格维护在 [GitHub #19](https://github.com/a1457139709/VibeBridge/issues/19)，领域术语见 [GLOSSARY](plans/GLOSSARY.md)。

第一阶段实现覆盖 [#24：创建项目并启动 Agent 工作区](https://github.com/a1457139709/VibeBridge/issues/24)、[#25：动态面板与布局操作](https://github.com/a1457139709/VibeBridge/issues/25)、[#26：多项目切换与重开恢复](https://github.com/a1457139709/VibeBridge/issues/26)、[#27：全局设置、主题与快捷键](https://github.com/a1457139709/VibeBridge/issues/27) 和 [#28：退出、故障清理与完整流程验收](https://github.com/a1457139709/VibeBridge/issues/28)。提供真实 PTY/xterm.js、SQLite 保存、动态面板、布局调整、项目切换、统一设置与退出清理、本地应用打包。真实 CLI、输入法及视觉体验的待验收步骤见验证记录。

当前版本在 [#45 第二阶段交互](https://github.com/a1457139709/VibeBridge/issues/45)基础上，包含 [#58 UI 修复](https://github.com/a1457139709/VibeBridge/issues/58)、[#59 会话标题过滤](https://github.com/a1457139709/VibeBridge/issues/59)及 [#61 类型色与紧凑面板](https://github.com/a1457139709/VibeBridge/issues/61)：设置各分类统一提供恢复默认、放弃与保存；面板缩小时保留会话标题和 Agent 类型标识；交换预览期间保持原终端几何。面板、导航与切换提示共用过滤后的会话标题，Codex 首尾动画符号覆盖已确认的十帧。真实 CLI 与动效的人工验收见 [SPEC #57 QA](docs/spec-57-qa.md)及 [#61 复验指南](docs/issue-61-qa.md)，Codex 真实忙闲与 Claude 账号条件相关验收仍未完成。

## 本地运行

需要 macOS、Node.js 22.12 或以上，以及本机已安装和登录的 `codex`、`claude`、`pi`。

```sh
npm ci
npx --no-install install-electron
npm run rebuild:terminal
npm run prepare:runtime
npm run dev
```

当前锁定的 Electron 版本需显式运行 `install-electron` 下载运行时二进制；`npm ci` 只安装 npm 包。随后重建原生 PTY，再执行运行时预检。

`dev` 先构建，再运行正式应用；不使用原型启动器。`npm start` 只启动现有构建，不编译或修复依赖。如果原生模块准备失败，先运行 `npm run rebuild:terminal`，再运行 `npm run prepare:runtime`。构建和依赖准备应在启动应用之前完成。

```sh
npm run package
```

生成 `outputs/VibeBridge.app`，可直接从 Finder 打开。打包使用同一套业务代码，包含 Electron、SQLite 和当前架构的原生 PTY；使用本地 ad hoc 签名，不包含公开分发、自动更新或公证流程。重新打包会替换该输出应用，请先退出它。

## 配置与数据

默认位于 `~/Library/Application Support/VibeBridge/`：

- `settings.json`：唯一的用户配置文件，退出后可手动修改，下次启动生效。
- `projects.sqlite`：项目、面板、实际布局与上次项目，不保存终端输出或 CLI 会话。
- `last-failure.json`：最近一次主进程／终端管理进程故障的时间、原因及可获得的清理错误；正常启动不覆盖该记录。

缺失配置使用以下默认值；损坏配置会明确报错，退出时不会覆盖原文件。

```json
{
  "theme": "system",
  "defaultLayout": "auto",
  "shortcuts": {
    "previousProject": "Command+Shift+[",
    "nextProject": "Command+Shift+]",
    "previousPanel": "Command+[",
    "nextPanel": "Command+]",
    "maximizePanel": "Command+Enter",
    "addPanel": "Command+N",
    "closePanel": "Command+Shift+W",
    "settings": "Command+,"
  },
  "agents": {
    "codex": { "command": "codex", "args": [] },
    "claude": { "command": "claude", "args": [] },
    "pi": { "command": "pi", "args": [] }
  }
}
```

主题支持 `system`、`light`、`dark`，仅在启动时解析。命令可以是 PATH 中的程序名或绝对路径，参数逐项填写；不解析 shell 命令、别名或函数。应用异步读取登录 shell 的本机环境，然后通过 PTY 直接执行解析出的程序，不把 Agent 放进 shell 中运行。

导航右下角的设置入口只替换工作区，导航保持原有宽度和显隐。再点设置入口、左上“‹ 返回”或设置快捷键可回到进入前的页面，也可从导航直接选择项目／面板或创建项目。返回后保留原项目、实际布局、临时放大和运行。Agent 页集中管理三种命令与参数，参数每行一项；“检查命令”在实际启动环境中检查可执行程序，编辑命令会清除结果。点击保存只影响之后启动的实例。

外观页提供跟随系统、深色、浅色列表。保存主题后提示重启及结束 Agent 的影响；本次运行中的工作台、已有和新增终端保持启动主题。保存回启动偏好会清除待重启提示。默认布局支持 `auto`（自动）、`row`（横向平铺）、`column`（纵向平铺），只作用于没有实际布局的初始安排，创建预览采用相同规则。

快捷键页支持按操作名或组合键搜索、按键录入和恢复全部默认。录入和“恢复全部默认”只修改草稿，点击“保存快捷键”后立即生效。“放弃更改”恢复已保存绑定。冲突按组合键分组高亮并显示对象，存在冲突时拒绝保存。手改时组合键使用以上格式，修饰键按 `Command`、`Control`、`Alt`、`Shift` 顺序排列，至少包含前三者之一。复制、粘贴、退出等原生菜单绑定保留。快捷键仅由前台窗口处理，未处理的输入继续交给选中 CLI。

Agent、外观和快捷键分类各自保留草稿和保存按钮；切换分类不会丢失草稿。离开设置时，有改动会询问“保存并返回／不保存／取消”；保存失败留在出问题的分类，原导航动作不执行。退出工作台直接丢弃未保存草稿。升级时自动补齐缺失快捷键，补入默认键产生的冲突会在快捷键页显示，不阻止启动。

`VIBEBRIDGE_DATA_DIR` 可指定隔离的数据目录，供本地验收使用。不要在多个应用实例中同时使用同一个数据目录。

## 代码边界

- `app/main/workbench.ts`：共用业务入口，协调项目、面板、配置、运行身份与生命周期。IPC 仅调用这些操作。
- `app/terminal/host.ts`：全部项目共用的独立终端进程，持有 PTY 和权威运行事实。输入必须指定运行 ID，失效时返回错误。
- `app/main/storage-worker.ts`：工作线程中的 SQLite 事务，避免同步磁盘操作阻塞主进程。
- `app/main/settings.ts`：串行、完整临时写入后替换的配置保存。
- `app/renderer/terminals.ts`：当前应用内的 xterm.js 实例及有界滚动缓冲，视图卸载不结束运行或清空缓冲。

面板顶部与导航共享当前运行实例的终端标题（OSC 0/2）；观察版原样显示，尚无标题时为 `Untitled task`。标题不写入存储，不读取 CLI 会话文件。导航按面板创建顺序排列，点击条目可跨项目聚焦；从临时放大进入时继续放大目标面板，还原到目标项目原布局。

项目行右键或“⋯”可编辑／删除项目。改目录在同一弹窗选择重启或保留现有运行；不重启时已有运行继续使用旧目录，之后的启动使用新目录。删除只移除工作台记录并结束该项目的运行，本地文件与 CLI 历史保留。

关闭面板（顶部“×”或默认 ⌘⇧W）会停止运行并移除配置；退出会停止所有运行但保留面板配置。CLI 正常或异常结束会移除对应面板。启动失败仅显示“Agent 无法启动”。不解析终端文字推断处理状态，不自动恢复会话或发送通知。

主窗口关闭与应用退出均先确认；取消保留全部项目运行。确认后等待已提交的保存操作，再向全部受管运行及后代请求结束，已结束则立即继续；两秒后仍存活才强制结束，并进行有界检查。两个现有进程通过 IPC 断开／子进程退出检测故障；存活方负责清理，不自动重开窗口。归属识别结合 PID、启动时间与每次运行的可继承环境标记，覆盖脱离原进程组及父进程已退出的工具，不按程序名或目录批量终止。

终端输出直接进入 xterm，不触发整页状态更新。每个终端保留 5000 行滚动缓冲；解析完成分批确认消费量，未确认输出约 128 Ki 个 UTF-16 code units 时暂停 PTY 读取，降到 64 Ki 后恢复，不截断原始输出或控制序列。上限可能多出一个已读取的块。

工作区右上角“＋”和零面板入口打开同一个 Agent 选择弹窗，每项目最多十个面板。新增时按相对面积选择最大的区域局部分割，不依赖焦点；关闭时按原分割关系合并。拖动分隔线调整比例，下限按当前字体的两列 × 两行字符空间计算；极小时只显示类型图标。主窗口缩小不受此下限限制。从顶部拖动显示半透明整面板影像及两两交换预览，有效松手后才保存；Escape 或窗口失焦取消。预览期间实际终端尺寸和输入身份保持不变。放大／还原仅改变视图，保留运行与保存布局。关闭最后一个面板后仍保留空项目。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop:all
```

`test:desktop:all` 自动发现 `tests/desktop/` 目录直属的 `*.test.cjs` 入口，按文件名顺序执行；任一流程失败即停止并返回非零退出码。新增入口不需要修改运行器或 CI。导出 `manual` 原因的入口只在明确选择时运行；当前只有真实 Codex 检查需要本机 CLI 和历史记录。以下入口用于单独复查；打包应用检查需先准备 `.app`。

```sh
npm run test:desktop
npm run test:desktop -- --setup
npm run test:desktop -- --appearance
npm run test:desktop -- --codex
npm run test:desktop -- --navigation
npm run test:desktop -- --notices-startup
npm run test:desktop -- --project-management
npm run test:desktop -- --settings-drafts
npm run test:desktop -- --settings-migration
npm run test:desktop -- --titles
npm run test:desktop -- --panels
npm run test:desktop -- --list
node scripts/test-desktop.mjs --packaged
```

业务测试使用 `work/issue-24/`，桌面测试为每个入口在 `work/desktop-tests/` 下创建独立目录，退出后清理；CLI 输入输出由少量可控交互程序提供。业务测试覆盖创建约束、独立输入与运行身份、真实尺寸变化、面板上限、启动失败、保存重开、损坏配置保护和退出子进程清理。桌面测试通过正式页面及公开业务 API 检查创建草稿、同页恢复分配后直接创建、连续创建时默认名称、原生方向键输入、视图重新挂载、取消和确认退出。

测试目录按用途组织：

- `tests/*.test.ts`：业务测试及运行器测试，由 `npm test` 自动发现。
- `tests/desktop/*.test.cjs`：完整桌面测试，配置、操作和断言放在同一个文件，由桌面命令自动发现。
- `tests/desktop/scenarios/`：依赖所属测试前序状态的子场景，由对应 `.test.cjs` 调用。
- `tests/desktop/support/`：Electron 测试宿主、共用项目准备和可选截图工具；默认不保存截图。
- `tests/fixtures/`：可控 CLI 和业务测试子进程。

### 新增桌面测试

例如新增 Agent 状态测试时，创建 `tests/desktop/agent-status.test.cjs`，导出包含 `async run(context)` 的对象，在函数中准备场景、执行操作并断言结果。全量命令会自动执行它；单独运行使用 `npm run test:desktop -- --agent-status`。普通辅助模块不使用 `.test.cjs` 后缀，也不需要登记。没有匹配入口、名称拼错或入口缺少 `run` 时，命令会失败。

每个入口从正式应用的新数据目录开始，默认使用可控 CLI；运行器负责启动窗口、执行用例、确认退出并检查运行实例已结束。`context` 提供 `window`、`evaluate(code)`、`until(check)`、`click(label)`、`fill(id, value)`、`directory`、`dialog`、`app`、`copyTerminal(panelId)`、`verifyArrows(panelId)` 和 `confirmationCount()`。用例可返回 `{ afterQuit }`，在退出后补充持久化断言。

入口按需导出以下选项，全部放在测试文件内：

| 导出项 | 用途 |
| --- | --- |
| `configure(settings)` | 首次启动前返回测试所需配置；也可返回字符串以测试损坏的配置文件。 |
| `reopen(context)` | 第一次正常退出后，使用同一数据目录启动新进程并验证恢复；此时 `context.reopen` 为 `true`。 |
| `expectedDialogError` | 用正则表达式检查预期的原生启动错误对话框。 |
| `manual` | 必须手动准备条件的原因；全量命令排除该入口，按名称仍可运行。 |

测试模块在发现阶段加载，因此顶层只声明配置和函数，操作放在 `run`／`reopen` 中。参考[标题测试](tests/desktop/titles.test.cjs)、[面板测试](tests/desktop/panels.test.cjs)和[默认流程](tests/desktop/default.test.cjs)。

`--setup` 聚焦创建表单，检查失焦后的红色警示、选择目录完成时按当前空名称填入、特殊字符处理、真实启动目录、emoji 显示和重复目录打开；仅替换系统目录选择器的返回结果，其余使用正式页面及业务路径。`--appearance` 使用深色启动，检查 pi 页脚 RGB 灰字、ANSI 灰字和索引灰字的实际显示对比度，并确认 CLI 强调色、淡化文字及块字符语义保留。`--codex` 是需要本机 Codex 的可选检查，通过真实键盘事件切换原生 `resume` 页的 Cwd/All；会读取本机历史列表，但不恢复会话或发送任务。这三个入口都可以与 `--packaged` 合用。`VIBEBRIDGE_TEST_APP` 可指定另一个待测 `.app` 路径，默认仍为 `outputs/VibeBridge.app`。

`--packaged` 使用开发 Electron 测试宿主加载 `.app` 内的产品代码和原生模块；此外需实际打开 `.app` 检查图标启动。桌面测试将继承 PATH 缩减为 `/usr/bin:/bin`，验证登录环境中的 `node` 仍能解析并直接启动。

GitHub Actions 的 [Checks 工作流](.github/workflows/checks.yml) 在 push、pull request 和手动触发时使用 macOS 执行依赖安装、Electron 二进制安装、原生 PTY 重建、运行时检查、类型检查、业务测试、构建及自动发现的桌面回归。桌面回归失败时上传 `macos-desktop-failure-log`，包含标准输出和错误输出，保留 7 天；不生成截图或录屏。远端执行结果以 PR Checks 为准，检查通过不代表合并已被分支保护强制拦截。

人工验收结果维护在 GitHub：[第二阶段 QA #53](https://github.com/a1457139709/VibeBridge/issues/53)、[SPEC #57 QA #60](https://github.com/a1457139709/VibeBridge/issues/60)及 [#61 后续反馈](https://github.com/a1457139709/VibeBridge/issues/61)。本地保留 [#58 验证](docs/issue-58-verification.md)、[#59 验证](docs/issue-59-verification.md)、[#61 验证](docs/issue-61-verification.md)与上述待执行指南；历史记录中的“未推送”等状态以各轮记录时间为准。第一阶段修复与第二阶段交付的旧验证文档可从 [Git 历史](https://github.com/a1457139709/VibeBridge/tree/389c25b/docs)查阅。
