# 工作台与 Agent 共用平台身份来源：所绑定平台 CLI 的当前账号；GitHub 用 `gh`

派发出去的指令由面板里的 Agent 执行，而 Agent 读写 issue 用的是平台自己的 CLI，GitHub 上就是 `gh`。如果工作台另有一套身份，侧边栏能看到、能派发的 issue，Agent 可能无法访问。所以工作台在代码托管平台上的身份一律取自所绑定平台 CLI 当前激活的账号；对 GitHub 就是 `gh` 当前激活的账号。工作台不保存、也不管理凭据，也没有自己的登录。通过调用 CLI 子命令读写，还是借 CLI 拿到 token 直接调 API，由平台适配器内部决定（见 ADR 0006），改变调用方式不需要新的 ADR。

## Considered Options

- **内置 OAuth 登录（device flow 或 GitHub App）**：不依赖 `gh`，但要发布 OAuth 应用、自己保管和刷新 token，组织还可能限制第三方 OAuth 应用；更重要的是会与 Agent 的身份脱节。
- **用户粘贴 PAT**：classic PAT 访问私有仓库需要 `repo` 全权限，细粒度 PAT 要逐个仓库授权并且会过期；同样与 Agent 的身份脱节。

## Consequences

- 平台 CLI 没有安装或没有登录时，仓库选择器和侧边栏不可用，只显示对应的异常状态。
- 不支持按项目选择账号；`gh auth switch` 是全局的，切换账号会同时影响所有 Agent。
- 如果 Agent 改用别的方式访问平台（例如 GitHub MCP 或环境变量里的 token），工作台无法保证两边身份一致。
- 接入其他平台时，它的适配器同样使用该平台 CLI 的当前账号。
