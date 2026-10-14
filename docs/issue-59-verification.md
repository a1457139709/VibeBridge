# Issue #59 验证记录

对应 [#59：启用三类 CLI 稳定会话标题过滤](https://github.com/a1457139709/VibeBridge/issues/59)、[SPEC #57](https://github.com/a1457139709/VibeBridge/issues/57)、[#36 标题决议](https://github.com/a1457139709/VibeBridge/issues/36#issuecomment-6106743467)及 [2026-10-13 用户真实样本确认](https://github.com/a1457139709/VibeBridge/issues/53#issuecomment-6147190412)。人工过滤版指南维护在 [#53](https://github.com/a1457139709/VibeBridge/issues/53)，原观察版案例和确认记录保留。

## 构建与实现

- 时间：2026-10-14，Asia/Shanghai。
- 起点：`39dcbdd66427fa59125f48cc6d3e915889550503`。
- 实现提交：`63a1e1963868969b28c7ddeb5885463fe22ba4d9`，本地 `main`，尚未推送。
- 环境：macOS 26.6.2（25G83）、Node 26.8.1、Electron 44.5.1。
- 使用 `npm run build` 的正式 `dist`、真实 Electron 窗口、PTY 和既有可控 CLI。没有使用原型代码。
- 共享显示函数接收 Agent 类型和原标题；面板、导航及切换提示共用它。紧凑面板观察按显示名变化更新，不随原始状态符号重建观察器。
- 原始标题、PTY 输出、运行归属及持久化代码均未修改；`dist/main.cjs` 哈希与本次起点相同。没有 hook、CLI 配置／参数注入、正文解析、目录推断、会话文件读取、超时清空或自动命名。

最终构建 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `dist/main.cjs` | `40124dd9b7303dc5b2d2e67811d03afdd38e3f2dce211f2ff761da10dd0a113b` |
| `dist/renderer/assets/index-BXOBzd8x.js` | `2e4360c1afe3fff587f7f62b81841e465ca09bf333a0d2541573c8113153f422` |
| `dist/renderer/assets/index-Cik8OG2s.css` | `b6b52199c59e76273a58710f8b8c701aa1b8ec55e6c65d1e34331620a2caa156` |

## 当前过滤边界与待确认事项

本版只移除决议逐字列出的首尾字符：Claude `✳ ◐ ◑`、Codex `⠋ ⠙ ⠹`。不把“看起来像符号”当作扩大字符集合的理由；名称内部的这些字符、连续空格、中文、emoji 和其他合法符号保留。

- Claude 工具名 `Claude Code` 和无信号／空标题使用 `Untitled task`。
- Codex 正常单个 ` | ` 提取会话名；不含 `|` 的目录型标题按 #36 用占位。含管道但不符合正常分隔格式时保留可读原文。
- pi 正常 `π - <目录>` 用占位，`π - <名称> - <目录>` 提取名称，其他前缀保留。
- 多个、重叠或空字段分隔符不猜测名称／目录，保留去已确认状态符号后的可读原标题。任意目录文字均按格式处理，没有硬编码 VibeBridge、A 或 111。

本轮已提出补充确认：是否明确采用 Codex 标准十帧 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`，并确认上述歧义回退边界。尚未收到答复，**未扩展到其余七个字符**。因此当前录屏和自动测试只证明已列举符号的稳定性，不能宣称覆盖真实 Codex 完整忙闲周期。本票保持开放，待边界确认及实现后人工验收。

## 自动验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过；各生产修改后也随正式 build 检查。 |
| `npm test -- tests/titles.test.ts` | 4/4 通过：OSC 0/2 分片与连续信号、原标题／输出、迟到旧实例隔离、目录重启、工作台重开、迟到启动。 |
| `npm run build` | 通过。Vite 保留既有超过 500 kB 的块大小提示。 |
| `npm test` | 最终完整套件 33/33 通过，零跳过，约 34.3 秒。 |
| `VIBEBRIDGE_TEST_EVIDENCE=outputs/issue-59 npm run test:desktop -- --titles` | 通过，含真实退出／重开。所有已确认样本逐项检查三处文字、原始数据、未知／歧义／空标题、连续状态变化、真正改名和原生输入目标。602 个动画帧中的六个可见标题保持不变。 |
| `npm run test:desktop -- --panels` | 通过，未跳过原生失焦。正常／最小面板显示过滤名，手动下限实测 109 × 33 CSS px；选中／输入、拖动中标题更新、真实终端与 PTY 尺寸、取消／提交及重开均通过。 |
| `npm run test:desktop` | 通过：创建、4/10 面板负载、布局、交换、放大、原生输入、设置、退出及重开。 |
| `git diff --check` | 通过。 |

TDD 从真实 Electron 失败断言开始，依次确认 Claude 未命名、Codex 命名、pi 未命名、Codex 目录型占位及未知空字段；修复后通过。没有新增内部解析器测试层。

首次受限沙箱的服务测试因无法检查受管进程而失败，获得运行权限后通过。桌面偶有 Electron Shared Dictionary 缓存告警；设置写入失败和启动失败日志来自既有故障用例。新增采样器曾与已有桌面采样变量冲突，已隔离作用域，完整标题流程重跑通过。

## 证据

本地 [截图与录屏索引](../outputs/issue-59/index.html)，`outputs/` 未纳入 Git，保留在本工作区：

- [三类面板及导航](../outputs/issue-59/three-filtered-titles.png)。
- [Claude 三处一致](../outputs/issue-59/claude-panel-navigation-notice.png)、[Codex 三处一致](../outputs/issue-59/codex-panel-navigation-notice.png)、[pi 三处一致](../outputs/issue-59/pi-panel-navigation-notice.png)。
- [已列举符号的稳定性录屏](../outputs/issue-59/status-stability.mp4)：可控 CLI 连续状态信号、静默及原生输入，5.035 秒，34 张真实 Electron surface 截图按真实时间戳编码为 2560 × 1720 MP4；不是实际三类 CLI 的忙闲录屏。
- `build.log`、`tests.log`、`service-titles.log`、`titles.log`、`panels.log`、`desktop.log` 保留实际命令结果。

截图已视觉审阅，视频从 0／2／4 秒解码检查可读性。录屏与逐动画帧文字检查互补；不把 602 个 DOM 采样帧写成 602 张视频截图。

## Standards

独立审查：0 个文档标准违规，0 个可处理的代码异味。显示规则集中、领域词汇一致，测试沿用公开桌面与服务接缝，未发现原型代码复用。

## Spec

独立静态审查：当前确认范围内 0 个实现缺陷，0 个额外范围。审查时提醒 #53／交付记录尚在编写，以及字符集合决议待确认；本记录明确保留该限制。已列举规则不代表完整真实 CLI 忙闲稳定性通过。

审查汇总：Standards 0；Spec 实现缺陷 0，完整字符集合与最终人工验收待补。

## 尚待人工执行

- 回答完整 Codex 字符集合及歧义边界的补充决议；确认后补齐相关实现与回归。
- TF01–TF07 的真实 CLI 自动标题、Claude／Codex `/rename`、pi `/name`、三处一致性、完整忙闲录屏、精确版本及真实关闭标题样本。
- Claude 首轮自动标题原文、pi 首轮前后对比等 #53 原有缺口继续保留；2026-10-13 可见文字样本不冒充 OSC 字节捕获。
- 用户原有 README、词汇表和文档删除保持原样，未纳入本次提交；未推送提交，也未关闭 #59。
