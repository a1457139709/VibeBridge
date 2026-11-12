# 工作台与 Agent 共用身份来源：所绑定 Forge 的 CLI 当前账号

派发出去的指令由面板里的 Agent 执行，而 Agent 读写 issue 用的是 Forge 自己的 CLI。如果工作台另有一套身份，侧边栏能看到、能派发的 issue，Agent 可能无法访问。所以工作台在某个 Forge 上的身份一律取自该 Forge 的 CLI 当前激活的账号；工作台不保存、不管理凭据，也没有自己的登录。

## Considered Options

- **内置 OAuth 登录**：要自己发布 OAuth 应用、保管和刷新 token，并且与 Agent 的身份脱节。
- **用户粘贴 token**：要用户自己管理权限和过期，同样与 Agent 的身份脱节。

## Consequences

- Forge 的 CLI 没有安装或没有登录时，仓库绑定和侧边栏不可用，只显示对应的异常状态。
- 不能按项目选择账号；CLI 切换账号会同时影响所有 Agent。
- Agent 若改用别的方式访问 Forge，工作台无法保证两边身份一致。
- 工作台必须找到与 Agent 相同的 CLI。
