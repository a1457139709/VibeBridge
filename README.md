# VibeBridge

macOS 本地多项目 Agent CLI 工作台。在一个窗口中管理多个项目，每个项目通过真实 PTY + xterm.js 终端并行运行 `codex`、`claude`、`pi`，项目、面板布局与设置由 SQLite 持久化，重开即恢复。

## 功能特性

- **多项目工作台**：一键切换项目，关闭重开后恢复上次项目与面板布局。
- **动态面板**：每项目最多十个面板；自动 / 横向 / 纵向平铺，拖动分隔线调整比例，拖拽交换位置，临时放大单个面板。
- **真实终端**：node-pty + xterm.js，每个终端保留 5000 行滚动缓冲，带背压控制；输入直达选中 CLI，不经过 shell。
- **统一设置**：Agent 命令与参数、主题（跟随系统 / 深色 / 浅色）、默认布局、全局快捷键；各分类独立草稿和手动保存，离开设置时可整体提交，失败保留全部草稿；快捷键冲突检测与启动迁移冲突提醒。
- **退出与故障清理**：退出前确认并结束全部受管运行及子进程；主进程或终端进程故障时由存活方清理并记录故障信息。
- **本地打包**：一键生成可双击打开的 `VibeBridge.app`。

## 环境要求

- macOS
- Node.js 22.22.2+（22.x）、24.15+（24.x）或 26+，与组件测试依赖要求一致
- 操作真实 Agent 时需安装并登录对应的 `codex`、`claude` 或 `pi`；自动测试只使用可控 CLI

## 安装与运行

```sh
npm ci                             # 同时通过 prepare 安装 Husky pre-commit 钩子
npx --no-install install-electron   # 下载锁定的 Electron 运行时二进制
npm run rebuild:terminal            # 重建原生 PTY 模块
npm run prepare:runtime             # 运行时预检
npm run dev                         # 构建并启动应用
```

`npm start` 只启动已有构建，不编译。原生模块准备失败时，先运行 `rebuild:terminal` 再运行 `prepare:runtime`。

## 打包

```sh
npm run package
```

生成 `outputs/VibeBridge.app`，包含 Electron、SQLite 和当前架构的原生 PTY；使用本地 ad hoc 签名，不包含公开分发、自动更新或公证。重新打包会替换该应用，请先退出它。

## 配置与数据

默认位于 `~/Library/Application Support/VibeBridge/`：

- `settings.json`：唯一的用户配置文件，退出后可手动修改，下次启动生效；配置损坏时明确报错，不会覆盖原文件。
- `projects.sqlite`：项目、面板、实际布局与上次项目；不保存终端输出或 CLI 会话。
- `last-failure.json`：最近一次主进程／终端管理进程故障的时间与原因。

`VIBEBRIDGE_DATA_DIR` 可指定隔离的数据目录（供验收使用）；不要在多个应用实例间共用同一数据目录。

缺失配置使用以下默认值：

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

主题仅在启动时解析。Agent 命令可以是 PATH 中的程序名或绝对路径，参数逐项填写（不解析 shell 命令、别名或函数）；应用读取登录 shell 的本机环境后通过 PTY 直接执行。

## 验证

完成上面的开发依赖与原生运行时安装后，普通 `git commit` 会先检查暂存文件大小，再运行同一个无窗口检查入口：

```sh
npm run check                      # typecheck → 单元／模块测试 → 组件测试
```

任一阶段失败会以非零状态阻止提交，输出保留具体失败文件和断言。后续无窗口检查直接读取当前工作区，不创建暂存快照、不自动暂存或藏起修改；提交者负责保证工作区与拟提交内容一致。`npm ci` 的 `prepare` 安装钩子，已有检出可运行 `npm run prepare` 重新安装，`git config --get core.hooksPath` 应为 `.husky/_`。不要用 `--ignore-scripts` 跳过标准安装中的钩子步骤。

