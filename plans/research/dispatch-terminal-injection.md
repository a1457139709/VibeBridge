# 派发：把 issue 与预设指令写进 Agent 面板终端

调研问题：**派发（Dispatch）**能否不依赖 Agent 类型的专门设置或其对话配置，仅靠"写进终端"把一个 issue 连同预设指令交给 Agent 面板？本文回答新面板启动时带初始提示、向运行中的面板写入、已有草稿、Agent 忙或等待批准、只预填不提交、启动就绪判断六个问题，并列出无法消除的按类型差异。

调研日期 2026-11-06。版本与来源：

| Agent 类型 | 本机实测版本 | 源码 / 文档 |
| --- | --- | --- |
| Claude Code | 2.1.319 | 闭源；官方文档 [interactive-mode]、[cli-reference]、[terminal-config]、[permissions] |
| Codex CLI | 0.164.0 | [openai/codex@ddd1812]（main，2026-11-06，比本机新几个版本）`codex-rs/tui` |
| pi | 1.4.0 | [badlogic/pi-mono@4ffe32c]（main，1.5.0）`packages/tui`、`packages/coding-agent` |

"实测"指本次用 node-pty（与工作台同一库）在 140×45 的 PTY 中驱动本机 CLI、读取剥离 ANSI 后的输出所得结论；探针脚本没有提交，方法见文末。源码结论引用的是 main 分支，与本机版本可能有细节差异。

[interactive-mode]: https://code.claude.com/docs/en/interactive-mode
[cli-reference]: https://code.claude.com/docs/en/cli-reference
[terminal-config]: https://code.claude.com/docs/en/terminal-config
[permissions]: https://code.claude.com/docs/en/permissions
[openai/codex@ddd1812]: https://github.com/openai/codex/tree/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/tui/src
[badlogic/pi-mono@4ffe32c]: https://github.com/badlogic/pi-mono/tree/4ffe32c6f1a138451162d6772f2723488fa32fad/packages

## 0. 本仓库现状：CLI 如何启动、如何写 PTY

- 终端宿主 `app/terminal/host.ts` 用 `pty.spawn(program, command.args, { cwd, env, name: 'xterm-256color', cols: 80, rows: 24 })` 直接执行程序，**不经过 shell**，所以 argv 中的多行文本、引号、`$` 都原样传给 CLI，没有 shell 转义问题（第 85 行）。
- 唯一的写入通道是 `input` 操作：`entry.terminal.write(value.data)`，单次上限 1 MiB（`value.data.length > 1024 * 1024` 时拒绝，第 119–121 行）。渲染端 xterm 的 `onData` 经 `window.workbench.sendInput(runId, data)` → `RunSupervision.input` → `TerminalClient.input` 到达这里（`app/renderer/terminals.ts:37`、`app/main/run-supervision.ts:134`）。派发可以复用同一通道，从主进程直接调用 `RunSupervision.input`。
- 启动参数由 Agent 设置的 `command` + `args` 组成，状态上报器在 `--` 边界之前插入自己的参数：Claude 加 `--settings <合并后的文件>`（`app/main/agent-status/claude/status.ts:12-50`），Codex 加若干 `-c hooks.<event>=...`（`codex/status.ts:18-39`），pi 加 `--extension pi-reporter.mjs`（`pi/status.ts:82-85`）。初始提示若走 argv，要放在用户参数和这些插入参数之后，并处理用户参数里已有 `--` 的情况。
- 处理状态只来自状态上报器，`ProcessingStatus` 的注释明确写着"never inferred from PTY data"（`app/main/processing-status.ts:30-34`）。每种类型都已能投影出 Ready / Busy / Needs input / Done / Error（`docs/claude-status.md`、`docs/codex-status.md`、`docs/pi-status.md`）。

## 1. 新面板：启动时带初始提示

三者都支持"交互模式 + 位置参数初始提示，启动后自动提交"：

| | 语法 | 自动提交 | 依据 |
| --- | --- | --- | --- |
| Claude Code | `claude [options] "query"` | 是，不等第二次 Enter | [cli-reference]：`claude "query"` "Start interactive session with initial prompt"；[interactive-mode] "Invisible characters"：命令行传入的提示"doesn't wait for a second Enter" |
| Codex CLI | `codex [OPTIONS] [PROMPT]` | 是，会话配置完成后提交 | `cli.rs:16-18` "Optional user prompt to start the session"；`chatwidget/session_flow.rs:267-268` `submit_initial_user_message_if_pending()` |
| pi | `pi [options] [--] [@files...] [messages...]` | 是，启动完成后 `session.prompt(initialMessage)` | `docs/cli.md:36`；`interactive-mode.ts:1266-1285` |

限制与坑：

- **长度**：因为不经 shell，只受内核 argv 总长度限制（macOS `ARG_MAX` 1 MiB，含环境变量）。issue 正文一般远小于此；超长时 argv 方案会直接启动失败，而且 argv 在 `ps` 中对本机其他进程可见。
- **多行**：作为单个 argv 元素传入即可，三者都保留换行（argv 不存在"换行提前提交"的问题）。
- **以 `-` 开头**：三者都会把它当选项。须在提示前加 `--`。pi 文档明确支持（"`--` Stop option parsing so a prompt can begin with `-`"）；Codex（clap）与 Claude（commander）遵循常规 `--` 语义，本次未逐一实测。
- **pi 的多个位置参数是多条消息**：`pi "a" "b"` 先发 `a` 再发 `b`（`interactive-mode.ts:1275-1283`）。必须把 issue 与指令拼成**一个** argv 元素。
- **pi 的 `@` 前缀是文件**：位置参数以 `@` 开头会被当成文件附件，即使在 `--` 之后也一样（`cli/args.ts:85-88`、`247-248`）。
- **以 `/` 或 `!` 开头**：三者都把行首 `/` 解释为斜杠命令、`!` 解释为 shell 命令（Claude [interactive-mode] "Shell mode with ! prefix"；Codex `chat_composer.rs` 文档 "Shell mode starts when input inserts a leading `!`"；pi 启动头 "/ commands · ! bash"）。预设指令应以普通文字开头。Claude 还会在清除不可见 Unicode 后、若结果以 `/` 开头时改为放进输入框等待确认（[interactive-mode] "Invisible characters in prompts"）。
- **初始提示只在新会话有意义**：`claude -r <id> "query"` 等恢复形式另当别论，派发到新面板不涉及。

