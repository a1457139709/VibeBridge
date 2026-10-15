# Issue 63：面板布局交互深化

实施与验收依据：[最新 Agent Brief](https://github.com/a1457139709/VibeBridge/issues/63#issuecomment-6191801148)。早期研究的共享 MeasurementGate 草图不作为接口要求。

基线：`383f4c5568c689c4367962305cdbec1c22b5442c`，实施分支 `refactor/panel-interactions-63`。验证日期：2026-10-15，macOS，Electron 44.5.1。未读取或复用原型实现。

## 调用者知识与职责

| 知识／职责 | 改造前 | 改造后 |
| --- | --- | --- |
| 交换预览与分隔线调整的活动状态、互斥 | Workspace 分别保存两套取消函数及拖动状态 | panel-interactions 只有一个活动操作；结束／取消前忽略重叠开始请求 |
| Escape、失焦、窗口／布局区域变化、布局失效、隐藏与卸载 | Workspace 与 panel-drag 分别监听及清理 | module 根据最新上下文、指针和环境事件统一终止；迟到事件不保存 |
| 嵌套面板最小尺寸及不足下限时的单向恢复 | Workspace 计算与维护上下限 | 内部 panel-resize 维护约束，调用者只转交分隔线意图 |
| 交换预览期间冻结测量，结束后按最新标题恢复 | panel-drag 写 CSS class，terminals 读 class 并用 MutationObserver 恢复 | module 拥有面板观察器和测量时机；交换预览冻结，分隔线调整实时测量 |
| 标题／运行快照更新时的观察生命周期 | TerminalView 按标题与 runId 重建观察器 | 每次 DOM 提交传入最新上下文；module 复用或撤销绑定，不让调用者安排冻结／释放顺序 |
| 面板标题栏、紧凑呈现、最小尺寸事实 | terminals 提供，Workspace 消费部分事实 | 内部 panel-measurement 集中面板知识 |
| xterm 单元格事实、终端屏幕、输出、输入、fit、运行实例关系 | terminals | 仍由 terminals 拥有，完全不依赖布局交互活动状态 |
| 临时布局呈现、有效提交的保存及错误报告 | Workspace | 仍由 Workspace 执行 module 的输出；不暴露共享 gate |

公共 interface：`createPanelInteractions(canvas, context)`、`update(context)`、`startSwap`、`startResize`、`cancel`、`dispose`。上下文中的 `layout` 是最新有效保存布局；临时布局只通过 `presentLayout` 输出。`Workspace` 在 DOM 提交后更新上下文，因此提交回调与标题／运行事实保持新鲜，不需要向 module 传私有测量状态。

内部实现分为生命周期与测量调度、交换影像、分隔线约束和面板测量。`panel-drag.ts` 及旧观察协议已删除。CSS 的 `.dragging`、`.resizing` 只负责外观；`capturePointer` 原样保留。

依赖方向：

```text
Workspace ──上下文／交互意图──> panel-interactions
Workspace <──临时布局／有效提交── panel-interactions
                               ├─ panel-swap（冻结的绘制影像与目标）
                               ├─ panel-resize（嵌套尺寸约束）
                               ├─ panel-measurement ──> terminals.terminalCellSize
                               └─ capturePointer
TerminalView ──挂载──> terminals（运行与屏幕生命周期）
```

**Deletion test：通过。** 如果删除新 module，调用者就必须重新拥有两个操作的互斥、各类取消、指针清理、分隔线恢复与钳制、面板绑定生命周期以及两种不同的测量策略。交换影像与尺寸计算虽然可以分文件，以上协调规则不能仅靠直接调用这些内部函数获得。因此收益来自调用者不再掌握这些协调知识，而非文件数或行数。

## 测试 seam 与红绿过程

`tests/desktop/panel-interactions.test.cjs` 将正式 module 打包到真实 Electron DOM 中，fixture 作为普通调用者，通过同一 interface 提供上下文并接收布局输出。使用真实浏览器布局、字体测量、ResizeObserver 和指针捕获，不注入 fake gate、不读取私有活动状态。

按序验证失败再实现：

1. A 悬停 B、再悬停 C，最终在 B 松手：未实现时提交为空；实现后仅提交原始 A↔B 一次。
2. 标题在预览前、预览期间连续更新、取消：未实现时没有面板测量；实现后预览中真实几何稳定，取消后使用最新标题。
3. 分隔线实时缩小与取消：未实现时布局不变；实现后松手前布局与紧凑呈现已更新，取消回到保存布局，迟到的松手不保存。
4. 操作互斥：第二个开始请求原先替换了活动操作；修正后在活动操作结束前忽略重叠请求。

继续覆盖两类操作各 14 条取消路径、最终松手坐标、外部布局更新、最新提交回调、销毁后观察停止、隐藏／临时放大禁止开始、已不足下限的面板在恢复途中不能反向让出空间，以及达到正常下限后恢复双向调整。

真实集成测试 `tests/desktop/panels.test.cjs` 保留原有 DOM/xterm、PTY、输入、终端记录、原生失焦、嵌套尺寸和重开检查，并增加：

- 分隔线仍按住时，真实 PTY 与紧凑呈现已经变化，保存布局未变；Escape 恢复尺寸。
- 预览中连续真实 OSC 标题更新后提交，按最终布局测量，并保留原终端对象。
- 按住交换预览时切换项目，卸载清除影像，迟到松手不改写保存布局。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；保留既有 Vite 大块提示 |
| `npm test -- tests/panels.test.ts` | 4/4 通过 |
| `npm test` | 37/37 通过，零跳过，约 34.3 秒 |
| `npm run test:desktop -- --panel-interactions` | 通过，含两类操作各 14 条取消路径 |
| `npm run test:desktop -- --panels` | 原有套件与补强后的套件均通过；原生焦点／失焦未跳过，退出重开通过 |
| `git diff --check` | 通过 |

运行限制与已处理失败：

- 首次在沙箱内启动 interface 桌面测试时 Electron 立即退出；获准在沙箱外执行后得到预期红测试，再逐步转绿。
- 面板业务测试首次在沙箱内 0/4，错误为无法读取受管进程表；沙箱外重跑 4/4，完整业务套件 37/37。
- 新增分隔线测试最初把鼠标按在两条分隔线交点，触发了内层分隔线；将测试起点改为外层分隔线四分之一处后通过。
- 取消路径测试最初向 window 直接派发键盘事件，触发既有应用监听器对非元素 target 的异常；改为从真实元素冒泡后通过。
- Electron Shared Dictionary 缓存告警及故障注入用例的启动失败输出不影响最终通过结果。

桌面测试继续由手动触发工作流执行，未修改 CI 触发政策。测试使用真实 PTY 和既有可控 CLI，未运行真实 Codex／Claude 对话；本票不要求改变 Agent 协议或验证真实服务端对话。

## Standards

独立审查：0 项发现。未发现 AGENTS.md、领域文档、README 测试约定或适用 skill 规则的违反，也没有值得修改的基线代码异味。调用者中的两套取消／测量协议已收进 module；公共 interface 测试没有检查私有活动状态或注入 gate，deletion test 得到代码差异支持。

## Spec

独立审查：0 项发现。对照最新 Agent Brief，未发现缺失要求、越界改动或明确实现错误。两种测量策略、最新上下文与提交回调、观察生命周期、尺寸约束和终端身份均有对应实现与验证。

审查基于 `383f4c5` 的全部暂存差异，两个审查者均只读检查；实际运行结果来自上面的执行记录。汇总：Standards 0，Spec 0。
