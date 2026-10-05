# 实现技术选型：事实与替代路线

核查日期：2026-10-02。本文是技术事实笔记，不是技术选型决议。来源为当天访问的一手文档；`latest` 文档与仓库默认分支会变化，实施时仍需锁定版本。未做性能基准或崩溃清理实验。

后续选型状态：用户已确认 Electron + xterm.js + node-pty、一个共用独立终端管理进程，以及“可手改的简单配置放本地文件、程序自动维护的持久化与重启恢复状态放 SQLite”。设置界面修改主题、快捷键及 Agent 启动命令时也写回同一本地配置文件，不另存 SQLite 覆盖值。外部手改文件重启应用后生效，不做自动监听；设置界面写回同一文件，主题按后续真实终端决议改为重启后统一生效，快捷键即时生效；Agent 命令变化用于之后启动的实例。下文保留比较依据；整体采用 JSON 或改用 Tauri 的建议未被采纳。最新决议见[技术选型复核](https://github.com/a1457139709/VibeBridge/issues/14)，规格见 [SPEC](./SPEC.md)。

2026-10-05 后续收敛：技术选型票已关闭。按[最新实施约束](https://github.com/a1457139709/VibeBridge/issues/14#issuecomment-5992132602)，通过 PTY 直接启动解析后的 Agent 程序，不额外套 shell；先由主进程与共用终端管理进程相互检测和清理，不预先增加第三个监控服务。配置完整临时写入后替换、应用内串行保存及 SQLite 事务为基础保存路线；缺失采用默认值，损坏和读写失败明确提示。外部编辑冲突处理暂缓，约定退出应用后手改。先复用 xterm.js 缓冲与绘制，按实测需要补流量控制；开发与正式运行共用实现，构建和依赖准备在运行前完成。下文候选比较保留为历史依据，不自动形成额外组件或功能要求；环境接入、异常清理、可靠保存与性能仍需实施验证。

调研当时的讨论前提：个人 macOS 工作台；日常 2–4 个运行实例，峰值 10 个；原生 Agent CLI 交互；只保存项目、面板配置、布局配置及设置，不保存终端记录或 CLI 历史会话。TypeScript + React 已获用户接受。xterm.js + 真实 PTY 方向已有共识，但实际视觉、输入与 CLI 兼容性仍待验证。

## 桌面壳：Electron 与 Tauri

| 技术 | 已核实事实 | 针对本项目的推论与代价 |
| --- | --- | --- |
| Electron | 随应用携带 Chromium 与 Node.js；主进程运行 Node，管理窗口、应用生命周期和原生桌面 API。[官方介绍](https://www.electronjs.org/docs/latest/)、[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) | 可保留 React 界面，并在 Node 中接 node-pty，应用层主要使用 TypeScript；浏览器内核随应用版本控制。代价是发布包携带浏览器与 Node 运行时。不能仅凭此断言本应用实际内存、耗电或输入延迟数值。 |
| Tauri | 以 Rust 与 WebView 组成桌面应用，可用消息调用 Rust 后端；使用系统 WebView，不把浏览器运行时打入应用。macOS 使用 WKWebView，随操作系统更新。[架构](https://v2.tauri.app/concept/architecture/)、[WebView 版本](https://v2.tauri.app/reference/webview-versions/) | React 与 xterm.js 可以继续保留，PTY 后端可改用 Rust portable-pty；减少随应用分发的运行时，但要维护 Rust 与 TypeScript 两侧通信和构建。对个人单一 macOS 设备，跨平台 WebView 差异不是主要理由；本机 WKWebView 下的终端表现仍需实测。 |

Electron 的有力理由是 TypeScript/Node 集成直接、运行时可控；本项目不应把暂未需要的跨平台能力当作主要选型理由。Tauri 是有效替代，不代表自动更流畅或自动满足进程清理要求。这些是基于以上架构事实的比较，不是测量结论。

## 终端画面与真实进程是两层

**xterm.js 负责终端呈现与输入。** 它是网页终端组件，处理终端控制序列，支持终端程序、鼠标事件、CJK 与输入法；它本身不是 shell。其官方示例把 xterm 输入写入 PTY，再把 PTY 输出写回 xterm。[xterm.js 官方说明](https://github.com/xtermjs/xterm.js#readme)

**node-pty 负责伪终端与 CLI 进程连接。** 它提供 Node 的 `forkpty` 绑定，在 macOS 上启动带伪终端的程序并读写数据，支持行列尺寸变化。它使程序获得终端环境，而非仅收集普通 stdout。node-pty 官方明确提示它不适合跨多个 Node worker threads 使用。[node-pty 官方说明](https://github.com/microsoft/node-pty#readme)

因此 xterm.js 与 node-pty 是互补组件，不能互相替代。保留真实 CLI 交互意味着某种终端模拟器与 PTY 接入仍有必要；普通日志文本区域不能等价覆盖交互式 TUI。

可替代路线：

- **xterm.js + portable-pty**：保留 React 网页终端，把进程侧移到 Rust。portable-pty 提供系统 PTY 的跨平台 Rust API，是 WezTerm 项目的一部分；包含创建 PTY、启动命令和读写接口。[portable-pty 文档](https://docs.rs/portable-pty/latest/portable_pty/) 适合作为 Tauri 路线的候选，具体吞吐与退出清理仍需应用自己完成。
- **Swift/AppKit + SwiftTerm**：SwiftTerm 提供 macOS `TerminalView`，其 `LocalProcessTerminalView` 可连接 Unix PTY 并运行本地命令。[SwiftTerm 官方说明](https://github.com/migueldeicaza/SwiftTerm#macos-nsview) 这是原生终端方向，完整采用通常意味着改用原生界面体系；在 React 应用中嵌入需要另行设计原生桥接，不是 xterm.js 的直接 npm 替换品。没有证据在本项目负载下保证它一定更快。

Electron 接 node-pty 的额外成本：原生 Node 模块可能需要针对 Electron ABI 重编译，必须验证打包后的本机架构产物。[Electron 原生模块说明](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) 使用 Electron 不意味着完全没有原生编译环节。

## PTY 放主进程还是独立进程

Electron 的主进程和 utilityProcess 都提供 Node 环境。官方把 utilityProcess 定位为可承载易崩溃组件、CPU 密集工作等的独立子进程，并支持 MessagePort 通信。[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model#the-utility-process)

| 候选 | 推论：收益 | 推论：成本与未证实项 |
| --- | --- | --- |
| 主进程直接管理 PTY | 通信和生命周期实现较少 | 原生 PTY 层故障与窗口管理处于同一故障范围；主进程突然死亡后，已经死亡的进程无法执行自己的清理代码。 |
| 一个 utilityProcess 集中管理 PTY | 将 PTY 原生组件与主进程分开，提供可观察的子进程退出事件 | 增加消息协议和生命周期状态；单个 host 故障仍影响其全部运行实例；不能由“独立进程”推导出“主进程死亡时全部后代一定清理”。 |
| 独立 helper/watchdog | 可探索由存活的监控方发现主进程丢失并清理所管理运行实例 | 这是额外实现方案，需设计父进程失联、退出时序、进程身份与误杀防护；本文没有证明其实现正确。 |

Electron `utilityProcess.kill()` 的文档只说明终止那个 utility process，POSIX 使用 SIGTERM 并回收它；没有声称递归终止任意 CLI 后代。[utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process#childkill) macOS 的 `kill` 可针对单 PID 或进程组发送信号；进程组是一种可用原语，不是“所有后代”的同义词。[Apple kill 手册](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)

**待验证约束**：无论选 Electron 还是 Tauri，都要验证正常退出、强制结束主进程、PTY host 故障、CLI 自建子进程的清理结果。utilityProcess 是故障隔离候选，不应宣传为崩溃清理保证。这里不把退出后保活服务引入产品。

## 配置持久化：SQLite 与 JSON 快照

**SQLite 的实际理由**是可靠的本地事务与结构化查询，而非它能恢复 Agent 会话。SQLite 本就面向应用的本地存储，其事务通过日志与同步写入等步骤处理崩溃中断；仍依赖底层系统兑现相关存储语义。[适用场景](https://www.sqlite.org/whentouse.html)、[原子提交](https://www.sqlite.org/atomiccommit.html)

**JSON 是有效候选**，因为当前存的是一份体量有限的配置快照，没有终端记录检索需求。这是根据产品范围作出的适配推论，并非 JSON 自带事务。可靠方案至少需要单一写入方、串行保存、格式版本与校验、同目录临时文件写完整后替换、失败恢复策略。Node 文档明确并发覆盖写同一文件不安全，且一次 `writeFile` 可能包含多次底层写入；直接覆盖目标文件不足以构成可靠快照。[Node 文件 API](https://nodejs.org/api/fs.html#fspromiseswritefilefile-data-options)

macOS `rename` 可在同一文件系统内替换文件，文档描述替换期间目标名始终存在的语义。[Apple rename 手册](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html) 临时文件替换解决的是避免读到半份新配置；断电持久性另有 flush、目录元数据与文件系统语义，不应把一次 rename 夸大成与数据库完整事务保障等价。

比较阶段的候选判断（已由上述分层存储决定收敛）：如果要清晰可见、便于手工备份的一份配置且只有一个写入方，JSON 快照值得讨论；如果希望多个对象变更天然一起提交、以后有结构化查询，SQLite 更合适。二者都需要配置版本迁移、坏数据处理与备份；SQLite 不需要伴随单独数据库服务器，也不构成保存 CLI 历史的理由。

## 能由资料回答与不能由资料回答的边界

资料可以确认各组件职责、运行时结构、候选 API 与已知集成成本。以下仍须真实 CLI 与目标 Mac 实测，不能在选型说明中写成已达成：10 个运行实例的性能；中文输入法与复制粘贴；真实 CLI 的重绘和尺寸变化；打包后原生 PTY 可用性；主进程突然死亡后的清理；配置中途写入失败后的恢复。
