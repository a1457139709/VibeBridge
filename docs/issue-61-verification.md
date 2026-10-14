# Issue 61 实施验证

对应 [Issue 61](https://github.com/a1457139709/VibeBridge/issues/61) 及本轮用户确认的[后续决议](issue-61-decisions.md)。本轮产品代码已实现；真实 CLI 验收状态见文末，未改写 GitHub 原有勾选。

## 构建与范围

- 2026-10-14，macOS、本机 Node 26.8.1、Electron 44.5.1。
- 起点：`f904af496cd06f9eac6c95ae4952d0a234259c0c`，当前本地 `main`。
- 正式 `app/` 独立实现，未读取、复制或改编原型代码及软件设计。
- 类型色集中在 CSS：浅色 Codex `#348153`、Claude `#b66c37`、pi `#8356b3`；深色对应 `#71bb8c`、`#e2a173`、`#b499db`。图标、紧凑底色、面板选择轮廓和导航选择保持同类型关系。
- 紧凑面板采用居中横排、窄时上下排、低矮时单行。标题最多两行，超出省略，悬停全文沿用共享会话标题。
- 通用按钮、选中与焦点采用中性色；浅色基础表面白色／中性浅灰，深色主按钮浅底深字。未新增强调色设置；#56 其他外观控件未纳入。
- 补齐 Codex 0.162.1 已核实的十帧首尾过滤。标题来源、内部合法字符、未知格式回退、原始 OSC、运行实例及持久化规则未改变。

最终构建 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `dist/main.cjs` | `62df6f2dfeb66cf2b6f926be6df909060b6f4006b9262b0ddc88a157ec99a2ca` |
| `dist/renderer/assets/index-C6KZjOgB.css` | `662341af21d99f46c6a2c2cef9854981dcd880f5f46893e2376952d9acc63bd0` |
| `dist/renderer/assets/index-Cv8PU_Y2.js` | `59f4122714fc32c8544c7927d0fe91f18ede7712bad33daea35c636549c05ec7` |

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过。保留既有 Vite 大于 500 kB 块提示。 |
| 先前的十帧复现脚本 | 修改前 7/10 帧残留；修改后 10/10 均输出 `QA57-稳定标题`。 |
| `npm test -- tests/titles.test.ts` | 4/4 通过，含原始 OSC／输出、分片、旧实例隔离和重开。 |
| `npm test` | 最终完整套件 33/33 通过，零跳过，约 34.5 秒。 |
| `npm run test:desktop -- --panels` | 修改前基线、修改后浅色、修改后深色全部通过；均包含真实窗口失焦取消及退出重开，未设置跳过标记。 |
| `npm run test:desktop -- --titles` | 通过，含真实退出重开；已有样本在面板／导航／提示一致，596 个显示采样帧保持稳定。该套件的连续动画输入仍为原有三帧，新增七帧由上面的十帧脚本单独验证。 |
| `npm run test:desktop` | 通过：创建、4／10 运行实例负载、布局、交换、放大、原生输入、视图恢复、配置、退出及重开。 |
| `git diff --check` | 通过。 |

测试使用正式 Electron 页面、真实 PTY 与既有可控 CLI，未启动真实 Claude 或 Codex 对话。新增自动测试边界的确认未收到回复，因此未新增测试文件或修改既有用例；复用了访谈阶段的十帧脚本与项目现有回归。

Electron 偶有 Shared Dictionary 缓存告警、系统字体提示，已通过进程均正常退出。标题套件的配置写入失败和完整套件的启动失败日志来自既有故障用例，不是本轮未处理失败。

### 尺寸与连续性

相同 1280 × 860 窗口、字体、布局和 `Alpha billing workspace` 标题：

| 手动下限 | 修改前 | 修改后 |
| --- | --- | --- |
| 面板宽度 | 109 CSS px | 74 CSS px（减少约 32%） |
| 面板高度 | 33 CSS px | 34 CSS px |

这些是该标题和字体下的实测，不是固定产品阈值。横向下限按有界标题的两行空间与图标、间距、边框测量，长标题不会无限抬高下限。窄面板居中上下排，低矮面板横排；独立宽高和嵌套分隔线均保留辨认内容。

同类型面板往返选择时仅目标面板及导航选中，输入送至原运行实例；缩小／拉大保留原终端和输出。主窗口缩小时保留布局比例，不足下限时沿用只允许增长等约束。拖动交换期间真实终端几何和 PTY 尺寸保持，实时标题变化在手势结束后才更新紧凑排版。

## 截图

均为正式 Electron 构建截图，保存在本地 `outputs/issue-61/`，不纳入 Git；已实际查看关键截图。一次性连续截图帧已清理，保留静态证据和原确认原型。

- 宽度对比：[修改前](../outputs/issue-61/before/panels-manual-width.png)、[浅色修改后](../outputs/issue-61/light/panels-manual-width.png)、[深色修改后](../outputs/issue-61/dark/panels-manual-width.png)。
- 低矮横条：[浅色](../outputs/issue-61/light/panels-manual-height.png)、[深色](../outputs/issue-61/dark/panels-manual-height.png)。
- 往返选择：[Alpha](../outputs/issue-61/light/panels-selected-alpha.png)、[Bravo](../outputs/issue-61/light/panels-selected-bravo.png)；[恢复正常](../outputs/issue-61/light/panels-restored.png)。
- 类型色入口：[设置](../outputs/issue-61/light/icons-settings.png)、[添加 Agent](../outputs/issue-61/dark/icons-add-agent.png)、[创建分配与预览](../outputs/issue-61/light/icons-setup-preview.png)。
- 三类共享显示标题：[正常面板与导航](../outputs/issue-61/titles/three-filtered-titles.png)。

## Standards

独立审查：0 项明确规范违反，0 项需要处理的代码异味。

未见违反原型使用边界、领域术语规则或运行生命周期边界。`panelMetrics` 集中紧凑布局测量，`panelMinimumSize` 保留既有调用接口。类型色集中于 CSS，标题过滤继续由共享显示规则负责，无新增跨层状态所有权。

## Spec

独立审查：0 项明确代码偏差，0 项范围扩张；1 项真实验收缺口。

已确认的 B 排版、类型色及独立选择轮廓、中性控件、字体测量和 Codex 十帧有对应实现。Electron 窗口底色和项目对话框遮罩属于中性基础表面的同步。T10 仍需真实 Codex 两轮忙闲、原始 OSC 和录屏；代码回放不替代该要求。

审查汇总：Standards 0；Spec 0 个代码问题，1 个真实验收缺口（T10）。

## 保留的待验收项

- **T10 Codex**：真实 0.162.1 `/rename QA57-稳定标题` 后连续两轮对话，记录原标题和画面，确认面板、导航、切换提示稳定。本轮未执行，原不通过状态不得改为通过。
- **T09 Claude**：用户无账号，真实 CLI 未验证；不宣称已发现或已修复 Claude 故障。
- 自定义 Codex 标题布局、GNU Screen ASCII 回退及其他状态格式不由这次十帧修复覆盖。
- GitHub #61／#56 后续决定未同步，未关闭 Issue、未推送本地提交。用户原有 README、其他词汇表修改和文档删除不纳入本次提交。
