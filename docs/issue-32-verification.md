# #32 修复与验证记录

本文件是本轮唯一结果表，依据 [#32](https://github.com/a1457139709/VibeBridge/issues/32)、[#19 规格](https://github.com/a1457139709/VibeBridge/issues/19) 与 [原 QA 反馈](https://github.com/a1457139709/VibeBridge/issues/29#issuecomment-6063221294)。历史验收状态不代表本轮结果。

日期：2026-10-10。代码：`69e94cb3036f598d1ca4169411807d888d055402` 上的本轮未提交改动，分支 `feat/v1-workbench`。本轮没有提交、推送或关闭 issue。

环境：macOS 26.6.2 (25G83)、arm64、Node 26.8.1、npm 11.19.0、Electron 44.5.1、xterm 6.0.0、node-pty 1.1.0；真实 Codex 0.162.1；灰色样本来自本机 pi 0.84.4 的深色主题与页脚实现。已读取 #32 引用的代码对话回顾。仓库当前没有 ADR 和 `docs/agents/qa.md`，本轮技术验证按 issue 的分工由 agent 执行。

构建：`dist/`；可体验应用：`outputs/issue-32/VibeBridge.app`。为保留原有应用，使用原打包脚本的临时副本，仅将输出目的地改为此路径，产品代码、原生模块和签名步骤相同。截图、运行日志和本轮源文件 SHA-256 位于 `outputs/issue-32/`。桌面测试使用隔离目录，测试后正常退出并检查受管 PID 已结束；临时数据与基线副本已清理。

| 项目 | 结论与证据 | 执行路径 / 命令 |
| --- | --- | --- |
| 创建成功后目录末级名不再自动带入 | **已复现、已修复。** 成功创建沿用了旧草稿及手动命名标记；原始提交把下一项目名称保留为 `First project`，应为 `next-project`。现在成功创建后重置草稿及标记；取消与打开已有项目仍保留草稿和手填名。一个面板的最小复现，在原始提交 exit 1、修复版 exit 0；基线源码 SHA-256 与 `git show HEAD` 一致。 | `npm run test:desktop`；另以临时单面板 UI 脚本对比原始提交与修复构建。 |
| 总数减少再恢复后按钮仍不可用 | **本轮未复现。** 有效、未添加目录和非空名称下，3 个 Agent 分配完成，3→2 后禁用，2→3 后同页立即可创建，未取消或重开绕过；实际保存名称、目录和三种面板类型正确，3 个 CLI 均输出 READY。新增回归，未对数量逻辑作猜测性修改。 | `npm run test:desktop`；打包入口复测通过。 |
| 无效目录提示、草稿与手填名称 | **缺少非空无效目录提示未复现。** 首次输入不存在目录、手填名称后换成不存在目录，均看到“请选择有效的本地目录”，且不可创建。首次有效目录自动带名；手填后改目录保留名称；取消重开保留草稿；成功后新草稿自动带名；打开已有项目不清除未完成草稿、不新增运行。空名称红字、重复目录提示强化属于后续需求，本轮未扩展。 | `npm run test:desktop`；全部通过。 |
| 左右键没有传给 CLI | **当前环境未复现。** 裸 Left/Right 的真实 keyDown/keyUp 经正式终端进入可控 CLI；普通模式收到 `1b5b44` / `1b5b43`，应用光标模式收到 `1b4f44` / `1b4f43`，且只到达选中运行。覆盖面板切换、设置往返、项目切换及创建页往返。实读本机应用绑定为默认值，未命中裸方向键。输入代码和应用绑定优先规则未改动。 | `npm run test:desktop`；打包入口复测通过。 |
| Codex 原生恢复入口 | **通过本轮针对性兼容检查。** 实际 `codex resume --no-daemon --no-alt-screen` 中，Right 把 Cwd 改为 All，Left 改回 Cwd；面板切换、设置与创建页往返后重复通过。焦点检查为 Codex 面板内的终端输入区。只浏览原生筛选，不恢复历史会话、不发送模型任务，不输出历史内容。此结果不代签用户未明确的其他组合键或完整会话恢复体验。 | `npm run test:desktop -- --codex`；`VIBEBRIDGE_TEST_APP=outputs/issue-32/VibeBridge.app npm run test:desktop -- --packaged --codex`，exit 0。 |
| 深色 CLI 灰字难辨 | **已复现、已修复。** 经认证读取原 QA 截图，pi 页脚使用 RGB `#666666`；在实际背景 `#262a28` 上仅 2.53:1。终端启用 xterm 原生 `minimumContrastRatio: 4.5` 后，实际显示为 `#919191`，4.61:1。ANSI 灰色从 1.99→4.69，索引灰色从 2.77→4.85。已可读的 pi 强调色仍为 `#8abeb7`；SGR dim 保留淡化效果，块字符保留原颜色。不改 CLI 数据和主题重启约定。相同最终用例在原始提交 exit 1，在修复包 exit 0；已检查前后截图，主观视觉体验仍待用户。 | `npm run test:desktop -- --appearance`；`VIBEBRIDGE_TEST_APP=outputs/issue-32/VibeBridge.app npm run test:desktop -- --packaged --appearance`。`dark-before.png` / `dark-after.png` 为本轮对照。 |
| 类型、业务、构建检查 | **通过。** TypeScript 无错误；14 个业务测试全部通过，含保存重开、配置损坏保护及退出/故障清理；生产构建成功；运行时预检确认 Electron、SQLite 和 PTY 可用。Vite 仍有现有大 chunk 提示；Electron 测试宿主输出 Shared Dictionary cache 警告，但上述断言与退出检查均成功。 | `npm run typecheck`、`npm test`、`npm run build`、`npm run prepare:runtime`，exit 0。 |
| 桌面完整路径与打包代码 | **通过。** 创建、布局、输入目标、后台运行、设置返回、取消退出、确认清理、保存重开、其他项目首次进入启动均通过。既有 4/10 运行负载场景随原桌面入口执行，未扩展新的压力验收范围。打包检查由开发 Electron 宿主加载 `.app` 中产品代码及原生模块，不等同于 Finder 图标启动验收。 | `npm run test:desktop`；`VIBEBRIDGE_TEST_APP=outputs/issue-32/VibeBridge.app npm run test:desktop -- --packaged`，exit 0。 |
| 自动检查保障 | **配置完成，远端未运行。** 新增 `.github/workflows/checks.yml`：push / pull_request / workflow_dispatch → macos-15 → Node 24 → npm ci → Electron PTY 重建 → runtime → typecheck → 业务测试 → build。官方 Actions 固定为发布 SHA。actionlint 1.7.12 静态检查通过，JS 语法及 `git diff --check` 通过。本机 GUI 入口已运行，尚未加入未验证的远端 GUI 环境；没有新增 lint 规则或强制本地 hook。本机 Node/macOS 版本与远端配置不同，不能以本机通过代替远端结果。 | `actionlint .github/workflows/checks.yml`，exit 0；本轮未推送，不能提供远端运行链接。 |
| 分支保护 / rulesets | **无法确认。** 对 main 的 protection 和仓库 rulesets 实际查询均返回 HTTP 403，提示私有仓库需升级套餐或公开仓库。不能据此声称没有保护，也不能声称检查已成为强制合并门槛；本轮未更改仓库设置。 | `gh api repos/a1457139709/VibeBridge/branches/main/protection`；`gh api repos/a1457139709/VibeBridge/rulesets`。 |

保留用户体验项：使用上面的新应用确认原工作场景中的灰字可读性、真实 CLI 操作手感，以及反馈所指的其他方向键组合（如有）。这不是让用户补做保存、重开、输入归属或进程清理测试；这些技术检查已由 agent 执行。未复现项仍保留为未复现，不作为已修复问题关闭。

本轮保留了进入任务时已有的 `docs/issue-24-verification.md` 至 `docs/issue-28-verification.md` 删除状态和原有 `work/` 内容。没有复制或使用原型实现。
