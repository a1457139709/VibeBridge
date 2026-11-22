# 每道进程边界检查收到的东西，外来内容不能运行

工作台由渲染进程、主进程、存储 worker、终端宿主和 Agent CLI 组成。数据跨过任何一道边界，都由接收方按共享的 schema 读一遍再用；来自 Forge 或用户环境的内容不能在页面里运行、加载或泄露。

## 进程之间

- **渲染进程 → 主进程**（`app/main/desktop-requests.ts`、`electron.ts`、`preload.ts`）：每个请求的参数在交给处理函数之前，按 DesktopAPI 契约给的类型解析。这里只检查形状；值的含义（名字太长、布局放了别的面板）由 Workbench 判断。主进程只回答本窗口当前显示的页面发来的 IPC；处理函数在显示页面之前装好，磁盘工作异步完成。
- **Project Store ↔ 存储 worker**（`app/main/persistence/storage-protocol.ts`、`storage-worker.ts`）：两边都用同一组 schema 读对方的消息，谁也不信任对方的形状。读不懂的请求回一个错误；连 `id` 都没有的直接丢弃。
- **主进程 ↔ 终端宿主**（`app/terminal/protocol.ts`）：两边按同一份定义解析收到的消息、给发出的消息定类型。
- **跨进程的错误和通知**（`app/shared/messages.ts`）：以字符串跨过 Electron 和子进程边界时，带一个显式的信封，不靠匹配翻译后的句子。只有信封里显式嵌套的消息会被格式化；作为普通字符串传入的用户名、路径和外部详情逐字节不变。这个模块不依赖 React 和任何一份词典。
- **捕获的错误**（`app/shared/caught-error.ts`）：捕获到的值是 `unknown`，代码可能抛字符串或普通对象，所以只有 `Error` 贡献它的 message，其他值取字符串形式。

## 存储

- 存储内容只按当前格式读取（`CODING_STANDARDS.md`）：其他格式让整次加载失败，文件不动。SQLite 会存下给它的任何值（TEXT 列里能放 blob，INTEGER 列里能放文本），所以除了 layout、`panels.agent` 和仓库相关的列，每一列都按表的声明读取，存了别的类型就像其他无效字段一样报告。
- 设置冲突只阻止正在保存的那些类别（`app/main/persistence/settings.ts`）。

## 外来内容和用户环境

- **Forge 的 HTML**（`app/shared/forge/forge-html.ts`）：工作台从不自己解析 Markdown，只显示 Forge 自己渲染的 HTML，并先经过白名单过滤，去掉一切能运行、加载、带样式或提交的东西。解析在惰性的 `<template>` 里进行，输入里的东西在途中不会加载或运行。页面的内容安全策略只允许自己的图片，所以图片和视频变成指向文件的链接，以 alt 文本命名；在链接里面时它只成为链接的名字，链接不嵌套。
- **外部链接**（`app/main/electron.ts`）：过滤后保留的链接只有 http、https 和 mailto，用系统自己的应用打开。
- **PATH**（`app/main/electron.ts`、`app/terminal/environment.ts`）：从 Finder 打开的应用只继承最小的 PATH。`gh` 这类 Forge CLI 先在继承的 PATH 上找，再在登录 shell 的 PATH 上找，Agent 也在那里找到它们。登录 shell 只用来读用户环境，Agent 从不经由它运行。
- **嵌套的工作台**（`app/terminal/environment.ts`）：在另一个工作台的终端里启动的工作台会继承那个工作台的变量，包括它的上报凭据；每次启动只加自己的。
- **进程检查**（`app/terminal/processes.ts`）：macOS 的 `ps -E` 读的是启动环境，包括重新挂靠父进程后继承来的归属。只保留我们自己的标记；命令行和其他环境变量从不记录或发送。
