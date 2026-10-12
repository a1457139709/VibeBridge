# #45 审查修复与复验

修复从集成提交 `37bf855` 开始；提交前已合入 `186237e` 的独立审查记录。实现仅涉及当前标题读取、三种手势的公共指针生命周期，以及复现后确认的极小面板输入焦点问题。沿用 Workbench 服务和真实 Electron DOM／原生输入测试边界，无新增测试框架或私有实现测试。

## 标题提示读取过期快照

实际关闭并重开应用后，使目标项目保持未启动，通过公开 `saveSettings` API 为下一次 Codex 启动增加受控 CLI 的 `--initial-title` 参数，并确认已有 Run 未变化。从已放大的源面板，在减少动态效果模式下定位目标面板：标题栏、导航先显示新的 OSC 标题，成功提示却显示旧快照的默认标题。

- Red：`npm run build && npm run test:desktop -- --titles`，首轮通过，重开轮断言得到 `已切换至：Untitled task`，预期 `已切换至：  New startup OSC | exact title  `。
- Green：同一命令通过首轮及真实重开轮。快照订阅同步更新当前 Run 引用，在生成提示时读取目标的当前标题。测试逐一比较标题栏、导航、提示，并用原生键盘输入确认仅目标 Run 收到字符。

新增重开测试还保留首轮的创建顺序、交换／调整尺寸、增删面板、空项目导航，以及重开后的标题和临时展示状态重置检查。

## 公共指针生命周期

`pointer-capture.ts` 集中管理指针编号过滤、捕获、move/up/cancel/lostcapture 监听、一次性结束和清理。导航宽度、面板分隔线、面板交换继续各自管理计算、持久化和外部取消条件。交换保留 pointerup 最终坐标命中检查；取消不提交。没有添加与帮助函数实现同构的单元测试。

真实导航测试覆盖宽度提交／取消及重开持久化；标题测试覆盖原生交换和分隔线提交。面板测试中的预览、无效目标、Escape 等路径已执行，原生窗口失焦取消路径仍受下述锁屏限制。

## 极小面板定位无法获得输入焦点

通过原生分隔线拖动将面板缩到两字符最小宽度，先聚焦另一面板，再原生点击导航中的极小面板定位项。

- Red：`npm run test:desktop -- --panels` 超时于新增的目标 textarea 焦点断言。`visibility: hidden` 也隐藏了 xterm 的输入元素。
- Green slice：以 `opacity: 0; pointer-events: none` 隐藏终端绘制，保留可编程聚焦的同一输入元素。重复运行面板测试时，新定位／原生字符输入断言通过；字符仅到达目标 Run，同一 `.xterm` 对象仍挂载，后台输出继续。面板仍只绘制 Agent 图标，隐藏终端不会截获鼠标事件。

## 最终检查与待补验证

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过；保留已有 Vite 大 chunk 提示 |
| `npm test` | 33/33 通过 |
| `npm run test:desktop -- --navigation` | 通过，包含真实退出／重开 |
| `npm run test:desktop -- --titles` | 通过，包含真实退出／重开和本次启动标题回归 |
| `npm run test:desktop -- --panels` | 新极小面板输入、普通／嵌套两字符边界、窗口缩小、预览及 Escape 路径通过；完整命令未通过，卡在已有原生窗口焦点前置条件 |
| `git diff --check` | 通过 |
| `git merge-base --is-ancestor implement/spec-45 HEAD` | 通过（集成分支 `186237e`） |

面板测试在调用 `window.blur()` 前要求 BrowserWindow、webContents 与 document 获得焦点。临时诊断读到 `window: false, contents: false, document: true, visible: true, hidden: false`；即使请求应用聚焦也不能恢复原生焦点。只读命令 `/usr/sbin/ioreg -n Root -d1` 的锁屏字段为 `"CGSSessionScreenIsLocked"=Yes`。临时诊断和额外聚焦尝试已移除，原生失焦断言保持不变，也未伪造 blur 或尝试绕过锁屏。

因此原生失焦取消、随后余下的面板提交／重开验证仍待用户解锁后重跑完整 `--panels`。主任务已请求用户解锁，将接手这项验证和实际打包应用启动验证。上述标题、导航、服务检查不替代这一未完成检查。

本次没有修改 #51 过滤范围，也没有宣称真实用户 CLI 标题兼容性或主观动画人工验收已完成。截图、测试工作目录保留供主任务归档。
