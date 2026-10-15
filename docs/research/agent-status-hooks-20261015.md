# Agent 状态来源：Codex CLI、Claude Code 与 pi

调查日期：2026-10-15。对应决策票：[调研 Codex、Claude Code 与 pi 的 hook 状态能力](https://github.com/a1457139709/VibeBridge/issues/70)。本报告提供能力证据，不选择产品状态集合、图标、计数或安装方案。

## 结论与证据范围

三类 CLI 都存在官方生命周期扩展机制，但事件的覆盖范围不同。“有 hook”不能直接推出“可完整识别所有状态”。尤其需要区别开始处理、准备请求审批、真正等人、结束一次模型循环、停止自动继续，以及业务任务成功。

此次只运行版本与帮助查询、读取已安装 pi 的文档/类型/实现，并查阅官方文档与对应版本的一手仓库。没有启动 Agent 对话、触发付费模型请求、安装扩展、修改用户 CLI 配置或进行端到端 hook 验证。下文的“支持”表示文档或源码存在相应能力，不代表该用户环境已经启用或可靠接通。

| 工具 | 本机实际查询 | 版本证据强度 |
| --- | --- | --- |
| Codex CLI | `codex-cli 0.162.1`；安装清单同为 `0.162.1`，`aarch64-apple-darwin` | 本机帮助包含 hook 信任开关、配置覆盖和 `--no-daemon`。生命周期细节来自调查当日官方在线文档；未取得该二进制所有 hook 字段的逐版本实测证明。 |
| Claude Code | `2.1.299 (Claude Code)` | 本机帮助确认 `--settings`、`--plugin-dir` 等入口；官方对应版本 [CHANGELOG][C4] 固定在提交 `db93774d73e8fdbaf315a6f4c175ae99ad3d515a`。事件细节主要来自当前官方文档。 |
| pi | `0.84.4`，包名 `@earendil-works/pi-coding-agent` | 安装包文档与 [v0.84.4 对应提交][P1] `b79e4cc834970cca69daebffab7df1da7d1e52c4` 的 extensions 文档逐字节一致；并读取本机已发布 JS 实现及该提交源码。 |

Codex 版本/帮助查询输出过无法创建 PATH aliases 的权限警告，但正常返回版本和帮助；未提升权限重跑或据此判断 hook 损坏。没有检查认证信息或用户现有 hook 内容。在线文档可能滚动更新；pi 已固定版本，Claude 更新记录已固定版本，Codex 不宣称已确定最低支持版本。

## 能力矩阵

这里比较的是可观察事实，不是建议的产品状态名称；表中限制不能省略后再当成完整状态。

| 可观察事实 | Codex CLI | Claude Code | pi 0.84.4 |
| --- | --- | --- | --- |
| 开始处理一条提示 | `UserPromptSubmit`，在提示发送前；其他 hook 仍可能阻止它。[Codex hooks][O1] | `UserPromptSubmit`；也可来自后台 Agent、定时任务等。Mods 另有 `turn.start`。[settings hooks][C1]、[Mods events][C5] | `agent_start` 是低层循环开始；`input` 可被消费而不启动 Agent。[extensions][P1] |
| 工具开始/结束 | `PreToolUse` / `PostToolUse`；并非全部工具路径覆盖。[Codex hooks][O1] | `PreToolUse` / `PostToolUse` / `PostToolUseFailure`，Mods 有 `tool.call`。[settings hooks][C1]、[Mods events][C5] | `tool_execution_start/end`，结束含 `isError`；工具可能并行。[extensions][P1] |
| 工具需要审批 | `PermissionRequest` 是准备申请审批；其他 hook 可自动作答。[Codex hooks][O1] | `PermissionRequest`，但沙箱网络申请不走它；自动决策/不可交互时也可能触发。[settings hooks][C1] | 没有内置工具权限弹窗；extension 自己的确认 UI 可被观察。[usage][P4]、[extensions][P1] |
| 明确等待用户回答 | 没有在所查 hook 目录中找到通用“弹出/关闭提问”事件；指定本地工具的前后事件仅能做逐工具候选适配。[Codex hooks][O1] | `AskUserQuestion` 的工具事件、MCP `Elicitation/Result` 是候选；不等于普遍的“人正在被等待”。[settings hooks][C1] | `ui_prompt_start/end` 覆盖 extension 的阻塞 `ctx.ui` 提示；不覆盖任意终端程序读输入。[extensions][P1] |
| 本轮停止处理 | `Stop` 可被其他 hook 续跑；另有 `notify` 的 `agent-turn-complete`。[hooks][O1]、[notify][O2] | `Stop` 不覆盖用户中断，且能续跑；Mods `turn.complete` 包括中断。[settings hooks][C1]、[Mods events][C5] | `agent_settled` 表示不再自动重试/压缩重试/消费排队续跑；`agent_end` 和 `turn_end` 都不够。[extensions][P1] |
| 中断/错误 | `Interrupt` 覆盖主线程用户中断；未找到通用 `StopFailure` hook，不能套用 Claude 名称。[Codex hooks][O1] | `StopFailure` 覆盖 API 错误；Mods `turn.complete.isAborted` 可标明用户中断。[settings hooks][C1]、[Mods events][C5] | `agent_settled` 不区分成功、错误或取消；需结合结构化结果，且仍不能证明业务成功。[运行源码][P2] |
| 会话关闭 | `SessionEnd` 是会话生命周期，可能晚于某客户端切走。[Codex hooks][O1] | `SessionEnd` 包含 clear/resume/logout 等原因，不等于进程退出。[settings hooks][C1] | `session_shutdown` 也用于 reload/new/resume/fork，不等于进程退出。[extensions][P1] |

## Codex：生命周期 hooks 与旧 notify 必须分开

现行官方文档已描述完整生命周期 hooks，不能继续用“Codex 只有完成通知”作为能力结论。命令 hook 从 stdin 接收 JSON；公共字段包括 `session_id`、`cwd`、`hook_event_name`，轮次事件可带 `turn_id`。子 Agent 的 hook 使用父会话 ID，专门的子 Agent 事件另有 `agent_id`。[Codex hooks][O1]

`notify` 是另一条机制：官方目前列出的事件只有 `agent-turn-complete`，JSON 作为一个命令行参数传入；字段使用 `thread-id`、`turn-id` 等带连字符的名称。它不能提供开始或完整审批生命周期。`tui.notifications` 的 `approval-requested`、OSC/BEL 则属于终端通知设置，不是该 JSON 回调的额外事件。状态接入不需要调用系统通知或声音接口。[Advanced Configuration][O2]

重要边界：

- `Stop` 发生时，其他匹配 hook 仍可能要求继续；不能把一次 `Stop` 当成永久完成。`PermissionRequest` 也不能保证人已经看到弹窗，更不能保证随后一定等人；这两点是依据事件发生位置作出的限制判断。[Codex hooks][O1]
- 工具 hook 不覆盖 hosted tools；统一执行工具的 `PostToolUse` 还可能在后续 `write_stdin` 取到最终结果时才发生。不能依靠工具事件频率补全所有忙碌区间。[Codex hooks][O1]
- 官方目录有 `Interrupt`，没有列出通用错误终止、通用提问显示/消失事件。这里只能报告“文档未建立覆盖”，不能断言内部绝不存在，也不能靠解析答案、终端标题或输出节奏补齐。[Codex hooks][O1]
- `SessionEnd` 可在正常关闭、归档/删除打开的会话、无人连接的会话闲置一段时间后触发。它不是面板运行进程的退出证明。[Codex hooks][O1]

配置入口是活动配置层旁的 `hooks.json` 或 `config.toml` 内联 hooks，也可由插件提供；多个来源会共同运行。非受管 hook 需要信任当前定义，修改定义后会重新待审。配置还有 `features.hooks`、管理员 `allow_managed_hooks_only` 等约束。[Hooks][O1]、[Config Reference][O3]、[Plugin packaging][O5]

一次启动可使用 `-c` 覆盖配置，但是否用它携带 hook、如何避免重复来源、如何保证用户既有配置不受影响，仍需接入决策与实测。不要为了状态图标默认启用 `--dangerously-bypass-hook-trust`。把每次运行的动态 token 直接嵌入 hook 定义还可能导致信任哈希每次变化，这是需要验证的安装方案约束。[CLI Reference][O4]、[Hooks][O1]

现行 CLI 存在共享 app-server 与 `--no-daemon`。因此“给新启动 CLI 设置环境变量，所有 hook 自然继承这个运行身份”目前不是已证实事实：需要确认实际执行 hook 的进程、每会话配置和身份传递，不能把共享服务生命周期等同于面板子进程生命周期。`--no-daemon` 只是待评估选项，本报告没有选择或启用它。[CLI Reference][O4]

## Claude Code：传统 hooks、延迟通知与 Mods

传统命令 hooks 使用 stdin JSON，可用 `session_id`、当前文档的 `prompt_id`、`cwd`、`hook_event_name`；子 Agent 另有 `agent_id/agent_type`。`prompt_id` 是提示身份，不能代替工作台运行身份；文档没有给出它的最低版本，需核对实际 payload。hook 子进程通常继承父环境，但官方列有变量清理例外，运行标识传递也要验证。[Hooks reference][C1]

事件不能混用：

- `PermissionRequest` 表示进入权限决策；不适用于沙箱命令的网络请求，而且可能被其他 hook 自动回答。`Notification.permission_prompt` 约等待六秒后才出现，终端按键会延后；`idle_prompt` 约回复结束六十秒后才出现，并受后台 Agent 等条件影响。它们既不是即时状态流，也不是“普通等待下一条指令”和“当前必须输入”通用判据。[Hooks reference][C1]
- `AskUserQuestion` 可经工具 hooks 观察，但 hook 能程序化填写答案。MCP `Elicitation` 也可被 hook 直接回答；`ElicitationResult` 是返回响应时的事件。因此应区分“请求存在”和“确认在等待真人”，并核对审批拒绝/取消后的解除路径。[Hooks reference][C1]
- `Stop` 可要求续跑，且不在用户中断时触发；API 错误改走 `StopFailure`。`background_tasks`、`session_crons` 能说明有待续活动，字段缺失不能当空数组。对应更新记录分别在 2.1.145 和 2.1.78 记载新增这些字段及 `StopFailure`。[Hooks reference][C1]、[固定版本更新记录][C4]

本机版本还可考虑官方 **Mods**：终端最低版本为 2.1.287，它用进程内函数注册 hook。`turn.start` 提供 `turnId`，`turn.complete` 包括用户中断的 `isAborted`，子 Agent 事件带 `agentId`。这比传统 `Stop` 的中断覆盖更广，但不是本次自动选定的接入方式。[Mods overview][C6]、[Mods events][C5]

Mods 同样有边界：处理器形成 `next(e)` 中间件链，前序 mod 可以短路；观察器必须透传原事件与结果。`tool.check` 的 `ask` 是权限决策，仍不是通用用户弹窗生命周期。`session.start` 会在 mod 重新加载后重发，却不在 `/clear`、`/resume`、`/branch` 后重发；不能假定它等于每次会话切换。应使用对应安装版本生成的类型声明核对 API，当前文档明确说事件/方法可随版本改变。[Mods events][C5]、[Mods reference][C7]、[Create a mod][C8]

配置候选：传统 hooks 可通过一次启动的 `--settings <file-or-json>` 添加，省去修改用户永久文件；设置列表存在合并规则，不能假定高优先级会清空原 hooks。Mods 可用 `--plugin-dir` 仅为本次启动加载。`disableAllHooks`、安全启动模式及受管策略可能阻止执行。Mods 使用专门 API 访问环境、进程、文件/HTTP，并非任意 Node 模块；没有运行这两种方案，也没有修改用户原配置。[Settings][C2]、[CLI Reference][C3]、[Mods API][C9]、[Mods overview][C6]

## pi：官方 extension 是事件机制，但是否纳入“hook”仍需决策

pi 官方把 TypeScript 扩展称为 extensions；它们通过 `pi.on(event, handler)` 接收结构化生命周期事件。它不是 PTY 文字解析，也不是由模型自行报告状态。从机制看属于官方事件扩展；是否满足本项目“仅 hook”的接入范围，应由[确定状态接入、运行关联与缺失信号处理](https://github.com/a1457139709/VibeBridge/issues/71)决定。[Extensions][P1]

本机版本具备两个尤其相关的增量：`agent_settled` 在 0.80.4 加入，`ui_prompt_start/end` 在 0.84.4 加入。低版本不能仅因已有 `agent_end` 就假定等价。[固定版本 CHANGELOG][P5]

- `agent_start` 与 `agent_end` 是低层 Agent 循环；结束后仍可能自动重试、压缩后重试或处理排队消息。`agent_settled` 才是这些自动延续结束后的事件；`ctx.isIdle()` 也覆盖这段生命周期。[Extensions][P1]
- 对应版本 `_runAgentPrompt` 在 `finally` 调用 `_emitAgentSettled`，因此 settled 本身不证明成功。如需区分错误/取消，应依据结构化 assistant `stopReason` / 工具 `isError` 等字段，并处理重试覆盖；不能从回复文字下结论。工具失败也不等于整轮失败。[运行源码][P2]、[事件类型][P3]
- `ui_prompt_start/end` 包围 `select/confirm/input/editor/custom`，嵌套或重叠提示合并为一个外层等待区间，通知处理器以 best-effort 方式调用且不等待其完成。源码用 microtask 分发；适配器还需防止自己的异步发送乱序。[Extensions][P1]、[runner 源码][P6]
- 这些事件覆盖 `ctx.ui` 扩展提示，不是普通输入编辑器、任意 shell 交互或所有项目首次信任提示的统一等待事件。pi 原生也不内置工具权限弹窗；不能据此承诺“所有审批/输入都可检测”。[Usage][P4]、[runner 源码][P6]
- `ctx.sessionManager.getSessionId()/getSessionFile()` 可取会话身份；`turnIndex` 是内部模型/工具轮次。事件没有工作台运行 ID。`session_shutdown` 与 `session_start` 还涉及 reload/new/resume/fork；重载会重建 extension 实例，不能因此误判面板运行已结束。[事件类型][P3]、[Extensions][P1]

加载可用受信任目录、配置中的 extensions，或 `pi -e /absolute/path/to/extension.ts`。官方将 `-e` 定位为临时测试入口，其与 `/reload` 的具体行为需纳入验证；`--no-extensions` 会关闭自动发现，不能为了接入状态而无意禁用用户原扩展。extension 与 pi 使用相同用户权限，观察器应只上报状态元数据，不注册工具、不改变提示或返回阻断结果。[Extensions][P1]、[Usage][P4]、[Security][P7]

## 运行关联、缺失信号与接入约束

以下是由上面的事实得出的工程限制，供后续决策使用，不是已实施协议：

1. **会话、一次提示和工作台运行是不同身份。** 恢复同一会话可以产生新的工作台运行，同一进程也可能切换会话。目录相同或会话 ID 相同不能把事件归入某个面板；必须携带或可靠绑定本次启动的运行身份，并隔离过期事件。
2. **进程退出只提供运行事实。** 工作台可以据终端管理进程确认实例结束，但不能由“还活着”推导忙碌、等待或本轮结束；`SessionEnd/session_shutdown` 也不能代替进程事实。
3. **先区分能力，再区分观测。** 版本没有事件、扩展未加载、信任未通过、策略禁用是能力/启用问题；已具备能力但尚未发生事件、投递失败、hook 超时或数据关联失败是观测问题。二者都不能用沉默推成空闲或完成。无法可靠断定时保留未知。
4. **陈旧与乱序需要独立规则。** 并发 hook、异步 callback、重载、恢复、旧进程迟到数据都可能影响顺序；官方 session/turn 字段不是端到端 exactly-once 投递保证。不能拿“最后收到的消息”无条件覆盖新运行状态。
5. **只发必要字段。** 时间/序号、运行关联、CLI 会话/提示/工具标识、事件类型与结构化结果已足以讨论状态；无需收集 prompt、工具参数、完整回复或 transcript。报告不建议解析标题、终端输出或 transcript 来补足状态。
6. **观察不可改变 Agent 工作。** 选择短时、有限资源、故障可控的上报方式；不返回阻断/审批/上下文，不发系统通知或声音。同步 handler 会影响等待时长，异步 handler 需要另行解决顺序与退出时丢失，具体权衡留给接入票。

## 专项：Error 是否可能在进程仍运行时出现

可能出现“本轮处理失败而 CLI 仍可接受后续操作”的情况。它与进程崩溃是不同事实，也与一个测试失败、命令非零退出或工具调用失败不同。用户在本次讨论中确认：任何 Agent 进程退出都立即关闭面板并移出计数，不保留 stopped/error 面板。下面只讨论仍存在的运行中能否取得轮次失败证据，不决定是否加入 `Error` 这一产品状态。

| 场景 | 证据与可判定边界 |
| --- | --- |
| Claude 本轮 API 失败 | `StopFailure.error` 有结构化类型，例如 `rate_limit`、`authentication_failed`、`server_error`；它代替本轮 `Stop`，不是进程退出通知。这是可以单独评估 `Error` 的直接官方信号。[Hooks reference][C1] |
| pi 模型处理失败 | 官方 `StopReason` 区分 `error` 与 `aborted`。Agent 循环遇到二者都会发含 assistant message 的 `turn_end`，再发 `agent_end` 并返回；会话层可能继续重试，所以不能见第一次 `error` 就宣布最终失败。候选规则必须在 `agent_settled` 后确认最终相关 assistant 仍为 `error`，且未被后续成功/续跑覆盖。[Agent loop][P8]、[AI types][P9]、[会话层][P2] |
| pi 尚未进入 Agent 循环就失败 | 缺少模型或 API key 等校验可以在 `prompt()` 中抛错，早于 `_runAgentPrompt`。所以 `turn_end` 加 `agent_settled` 仍不是所有失败的完整覆盖，不能声称“任何错误都能检测”。[会话层源码][P2] |
| Codex 本轮失败 | 当前查到的官方 hook 目录没有通用失败终止事件；`Stop` 也没有等价于完整失败类型的字段。单靠这些证据不能可靠识别通用 `Error`。App-server 另有结构化失败协议，但本研究不以它悄悄替换 hook-only 接入规则。[Hooks][O1]、[App Server][O6] |
| 单个工具/测试失败 | Claude `PostToolUseFailure`、pi `tool_execution_end.isError` 等仅证明该工具出错；Agent 可以读取错误并继续修复。测试通过/失败的业务判断更不能通过解析终端输出来制造状态。[Claude hooks][C1]、[pi events][P1] |
| 用户主动中断 | Codex `Interrupt`、Claude Mods `turn.complete.isAborted`、pi `stopReason: aborted` 是中断证据；不能自动归为失败。传统 Claude `Stop` 不在该路径触发。[Codex hooks][O1]、[Mods events][C5]、[AI types][P9] |
| CLI 崩溃或退出 | 由终端管理进程提供退出事实并按用户决定移除面板/计数；hook 不保证在强制退出时还会送出最后事件。无需为已移除运行保留 `Error`。 |

pi 的具体候选判定只证明“终止错误可与取消区分”，不是产品语义或已验证算法；多次重试、排队继续、扩展修改 message 的场景仍需验证。Claude `StopFailure` 也不能把仍在处理的普通工具失败扩大成轮次失败。

## 仍需实机验证的具体场景

这份研究已经回答官方能力边界；以下是投入开发前的验证清单，不是已经通过的验收。是否需要独立准备票，由接入决策根据选择的机制确定。

| 场景 | 要验证的事实 |
| --- | --- |
| 三类 CLI 的只读启动/加载探针 | 确认当前版本、hook/extension 真正启用和上报可达；“配置可解析”不能代替“事件已接通”。 |
| 两个同目录面板，同时新建/恢复同一会话 | 每条事件只影响正确运行；Codex 重点核对共享 daemon 中环境与配置的实际归属。 |
| 用户 hook 共存、Stop 自动续跑、提示被 hook 阻止 | 不能短暂或永久标成业务成功；明确哪些事件是请求发生、哪些是处理结束。 |
| 审批允许/拒绝/取消/自动回答，沙箱网络申请 | 验证进入与解除等待的完整配对；普通工具前事件不足以证明用户弹窗已出现。 |
| 明确提问与普通回复后等下一条指令 | 不读文字区分；Claude 核对 AskUserQuestion/MCP，pi 核对 ctx.ui 范围，Codex 核对实际可观察的指定工具。 |
| API 错误、自动重试、压缩、队列续跑、用户中断 | Codex 错误路径目前缺少通用 hook 证据；Claude 比较传统 hooks 与 Mods；pi 验证 settled 最终语义。 |
| reload、clear、resume、fork，前后台项目切换 | 会话身份变化与面板运行身份变化分别处理；不因视图卸载丢状态，不因重载重复计数。 |
| hook 不受信任/被禁用、上报失败、强制退出、旧事件迟到 | 不把缺失事件伪装成确定状态，不让旧运行污染新运行；SIGKILL 等无法依赖优雅关闭回调。 |

置信度：pi 0.84.4 的事件定义、等待包围与 settled 调用位置有版本固定源码，较高；Codex 与 Claude 当前公开能力有官方文档，较高；本机真实投递、用户配置共存、自动批准边界与跨运行关联尚未实测，不能据报告承诺稳定支持。无公开证据的能力明确保留未知，而不是通过 UI 或终端输出猜测。

## 一手来源

所有在线来源于调查日读取；固定提交链接用于避免报告跟随 main 漂移。未复制第三方实现。

[O1]: https://learn.chatgpt.com/docs/hooks
[O2]: https://learn.chatgpt.com/docs/config-file/config-advanced#notifications
[O3]: https://learn.chatgpt.com/docs/config-file/config-reference
[O4]: https://learn.chatgpt.com/docs/cli/reference
[O5]: https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks
[O6]: https://learn.chatgpt.com/docs/app-server
[C1]: https://code.claude.com/docs/en/hooks
[C2]: https://code.claude.com/docs/en/settings
[C3]: https://code.claude.com/docs/en/cli-reference
[C4]: https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md
[C5]: https://code.claude.com/docs/en/plugins/mods/events
[C6]: https://code.claude.com/docs/en/plugins/mods/overview
[C7]: https://code.claude.com/docs/en/plugins/mods/reference
[C8]: https://code.claude.com/docs/en/plugins/mods/create#get-the-types-for-your-build
[C9]: https://code.claude.com/docs/en/plugins/mods/api
[P1]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md
[P2]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts
[P3]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/types.ts
[P4]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/usage.md
[P5]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/CHANGELOG.md
[P6]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/runner.ts
[P7]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md
[P8]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts
[P9]: https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/types.ts
