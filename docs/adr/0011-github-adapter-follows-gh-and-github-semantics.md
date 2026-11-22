# GitHub 适配器按 `gh` 和 GitHub API 的实际行为读写

GitHub 适配器（`app/main/forge/github*.ts`）只通过 `gh` 访问 GitHub（ADR 0004、0006）。下面这些是 `gh` 和 GitHub API 自己的行为，适配器依赖它们，从代码里看不出来。

## `gh` 的输出与失败（`github-cli.ts`）

- 写入子命令（`gh issue close`、`gh pr merge` 等）把结果打印在标准错误上，不在标准输出上；读取它们的结果要读标准错误。
- 失败分类：退出码 4 是 `gh` 的「需要登录」；401 和 404 来自 REST API，`NOT_FOUND` 来自 GraphQL。写入子命令失败时只打印 GraphQL 的消息，消息里点名当前账号看不到的仓库。
- `gh` 没有报错、但输出不符合 schema 的，按暂时性失败处理。
- GraphQL 变量：数字用 `-F` 发成 `Int`，字符串用 `-f` 发成 `String`。
- 按编号一次读多个条目（每个编号一个字段，例如 `n12: issue(number: 12)`）时，GitHub 对不存在的编号返回 `null`，并在数据旁边附一个 `NOT_FOUND` 错误，`gh` 因此以失败退出。只有这类错误时数据照常使用；其他失败照常报告。

## 字段语义（`github-fields.ts`、`github-issue.ts`、`github-pull-request.ts`、`github.ts`）

- 每个读取请求都在同一个请求里取回 `repository { databaseId nameWithOwner }`，调用方据此核对应答的是不是绑定的仓库（ADR 0006）。REST 的 `id` 就是 GraphQL 的 `databaseId`，改名和转移都不变。
- GitHub 在旧路径上的重定向还在时，会以旧路径应答改名或转移后的仓库；只有 ID 能说明应答的仍是同一个仓库。
- 仓库路径不区分大小写；渲染进程比较 forge URL 里的路径时同样不区分大小写（`ForgeDisplay.tsx`）。
- 关闭、重开、合并需要写权限；`viewerPermission` 为 `null` 表示看不出权限。
- 子 issue 和阻塞关系来自各自的字段（`parent`、`subIssues`、`blockedBy`），不用搜索限定符。`blockedBy` 打开和关闭的阻塞者都列出，`issueDependenciesSummary.blockedBy` 只数打开的，包括列表窗口之外的。
- GitHub 的 issue 搜索也会找到 pull request，所以列表查询要带 `is:issue` 或 `is:pr`。搜索词里的数字（带不带 `#`）匹配编号，其他词匹配标题；pull request 的 `is:closed` 包括已合并的。
- 关闭 issue 的 pull request 可能在别的仓库，URL 说明在哪。`refUpdateRule` 是查看者能读到的基础分支保护；`isRequired` 问的是某个检查对这个 pull request 是否必需。
- 检查运行在完成前是 pending，完成后按结论算；neutral、skipped、stale 的运行不妨碍合并。
- 待提交（pending）的 review 只可能是查看者自己的；对代码评论的回复以没有摘要的 review 出现。
- 直接操作走 `gh issue` 和 `gh pr` 子命令，不走 API。`gh pr merge` 带合并方式参数、不带消息时，立即用 GitHub 默认的提交消息合并，并保留分支。

## Consequences

- `tests/fixtures/gh-cli.cjs` 按以上行为模拟 `gh`；GitHub 或 `gh` 的行为变了，适配器和这个替身要一起改。
