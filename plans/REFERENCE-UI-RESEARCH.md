# VibeGuild / BridgeMind UI 调研

调研日期：2026-09-29。依据官方文档、官网及更新日志；没有安装、操作桌面客户端。BridgeMind 官网标明为样例数据交互演示，因此演示可参考外观，不能作为客户端行为验收。[官网](https://www.bridgemind.ai/)

## 创建与启动

| 产品 | 已证实流程 | 尚未证实 |
| --- | --- | --- |
| VibeGuild | New workspace → 选项目文件夹 → 选布局 → 用“Start with”数量步进器预填 Agent／终端；未填位置保持空闲。文档例子是 2×2 中两格 Claude Code、一格终端。[入门](https://vibeguild.ai/docs/getting-started) 官网说明工作区打开时启动已选 Agent。[官网](https://vibeguild.ai/) | 最终确认按钮的名称、能否在配置页逐格指定位置。 |
| BridgeMind | Code 模式 → 从左栏添加文件夹 → 选工作区 → 从面板菜单启动会话；也提供 Solo、Pair、Workbench、Swarm 预设，启动前展示数量与角色。[Code Mode](https://docs.bridgemind.ai/docs/code-mode) macOS v0.1.20 明确有启动向导，可保存 seat list 下次复用；v0.1.21 明确有 Launch 按钮并支持混合类型席位。[0.1.20](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-20)、[0.1.21](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-21) | 是否首次添加项目后强制进入配置页、任意面板数量上限、当前向导逐格分配 Agent 的完整交互。 |

VibeGuild 的布局模板包括 1×1、1×2、1×3、2×2、1+2、3×3；进入后可增加、拆分、拖动面板，Arrange 可重新排布。[工作区](https://vibeguild.ai/docs/workspaces) BridgeMind 支持拆分、堆叠、标签页、缩放与重排，属于可调整的布局。[Code Mode](https://docs.bridgemind.ai/docs/code-mode)

## 关闭、恢复与 Agent 类型

- **关闭后的格子**：两家资料均提到关闭面板，但本次没有找到“关闭后保留固定空槽位”或“关闭后自动合并布局”的明确规则，不能从支持关闭推导其结果。[VibeGuild 工作区](https://vibeguild.ai/docs/workspaces)、[BridgeMind Code Mode](https://docs.bridgemind.ai/docs/code-mode)
- **恢复**：VibeGuild 的面板菜单含 Restart，Agent profile 可配置 CLI 会话恢复，但取决于对应 CLI 的支持。[工作区](https://vibeguild.ai/docs/workspaces)、[Agent profiles](https://vibeguild.ai/docs/agents) BridgeMind macOS v0.1.48 明确保留已关闭会话历史，并提供 Resume session／Start fresh；日志未说明两个入口是否常驻空格中央。[0.1.48](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-48)
- **固定类型**：没有查到两家规定“位置永久绑定某类 Agent”。BridgeMind 的 Handoff 会在旁边打开接收会话，这是另一个会话，不能据此认定原槽位能够直接换类型。[Windows/Linux 0.1.18](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-18) VibeGuild 的 profile 编辑也不能等同于当前面板的类型切换。[Agent profiles](https://vibeguild.ai/docs/agents)

## 主布局与控件

VibeGuild 左栏列工作区及其面板，中间是终端网格，右侧可打开辅助工具；底部有状态栏。[总体布局](https://vibeguild.ai/docs) 其面板实际保留标题栏：编号状态、名称／任务、分支、放大、关闭；⋯ 收纳重启与拆分。忙碌／等待时关闭默认在面板内确认，可由设置调整。[工作区](https://vibeguild.ai/docs/workspaces)、[设置](https://vibeguild.ai/docs/settings)

BridgeMind 官网演示是左项目栏、中央分屏、右辅助栏。[官网](https://www.bridgemind.ai/) macOS v0.1.21 简化了标题文字：状态点与图标保留，完整标题进入提示和 ⋯；仍有面板 header，不能描述为完全无标题栏。[0.1.21](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-21) 两家资料都不足以确认“鼠标仅靠近右上角才浮现三个操作”。

## 版本与证据限制

- VibeGuild 更新日志当前标记 v0.1.4（2026-08-05）为最新；工作区页直接抓取失败，上述内容来自搜索服务收录的同域官方正文，可能有缓存延迟。[更新日志](https://vibeguild.ai/changelog)
- BridgeMind 文档仍将 Files 列为 Code 面板，但 2026-09-25 的 Windows/Linux v0.1.68 已将 Files 移至右侧栏。两份资料存在版本／平台差异，不能拼成一套未经验证的当前界面。[Code Mode](https://docs.bridgemind.ai/docs/code-mode)、[0.1.68](https://www.bridgemind.ai/changelog/bridgemind-one/v0-1-68)

## 官网演示的直接观察

在 BridgeMind 官网的 Code 演示中，可见左侧项目及会话列表、中央上下分屏、右侧辅助栏；终端使用细边框，选中的面板有蓝紫色高亮边框，顶部仍有一条紧凑的图标操作区域。点击演示中的 Open sample workspace 会进入一个示例空项目，显示 Agent 选择按钮；这条演示路径没有展示更新日志描述的完整启动配置向导，不能据此推断桌面端已取消向导。[官网演示](https://www.bridgemind.ai/)

以下为本次实际查看的官网演示截图，页面明确标有 Sample data，终端内容为模拟数据。

![BridgeMind 官网 Code 模式示例](./research-assets/bridgemind-code-demo.png)

## 对 VibeBridge 的建议（设计推断）

借鉴“启动前配置、确认后一起进入工作区”的结构：项目目录 → 布局／数量 → 分配 Agent → 确认启动。随后允许通过“＋”新增面板、关闭后移除面板并自动排布，仍支持手动调整和保存布局。

访谈更新：用户已确认采用上述动态面板方向，首次创建引导仍为必要步骤；第一版仅保存面板配置与布局，会话由用户在 CLI 内手动恢复。此前固定槽位、空槽位新建／恢复双入口与应用自动恢复的方案已被替换。无常驻面板标题、靠近右上角浮现三个图标等已确认视觉取舍仍保留。具体产品规则见 [当前规格](./SPEC.md)，不将其视为两款参考产品的同等行为承诺。
