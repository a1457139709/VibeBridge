# #45 原始标题观察版交付

代码集成于 `implement/spec-45`，基线 `f324d6a`，最终产品代码合并提交 `5a575b7da9c5fd66c8698ad75360a44c6a38264f`。实现、合并、独立 Standards／Spec 审查以及审查修复均由实际 sub-agent 执行；主 agent 负责集成核查、打包、交付与问题记录。

本轮完成 #46–#50 的产品代码，保留规格明确要求的人工验收。#51 尚未开始：#49 要求用户明确确认真实 Claude Code、Codex CLI、pi 的标题观察结果，不能用自动测试或 agent 推断代替。

## 本机交付

目录：`/Users/red/Project/VibeBridge/outputs/spec-45-observation/`。

- `启动观察版.command`：启动同目录 `VibeBridge.app`，工作台数据独立存放在 `data/`。
- `验收指南.md`：[真实 CLI 与动效验收步骤](spec-45-human-acceptance.md)的交付副本。
- `VibeBridge.app`：由上述代码提交运行 `npm run package` 生成，已执行本地 ad-hoc 签名和 `codesign --verify --deep --strict`。
- `README.md`：交付版本、限制与使用入口。

打包入口 `Contents/Resources/app/dist/main.cjs` 的 SHA-256：`04333c537b915f6224307230a08e913dca327fd2fae15b0532a6ff43d5c9075b`。

截图归档位于同级 `outputs/spec-45-evidence/`。它们与应用是本机交付物，不进入 Git 仓库。

## 验证结果（2026-10-13）

| 检查 | 结果与范围 |
| --- | --- |
| 最终合并后的 `npm run build` | 通过；已有 Vite 大 chunk 提示仍在 |
| 最终合并后的 `npm test` | 33/33 通过 |
| 修复分支 `npm run test:desktop -- --navigation` | 通过，含真实重开 |
| 修复分支 `npm run test:desktop -- --titles` | 通过，含真实重开及新启动 OSC 通知回归 |
| `npm run package` 与签名校验 | 通过 |
| `VIBEBRIDGE_TEST_APP=/Users/red/Project/VibeBridge/outputs/spec-45-observation/VibeBridge.app npm run test:desktop -- --packaged --titles` | 通过；从最终 bundle 加载产品代码与原生模块，验证标题／导航／设置保护、实际输入、布局与真实退出重开 |
| `zsh -n 启动观察版.command` | 通过 |
| 最终修复后的完整 `--panels` | **未完成**：前段边界、极小面板输入、预览、Escape 等已通过；原生窗口焦点前置条件被 macOS 锁屏阻挡，失焦取消及之后的提交／重开步骤待补 |
| 交付启动脚本直接打开应用并目视确认 | **待解锁后验证**；打包桌面测试不替代这一检查 |

桌面测试使用本机真实 Electron、受控 CLI 和隔离工作台数据，不是 CI GUI 覆盖。预期写入失败测试产生的 `EISDIR` 日志和 Electron 临时 Shared Dictionary 警告没有导致最终命令失败。CI 状态以集成分支最新 GitHub Actions 记录为准。

锁屏诊断只读取系统状态：`CGSSessionScreenIsLocked=Yes`。没有绕过锁屏，也没有降低原生失焦断言。解锁后应重跑完整 `npm run test:desktop -- --panels`，随后验证交付启动入口。

## 问题状态

- #46：已完成；#47：实现与自动验证已完成，可关闭。
- #48：代码与服务／桌面验证完成；真实 CLI 改目录重启及手动恢复历史待用户验收。
- #49：原始标题观察版完成；真实 CLI 标题记录、明确确认和切换动效体验待用户验收，因此保持开放。
- #50：代码完成；上述原生失焦复验和减弱动态效果的人工体验待完成，因此保持开放。
- #51：等待 #49 的明确确认后才开始；#45 保持开放。

各功能详情见 [#46](issue-46-verification.md)、[#47](issue-47-verification.md)、[#48](issue-48-verification.md)、[#49](issue-49-verification.md)、[#50](issue-50-verification.md)；审查结论见 [独立审查](spec-45-review.md)和[修复记录](spec-45-review-fixes.md)。
