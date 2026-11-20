# Workbench 只做协调，状态归功能模块

主进程的 `Workbench`（`app/main/workbench.ts`）是 IPC 进来的地方，但它不持有功能的状态。每个功能有自己的模块，模块持有自己的状态，并自己读写存储：

- `ProjectPanels`（`app/main/projects/project-panels.ts`）：项目的面板、托盘和布局。
- `RepositoryBindings`（`app/main/forge/repository-bindings.ts`）：仓库绑定，以及绑定按 ID 跟随仓库。
- `RunSupervision`（`app/main/runs/run-supervision.ts`）：面板的运行、输入、尺寸和输出流。
- `Dispatches`（`app/main/dispatch.ts`）：派发和派发记录。
- `ForgeSidebarData`（`app/main/forge/forge-sidebar-data.ts`）：Forge 侧边栏的列表、详情，以及绑定页可选的仓库（ADR 0008）；IPC 通过 `workbench.forgeSidebar` 调它。

`Workbench` 只做跨模块的事：

- **操作队列**：改动项目的调用排进 `operation`，一次一个。
- **找项目**：`project(id)` 把项目 ID 换成项目，项目不存在就报错。
- **跨模块流程**：创建、编辑、删除、激活项目要同时动存储和几个模块，流程写在 `Workbench` 里。
- **快照和事件**：把各模块的视图拼成快照，发给渲染进程。

一个调用既不进队列、也不找项目、也不组合模块时，调用方直接调模块：IPC 通过 `workbench.runs` 调 `RunSupervision`。`Workbench` 里不留只转发的方法；`npm run check:source-shape` 会拒绝方法体只有一个 `this.<字段>.<方法>(…)` 调用的方法。`this.operation(() => this.panels.place(this.project(id), …))` 这样排队并找项目的一行方法是协调，保留。

新功能加一个模块，持有它自己的状态。`Workbench` 最多加一行把调用排进队列，或在跨模块流程里加一步。

## Considered Options

- **状态都放在 `Workbench` 里**：每个功能都要改 `workbench.ts`，文件一直变大。提交时的文件大小检查只能逼着把它拆开，或者把代码挤到很长的行里；按功能拆出模块才能让文件随功能分开。
- **IPC 全部绕开 `Workbench`，直接调模块**：改动项目的调用会失去操作队列和找项目这一步，顺序和「项目已删除」的错误要在每个模块里重做一遍。
- **保留转发方法，让 IPC 只认识 `Workbench`**：每个功能的每个调用都要在 `Workbench` 里多一个方法，`Workbench` 又会变成所有功能都要改的地方。

## Consequences

- `workbench.ts` 只随跨模块流程变化；单个功能的改动落在它自己的模块和 IPC 那一行。
- 渲染进程的 `DesktopAPI` 用 `sendInput`、`resizeRun` 这些名字，IPC 处理函数把它们接到 `workbench.runs.input`、`workbench.runs.resize`。
- 只转发的方法在 `npm run check` 和 CI 的静态检查里失败。
