# 桌面测试分层与验收去向（#82）

盘点基准：`af9885f`（#82 开始时的 main）。下表的旧路径均相对此提交的 `tests/desktop/`，可用 `git show af9885f:tests/desktop/<路径>` 查原断言。旧入口和依赖前序状态的 scenarios 已移除，不以合并入口文件减少测试数量。

代码检查为 `npm run check`：typecheck → 单元／模块测试 → 组件测试。模块测试仍在 Electron Node 模式中使用真实 PTY、SQLite、隔离目录和可控 CLI。组件在 jsdom 测试进程内渲染，只替换 preload API，不启动应用窗口，不验证 CSS、几何或原生焦点。

## 去向索引

- U：`tests/rules.test.ts`，直接调用名称、数量、布局、快捷键、标题公共规则函数。
- B：`tests/*.test.ts` 中已有的 Workbench／进程测试；下表给出具体文件，不删除或缩减已有业务覆盖。
- C：`tests/components/Setup.test.tsx`、`SettingsPage.test.tsx`，按可访问名称操作控件，验证 API 参数、外部回调和用户可见结果。
- D：云端 `tests/desktop/startup.test.cjs`、`terminal.test.cjs`、`restore.test.cjs`。
- M：本文后半部分的手动验收项。标为 M 的项目不宣称具有自动替代覆盖。

## 逐项盘点

