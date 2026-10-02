# VibeBridge 真实终端原型

**THROWAWAY / 用于体验决策，不能作为正式产品实现。**

对应决策票：[用真实 Agent 验证内嵌终端的视觉与交互体验](https://github.com/a1457139709/VibeBridge/issues/17)。用户已同意先做最小真实原型，再由本人体验决定是否接受当前外观。

## 启动

在项目根目录运行：

```sh
npm run prototype:terminal
```

直接验证浅色（让 CLI 在启动时查询到浅色背景）：`npm run prototype:terminal -- --theme=light`。

首次获取此分支先 `npm ci`。首次启动会从官方来源下载 Electron；若 node-pty ABI 不匹配，会自动为该 Electron 编译，需要本机 Xcode Command Line Tools。也可手动执行 `npm run rebuild:terminal`。类型检查：`npm run check:terminal`。

脚本从当前 PATH 检测 `codex`、`claude`、`pi`，记录 `--version`，打开 Electron 窗口并自动启动首个可用 Agent。右上角可继续添加，最多四个真实运行实例。CLI 使用本机已有配置与认证；原生登录、目录信任、权限确认仍在 CLI 中操作。没有自动提交模型任务或绕过权限确认。

每次启动创建新的临时示例目录，包含 README 和 example.ts。路径在窗口顶部显示；Agent 对临时目录的修改会留在该目录中，直到系统清理。原型使用独立的临时 Electron profile，不保存工作台设置或终端记录。Agent 自身可能按其原生行为保存会话。

## 体验方式

- 默认排版 A 复用当前 UI：SFMono-Regular、13px、1.55 行高、4.5 最小对比度、隐藏滚动条。B 为紧凑排版，C 为较大字号，均只是候选，不表示用户已确认。可调字号、行高、滚动条和最小对比度。
- 底部 1 / 2 / 4 格控制比较尺寸；空格仅用于保留相同分屏大小，不启动额外进程。已有面板数超过所选格数时自动容纳全部面板。
- 面板右上角临时放大／还原。外观和尺寸调整保持同一个 PTY 与 PID，实际 cols / rows 显示在面板顶部。
- 工作台主题、终端调色板和 CLI 原生主题是三个状态。底部“终端配色”可跟随界面、固定深色或固定浅色；固定深色可比较“浅色工作台＋深色终端”。默认仍跟随界面，候选选择不保存。CLI 内部主题仍用其自身功能修改，并在体验记录中注明；此选项不会修改 CLI 配置。
- 原型为真实 PTY 清除从命令执行环境继承的 `NO_COLOR`，让 CLI 输出颜色。使用 xterm 的 WebGL 扩展与自定义块字符；面板底部显示实际渲染器。WebGL 不可用或失效时回退 DOM，并明确显示回退状态。
- 输入、转义序列和二进制鼠标事件传给 PTY；CLI 输出交给 xterm.js 解释。⌘C 复制终端选区，⌘V 用 xterm 的 bracketed paste 逻辑粘贴；Ctrl+C 保留给 CLI。
- 关闭面板结束该运行实例；关闭整个原型结束所有受管实例。为了观察退出结果，CLI 自行退出时暂时保留画面和退出码，这是实验专用行为。
- “体验记录”可以填写观察并复制环境版本、主题、排版、窗口尺寸和各终端网格；不复制终端正文。复制到决策票前仍需人工判断结论。

建议逐一尝试：长中文回答、代码与工具输出、权限确认、方向键／原生选择菜单、连续输入、中文输入法、多行粘贴、Ctrl+C、滚动回看、尺寸变化和临时放大。

## 实验边界

这次沿用已经确认的 UI，只比较真实 CLI 呈现。排版 A/B/C 不重新打开导航或添加面板结构决策。配色和图标是当前本地 UI 的独立快照，原有模拟工作台仍可用 `npm run prototype` 启动。

Electron 主进程只管理窗口和窄 IPC；一个 `utilityProcess` 持有全部 node-pty 实例。渲染器开启 context isolation、sandbox，关闭 Node integration，无外部 Web 服务。正常关闭对所建 PTY 进程组发出终止信号并在等待后强制清理。

不包含项目管理、SQLite、本地配置保存、跨启动恢复、产品打包和完整故障恢复。直接使用当前 PATH 中的命令，不验证 Finder 启动、shell 初始化、别名／函数或所有命令环境。主进程及终端宿主故障、脱离进程组的后代清理等仍由技术复核与正式集成验收负责。

主观结论必须来自用户体验。构建通过、能显示 CLI 启动界面，不等于中文输入法、长回答、权限确认、所有控制序列或全部生命周期场景已经通过。

## 本次冒烟验证（2026-10-02）

- `npm run check:terminal`、原有 `npm run check:prototype`、Vite 构建通过；node-pty 已为 Electron 44.5.1 构建并实际加载。
- macOS arm64；Codex CLI 0.159.0、Claude Code 2.1.285／重启检测为 2.1.287、pi 0.84.4。分别出现原生启动界面；Codex 和 Claude 的示例目录确认菜单可用。未提交模型任务。
- 初始 DOM 渲染器、基准排版与 1360×900 窗口下，双格为 70×28，四格为 70×12；pi 临时放大为 144×28，PID 保持不变。深浅主题切换保持运行实例。后续 WebGL 的网格度量见下方修正记录。
- pi 中粘贴 `中文粘贴检查` 和 `第二行：ABC 123` 两行，只出现一次；Ctrl+C 清空输入。最初重复粘贴由额外 Cmd+V 处理器与 Electron 原生菜单同时响应导致，删除额外处理器后重复同一场景通过。
- 原型收到正常终止请求后，主进程、PTY 宿主以及已记录的三个 CLI PID 全部退出；另一次关闭 pi 面板后，该 PID 也已退出。
- 为后台终端设置 `backgroundThrottling: false`，避免窗口失焦／遮挡时终端网格与绘制调度被节流；调整后的窗口操作和截图已再次核对。

以上只是链路冒烟检查。长模型回答、实际工具执行／权限审批、中文输入法候选窗口、各 CLI 原生历史与滚动体验仍等待用户操作；没有正式集成通过结论。

## 浅色参考与已定位问题（2026-10-02）

用户原话：“在深色主题下终端表现不错。但是浅色主题会造成视觉错乱。”因此深色获得了正向体验反馈，浅色尚未通过，决策票保持打开。

用户随后提供了 Codex、Claude Code 的原生浅色终端截图作为参考：白底、深色正文，保留蓝色强调、灰色辅助文字、原生状态色和完整的块状图标。继续以真正的浅色终端为验证目标，独立深色选项只是已有对照，不作为接受结论。

定位并修正两项问题：

1. **Codex 几乎呈灰度**：执行环境带有 `NO_COLOR=1`，被原型原样传入 PTY。相同 CLI、相同浅色 OSC 10/11 响应下，继承它时没有蓝色输出；只删除它后恢复原生蓝色、浅灰输入区。修正在实际 PTY 宿主构造子进程环境的位置。
2. **Claude 图标出现黑色横条**：CLI 本身为橙色块字符指定 RGB 黑底；DOM 按字体画字符，在 1.55 行高下没有填满单元格，露出黑底。关闭对比度补偿不会消除横条；行高降到 1 后横条缩小。改用 `@xterm/addon-webgl@0.19.0` 和 `customGlyphs` 后，在原来的 13px／1.55 行高下图标连续、没有横条。此现象并非 ANSI 白色映射导致，因此本次未改 ANSI 调色板。

用于锁定第一项的 throwaway 诊断探针调用真实 `host.prototype.cjs`、真实 PTY 与 Codex，只响应启动时的终端颜色查询，不提交模型任务、不输出终端正文：

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron plans/terminal.prototype/debug/color-probe.prototype.cjs
```

同一探针修正前输出 `hasNativeBlue: false / FAIL`，修正后输出 `hasNativeBlue: true / PASS`。它只覆盖本机 Codex 0.159.0 启动颜色，不是完整兼容测试套件。

验证：类型检查与 Vite 构建通过；真实 Codex 0.159.0、Claude Code 2.1.287 在白底下显示原生颜色，Claude 图标黑条消失；两面板均显示 WebGL。1360×900、基准排版下 WebGL 测得双格 73×28（DOM 为 70×28），实际网格已传给 PTY。深浅色往返切换保持这两个 PID 和网格。最后停留在浅色、原始颜色（最小对比度 1）供用户对照；默认排版仍是 4.5，对比度取舍尚未定案。

仍有边界：从浅色切到深色时，已经运行的 Codex 保留了浅灰输入背景，说明运行中的 CLI 原生主题并不会随工作台立即重新选择。本次通过启动参数控制初始主题，不自动重启 CLI 或改其配置。pi 的原生浅色主题、长输出、运行时主题同步以及用户对修正版的体验仍待验证；不据此关闭决策票。

## 实现参考

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron 原生模块与 ABI](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [node-pty 官方仓库](https://github.com/microsoft/node-pty)
- [xterm 官方 WebGL 扩展](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl)
- [xterm customGlyphs 说明](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#optional-customglyphs)
