# VibeBridge

macOS 本地多项目 Agent CLI 工作台。在一个窗口中管理多个项目，每个项目通过真实 PTY + xterm.js 终端并行运行 `codex`、`claude`、`pi`，项目、面板布局与设置由 SQLite 持久化，重开即恢复。

## 功能特性

- **多项目工作台**：一键切换项目，关闭重开后恢复上次项目与面板布局。
- **动态面板**：每项目最多十个面板；自动 / 横向 / 纵向平铺，拖动分隔线调整比例，拖拽交换位置，临时放大单个面板。
- **真实终端**：node-pty + xterm.js，每个终端保留 5000 行滚动缓冲，带背压控制；输入直达选中 CLI，不经过 shell。
- **统一设置**：界面语言（English / 简体中文）、Agent 命令与参数、主题（跟随系统 / 深色 / 浅色）、默认布局、全局快捷键；各分类独立草稿和手动保存，离开设置时可整体提交，失败保留全部草稿；快捷键冲突检测；设置冲突在启动时强制前往对应设置修正。
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

- `settings.json`：唯一的用户配置文件，退出后可手动修改，下次启动生效；文件不是合法 JSON 对象时明确报错，不会覆盖原文件。
- `projects.sqlite`：项目、面板、实际布局与上次项目；不保存终端输出或 CLI 会话。
- `last-failure.json`：最近一次主进程／终端管理进程故障的时间与原因。

`VIBEBRIDGE_DATA_DIR` 可指定隔离的数据目录（供验收使用）；不要在多个应用实例间共用同一数据目录。

缺失或非法的配置项使用以下默认值，未知的键保留在文件中：

```json
{
  "language": "en",
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

设置存在冲突（如两个动作使用同一快捷键）时配置照常生效，启动后会要求在对应设置中修正。

在 General / 通用中选择界面语言，保存成功后立即生效并在重开后保留；默认 English，不跟随系统。语言资源随应用提供，可离线切换；CLI 输出、用户内容及真实会话标题保持原样。

主题仅在启动时解析。Agent 命令可以是 PATH 中的程序名或绝对路径，参数逐项填写（不解析 shell 命令、别名或函数）；应用读取登录 shell 的本机环境后通过 PTY 直接执行。

## 开发检查

```sh
npm run check                      # 运行本地无窗口检查
```

本地检查包含 Claude hooks 的模拟 CLI 测试，不会启动真实 Claude 或访问其服务。生产桌面测试在 GitHub Actions **Checks** 中运行，也可通过 **Run workflow** 手动触发。真实 Claude 验收由用户手动进行，详见 [Claude 测试入口](docs/claude-status.md#test-entry-points)。

## 代码结构

- `app/main/workbench.ts`：共用业务入口，协调项目、面板、配置、运行身份与生命周期；IPC 仅调用这些操作。
- `app/terminal/host.ts`：全部项目共用的独立终端进程，持有 PTY 和权威运行事实。
- `app/main/storage-worker.ts`：工作线程中的 SQLite 事务，避免阻塞主进程。
- `app/main/settings.ts`：串行、完整临时写入后替换的配置保存。
- `app/renderer/terminals.ts`：xterm.js 实例及有界滚动缓冲，视图卸载不结束运行。
- `app/renderer/panel-interactions.ts`：面板布局交互入口，统一交换预览、分隔线约束、取消与面板测量调度。