| 原入口／子场景 | 原验证行为 | 去向与理由 |
|---|---|---|
| `default.test.cjs`、`support/project.cjs`：创建 | 初始空草稿；名称回填；无效／重复目录；数量不足／超额；取消后返回；打开已有项目 | U 名称与分配边界；C Setup 输入、目录选择、重复目录回调与创建条件；跨页面取消再进入保留草稿 → M1；真实创建贯通 → D terminal |
| `default`：输入与面板 | 原生字符、普通／应用光标模式箭头；选中面板、设置往返后的焦点 | D terminal 保留一次真实字符输入及渲染回显；`projects.test.ts`、`workbench.test.ts` 保留按 run 路由；光标模式和焦点往返 → M2 |
| `default`：布局交互 | 自定义布局、交换、分隔线提交／失焦取消、临时放大、恢复 | U 布局坐标和校验；`panels.test.ts` 保存与面板操作；D restore 验证非默认排列和比例；真实手势、临时放大 → M3 |
| `default`：运行与关闭 | 添加／关闭面板，零面板，退出期间残留子进程，输入丢弃，后台输出，最小化及重新挂载 | `panels.test.ts`、`projects.test.ts`、`lifecycle.test.ts`、`workbench.test.ts` 保留业务断言；D terminal 关闭后运行及子进程清理；可见滚动记录和最小化后的交互 → M2、M3 |
| `default`：退出及重开 | 取消原生退出对话框；关闭／退出清理；项目、设置、布局持久化；惰性启动与空项目；不恢复旧输出 | B workbench、projects、settings、panels；D restore 的配置恢复与全新运行身份；原生取消、旧终端画面清空 → M2、M7 |
| `setup.test.cjs`：字段 | untouched/blur 警告、输入更正、控制字符粘贴、目录检查状态、自动名称清洗、手写名保留、取消选择、等待中改名称 | U 名称清洗边界；C Setup 覆盖有效性、粘贴、最新手写名、取消与异步失败；字段颜色及空提示折叠间距 → M1 |
| `setup`：创建 | 特殊字符目录启动 cwd、重复目录提示和打开已有项目、导航 emoji 首字 | `project-management.test.ts`、`workbench.test.ts` 保留路径/业务验证；C Setup 验证打开已有项目参数；特殊路径真实 UI 和 emoji 呈现 → M1 |
| `settings-drafts.test.cjs` | 快捷键录入只改草稿；分类切换保留；只保存当前分类；校验失败；离开取消／不保存 | C SettingsPage 的草稿、分类提交、快捷键输入、失败留页与离开决策；B settings-drafts；实际快捷键路由 → M4 |
| `settings-commit.test.cjs` | 全分类提交，首个错误分类及字段，保存中屏蔽操作和重复请求，磁盘失败留草稿 | C SettingsPage 用 validation/storage/unavailable 返回覆盖处理及重复提交；`settings-commit.test.ts` 保留真实磁盘失败与原子提交，不在组件层重复制造磁盘故障 |
| `scenarios/settings-categories.cjs` | 各分类默认值／放弃／保存隔离，新保存基线，失败后重试，重进页面，运行不重启 | C SettingsPage 覆盖分类隔离、默认值与保存基线、失败重试；B settings、settings-drafts、settings-commit 保留持久化与运行身份；每分类视觉反馈和重进页面 → M4 |
| `scenarios/settings-leave.cjs` | 设置入口、快捷键、项目、添加项目等离开方式；全部草稿一次提交；校验／磁盘失败阻止导航；丢弃后离开 | C SettingsPage 在公开 `requestLeave()` 边界覆盖统一决策及整体提交；B settings-commit 保留真实磁盘原子性；各入口接线与焦点 → M4 |
| `scenarios/settings-conflicts.cjs` | 多组冲突、系统保留键、冲突文案与颜色、录入不会导航、默认值与放弃 | U shortcutConflicts／shortcutFromEvent／shortcutFormatError；B settings 与 settings-drafts；C SettingsPage 验证录入和校验失败处理；颜色及原生录入焦点 → M4 |
| `scenarios/settings-close.cjs` | 设置页屏蔽关闭快捷键；普通／放大面板关闭后的布局、进程和焦点 | `panels.test.ts` 保留关闭与清理；D terminal 保留关闭贯通；真实快捷键屏蔽、相邻面板焦点及放大退出 → M2、M4 |
| `scenarios/settings-feedback.cjs` | 命令检查必须显式触发；修改／丢弃草稿后旧检查不能覆盖新反馈；长反馈折行、焦点环与窄窗口 | C SettingsPage 的受控检查及过期反馈；真实命令可用性由现有业务环境检查负责；视觉和滚动 → M4 |
| `scenarios/settings-scroll.cjs` | 分类滚动时标题、导航、保存和返回位置稳定 | M4；纯视觉布局，不以 jsdom 假装验证 |
| `scenarios/settings.cjs` | 启动命令和参数保存、只影响后续运行；未保存快捷键不生效、冲突；主题重启生效；不可用命令不回退 | `settings.test.ts`、`workbench.test.ts`、`project-management.test.ts`；C SettingsPage 提交参数及草稿；实际主题和快捷键体验 → M2、M4 |
| `settings-migration.test.cjs` | 迁移冲突提醒、进入快捷键分类、恢复默认／放弃、失败不写、修正后重开不提醒，退出丢弃草稿 | `settings-drafts.test.ts` 保留迁移、冲突、文件不重写和再次启动；提醒、跳转与关闭对话框 → M4、M7 |
| `settings-migration-deferred.test.cjs` | 暂时关闭迁移提醒，本次不再显示；未修复时下次启动重现 | B settings-drafts 保留未修复迁移状态；提醒显隐生命周期 → M7 |
| `notices-startup.test.cjs` | 配置损坏错误提示、五秒消失、重试失败保留文件 | `workbench.test.ts` 保留损坏文件保护；C SettingsPage 覆盖不可保存反馈；计时与启动提醒 → M7 |
| `scenarios/notices.cjs` | 保存反馈进入共享队列、相同内容去重并重置计时、悬停暂停、成功/错误独立时长、多个提示堆叠、关闭不抢焦点 | C SettingsPage 验证成功/错误回调；提示队列计时和外观、真实焦点 → M7；删除机器计时桌面断言 |
| `navigation.test.cjs`：导航 | 折叠／展开、拖动宽度、释放前不保存、重开恢复；长列表固定底栏、草稿跨页保留 | `navigation.test.ts` 保留宽度边界及持久化；真实几何、页间草稿、列表滚动 → M1、M5 |
| `navigation`：设置与终端 | 设置入口／快捷键切换、设置与对话框抑制工作台快捷键、项目切换、返回终端输入 | B projects、settings 保留运行；D terminal 保留一条实际输入贯通；页面路由与复杂焦点 → M2、M4、M5 |
| `project-navigation.test.cjs` | 未确认的缩放／折叠覆盖、旧快照／旧确认不盖新预览、失败恢复并可重试、小窗口静止释放约束、更新项目名／标题 | `navigation.test.ts` 仅覆盖持久化和边界；异步预览及与真实几何耦合的交互转 M5，明确不再保留这套桌面自动化 |
| `project-management.test.cjs` | 菜单／右键编辑，改名、改目录重启／不重启／取消，真实路径去重，保存失败、删除、空工作台 | `project-management.test.ts` 保留完整业务和失败路径；菜单、单对话框说明、重启结果、取消与焦点 → M6 |
| `appearance.test.cjs` | 深色终端 ANSI、256 色、RGB 文字对比度，原色块与 dim 保留 | M2；颜色与可读性为手动外观验收 |
| `panels.test.cjs`：最小尺寸 | 普通／嵌套面板最小宽高、会话标题可读、窗口过小不会重写布局、单侧只可增长、两侧不足不可拖、增长后的反向限制、新面板不受阻 | B panels 保留配置/运行；U 保留布局计算；真实测量和手势约束 → M3 |
| `panels`：交换预览 | A→B→C、原面板几何与 PTY 尺寸冻结、标题更新、半透明完整画面、文本选择和后台输出、返回源／无效释放／Escape／失焦／减少动画取消 | M3；是可见预览、手势、焦点与实时终端组合，不扩大本地自动化。业务输入和运行身份仍由 B projects、panels、titles 覆盖 |
| `panels`：提交及重开 | 仅有效松手交换、保持选中和运行、最终尺寸、切项目取消、重开已提交布局 | B panels；D restore；真实松手和选择保持 → M3 |
| `panel-interactions.test.cjs` | 公共交互入口只提交最终落点，标题测量冻结／恢复、实时缩放、活动互斥、最新回调、销毁观察器 | 几何与鼠标依赖的交互整体转 M3；不宣称用 U layoutBoxes 替代这些控制器路径 |
| `panel-interactions`：取消矩阵 | 显式取消、Escape、blur、窗口/画布大小/位置、隐藏上下文/DOM、切项目、外部布局、放大、pointercancel、capture lost、销毁；迟到 pointerup 不提交 | M3 逐组手工检查；删除测试专用 fixture，生产交互入口保持不变 |
| `panel-location.test.cjs` | 同面板重新聚焦、立即聚焦/放大、激活确认与 DOM/终端就绪分离、旧快照/回调取消、隐藏/卸载、目标消失、失败和重试、手动选择打断 | M2、M5；这些真实挂载、动画与焦点竞态不留在本地检查，也不伪装为无布局 DOM 测试 |
| `titles.test.cjs`、`scenarios/title-filtering.cjs`：规则 | Claude/Codex/pi 已知格式、未知/歧义/空值、多空格/emoji、旋转状态符，原始 OSC 不修改 | U sessionTitle 样例；`titles.test.ts` 保留分片 OSC、原样输出、运行身份及重开重置；多个位置呈现一致、连续帧不闪烁 → M2、M5 |
| `titles`：导航体验 | 创建顺序、跨项目分屏/放大、减少动画提示、真实 100ms 动画、快速切换只聚焦最新目标、独立展开、长标题省略、增删/空面板 | B panels、projects 保留业务配置；动画、提示、排序及呈现 → M3、M5 |
| `scenarios/title-settings.cjs` | 定位面板前的设置离开守卫、失败留页、丢弃/成功保存后输入只到目标 | C SettingsPage 公开离开守卫；B settings-commit；实际导航接线与输入焦点 → M4、M5 |
| `scenarios/titles-reopen.cjs`、`titles` reopen | 已保存配置、原始标题清空、休眠项目启动新标题，最新标题用于通知和面板，输入到新实例 | B titles 的运行身份/标题；D restore 配置和新实例；多位置标题/通知与新运行聚焦 → M5 |
| `scenarios/load.cjs` | 4/10 运行的大量输出，切换/输入/拖动延迟，后台 xterm 光标报告，内存数值 | B projects、lifecycle 保留多项目/输出/进程行为；渲染压力体验 → M8。删除旧用例的机器相关耗时/内存日志，不设性能数字门槛 |
| `codex.test.cjs` | 本机真实 Codex 历史选择器 Cwd/All 箭头与焦点 | M2；真实 CLI 兼容性必须由用户显式手动验收，不进入任何自动门禁 |