**启动时只预填、不提交**：三者都**没有**对应的命令行选项（查阅 `claude --help`、`codex --help`、`pi --help` 与上述文档）。只能等 TUI 就绪后写入终端（见 [dispatch-terminal-input-behavior.md](dispatch-terminal-input-behavior.md) 第 5 节），或使用 Agent 专有机制（如 pi 扩展的 `ctx.ui.setEditorText`，`docs/extensions.md:1177`），后者违背本次"不依赖 Agent 专门配置"的目标。

## 2–5. 运行中面板的写入行为

写入 + Enter 的提交规则、长文本折叠、与草稿合并、Busy 与 Needs input 时的行为、只预填与启动就绪信号（含 OSC 7501）见 [dispatch-terminal-input-behavior.md](dispatch-terminal-input-behavior.md)。

## 6. 结论

### 最不依赖 Agent 类型的机制

1. **新面板：初始提示走 argv**。`<command> <用户参数> <状态上报器参数> -- "<指令 + issue>"`，作为一个 argv 元素。CLI 自己处理"等会话就绪再提交"和启动对话框，工作台不需要判断就绪时机，也不会在对话框上误按 Enter。这是三种方案里唯一不存在"Enter 落到对话框上"风险的。
2. **运行中的面板：只预填，不自动提交**。写入 `ESC[200~` + 清洗后的文本（LF 换行，去掉 `\r`、ESC 及其他控制字符和不可见字符）+ `ESC[201~`，不写 `\r`。由用户在终端里看到、修改、按 Enter。任何状态下都不会替用户作决定，最坏情况只是内容被对话框吞掉或与草稿合并，这两种情况用户都看得见。
3. **若要在运行中的面板自动提交**：只在工作台现有处理状态为 Ready 或 Done（不是 Busy、Needs input、Error、未知）时写入"粘贴 + `\r`"，并接受检查与写入之间的竞态；Busy 时不按 Enter，等本轮结束或改为只预填。不要用 Ctrl+C、Esc、Ctrl+U 清空草稿。

### 无法消除的按类型差异

- **折叠阈值与含义**：Claude >800 字符或 >3 行，Codex >1000 字符，pi >10 行或 >1000 字符。Claude 把折叠内容标注为"外部粘贴"，改变了预设指令的约束力；Codex 和 pi 不区分。
- **Busy 时 Enter 的语义**：Claude 排队、在工具调用结束后并入当前轮；Codex 立即 steer；pi 在当前回复后 steer。"下一轮再处理"只有 Codex（Tab）和 pi（Alt+Enter）有，键位不同，Claude 没有。
- **批准对话框的按键**：Codex 的 `y`/`a`/`p`/`d`/`n`/`c` 是单键快捷键，原始按键写入的正文会直接批准；Claude 用方向键/数字 + Enter；pi 默认没有逐次批准，但扩展可以弹对话框。三者都把 Enter 当作确认高亮项，而高亮项默认是同意。
- **启动期间的输入**：Codex 保留启动草稿并延后提交；pi 启动期间拒绝提交；Claude 未公开说明，实测 raw 模式前写入的 `\r` 变成换行。启动对话框（更新、信任、hooks 审查）因类型和本机配置而异。
- **argv 解析**：pi 多个位置参数是多条消息、`@` 前缀是文件（`--` 之后仍然如此）；三者都需要 `--` 才能以 `-` 开头。
- **Ctrl+C**：Claude 优先中断；Codex 输入非空时清空、为空时中断或退出、在批准对话框上取消请求；pi 清空、500 ms 内再按退出。
- **特殊前缀**：三者都把行首 `/`、`!` 当作命令或 shell，具体命令集不同。
- **状态信号**：OSC 7501 三者都实现，但 Codex 无条件上报、Claude 和 pi 需查询回复；现有状态上报器的事件来源本就是按类型实现的。

### 其他

- 现有 1 MiB 单次写入上限足够 issue 正文；超长内容也可以分块写入同一段 bracketed paste（Claude 文档提醒部分终端在极大粘贴时会丢字符，建议写文件让 Agent 读取）。
- Codex 0.164.0 有 `codex queue --thread <id> --message <text>`（"Queue a message for an existing session"），是不经终端的入队方式，但它是 Codex 专有的，而且依赖会话 ID，这里只作记录。

## 方法

探针用 `node-pty` 直接 spawn 本机 CLI（cwd 为本仓库，环境中去掉了外层 Claude Code 会话的 `CLAUDE_CODE_*` 变量），按"等待 / 写入"步骤序列运行，每步后输出剥离 ANSI 的增量屏幕文本，并记录 `ESC[?2004h`、`ESC[?1049h`、OSC 7501 的出现时间；需要时回复 OSC 7501 查询。场景：粘贴 + Enter 同一次写入、长粘贴后延时 Enter、原始按键 LF + 延时 CR、先键入草稿再粘贴、启动后 50 ms 写入、Agent 流式输出期间注入、批准对话框打开时注入。用到的模型请求都是"回复某个单词"一类的短提示。权限场景写入的文件位于会话临时目录。
