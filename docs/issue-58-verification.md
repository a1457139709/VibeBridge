# Issue #58 验证记录

对应 [#58：修复 QA 六项 UI 反馈](https://github.com/a1457139709/VibeBridge/issues/58)、[SPEC #57](https://github.com/a1457139709/VibeBridge/issues/57)；人工指南已更新至 [#53](https://github.com/a1457139709/VibeBridge/issues/53)。所有人工判定保持空白。

## 构建与范围

- 验证时间：2026-10-13 至 2026-10-14，Asia/Shanghai。
- 环境：macOS 26.6.2（25G83）、Node 26.8.1、Electron 44.5.1。
- 起点：`389c25beae9c85d324015cf0fb95e5c2fd4ec444`。
- 六项修复提交：`4761c4fc18ee194e241d6b7e778bc34b7359a46e`；本记录所在提交另含审查发现的拖动中标题更新回归修复。
- 使用 `npm run build` 的正式 `dist`，真实 Electron 窗口、原生输入、PTY 及受控 CLI。没有使用原型代码。
- #56 新外观控件、#51 标题过滤不在此次实现范围。

最终构建 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `dist/main.cjs` | `40124dd9b7303dc5b2d2e67811d03afdd38e3f2dce211f2ff761da10dd0a113b` |
| `dist/renderer/assets/index-6wu_io7k.js` | `c9a05383f5a94bd2c75da2ec210045ed8ad58841726915b2ad09d723c81b1100` |
| `dist/renderer/assets/index-Cik8OG2s.css` | `b6b52199c59e76273a58710f8b8c701aa1b8ec55e6c65d1e34331620a2caa156` |

## 执行结果

| 命令 | 结果与覆盖 |
| --- | --- |
| `npm run build` | 通过，含 TypeScript 检查。Vite 提示既有单块产物超过 500 kB。 |
| `npm test` | 最终构建后再次通过 33/33，约 34.7 秒；零失败、零跳过。启动失败等日志来自故障用例。 |
| `npm run test:desktop` | 通过。原有完整桌面流程、4/10 面板负载、原生输入、设置、退出与重开。 |
| `npm run test:desktop -- --settings-drafts` | 通过。三分类非默认保存基线、并存草稿、分别保存／默认／放弃；真实写盘失败与重试；命令反馈、迟到结果隔离、焦点、滚动、窄窗口。 |
| `npm run test:desktop -- --settings-migration` | 通过。放弃与恢复后的迁移冲突按真实保存值显示。 |
| `npm run test:desktop -- --titles` | 通过。共享标题、同项目／跨项目定位、临时放大、原生输入、长标题、通知、离开保护及真实重开。 |
| `VIBEBRIDGE_TEST_SKIP_NATIVE_BLUR=1 VIBEBRIDGE_TEST_EVIDENCE=outputs/issue-58/light npm run test:desktop -- --panels` | 浅色通过，含审查新增回归及真实重开；明确跳过真实窗口失焦，不能作为该项通过证据。 |
| `VIBEBRIDGE_TEST_THEME=dark VIBEBRIDGE_TEST_SKIP_NATIVE_BLUR=1 VIBEBRIDGE_TEST_EVIDENCE=outputs/issue-58/dark npm run test:desktop -- --panels` | 深色通过，含审查新增回归及真实重开；明确跳过真实窗口失焦，不能作为该项通过证据。 |
| `npm run test:desktop -- --panels` | 尝试过，阻塞于原生窗口聚焦前置条件。系统返回 `CGSSessionScreenIsLocked=Yes`，没有用合成 blur 事件替代。 |

桌面命令偶有 Electron Shared Dictionary 缓存告警；已通过的测试均正常退出。第一次受限沙箱服务测试因无法检查进程而失败，取得执行授权后的完整测试通过。

### 面板与拖动

- 横向、纵向、嵌套手动下限均保留可辨认标题；测试读取实际文字区域，确认标题与导航一致。
- 本轮 `Alpha billing workspace` 面板实际手动下限为 **109 × 33 CSS px**，含 slot 留白为 117 × 41；`Untitled task` 回退宽度为 112。下限由实际字体、最多 12 个标题字符及省略号、图标、标题栏和边界共同确定，不是固定终端列行数。标题变化可使宽度下限不同，完整长标题不会无限抬高下限。
- 主窗口压缩可低于手动下限，保持原比例；不足面板只能增大，两侧不足禁止继续拖动。小窗口仍能新增面板。
- 三个 Codex 分别采用 Alpha／Bravo／Charlie 标题；往返、重复导航均验证唯一选中、原生输入接收方、原终端 DOM 和运行实例连续。
- 拖动期间仅 A 半透明跟随；B 或 C 不透明显示在 A 原区域，原实体只隐藏绘制。原区域命中稳定，B→C 无累积交换。真实终端几何、PTY 尺寸、文本选择、原生输入目标、后台输出、运行实例和保存布局保持不变。
- 来源、无效目标、Escape 取消及有效松手、项目切换、真实重开通过。真实窗口失焦另列待办。
- 使用 Electron DevTools 媒体模拟检查 `prefers-reduced-motion: reduce` 下的预览及取消；未把它写成使用者的系统减弱动态效果体验结论。
- 审查补充真实 OSC 标题更新回归：宽度处于紧凑临界值的面板，在按住拖动时由普通标题变成长宽标题，真实终端几何及 PTY 尺寸不变；取消后再按最新标题更新紧凑布局。

### 设置与图标

- 共享权威默认值和当前分类操作，三个分类分别验证默认值仅进草稿、放弃返回最近保存基线、其他分类草稿不受影响、保存失败保留草稿。
- 三种 Agent 输入框均检查聚焦与滚动后的轮廓；Mac 滚动条侧预留空间。空反馈不占额外行，有效成功／失败、长路径反馈仍可读。
- 命令检查仍由用户触发；编辑、放弃及恢复会失效旧检查结果。使用公开 Electron IPC 边界控制迟到响应，生产代码没有测试入口。
- Codex 共用官方 [OpenAI Blossom SVG](https://cdn.oaistatic.com/assets/favicon-l4nq08hd.svg)，遵循[品牌资源说明](https://openai.com/brand/)。浅／深主题截图涵盖正常与最小面板、导航、创建分配与预览、添加 Agent、设置。品牌图形与选中／焦点轮廓独立。

## 证据

本地可打开 [截图与连续录屏索引](../outputs/issue-58/index.html)。`outputs/` 未纳入 Git，证据保留在本工作区。

- [浅色拖动录屏](../outputs/issue-58/light/drag.mp4)、[深色拖动录屏](../outputs/issue-58/dark/drag.mp4)：连续采集真实 Electron surface，按真实时间戳编码，包含按下、悬停 B／C、取消、减弱动态效果及有效松手。
- `light/`、`dark/` 中 `panels-*.png`：缩小前、宽高下限、往返选中、恢复；`drag-*.png`：按住与结束中间状态；`icons-*.png`：各图标入口。
- `settings-focus-{codex,claude,pi}.png`、`settings-check-*.png`、`settings-long-feedback.png`、`settings-narrow.png`：焦点、滚动、空／有反馈、长结果及窄窗口。
- `settings-{Agent,外观,快捷键}-{draft,defaults}.png`：统一操作与逐分类恢复前后。

截图进行了实际图像审阅，未用 SVG 路径或 CSS 常量断言代替视觉证据。

## Standards

独立审查：0 项。未发现违反项目文档标准或新增可处理的代码异味。共享默认值、终端所有权与仅绘制的交换预览符合项目边界。增量复核确认观察器正确清理。

## Spec

独立初审：1 项 P2。真实 OSC 标题变化可在拖动中切换紧凑布局，进而提前改变 PTY 尺寸，违反按住预览期间尺寸不变的要求。

已用真实 Electron 红测复现：终端区域高度由 735 变为 766，y 由 116 变为 85。修复为拖动期间延后紧凑布局更新，结束后依据最新标题重新计算；回归检查实际几何、PTY resize 事件与取消后的布局更新。原审查者复核：问题已解决，无剩余实现问题。

审查汇总：Standards 0；Spec 初审 1 项 P2、已修复，剩余 0。

## 尚待完成

- **真实主窗口失焦取消**：Mac 锁屏阻止原生聚焦。已请求使用者解锁，仍需在解锁后运行未设置 `VIBEBRIDGE_TEST_SKIP_NATIVE_BLUR` 的 `--panels` 命令；此项未通过。
- 用户对正常／减弱动态效果、真实 CLI 和六项修复的人工体验结论仍留在 #53 等待填写，自动验证不代签。
- #51 标题过滤合入后，复查正常／最小面板、导航及切换提示使用同一显示标题。
- 提交保留在本地 `main`，未推送。GitHub QA 中的仓库文档链接将在提交发布后可用；当前可复查本地文档与证据。
