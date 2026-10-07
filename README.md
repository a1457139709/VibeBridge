# VibeBridge

macOS 本地多项目 Agent CLI 工作台。正式应用代码在 `app/`；`plans/*prototype` 仅保留既有原型，不参与正式应用构建。

当前实现覆盖 [#24：创建项目并启动 Agent 工作区](https://github.com/a1457139709/VibeBridge/issues/24) 和 [#25：动态面板与布局操作](https://github.com/a1457139709/VibeBridge/issues/25)。提供统一创建页、真实 PTY/xterm.js、SQLite 保存、动态面板、布局调整与退出清理、本地应用打包。全局设置页面、快捷键定制和完整跨项目故障验收属于后续交付。

## 本地运行

需要 macOS、Node.js 22.12 或以上，以及本机已安装和登录的 `codex`、`claude`、`pi`。

```sh
npm ci
npm run prepare:runtime
npm run dev
```

`dev` 先构建，再运行正式应用；不使用原型启动器。`npm start` 只启动现有构建，不编译或修复依赖。如果原生模块准备失败，先运行 `npm run rebuild:terminal`，再运行 `npm run prepare:runtime`。构建和依赖准备应在启动应用之前完成。

```sh
npm run package
```

生成 `outputs/VibeBridge.app`，可直接从 Finder 打开。打包使用同一套业务代码，包含 Electron、SQLite 和当前架构的原生 PTY；使用本地 ad hoc 签名，不包含公开分发、自动更新或公证流程。重新打包会替换该输出应用，请先退出它。

## 配置与数据

默认位于 `~/Library/Application Support/VibeBridge/`：

- `settings.json`：唯一的用户配置文件，退出后可手动修改，下次启动生效。
- `projects.sqlite`：项目、面板、实际布局与上次项目，不保存终端输出或 CLI 会话。

缺失配置使用以下默认值；损坏配置会明确报错，退出时不会覆盖原文件。

```json
{
  "theme": "system",
  "agents": {
    "codex": { "command": "codex", "args": [] },
    "claude": { "command": "claude", "args": [] },
    "pi": { "command": "pi", "args": [] }
  }
}
```

主题支持 `system`、`light`、`dark`，仅在启动时解析。命令可以是 PATH 中的程序名或绝对路径，参数逐项填写；不解析 shell 命令、别名或函数。应用异步读取登录 shell 的本机环境，然后通过 PTY 直接执行解析出的程序，不把 Agent 放进 shell 中运行。

`VIBEBRIDGE_DATA_DIR` 可指定隔离的数据目录，供本地验收使用。不要在多个应用实例中同时使用同一个数据目录。

## 代码边界

- `app/main/workbench.ts`：共用业务入口，协调项目、面板、配置、运行身份与生命周期。IPC 仅调用这些操作。
- `app/terminal/host.ts`：全部项目共用的独立终端进程，持有 PTY 和权威运行事实。输入必须指定运行 ID，失效时返回错误。
- `app/main/storage-worker.ts`：工作线程中的 SQLite 事务，避免同步磁盘操作阻塞主进程。
- `app/main/settings.ts`：串行、完整临时写入后替换的配置保存。
- `app/renderer/terminals.ts`：当前应用内的 xterm.js 实例及有界滚动缓冲，视图卸载不结束运行或清空缓冲。

关闭面板会停止运行并移除配置；退出会停止所有运行但保留面板配置。CLI 正常或异常结束会移除对应面板。启动失败仅显示“Agent 无法启动”。不解析终端文字推断处理状态，不自动恢复会话或发送通知。

工作区右上角“＋”和零面板入口打开同一个 Agent 选择弹窗，每项目最多十个面板。新增时按相对面积选择最大的区域局部分割，不依赖焦点；关闭时按原分割关系合并。拖动分隔线调整比例，从顶部拖到另一面板交换位置，排列与比例自动保存。放大／还原仅改变视图，保留运行与保存布局。关闭最后一个面板后仍保留空项目。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop
node scripts/test-desktop.mjs --packaged
```

测试使用 `work/issue-24/` 下的隔离目录，以及少量可控交互程序。业务测试覆盖创建约束、独立输入与运行身份、真实尺寸变化、面板上限、启动失败、保存重开、损坏配置保护和退出子进程清理。桌面测试通过正式页面及公开业务 API 检查创建草稿、超额分配、原生键盘输入、视图重新挂载、取消和确认退出。

`--packaged` 使用开发 Electron 测试宿主加载 `.app` 内的产品代码和原生模块；此外需实际打开 `.app` 检查图标启动。桌面测试将继承 PATH 缩减为 `/usr/bin:/bin`，验证登录环境中的 `node` 仍能解析并直接启动。

验收记录和剩余人工步骤见 [#24 验证记录](docs/issue-24-verification.md) 与 [#25 验证记录](docs/issue-25-verification.md)。
