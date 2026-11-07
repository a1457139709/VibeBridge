# 工作台与 Agent 共用 GitHub 身份来源：`gh` 当前激活的账号

派发出去的指令由面板里的 Agent 执行，而 Agent 读写 issue 用的是 `gh`。如果工作台另有一套身份，侧边栏能看到、能派发的 issue，Agent 可能无法访问。所以工作台的 GitHub 身份一律取自 `gh` 当前激活的账号，工作台不保存、也不管理凭据，也没有自己的登录。通过调用 `gh` 子命令读写，还是借 `gh auth token` 直接调 API，由 GitHub 网关内部决定，改变调用方式不需要新的 ADR。

## Considered Options

- **内置 OAuth 登录（device flow 或 GitHub App）**：不依赖 `gh`，但要发布 OAuth 应用、自己保管和刷新 token，组织还可能限制第三方 OAuth 应用；更重要的是会与 Agent 的身份脱节。
- **用户粘贴 PAT**：classic PAT 访问私有仓库需要 `repo` 全权限，细粒度 PAT 要逐个仓库授权并且会过期；同样与 Agent 的身份脱节。

## Consequences

- 没有安装或没有登录 `gh` 时，侧边栏不可用，只显示对应的异常状态。
- 不支持按项目选择账号；`gh auth switch` 是全局的，切换账号会同时影响所有 Agent。
- 如果 Agent 改用别的方式访问 GitHub（例如 GitHub MCP 或环境变量里的 token），工作台无法保证两边身份一致。
- 以后接入其他平台时，沿用「与 Agent 共用身份来源」这条原则，具体用什么工具在那时另行决定。
