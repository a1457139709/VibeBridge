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
- Node.js 22.12 或以上
- 本机已安装并登录 `codex`、`claude`、`pi`

## 安装与运行

```sh
npm ci
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

`npm ci` 会通过 `prepare` 安装仓库的 Git pre-commit hook；已有依赖时可运行 `npm run prepare` 启用。
每次提交只检查暂存区中新增或修改的普通文件（包含重命名目标），以暂存版本的字节数 / 4 估算 token；
超过 5,000 token（20,000 字节）会阻止提交，恰好等于上限可提交。未暂存的内容、删除项、符号链接和子模块不参与检查。
可运行 `npm run check:staged-size` 手动检查，失败消息包含按职责拆分代码、测试或文档、更新引用并重新暂存的具体步骤。

Git 不记录文件是否由 Agent 编写，因此默认检查全部普通文件，以暂存的 `.gitattributes` 标注工具产物例外。
常见锁文件、`generated/` 下的文件以及 `*.generated.*`、`*.gen.*` 已标记为 `linguist-generated`；
其他代码生成产物或第三方副本应按实际路径标记 `linguist-generated` 或 `linguist-vendored`，并暂存 `.gitattributes`。
不要为手写代码、测试或文档添加豁免。

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop:all
```

`test:desktop:all` 自动发现 `tests/desktop/` 目录直属的 `*.test.cjs` 入口，按文件名顺序执行，任一失败即停止并返回非零退出码。单独复查使用 `npm run test:desktop -- --setup`（或 `--appearance`、`--titles`、`--panels` 等，`--list` 列出全部入口）。导出 `manual` 原因的入口不参与全量，按名称仍可运行，例如 `--codex` 需要本机 Codex CLI 和历史记录。打包应用检查先准备 `.app`，再运行 `node scripts/test-desktop.mjs --packaged`；`VIBEBRIDGE_TEST_APP` 可指定另一个待测 `.app` 路径。

测试目录按用途组织：

- `tests/*.test.ts`：业务测试及运行器测试，由 `npm test` 自动发现。
- `tests/desktop/*.test.cjs`：桌面测试入口，由桌面命令自动发现。
- `tests/desktop/scenarios/`：依赖所属测试前序状态的子场景。
- `tests/desktop/support/`：Electron 测试宿主与共用工具。
- `tests/fixtures/`：可控 CLI 和业务测试子进程。

新增桌面测试：创建 `tests/desktop/<name>.test.cjs`，导出包含 `async run(context)` 的对象，可选导出 `configure(settings)`、`reopen(context)`、`expectedDialogError`、`manual`；全量命令自动执行，`npm run test:desktop -- --<name>` 单独运行。参考 [默认流程](tests/desktop/default.test.cjs)。

## 代码结构

- `app/main/workbench.ts`：共用业务入口，协调项目、面板、配置、运行身份与生命周期；IPC 仅调用这些操作。
- `app/terminal/host.ts`：全部项目共用的独立终端进程，持有 PTY 和权威运行事实。
- `app/main/storage-worker.ts`：工作线程中的 SQLite 事务，避免阻塞主进程。
- `app/main/settings.ts`：串行、完整临时写入后替换的配置保存。
- `app/renderer/terminals.ts`：xterm.js 实例及有界滚动缓冲，视图卸载不结束运行。
- `app/renderer/panel-interactions.ts`：面板布局交互入口，统一交换预览、分隔线约束、取消与面板测量调度；[职责与验证记录](docs/issue-63-verification.md)。