## 手动验收

这些是用户主动运行应用时的验收清单，不是提交钩子的步骤。为避免使用个人项目，先以独立 `VIBEBRIDGE_DATA_DIR` 启动构建。自动排查失败不得在用户本机启动桌面测试。

- **M1 创建项目**：未触碰空字段不报错，失焦后错误在字段附近显示，更正后空白提示区域收起；浏览、取消、输入中等待不会丢失草稿；取消/打开已有项目/设置往返后草稿保留；特殊字符目录与 emoji 名称可读。
- **M2 终端与原生输入**：在明确选中的面板输入、复制粘贴、普通/应用光标模式箭头；切项目、设置往返、最小化/恢复、放大/还原后焦点与输入目标正确。深浅色下灰色文字、ANSI/RGB、dim 与图形色块可读。真实 CLI 历史选择器兼容性由用户选择测试，既不自动运行真实 CLI，也不把 CLI 会话恢复当作布局恢复。
- **M3 面板交互**：调整普通及嵌套分隔线；小窗口下单侧只能增长、两侧不足不拖动、到达最小值后可反向；预览保持运行和终端原尺寸，标题更新后仍稳定；A→B→C 只在有效最终落点交换。源位置/无效区域/Escape/失焦/窗口或画布改变/隐藏/切项目/放大/捕获丢失/卸载均取消，迟到松手不保存；放大与第二操作不抢当前拖动；重复取消/退出无残影；最终提交后重开保持布局。
- **M4 设置**：在各分类切换、默认值/放弃、更改参数、保存/失败重试；所有离开入口（返回、设置入口、快捷键、添加项目、项目/面板定位）尊重同一个离开决策；错误定位、冲突颜色、长反馈换行、焦点环、窄窗口和滚动后的保存/返回按钮可用；录入时不触发工作台动作；主题仅在重启后生效。
- **M5 导航与定位**：折叠/展开、调整宽度后重开；快速缩放后折叠、快速定位不同项目/面板，较旧响应不能覆盖最新预览/聚焦；保存失败后回到已知值且可重试；切页/卸载/目标关闭/请求失败可取消并重试；确认先到、目标终端后挂载时才聚焦；手动选择可打断旧定位；分屏/放大模式、展开状态、创建顺序、标题与提示一致，长标题不挤走操作按钮；减少动画设置生效。
- **M6 项目管理**：菜单和右键打开同一组操作，编辑不意外切项目；单个对话框正确描述原/新目录和重启结果；取消、重名/重复路径提示、删除确认及最后一个项目删除后的空工作台正确。
- **M7 提醒与退出**：启动配置损坏、未修复快捷键迁移提醒及重开后的提醒；提示队列去重、自动消失、悬停暂停、关闭不抢终端焦点；原生退出取消保留运行，确认退出清理进程，设置草稿不被意外保存。
- **M8 压力体验**：用可控 CLI 产生多面板输出，切项目、输入和拖动仍可操作，后台输出在返回后可见；记录明显卡顿供诊断，不规定秒级门槛。

## 云端约束与诊断

每个保留用例由运行器创建独立 `work/desktop-tests/<suite>-*` 数据目录；只有 restore 的首次运行与重开共享数据。用例可按名称独立执行，串行使用同一云端桌面。运行器默认全量只发现这三条流程；`--list` 不启动 Electron。

失败产物位于 `work/desktop-artifacts/<suite>-*/run/` 或 `reopen/`：`process.log`、可用时的 `failure.png`、`renderer.txt`、`snapshot.json`。启动失败未创建窗口时以日志为准。CI 上传失败产物保存七天。通过的诊断目录及隔离数据自动清理，无报告窗口、夜间工作流或强制框架迁移。
