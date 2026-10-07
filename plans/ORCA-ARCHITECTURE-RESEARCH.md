# Orca 对 VibeBridge V1 扩展边界的参考

研究日期：2026-10-07。固定 Orca commit：`5b1bb78d14b6a1929523d8741f58d1206e94ce25`。只读源码，未安装或运行。建议不是已接受决定。

## 一手源码证据

- [运行时解耦](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/orcad/main.ts#L1-L25)：普通 Node 入口带 smoke-load-check；仅确认代码存在，本次未运行。

- [依赖验证](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/config/scripts/check-runtime-electron-ratchet.mjs#L1-L46)：esbuild 依赖图门禁约束运行时 Electron 引用；config/runtime-electron-baseline.txt 当前为空。本次未执行检查。

- [类型耦合](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/runtime/runtime-desktop-surface.ts#L1-L35)：接口仍 import type BrowserWindow/IpcMainEvent。类型擦除意味着这不是运行时加载 Electron 的证据，但桌面概念仍渗入接口。

- [宿主适配](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/host/electron-runtime-desktop-surface.ts#L1-L23)：实际 Electron 导入集中在桌面适配器，提供通知、窗口查找和 IPC。

- [状态来源](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/shared/agent-status-types.ts#L1-L55)：working/blocked/waiting/done 源于原生 Agent hooks，另有中断推断，不应等同 PTY 退出。

- [Hook 归一化](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/agent-hooks/server.ts#L1-L42)：独立 Hook 入口调用 normalizeHookPayload。

- [通知投递](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/notifications/notification-delivery-service.ts#L1-L99)：注入时钟、设置、原生/移动投递，含去重冷却；接口仍引用 BrowserWindow 类型。

- [worktree 创建](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/main/runtime/runtime-local-git-worktree-create.ts#L28-L73)：repo、workspaceRoot、branchName、worktreePath、store 和 Git 操作分离传入。

- [worktree 生命周期](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/preload/api/worktree-api.ts#L85-L142)：创建、删除、仅忘记记录及多项删除许可分别表达。

- [外部调用](https://github.com/stablyai/orca/blob/5b1bb78d14b6a1929523d8741f58d1206e94ce25/src/cli/runtime/transport.ts#L190-L210)：Node net socket 请求携带 authToken；src/cli/handlers/agent-hooks.ts 的 client.call 调用 settings.update。命令通道与 Hook 状态入口分开。本次未审计权限模型。

## VibeBridge 基线与建议

VibeBridge HEAD 为 1142123，同时阅读主目录现有未提交 SPEC，未修改用户文件。当前 SPEC 第 82–90 行选定独立终端管理进程，没有规定核心依赖规则；第 318 行提醒在范围外。终端原型 plans/terminal.prototype/host.prototype.cjs 第 10、29 行直接使用 process.parentPort，第 6、43 行使用全局 cwd，第 45–49 行只有 output/exit。因此有进程隔离，不等于已经有可在普通 Node 中调用的运行核心。

用户后续澄清：目标是避免 Electron 耦合妨碍未来 Agent 通信和状态管理，不要求整个应用完全脱离 Electron。以下为待讨论建议，不是已确认的全面解耦要求。

1. 运行状态与通信处理集中管理，尽量通过普通数据调用，不让窗口或组件成为状态的唯一所有者。
2. Electron 可继续承担桌面能力、utilityProcess 启动和内部 IPC 接线；业务规则与这些入口分开，未来 Agent 请求能复用同一套操作。具体模块分工由后续人机决策确定。
3. 启动输入明确 runId、程序、参数、cwd、环境与尺寸。V1 仍从项目目录取得 cwd；不必提前实现 worktree 功能。关闭面板未来不应隐式等于删除工作副本。
4. PTY 数据/退出与 Agent 语义事件分开。V1 只发真实已有事件；将来按 Agent 增加状态来源，再由通知消费者处理，不把进程退出伪装成业务任务完成。
5. 验证切换视图不丢运行状态、不同调用入口复用同一操作等扩展约束。普通 Node 下加载/调用核心只是候选验证方式，不是用户要求的全面可移植性验收。无需现在交付 daemon、浏览器客户端、公开 RPC 或插件系统。

Orca 的移动端、远程主机和编排体系超出轻量 V1；借鉴边界与依赖验证，不复制整个平台。用户已确认未来还需要 Agent 间通信和任务调度。本研究未覆盖完整调度方案；后续人机决策只确定这些目标对 V1 接口的最小约束，不将协作与调度功能纳入 V1 实现。

## 验证与限制

固定提交源码阅读支持上述结构观察，不证明 Orca 所有运行路径均可移植或其权限安全。本次不执行第三方代码。此前推送因缺少上传 VibeBridge 架构细节的明确授权而被自动审批拒绝；用户于 2026-10-07 明确授权上传，现可发布本报告。
