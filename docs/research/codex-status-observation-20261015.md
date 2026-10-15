# 保留原生 Codex TUI 时观察结构化状态事件

研究日期：2026-10-15。研究对象：本机 `codex-cli 0.162.1`，以及当日官方文档；同版本官方源码固定在 `rust-v0.162.1` 对应的提交 [`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`](https://github.com/openai/codex/tree/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d)。源码标签与本机版本号一致，不代表已经验证本机二进制的构建来源或全部运行行为。

对应研究：[核实保留原生 Codex CLI 时观察结构化状态事件的可行性](https://github.com/a1457139709/VibeBridge/issues/75)。所属地图：[Agent 状态显示与项目汇总决策地图](https://github.com/a1457139709/VibeBridge/issues/68)。本报告补充[既有 hook 能力研究](https://github.com/a1457139709/VibeBridge/issues/70#issuecomment-6193766167)，不覆盖其历史证据。

## 结论

**保留原生 TUI、与另一个连接共同使用同一个 App Server，在官方文档和 0.162.1 源码中有依据。对当前任意原生 CLI 运行直接增加一个完全无副作用、能准确对应面板的旁路观察器，尚未得到证明。不能把这两件事当成同一个结论。**

- 官方明确提供 `codex --remote <endpoint>`；第二个客户端可在**同一服务器**上通过 `thread/resume` 加入已经运行的 thread。此时不另建会话，同版本源码保留进行中的 turn，加入订阅并重放尚未解决的审批请求。它不是专门的只读观察接口。[原生 TUI 连接文档][app-server]、[运行中 resume 实现][resume-source]、[订阅与待处理请求重放][lifecycle-source]
- 当前本地嵌入模式并没有在本次核对的公开接口中暴露“给任意 PID 附加观察连接”的能力。另起一个 App Server，再用同一个历史 thread ID 调 `resume`，不是加入原进程；官方测试会拒绝另一个进程已有 active writer 的情况。[嵌入客户端说明][client-readme]、[跨进程 writer 测试][writer-tests]
- 协议有能力区分处理开始、等待审批/输入、本轮正常结束、中断及本轮失败；重试错误有 `willRetry: true`。这些是**已绑定 thread 的结构化事实**，不是面板绑定已经解决的证明。[事件文档][app-server]、[错误与重试实现][events-source]
- 两个主要缺口是：如何在 TUI 新建、恢复、切换时获得可靠的 `VibeBridge run → 当前 thread` 对应关系；以及共享服务与现有“面板退出即结束运行实例”的进程所有权如何兼容。目录、标题、历史 ID、最后活动时间都不能独立解决它们。[TUI 当前 thread 状态][tui-routing]、[VibeBridge 终端宿主][vb-host]
- 官方当日文档仍将 App Server 命令和 WebSocket 传输标记为实验性，明确不支持生产工作负载。因此可以安排有边界的验证，但本次事实研究不能把方案标记为已具备生产接入条件。[成熟度说明][app-server]

用户要求：网络或服务器故障使本轮无法自行继续、需要用户重新发指令时显示 Error。这个需求已经接受。本报告只核实可用信号，不决定完整状态集合、图标、清除条件、汇总位置或最终架构。进程退出后立即移除面板和计数的产品约束保持成立；进程退出不是一个需要保留的 Error 面板。

## 证据范围与实际执行

证据分为三层：**文档说明**、**同版本源码/源码内测试**、**本机实际检查**。阅读官方测试不等于在 VibeBridge 中运行过这些测试。

本机实际执行的命令只有版本、帮助及离线 schema 生成：

```text
codex --version
codex --help
codex resume --help
codex app-server --help
codex app-server proxy --help
codex app-server daemon --help
codex app-server generate-json-schema --out <任务临时目录>/stable-schema
codex app-server generate-json-schema --out <任务临时目录>/schema --experimental
```

结果：版本为 `codex-cli 0.162.1`；帮助列出了 `--remote`、`--no-daemon`、`app-server proxy --sock`、daemon 子命令；两套 JSON Schema 均成功生成。命令提示无法创建 PATH aliases，但检查成功退出。没有启动模型 turn、连接现有用户服务、执行 daemon start/stop/version、读取凭证、读取用户会话内容或修改 CLI 配置。没有修改生产代码。

生成文件的 SHA-256 可复核本机接口快照；schema 未作为额外交付物提交：

| 不含 `--experimental` 的文件 | SHA-256 |
| --- | --- |
| `v2/ThreadResumeParams.json` | `948779cace55dda4384689a1627cd6675aa4782744bb5820cca16bfc0118586c` |
| `v2/ErrorNotification.json` | `63518d8faae38b8eb73518d59b113f77603d238dd0cf36260b4232f381f43f8c` |
| `v2/TurnCompletedNotification.json` | `69413578ec3ecd02691424bdeb9d640c7244b4ca4c5c3ef26f69a2efe7c37db8` |
| `v2/ThreadStatusChangedNotification.json` | `26f3c60c1b73f7fa2d31c74429cdc36f8746c76c33e3d314b3fb61d3661f05f6` |
| `v2/ThreadTurnsListParams.json` | `2a8b93d7d4437cc25e16a1dde16d8db3c338d39e16c5eece2a56e943a21577d7` |

核心 resume、状态、turn 结束和 retry 字段存在于未启用实验扩展的 schema 中。**字段不需要实验能力声明，不等于整个传输或部署模式已获得生产支持。** 文档与生成 schema 在核心字段上相符；本报告中的具体实现边界优先注明固定源码版本。固定版本仓库也提供[完整协议 schema][protocol-schema]，便于独立核查字段；该目录中的完整导出与本机未启用实验字段的导出范围不必相同。

## 原生 CLI 与观察连接的能力矩阵

| 场景 | 已证实的能力 | 限制 / 尚未证实 |
| --- | --- | --- |
| TUI 明确连接共享服务 | 官方 `--remote` 接受 `ws://`、`wss://`、`unix://`、`unix://PATH`；本机帮助也有这些选项 | 会改变启动/后端连接方式；是否符合应用现有生命周期仍需验证。[CLI 文档][cli-reference] |
| 普通 `codex` 启动 | 同版本 TUI 源码会按显式 endpoint、可复用 daemon、启动配置及 executor 等条件选择 Remote、LocalDaemon 或 Embedded | 不能只看启动命令是 `codex` 就断言当前使用哪一种。本次未探测用户正在运行的 daemon。[选择逻辑][tui-target] |
| 已有运行 thread，同一 server，已知 thread ID | `thread/resume` 重新加入现有运行，注册当前连接；同版本测试覆盖继续流式处理、跳过历史载荷、重放审批 | 是有作用的 resume，不是只读 subscribe；没有 `runningOnly` 原子条件，thread 已冷却时可能成为冷恢复。[实现][resume-source]、[运行中测试][resume-tests] |
| 已有运行 thread，另一个 server 进程 | 没有证据表明能跨进程转接到原 writer | 官方测试明确拒绝已有 active writer。历史路径/ID 不会把新 server 变成原会话的观察连接。[writer 测试][writer-tests] |
| 只读查询已知 thread | `thread/read` 返回运行状态但不加载/订阅；`thread/turns/list` 可读结构化 turn 历史，无需 resume | 可以研究低副作用查询，但实时性、缺口恢复和面板归属仍需验证；这不是解析 transcript 文件。[查询文档][app-server] |
| 通过 `thread/loaded/list` 找运行 | 可列出 server 内存中已加载 thread | loaded 不等于正在忙碌，也不等于属于当前工作台面板；包含缓存、其他客户端及可能的子 Agent。[查询文档][app-server] |
| 专用只读 observer 权限 | 本机 initialize schema 没有发现这种 capability；客户端有 name/title/version，且可按方法关闭部分 notification | `optOutNotificationMethods` 不作用于 server request；不能靠关闭通知获得只读权限。[初始化与 opt-out 文档][app-server]、[请求路由源码][outgoing-source] |
| 当前面板身份 / TUI 显示中的 thread | TUI 内部维护 `active_thread_id`、`primary_thread_id` 等状态 | 本次没有找到对独立客户端发布“某 TUI 连接目前显示哪一个 thread”的公开接口。[TUI 路由源码][tui-routing] |

`app-server proxy --sock` 的本机帮助说明可以把 stdio 转给已经运行的控制 socket。它可作为连接已有服务的一种运输工具，但帮助没有声明它能给任意嵌入式 TUI 增加端点，也没有解决面板身份问题；本次没有实际运行 proxy。

### 同一服务器上的 resume 为什么仍有副作用

0.162.1 的 `resume_running_thread` 先在当前 `thread_manager` 查找运行对象，随后复用它而不是重新构造 conversation。若传入 history，则拒绝对运行中对象这样恢复；若 path 与活动路径不符也会拒绝。已有订阅或仍在运行时，冲突配置通常会被忽略并记录警告；没有订阅的空闲缓存对象在某些配置差异下则可能被关闭并冷恢复。因此，观察连接不应传模型、权限、工作目录等覆盖参数，且“先查询 loaded 再 resume”存在状态变化间隙。[具体实现][resume-source]

即使只传 thread ID，resume 也会注册订阅者、设置 app-server 客户端信息、发送恢复快照及重放待处理请求；恢复快照后还会向扩展发出 idle 生命周期事件（若该 thread 当时空闲）。这些事实使“无副作用旁观”这个表述不成立。它们是否会对特定用户扩展产生可见效果，本次未实测。[resume 实现][resume-source]、[响应和重放顺序][lifecycle-source]

## 身份关联：thread、turn 与运行实例不能混用

本机 schema 和官方源码区分以下身份：

| 身份 | 能说明什么 | 不能说明什么 |
| --- | --- | --- |
| VibeBridge `run.id` / `panelId` / `projectId` | 工作台本次启动与面板、项目的归属 | Codex 协议不会自动携带这些字段。[当前宿主][vb-host] |
| `thread.id` | 一个 Codex 对话分支 | 不是某一次面板进程的 ID；两个客户端可能加入同一个 thread。[resume 实现][resume-source] |
| `thread.sessionId` | 同一 live session tree 的根身份；fork 可共享 | 不是每个独立 thread 或每个 TUI 面板的唯一身份。见本机 `ServerNotification.json` 的 Thread 定义。 |
| `turn.id` / `turn.rootTurnId` | 一轮处理，以及自动续跑等工作链的根 | 不证明整个业务任务结束，也不代表运行实例退出。见本机 Turn 定义及[Goals 文档][goals]。 |
| `originator` / `source` / `cwd` | 创建来源、来源类型与目录等元数据 | originator 描述创建时来源而非当前客户端；相同目录、CLI 来源或历史来源不能区分本次运行。见本机 Thread 定义及[客户端身份说明][client-readme]。 |
| JSON-RPC request ID / server connection ID | 一次协议请求或连接 | 不等于面板；server 内部知道连接与订阅集合，本次未找到公开的 TUI active-thread 映射导出。见[连接订阅表][thread-state]。 |

当用户在 TUI 新建对话、恢复历史、切换到已有 thread 或浏览子 Agent 时，面板进程可以继续存在。TUI 自己有这些路由状态，但“观察到一个新 thread”“某目录最近有事件”都不足以把该变化归给唯一面板。给每个面板分配独立 endpoint、从 hook 传递运行标记、或在协议边界建立明确绑定，都是**待评估的候选**，不是本报告已验证的架构。尤其不能假定共享 server 启动时继承的环境变量会随以后每个 TUI 连接自动变化。[TUI 路由][tui-routing]、[VibeBridge 启动方式][vb-host]

若两个面板加入同一 live thread，它们会观察同一轮处理。该事实不能自动回答产品应按面板还是按实际工作去重计数；这是后续状态/汇总规范必须作出的决定，研究不代替决定。

## 状态、错误与时序证据

| 目标事实 | 官方结构化证据 | 可作出的判断与边界 |
| --- | --- | --- |
| 开始处理 | `turn/started`，turn 状态 `inProgress`；`thread/status/changed` 的 `active` | 已开始该 turn；不能根据没有输出判空闲。[事件文档][app-server] |
| 等待审批 | `ThreadStatus.activeFlags` 中 `waitingOnApproval`；命令、文件、permissions 等 approval request | 等待请求解决，而不是根据终端文案猜测。自动审批模式下不一定是等待人；flag 语义应按实际模式核对。[状态实现][thread-status] |
| 等待结构化输入 | `waitingOnUserInput`，如 `item/tool/requestUserInput`，及关联 request ID | 不涵盖任意文字问句、普通输入框焦点或终端提示；部分请求可超时自动解决。[请求文档][app-server]、[状态实现][thread-status] |
| 本轮正常结束 | `turn/completed` 且 `turn.status=completed` | 只证明这一轮正常结束，不证明所有子任务/业务目标成功，也不保证不会自动续跑。[事件文档][app-server]、[Goals 文档][goals] |
| 仍在重试的错误 | `error` notification 的 `willRetry=true` | 不得当成本轮失败。源码明确不把 StreamError 记入最终失败摘要。[重试实现][events-source] |
| 本轮最终失败 | `turn/completed` 且 `turn.status=failed`，带 `turn.error`；此前可有 `error.willRetry=false` | 已停止这一轮；可支持用户要求的 Error 事实基础。还需结合最新 thread 状态、后续 turn/自动续跑判定是否仍无法自行继续。[结束实现][turn-finish] |
| 中断 | `turn/completed` 且 `turn.status=interrupted` | 与 failed 分开；interrupted 也可能带 error，不能仅凭 error 非空标记 Error。[中断实现][turn-finish] |
| 工具/命令/测试失败 | `commandExecution.exitCode`、工具 item 自身 failed/error 等 | 只说明 item 结果，Agent 仍可处理/重试/修复；不是 turn 终态。[item 文档][app-server] |
| 观察连接断开 | WebSocket/Unix/stdio 传输失败，没有可信后续通知 | 是观察链路失效，不是模型服务失败。连接失效时不能从静默推导 failed/completed。[断开测试][disconnect-tests] |
| CLI/TUI 进程退出 | 工作台掌握的进程生命周期 | 按产品约束移除运行实例、面板及计数；不会把旧 turn 失败遗留在已关闭面板。共享后端是否仍运行必须另行处理。[当前宿主][vb-host] |

### 网络/服务器失败的具体依据

0.162.1 本机非实验 schema 的 `ErrorNotification` 必需字段是 `threadId`、`turnId`、`willRetry`、`error`。`CodexErrorInfo` 包含 `httpConnectionFailed`、`responseStreamConnectionFailed`、`responseStreamDisconnected`、`responseTooManyFailedAttempts`、`serverOverloaded`、`internalServerError` 等类型；`responseTooManyFailedAttempts` 的定义明确涉及达到重试上限。**错误类别描述原因，`willRetry` 和 turn 终态描述此刻是否已经结束，不能只按错误名称决定状态。**

固定版本源码提供以下完整链路：[错误分派][events-source]、[turn 结束转换][turn-finish]、[failed 事件测试][failed-tests]。

1. `EventMsg::StreamError` → 发 `error.willRetry=true`，不写入 turn 的最后错误。
2. `EventMsg::Error` → 先记 thread 的系统错误；只有 `affects_turn_status()` 成立才记录本轮错误，并发 `willRetry=false`。
3. `TurnComplete` → 摘要存在最后错误则发 `status=failed`，否则 `completed`。
4. `TurnAborted` → 发 `status=interrupted`，可携带独立 error。

所以 `thread.status=systemError` **不等价于**产品的“本轮失败”：源码可能在判断 `affects_turn_status()` 之前就设置它。另一方面，`willRetry=false` 不应被解释为整个 Agent 永远不会再活动；还可能出现新输入、排队工作或自动续跑。检测本轮终态与决定 UI 何时显示/清除 Error 是两个需要分开落实的步骤。[状态解析实现][thread-status]、[错误实现][events-source]

正常结束也有同样边界：Goals 在一轮结束后的安全边界可能继续处理，`rootTurnId` 为工作链提供身份线索，但不是“已完成全部工作”的布尔值。需要验证 turn 结束、thread idle、续跑开始、队列/子 Agent 事件之间的实际顺序，避免短暂的完成闪烁或把旧失败覆盖到新 turn。[Goals 官方说明][goals]

## 多客户端审批与重连

普通 server request 会发给该 thread 的订阅连接；源码以全局 request ID 保存回调，收到一个响应或 JSON-RPC error 后就取走回调。另一个连接后来再答，找不到原回调。也就是说，观察客户端若使用“未知 server request 一律回错误”的默认模板，可能抢先结束 TUI 的审批/输入请求；不应把自己当成请求处理者。某些 user verification 流程有专门的唯一 owner 与身份校验，是特例，不能由此推导所有请求都有单一 TUI owner。[请求广播与回调实现][outgoing-source]

运行中 resume 会重放尚未解决的普通请求；`serverRequest/resolved` 在响应或后续清理时通知解决。观察端可以据此管理待处理集合，但“resolved”本身不证明用户批准，也可能是中断/新轮次清理。完整协议客户端必须验证哪些请求应忽略、哪些只记录以及重连是否改变等待行为。本次没有把不响应所有请求宣布为已实测无副作用的方案。[重放实现][lifecycle-source]、[审批文档][app-server]

连接断开不等于 thread 停止。官方测试明确覆盖最后一个订阅者断开后 thread 仍加载，直到空闲超时；文档默认是无订阅且无活动 30 分钟后卸载。增加观察订阅可能延长存活。重连后应重新核对绑定并使用结构化快照/turn 查询补足事实；不能假定缺失的 notification 会完整重放。普通请求有重放证据，不代表所有历史事件都可重放。[断开测试][disconnect-tests]、[订阅生命周期文档][app-server]

## 传输、配置、信任与现有进程管理

官方文档展示的最小形式如下，仅为可核查的连接语法，本次没有运行：

```text
codex app-server --listen ws://127.0.0.1:4500
codex --remote ws://127.0.0.1:4500
```

本地还可选择明确的 Unix socket 路径，避免为本地观察增加网络暴露。非本地连接需要认证与 TLS；客户端把 token 所在环境变量名传给 `--remote-auth-token-env`。本次不需要也未读取 token。连接权限不仅能读状态，还覆盖会话、配置、审批等操作；本次未发现正式的 read-only scope。[连接与认证文档][app-server]

当日滚动文档关于非 loopback 未认证 listener 的默认行为，与固定版本的拒绝启动测试有差异。因此不应依据默认值部署网络监听；若未来验证，需要对目标二进制显式配置并检查认证。本报告不会通过真实暴露端口来消除这一差异。[文档][app-server]、[固定版本认证测试][websocket-auth-tests]

每个连接需要 initialize/initialized 握手；应固定 CLI/server 版本并核对实际生成的 schema。`experimentalApi` 是字段/方法能力开关，不能使未实现接口变可用。避免为观察设置模型、权限、信任或工作目录覆盖；普通冷恢复仍可能触发 MCP 初始化，required MCP 失败会导致 resume 失败，不能误报成用户原 turn 的网络失败。[初始化与恢复文档][app-server]

VibeBridge 当前的终端宿主以 `pty.spawn` 启动 CLI，写入本次 `VIBEBRIDGE_RUN_OWNER`，记录后代进程，面板退出及工作台退出时终止归属进程。本研究引用代码基线为 [`4ff95615c981e2a1312cce386c3e1b72fc35542a`](https://github.com/a1457139709/VibeBridge/tree/4ff95615c981e2a1312cce386c3e1b72fc35542a)，不包括其他任务正在进行的工作区修改。[宿主][vb-host]、[清理实现][vb-processes]

由此产生的**集成推论**是：

- 若接入用户已有 daemon，它可能不属于某个面板进程树；关闭 TUI 不保证后端工作结束。
- 若共享 daemon 由第一个面板启动并继承该面板的 owner 标记，按现有归属清理可能伤及其他仍在使用它的面板。
- 若观察者保持订阅，它本身可能改变最后订阅者与卸载时机。
- 若采用独立服务进程，必须明确谁启动、谁复用、谁关闭，以及用户退出面板/工作台时怎样终止对应工作而不影响其他会话。

这些是根据两边生命周期推导的风险，不是本次对真实用户运行复现的缺陷，也不是已决定增加常驻后台服务。生产实现前必须解决所有权，不能只增加事件客户端。[VibeBridge 进程实现][vb-processes]、[服务器断开语义][disconnect-tests]

## 面向深模块设计的事实约束

按 Codebase Design 的术语，后续 **Module** 应通过一个小而完整的 **Interface** 提供运行状态事实；跨 CLI 的 **Adapter** 差异由 **Implementation** 承担。这是对后续设计输入的建议，不是本报告批准了某个模块拆分或 App Server 架构。

最小可用 Interface 至少需要让调用方知道三类事实：**它观察的是哪个工作台运行实例；该实例实际支持哪些识别能力且绑定是否有效；当前可信事实与观察健康度是什么**。停止观察的操作还必须明确其是否会结束 CLI 或后端工作。调用方不应自己处理 JSON-RPC、挂起 request 集合、连接重放、Codex 版本字段差异或从终端猜测会话；相应的顺序、去重和断线处理应集中在 Implementation。测试也应通过同一 Interface 验证同目录多运行、旧 turn 迟到、重试与最终失败等可观察行为。

Interface 不只是类型签名：需要更改启动模式、实验性支持、没有可靠身份绑定、只读权限缺失及退出所有权，都是正确使用 Module 必须知道的事实，不能藏在一个无条件返回“状态”的方法后面。无法建立绑定或观察中断时，必须保留能力/健康度信息，不能捏造 Busy、Done 或 Error。这些约束来自前述证据；具体 Interface 形式、seam 位置及各 CLI Adapter 的实现由后续设计确定。

## 方案边界与后续最小验证

| 候选方向 | 保留什么 / 得到什么 | 尚需承担的代价 |
| --- | --- | --- |
| 保留现有 hook 接入 | 保留原生终端与启动结构；已知 hook 可继续提供其承诺的事实 | Codex Stop hook 没有 success/failed 字段，不能独立满足所有 Error 识别需求；信号缺失保持未知。[先前研究][previous] |
| 原生 TUI 明确连接共享 App Server，另加观察连接 | 原生交互继续由 Codex 实现；同一 live thread 可有结构化事件 | 面板绑定、resume 副作用、审批响应、服务所有权、实验性支持与版本耦合需要验证。并未选定此方案。 |
| 同一服务上只读结构化查询 | 已知 ID 时可避免 resume/订阅的部分副作用 | 身份仍未解决；查询频率、短暂状态、持久化延迟与事件缺口的正确性未验证。 |
| 由工作台完全驱动 App Server 对话 | 宿主直接掌握请求与 thread/turn 身份 | 需要接管输入、审批、会话生命周期等交互责任；自建聊天 UI 或替换 TUI 没有获得授权，不是本研究默认方向。 |

**本次足以回答研究票，但不足以直接批准开发。** 建议后续仅在专用临时目录和隔离测试服务中验证，使用本地模拟模型响应，不连接用户现有会话、不读取用户凭证、不发付费模型请求：

1. 同版本原生 TUI 与第二个连接接入**同一个**测试 server；确认正在运行的同一 turn ID 可被观察，resume 不重启处理，并记录对客户端信息/扩展 idle 事件的影响。
2. 两个同目录面板分别新建、恢复、切换、fork；包括两个面板加入同一 thread。首先证明 run 绑定来自可靠结构化来源，再验证状态与计数，禁止按 cwd/标题/时间接近度猜测。
3. 模拟流断开后重试成功、重试耗尽、最终服务错误、工具非零退出、用户中断、自动续跑；逐一核对 `willRetry`、turn 终态、thread 状态和最新绑定，确保 Error 只表示所需的本轮失败。
4. TUI 中保留审批/输入；第二连接接入、断开及重连期间不得代答、拒答或抢占。覆盖 request 重放、resolved 清理、超时和 user verification 特例。
5. 分别关闭观察端、TUI 面板、工作台与测试 server；验证运行计数及时移除、模型通道断线与观察链路断线不混淆、没有遗留工作或误杀另一面板。
6. 以未启用实验 schema 的字段为最低能力检查，并测试版本不匹配/方法缺失；不满足条件时明确未知，不回退到 PTY、标题或 transcript 文本推断。

未验证意味着需要这些实验；未发现接口意味着不能承诺对应能力；没有收到一个事件不等于该能力不存在，也不等于 turn 已失败。最终状态集合与接入方案由[确定状态接入、运行关联与缺失信号处理](https://github.com/a1457139709/VibeBridge/issues/71)及相关产品决策继续确定。

## 来源

下列 OpenAI 官方文档按 2026-10-15 阅读；GitHub 链接固定到所核对版本。源码内测试只作为第一方设计证据，本次未运行。

[app-server]: https://learn.chatgpt.com/docs/app-server
[cli-reference]: https://learn.chatgpt.com/docs/cli/reference
[goals]: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
[previous]: https://github.com/a1457139709/VibeBridge/blob/a42a3038f3d515bee6fca345661dc6f1862ccc2a/docs/research/agent-status-hooks-20261015.md
[protocol-schema]: https://github.com/openai/codex/tree/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server-protocol/schema/json
[resume-source]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/request_processors/thread_processor.rs#L4281
[lifecycle-source]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L598
[resume-tests]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L4777
[writer-tests]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L314
[client-readme]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server-client/README.md
[tui-target]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/tui/src/lib.rs#L1019
[tui-routing]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/tui/src/app/thread_routing.rs#L194
[thread-state]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/thread_state.rs#L345
[thread-status]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/thread_status.rs#L438
[events-source]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/bespoke_event_handling.rs#L1031
[turn-finish]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/bespoke_event_handling.rs#L1506
[failed-tests]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/bespoke_event_handling.rs#L3554
[outgoing-source]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/outgoing_message.rs#L330
[disconnect-tests]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/tests/suite/v2/connection_handling_websocket.rs#L453
[websocket-auth-tests]: https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/tests/suite/v2/connection_handling_websocket.rs#L431
[vb-host]: https://github.com/a1457139709/VibeBridge/blob/4ff95615c981e2a1312cce386c3e1b72fc35542a/app/terminal/host.ts#L38
[vb-processes]: https://github.com/a1457139709/VibeBridge/blob/4ff95615c981e2a1312cce386c3e1b72fc35542a/app/terminal/processes.ts
