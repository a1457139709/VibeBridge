# VibeBridge：多项目 Agent 工作台

VibeBridge 是面向个人日常工作的多项目 Agent CLI 工作台。本词汇表区分工作台的面板与布局、CLI 维护的对话，以及一次实际运行。

## Language

### 工作组织

**工作台（Workbench）**：
用户管理多个项目、在项目之间切换并通过终端面板操作 Agent CLI 的应用。
_Avoid_：IDE、任务调度器、Agent 协作平台

**项目（Project）**：
工作台中以一个本地目录为基础组织工作的单元，拥有自己的面板配置与布局。
_Avoid_：仓库（目录不一定是 Git 仓库）、受管会话集合、窗口组

**项目目录（Project Directory）**：
项目关联的本地工作目录，也是该项目中 Agent 运行实例的默认启动目录；同一项目的 Agent 共享其中的文件。
_Avoid_：独立工作副本、隔离目录、面板专属目录

**Agent 类型（Agent Type）**：
某一种通过 CLI 交互的 Agent 工具，例如 Claude Code、Codex CLI 或 pi；同一类型可以有多个运行实例。
_Avoid_：模型、厂商、会话、桌面应用

**Agent 设置（Agent Settings）**：
工作台中按 Agent 类型统一管理、供各项目使用的启动设置。
_Avoid_：Agent 实例、会话身份、项目专属 Agent

### 布局与交互

**主窗口（Main Window）**：
工作台的应用窗口，包含项目导航以及当前项目的布局区域。
_Avoid_：Agent 面板、终端会话

**布局区域（Layout Area）**：
主窗口中用于平铺当前项目全部 Agent 面板的区域，不包括项目导航。
_Avoid_：整个屏幕、某个终端的历史输出区

**Agent 面板（Agent Panel）**：
项目布局中可新增、关闭和调整的一个终端交互区域，承载所选 Agent 的运行实例或显示其未运行状态。
_Avoid_：独立桌面窗口、固定槽位、会话本身、Agent 类型

**面板配置（Panel Configuration）**：
工作台为某个面板保留的 Agent 类型选择。
_Avoid_：会话上下文、会话恢复标识、进程快照

**布局配置（Layout Configuration）**：
一个项目的面板集合、排列关系和相对大小所构成的空间安排。
_Avoid_：CLI 会话历史、临时放大状态、任务运行状态

**面板位置关系（Panel Spatial Relationships）**：
Agent 面板之间的左右、上下方位关系，是用户辨认面板所在位置的空间依据。
_Avoid_：固定像素坐标、面板大小不变、面板面积相等

**项目创建引导（Project Setup）**：
确认新项目目录后，用于选择窗口总数并按 Agent 类型配置初始数量的简单页面。
_Avoid_：布局预览编辑器、逐格分配界面、每次进入项目的确认页、Agent 安装向导、只有单个大终端的初始工作区

**自动排布（Automatic Arrangement）**：
依据当前面板集合及布局规则形成平铺安排的行为。
_Avoid_：固定空槽位、自由重叠浮窗、滚动网格

**临时放大（Temporary Maximize）**：
临时让单个 Agent 面板占据布局区域的查看方式，退出此状态后返回原布局。
_Avoid_：修改保存布局、删除其他面板、结束其他实例

**恢复布局（Restore Layout）**：
依据保存的面板配置和空间安排重新呈现项目工作区的行为。
_Avoid_：恢复 Agent 对话、恢复进程、自动续写任务

### 会话与运行

**会话（Session）**：
由 Agent CLI 维护、具有对话身份与上下文的一次持续对话；同一会话可以经历多次运行实例。
_Avoid_：面板、进程、终端画面、单轮回复、业务任务

**历史会话（Historical Session）**：
CLI 已保存、可通过其原生历史功能查找的既有对话。
_Avoid_：工作台维护的历史列表、关闭的面板、终端输出记录

**会话恢复标识（Session Resume Reference）**：
能够精确指向某个既有会话、供对应 CLI 恢复它的标识；可以是会话 ID 或会话文件标识。
_Avoid_：面板编号、项目目录、最近一次会话

**恢复会话（Resume Session）**：
通过 CLI 的恢复能力重新进入既有对话上下文的行为；本项目讨论的手动恢复由用户在原生 CLI 交互中发起。
_Avoid_：恢复布局、新建对话、重放旧终端画面

**运行实例（Agent Run）**：
由工作台在某个面板中启动、持续一段时间的 Agent CLI 运行。
_Avoid_：Agent 类型、Agent 设置、持久会话身份、面板本身

**关闭面板（Close Panel）**：
从项目布局中移除某个面板并结束其运行实例的用户操作。
_Avoid_：退出应用、删除 CLI 历史、保留固定空位

**终端记录（Terminal Record）**：
终端呈现的输入输出内容，可用于回看操作过程，与 Agent 自身保存的对话上下文不同。
_Avoid_：Agent 记忆、会话恢复标识、任务成功证明

**后台运行（Background Execution）**：
工作台仍在运行时，非当前项目或暂时不可见面板中的运行实例继续执行的状态。
_Avoid_：退出应用后留存的后台服务、自动恢复对话

**退出工作台（Quit Workbench）**：
用户确认后结束整个应用及其管理的运行实例，同时保留项目、面板配置和布局的操作。
_Avoid_：逐个关闭面板、删除 CLI 历史、仅隐藏主窗口

**本轮结束（Turn Ended）**：
Agent 结束一轮处理或回复的状态，其含义不等于用户的完整业务任务已经成功完成。
_Avoid_：任务成功、面板关闭、进程退出
