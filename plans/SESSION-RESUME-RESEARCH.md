# 原会话自动恢复：Claude Code 事实核查

调研日期：2026-09-29。范围仅为官方交互式 CLI 与 Hooks 文档；未启动真实 Agent、创建会话或修改 CLI 配置。状态更新：用户已选择第一版保存面板与布局，在 CLI 内手动恢复会话。本文保留为自动恢复的备选技术资料，不属于当前实现要求，也不承诺后续采用。

## 官方已证实

- `claude` 启动交互会话；`--session-id <UUID>` 指定会话标识；`--resume <ID>` 精确恢复指定会话。`--continue` 选择目录内最近会话，不能表达某个面板的固定绑定；`--fork-session` 则明确产生新 ID。[CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)
- `SessionStart` 的输入包含当前 `session_id`、`cwd`、`transcript_path`。`source` 包括新建 `startup`、恢复 `resume`、清空 `clear`、压缩 `compact`、分支 `fork`；交互式 `/resume` 也触发恢复事件。`fork` 在旧版中曾报为 `resume`。[SessionStart](https://code.claude.com/docs/en/hooks#sessionstart)
- Hook 进程继承父环境，但有 `OTEL_*` 等清理例外。对话文件异步写入，可能落后于当前内存状态。[Common input fields](https://code.claude.com/docs/en/hooks#common-input-fields)
- 启动、启动时恢复及 `/clear` 的 `SessionStart` 可在后台执行；同一终端内切换会话也会触发该事件。该文档没有为 `/clear` 与压缩逐一保证 ID 是否变化，应读取实际事件中的 ID。[SessionStart](https://code.claude.com/docs/en/hooks#sessionstart)

## 最简交互式示例

下面只是命令示意，UUID 由 VibeBridge 为新会话生成，并先与面板建立记录；并未执行。第一次新建与以后恢复是两次独立启动，工作目录由应用设置为项目目录。[参数依据](https://code.claude.com/docs/en/cli-reference#cli-flags)

```sh
# 第一次：指定一个新 UUID，启动交互式 CLI
claude --session-id "550e8400-e29b-41d4-a716-446655440000"

# 以后：交互式恢复同一会话
claude --resume "550e8400-e29b-41d4-a716-446655440000"
```

## 自动恢复的候选实现（已推迟，推断尚未验证）

最小映射为 `projectId → panelId → agentType + sessionId`。应用负责窗口位置、运行与映射；Agent CLI 负责保存和读取对话。重开时创建新的终端进程，以保存的 ID 调用恢复命令。它不等于恢复原进程的内存、正在执行的命令或终端滚动缓冲区。

若始终由应用新建且用户不在 CLI 内换会话，预先指定 UUID 就可建立初始关联，Hook 不是唯一办法。但用户可以在同一终端执行 `/resume`、`/clear` 或分支操作，面板当前承载的会话可能改变，因此需要持续校正关联。

可在启动进程时附加应用自己的 `VIBEBRIDGE_PANEL_ID` 和本次运行标识；配置的 `SessionStart` command hook 将它们与实际 `session_id` 回报给本地应用。这利用了上述父环境继承机制，但变量是否保留、目标 CLI 版本是否支持、Hook 如何注入仍需集成测试；也可把关联标识作为该次 Hook 的明确参数传入。

接收端应核验本次运行标识，避免旧进程迟到的回报覆盖新运行。恢复失败或未能可靠确认会话时，显示状态并保留原映射，不能悄悄创建新对话；也不能按目录“最新文件”、时间戳或终端文字猜测归属。两个面板可以同时在同一目录运行，这是目录推断会串错会话的直接原因。

后续最小验证应覆盖：同目录两个面板、重启恢复、面板内 `/resume` 与 `/clear`、会话分支、Hook 未回报、历史文件不可用。Claude Code 的接口证据不能直接代表 Codex 或 pi，它们需要各自适配核查。
