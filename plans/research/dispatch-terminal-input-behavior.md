# 派发：运行中面板的终端写入行为

[派发调研总览](dispatch-terminal-injection.md) 的第 2–5 节：向运行中的 Agent 面板写入文字与 Enter、已有草稿、Agent 忙或等待批准、只预填不提交与启动就绪判断。版本、来源与实测方法见总览。

[interactive-mode]: https://code.claude.com/docs/en/interactive-mode
[cli-reference]: https://code.claude.com/docs/en/cli-reference
[terminal-config]: https://code.claude.com/docs/en/terminal-config
[permissions]: https://code.claude.com/docs/en/permissions
[openai/codex@ddd1812]: https://github.com/openai/codex/tree/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/tui/src
[badlogic/pi-mono@4ffe32c]: https://github.com/badlogic/pi-mono/tree/4ffe32c6f1a138451162d6772f2723488fa32fad/packages

## 2. 运行中的面板：写入后按 Enter

### 键序与提交

三者都启用 bracketed paste（Codex `tui.rs:256` `EnableBracketedPaste`；pi `tui/src/terminal.ts:219`；Claude 实测输出 `ESC[?2004h`），并把 `\r`（回车）当提交、`\n`（LF，即 Ctrl+J）当换行：

| | `\r` | `\n` / Ctrl+J | 依据 |
| --- | --- | --- | --- |
| Claude Code | 提交 | 换行 | [terminal-config] "Pressing Enter submits... press Ctrl+J" |
| Codex CLI | 提交（非粘贴突发窗口内） | 换行 | `chat_composer.rs:136` "`Enter` submits immediately" |
| pi | 提交 | 换行 | `tui/src/keybindings.ts:143-144`（`newLine: shift+enter, ctrl+j`；`submit: enter`）；`components/editor.ts:900-932` |

实测（三者结果一致）：

| 写法 | 结果 |
| --- | --- |
| `ESC[200~第一行\n第二行ESC[201~\r`（一次写入） | 多行文本作为一条消息提交，模型按要求回复 |
| 原始按键 `第一行\n第二行`，1.5 s 后单独写 `\r` | 同上：`\n` 成为换行，`\r` 提交 |
| 原始按键中夹带 `\r` | 会在 `\r` 处**提前提交**，剩余文字留在输入框（源码可推出，未专门实测） |

**结论：用 bracketed paste 包裹正文，正文中的换行统一为 `\n`、去掉 `\r`，再追加一个 `\r` 提交。**

额外注意：

