# 工作台与 Agent 共用身份来源：所绑定平台 CLI 的当前账号

派发出去的指令由面板里的 Agent 执行，而 Agent 读写 issue 用的是代码托管平台自己的 CLI。如果工作台另有一套身份，侧边栏能看到、能派发的 issue，Agent 可能无法访问。所以工作台在某个代码托管平台上的身份一律取自该平台 CLI 当前激活的账号，工作台不保存、也不管理凭据，也没有自己的登录。GitHub 用 `gh`。调用 CLI 子命令还是借 CLI 取得的 token 直接调 API，由该平台的适配器内部决定，改变调用方式不需要新的 ADR。

## Considered Options

- **内置 OAuth 登录（device flow 或 GitHub App）**：不依赖平台 CLI，但要发布 OAuth 应用、自己保管和刷新 token，组织还可能限制第三方 OAuth 应用；更重要的是会与 Agent 的身份脱节。
- **用户粘贴 PAT**：classic PAT 访问私有仓库需要 `repo` 全权限，细粒度 PAT 要逐个仓库授权并且会过期；同样与 Agent 的身份脱节。

## Consequences

- 平台 CLI 没有安装或没有登录时，绑定和侧边栏不可用，只显示对应的异常状态；安装链接和登录命令由适配器提供。
- 不支持按项目选择账号；`gh auth switch` 是全局的，切换账号会同时影响所有 Agent。
- 如果 Agent 改用别的方式访问平台（例如 GitHub MCP 或环境变量里的 token），工作台无法保证两边身份一致。
- 接入新平台时，它的适配器同样以该平台 CLI 的当前账号为身份。
- 工作台从 `PATH` 找平台 CLI；从访达启动时，继承的 `PATH` 之后再接上登录 shell 的 `PATH`，与 Agent 找到的是同一个 CLI。