文件大小检查只读取暂存区中新增或修改的普通文件（包含重命名目标），按字节数 / 4 估算 token。
超过 5,000 token（20,000 字节）会在后续检查启动前阻止提交，恰好等于上限可提交；失败消息给出按职责拆分、更新引用、验证和重新暂存的步骤。
未暂存内容、删除项、符号链接和子模块不参与大小检查；可用 `npm run check:staged-size` 单独运行。

Git 不记录文件是否由 Agent 编写，因此默认检查全部普通文件，以暂存的 `.gitattributes` 标注工具产物例外。
常见锁文件、`generated/` 下的文件以及 `*.generated.*`、`*.gen.*` 已标记为 `linguist-generated`；
其他代码生成产物或第三方副本应按实际路径标记 `linguist-generated` 或 `linguist-vendored`，并暂存 `.gitattributes`。
不要为手写代码、测试或文档添加豁免。后续 `npm run check` 仍按上文检查当前工作区。

本地检查完整运行既有真实 PTY、存储、输入路由、运行生命周期和进程清理测试。Electron 仅以 `ELECTRON_RUN_AS_NODE=1` 运行模块测试；组件使用 jsdom 和可控 `window.workbench` 接口，均不创建桌面或报告窗口，也不操作系统焦点。单个测试文件排查：

```sh
npm test -- tests/project-management.test.ts
npm run test:components -- tests/components/Setup.test.tsx
npm run typecheck
npm run build                      # 只构建，不启动应用
```

PR 自动在 GitHub 托管 `macos-15` 上执行两个检查：

- **Code checks**：同一 `npm run check` 入口及生产构建。
- **Desktop checks**：构建后串行运行应用启动/IPC、可控 CLI 终端输入输出/进程清理、保存配置和布局后重开恢复三条流程。

`main` 的合并必需检查为 **Code checks** 和 **Desktop checks**，要求与最新 main 同步；任一未通过不能正常合并。分支保护属于 GitHub 仓库设置，复制仓库时也需在目标仓库设置这两个名称，单有工作流文件不足以限制合并。工作流只在 PR、main 推送及手动触发时运行，无夜间任务。

桌面用例只在云端运行。`npm run test:desktop -- --list` 可安全列出入口；排查使用 GitHub Actions 的 Checks 工作流，单条云端命令为 `npm run test:desktop -- --terminal`（或 `--startup`、`--restore`）。本机执行桌面命令会拒绝启动，不能作为本地失败的自动回退。每条用例独立隔离数据，保存/重开流程内部共享同一数据目录；失败日志、截图和快照通过 `macos-desktop-failure` artifact 保留七天。

外观、实际拖拽/缩放、复杂焦点和真实 CLI 兼容性由用户手动验收。完整的旧桌面断言去向和验收清单见 [测试分层盘点](docs/testing/desktop-migration.md)。恢复布局只恢复项目、面板配置和排列；CLI 启动为新运行实例，不表示恢复会话。

测试目录：

- `tests/*.test.ts`：公共规则、无窗口模块/集成测试，以及用替身进程验证的 Git 钩子和桌面运行器测试。
- `tests/components/*.test.tsx`：进程内组件测试，独立于原生桌面交互。
- `tests/desktop/*.test.cjs`：仅保留三类云端贯通流程；`support/` 为宿主和失败诊断。
- `tests/fixtures/`：可控 CLI 和业务测试子进程，不读取个人 Agent 历史。

## 代码结构

- `app/main/workbench.ts`：共用业务入口，协调项目、面板、配置、运行身份与生命周期；IPC 仅调用这些操作。
- `app/terminal/host.ts`：全部项目共用的独立终端进程，持有 PTY 和权威运行事实。
- `app/main/storage-worker.ts`：工作线程中的 SQLite 事务，避免阻塞主进程。
- `app/main/settings.ts`：串行、完整临时写入后替换的配置保存。
- `app/renderer/terminals.ts`：xterm.js 实例及有界滚动缓冲，视图卸载不结束运行。
- `app/renderer/panel-interactions.ts`：面板布局交互入口，统一交换预览、分隔线约束、取消与面板测量调度。