- **正文里不能出现 `ESC[201~`**，否则粘贴提前结束、后面的内容变成按键（可能触发快捷键）。写入前应删除正文中的 ESC 等控制字符。pi 会自行过滤粘贴中除换行外的控制字符（`editor.ts:1292-1295`），Codex 做 `sanitize_user_text`（`paste_input.rs:156-157`），Claude 提交时去除不可见 Unicode；但 `ESC[201~` 本身必须由工作台保证不出现。
- **Codex 的"粘贴突发"窗口**：不支持 bracketed paste 的输入流里，8 ms 内连续到达的字符被视为粘贴，此后 120 ms 内的 Enter 被当作换行而非提交（`paste_burst.rs:159-170`、`347-351`）。显式 bracketed paste 会清除这个窗口（`clear_after_explicit_paste`，`paste_burst.rs:463-469`，由 `apply_paste` 在 `paste_input.rs:209` 调用），所以"粘贴 + 紧跟 `\r`"在实测中正常提交。如果用原始按键写入正文，`\r` 应延后 >120 ms。
- **pi 的反斜杠规则**：光标前一个字符是 `\` 时，Enter 会删掉 `\` 并插入换行而不是提交（`editor.ts:921-928`）。Claude 也有同样的 `\` + Enter 换行约定（[terminal-config]）。正文若以 `\` 结尾，应在末尾补一个空格或换行。
- **Claude 的不可见字符拦截**：正文含零宽字符、双向控制符等时，第一次 Enter 不发送，只清理后放回输入框，需要第二次 Enter（[interactive-mode] "Invisible characters in prompts"）。issue 正文来自 GitHub，可能含这类字符；工作台应在写入前自行去除，否则"写入 + Enter"会停在输入框。

### 长文本折叠

| | 折叠阈值 | 占位形式 | 提交时 |
| --- | --- | --- | --- |
| Claude Code | >800 字符或 >3 行 | `[Pasted text #1 +120 lines]` | 发送完整内容（[terminal-config] "Paste large content"）；并把粘贴内容标注为"可能含非用户所写指令"，只在用户键入的文字要求时才遵循 |
| Codex CLI | >1000 字符 | `[Pasted Content N chars]` | 提交时展开（`chat_composer.rs:224-233`、`471`；`paste_input.rs:188-195`） |
| pi | >10 行或 >1000 字符 | `[paste #1 +123 lines]` / `[paste #1 1234 chars]` | `submitValue` 展开（`editor.ts:1308-1324`、`1374-1376`） |

实测 16 行粘贴：Claude 显示 `[Pasted text #1 +15 lines]`，pi 显示 `[paste #1 +16 lines]`，随后 `\r` 均提交了完整内容并得到正确回复；Codex 的 16 行（约 400 字符）未达阈值、直接展开显示，也正常提交。

**Claude 的语义差异值得注意**：被折叠的粘贴内容在 Claude 看来是"外部粘贴"，其中的指令只在用户键入的文字要求时才遵循（[terminal-config] "How Claude treats pasted text"）。如果把"预设指令 + issue"整体作为一次粘贴写入，指令本身也会被当作粘贴内容。较稳妥的做法是：指令放在 issue 正文前面、并明确写出"按下面粘贴的 issue 执行"；或者把指令作为短粘贴（≤800 字符且 ≤3 行，不折叠）、issue 作为第二段粘贴写入。这一点只在 Claude 上有影响，其余两者不区分。

## 3. 输入框里已有半截草稿

**写入内容会在光标处与草稿合并**，三者都不会自动清空或另起一条：实测先写 `DRAFT-typed-by-user `，再粘贴 `PREFILLED dispatch text\nline two`，三者输入框都变成 `DRAFT-typed-by-user PREFILLED dispatch text` + 换行 + `line two`。如果光标在草稿中间，插入点也在中间。此时再按 Enter，用户的草稿会连同派发内容一起被发出。

没有通用的安全清空方式：

| 按键 | Claude Code | Codex CLI | pi |
| --- | --- | --- | --- |
| Ctrl+C | 有运行中的操作时**中断**；否则第一次清空输入、第二次退出（[interactive-mode] General controls） | 输入非空时清空；为空时交给中断/退出逻辑；批准对话框打开时**取消该请求**（`bottom_pane/mod.rs:1039-1075`、`approval_overlay.rs` `on_ctrl_c`） | 第一次清空编辑器，500 ms 内第二次**退出**（`interactive-mode.ts:4440-4448`） |
| Ctrl+U | 删到行首，多行时需重复（[interactive-mode] Text editing） | 删到行首（`keymap.rs:1930-1931`） | 删到行首（`docs/keybindings.md` `tui.editor.deleteToLineStart`） |
| Esc | 中断当前轮；对话框打开时关闭对话框；在权限提示上等于"No"；Esc Esc 清空草稿，输入为空时打开回退菜单 | 运行中中断当前轮；批准对话框上是 decline | 中断当前任务 |

因此 Ctrl+C 和 Esc 都可能**中断 Agent 或退出 CLI**，绝不能用作"先清空再写入"；Ctrl+U 只删当前行，多行草稿清不干净，且要先知道光标位置。工作台也无法在不解析屏幕的情况下得知草稿内容。

可行做法：不清空、不按 Enter（见第 5 节"只预填"），把是否合并、是否提交交给用户；或者只在面板无草稿可能的时刻（新面板、刚由派发启动的面板）自动提交。

## 4. Agent 正忙或在等待批准时

### 正在处理（Busy）

三者"运行中按 Enter"的结果都是**把消息并入当前轮、在下一个工具调用边界送达**，而不是丢弃：

| | Enter | 另一个键 | 依据 |
| --- | --- | --- | --- |
| Claude Code | 排队；若 Claude 正在跑工具调用，工具结束后在**同一轮**内送达；轮结束时仍在队列中的自动发出 | Ctrl+Enter / Ctrl+X Ctrl+S 立即发送 | [interactive-mode] "Queue messages while Claude works" |
| Codex CLI | steer：立即提交给正在运行的轮，显示 "Messages to be submitted after next tool call" | Tab：排队到下一轮 | `chat_composer.rs:136-138`；`chatwidget/input_flow.rs:51-90`；`chatwidget/input_queue.rs` |
| pi | steer：等当前回复及其工具调用结束后引导下一次回复 | Alt+Enter：follow-up，等整个任务结束 | `docs/usage.md:30-40`；`interactive-mode.ts:3490-3498` |

实测：让 Agent 逐行写 1 到 300 的英文，5 秒后粘贴 "Reply with exactly the word PONGG." 并按 Enter。Claude 显示排队并提示 `ctrl+x ctrl+s to send now`，数完后回复 PONGG；Codex 显示 "Messages to be submitted after next tool call"，随后回复 PONGG；pi 数完后回复 PONGG。

所以"写入 + Enter"在 Busy 时**不会丢**，但语义是"打断/引导当前任务"，不是"排在后面的新任务"。把一个新 issue steer 进正在处理另一个 issue 的会话，会改变当前任务的走向。只有 Codex 的 Tab 和 pi 的 Alt+Enter 提供"下一轮再处理"，而且键位不同，Claude 没有对应的键。

### 等待批准或回答（Needs input）——关键危险

批准/选择对话框打开时，键盘输入交给对话框，不再进入输入框：

- **粘贴的文字被吞掉**：Codex 中 `BottomPane::handle_paste` 把粘贴交给栈顶视图（`bottom_pane/mod.rs:1078-1100`），`ApprovalOverlay` 没有实现 `handle_paste`，默认实现直接返回 `false`（`bottom_pane_view.rs:155-159`），文字丢失。Claude 实测同样不留痕迹。
- **随后的 `\r` 选中当前高亮项，而默认高亮项是"同意"**：Codex 的选项顺序以 "Yes, proceed (y)" 开头，Enter 是 `list.accept`（`approval_overlay.rs:601-608`、`868-875`；`keymap.rs:2097`）；Claude 的权限提示默认光标在 "❯ 1. Yes"。
- **正文里的普通字母也可能是快捷键**：Codex 批准对话框中 `y` 批准、`a` 本会话内一律批准、`p` 按前缀批准、`d` 拒绝、`n`/Esc 拒绝、`c` 取消（`keymap.rs:2124-2130`），并且这些快捷键在列表导航之前处理（`approval_overlay.rs:557-591`）。以原始按键写入正文时，正文中第一个 `y`、`a` 就会替用户作出批准。bracketed paste 不会触发这些快捷键（整体作为粘贴事件），但末尾的 `\r` 仍会触发。

实测（Claude 使用 `--permission-mode default`，Codex 使用 `-s read-only -a on-request`）：先让 Agent 写一个文件，等批准对话框出现后粘贴 "INJECTED dispatch text: reply PONGF" 并按 Enter。**两者都把 Enter 当成"同意"并写入了文件，注入的文字完全丢失**，此后输入框为空，Agent 不知道有过派发。

**启动阶段的对话框同样危险**：实测本机 Codex 0.164.0 启动时弹出 "Update available" 选择框，默认项是 "1. Update now (runs `sh -c 'curl ... install.sh | ... sh'`)"。探针在此时写入的 `\r` 选中了它，**开始执行更新安装脚本**（探针 20 秒后结束了进程，安装中断，`~/.codex/packages/standalone/current` 仍指向 0.164.0）。之后的实测都加了 `-c check_for_update_on_startup=false`。Claude 的项目信任对话框、Codex 的 hooks 审查与信任提示（`docs/codex-status.md`）、pi 的项目信任选择都属于此类。

pi 内置不弹逐次批准（`docs/security.md`："does not ask for approval before every tool call"），但扩展可以弹 `select`/`confirm`/`input`/`editor` 对话框（`docs/extensions.md:1177`），选择列表的 Enter 同样是确认。

**结论：Needs input 或启动对话框期间注入"文字 + Enter"，最坏情况是替用户批准一个操作并丢失派发内容。** "直接写入、让 Agent 自己排队"只在 Busy（无对话框）时成立；而 Busy 期间对话框随时可能弹出，检查状态与写入之间存在竞态。

## 5. 只写入、不按 Enter（留给用户编辑和提交）

### 运行中的面板

在空闲或 Busy 时，三者都把 bracketed paste 原样放进输入框，不提交（第 3 节实测）。风险：

- 与草稿合并（第 3 节）。
- 在 Needs input 时，粘贴被批准对话框吞掉（Codex 源码可证，Claude 实测），不会误批准，但派发内容丢失、用户看不到。
- 不按 Enter 就不会触发对话框选项，所以**"只预填"是唯一在任何状态下都不会替用户作决定的写法**。

### 启动阶段：何时算"就绪"

过早写入有两个问题：

1. **TUI 进入 raw 模式之前，PTY 处于 cooked 模式**：内核回显写入内容（实测 Codex、pi 屏幕上出现了字面量 `^[[200~...^[[201~`），并且 ICRNL 把 `\r` 转成 `\n`。实测在启动后 50 ms 写入"粘贴 + `\r`"：Claude 输入框里出现了文字但**没有提交**（`\n` 被当作 Ctrl+J 换行）；pi 同样没有提交；Codex 接收了文字并显示 "Waiting for startup"，启动完成后才提交。
2. **启动中的保护性界面**：Codex 有专门的启动草稿机制，启动期间可编辑、提交意图延后到保护性界面关闭后（`startup_draft.rs:1-3`、`startup_draft_input.rs:1-4`）；pi 在启动完成前按 Enter 会把文字放回编辑器并提示 "Startup is still in progress"（`interactive-mode.ts:1025-1029`、`3309-3312`）；Claude 没有公开说明。更新提示、信任对话框会截获输入（第 4 节）。

可以不依赖具体 Agent 类型的就绪信号：

| 信号 | 含义 | 实测时间点 | 局限 |
| --- | --- | --- | --- |
| 输出流中出现 `ESC[?2004h`（开启 bracketed paste） | TUI 已进入 raw 模式、能把粘贴识别为粘贴 | Claude ≈200 ms，Codex ≈14 ms，pi ≈150 ms | 不代表会话已就绪，也不代表没有模态对话框 |
| 状态上报器给出 Ready（SessionStart 等） | 会话已建立 | 依类型而定 | 已是现有机制，与类型无关的统一投影；Codex 的 hooks 未被信任时没有 SessionStart（`docs/codex-status.md:9`），面板停在 Error |
| OSC 7501 Program Status（见下） | `idle` / `working` / `blocked:kind=permission` / `done` | 见下 | 需要工作台回复查询；与现有"不从 PTY 数据推断状态"的设计相冲突 |

**OSC 7501 Program Status Protocol** 是三者都已实现的终端级状态协议（[规范](https://www.superlogical.com/rex/docs/build/program-status)）：程序发出 `OSC 7501 ; state=<idle|working|done|blocked|error> [: kind=permission|question|auth] ST`。Codex 不经查询直接发出（`terminal_program_status.rs:219-275`）；Claude（[terminal-config] "See session status in your terminal"，要求 v2.1.295+）和 pi（`tui/src/program-status.ts`）先发查询 `OSC 7501;? ST`，只有终端回复后才上报。实测在探针中回复查询后，三者的上报如下：

```text
claude: 304ms idle → 8070ms working → 10178ms blocked:kind=permission:msg=<base64 "approve Write: ...">
        → (Esc 拒绝后) 23084ms idle
codex:  1076ms idle → 1146ms working → 2513ms idle (MCP 启动完成) → 8005ms working
        → 12794ms blocked:kind=permission → 23017ms working → idle
pi:     150ms idle → 8012ms working → 13322ms done
```

它提供了与 Agent 类型无关的"blocked"信号，可以拦截第 4 节的危险时刻。但需要注意：

- 这是从 PTY 输出流读取状态，与 `ProcessingStatus` "never inferred from PTY data" 的现有设计决定冲突。若采用，应作为新决定记录（ADR），而不是悄悄引入。
- 回复查询会改变 CLI 的行为：Claude 文档说明终端支持该协议时，标签标题不再带状态字形（[terminal-config]），这会影响 `app/main/session-title.ts` 对 Claude 标题的解析。
- 实测中 Claude 在 304 ms、Codex 在 1076 ms 就报 `idle`，这时启动对话框（更新、信任）是否已经结束并不确定；Codex 启动时的更新选择框期间上报什么状态，本次没有测。`idle` 不能单独作为"没有模态对话框"的证明。
- 现有状态上报器已经能给出 Needs input（Claude PermissionRequest/Elicitation、Codex 批准事件、pi 的等价事件），信息量与 7501 相近；用现有投影作为派发前的守卫，不需要引入新的状态来源。
