# #45 观察版代码审查

审查基线：`f324d6aeb9dd82d05fb13b26aac467e8870a885b`。审查提交：`37bf85508798f7565f8127a2ef8d2ceaf7177d4e`。

两个独立 agent 分别审查规范和规格，使用 `git diff f324d6aeb9dd82d05fb13b26aac467e8870a885b...37bf85508798f7565f8127a2ef8d2ceaf7177d4e`。范围为 #46–#50 的观察版；#51 过滤及明确保留的人工验收不计为缺失实现。

## Standards

Documented standards: **0 violations found**. The reviewed changes preserve the README’s main-process business boundary, terminal-host ownership, worker-based storage, and renderer terminal ownership.

Judgment call: **possible Duplicated Code** in `app/renderer/index.tsx:139` and `app/renderer/panel-drag.ts:63`, alongside the existing divider lifecycle in `app/renderer/Workspace.tsx:122`. Each independently implements pointer capture, move/up/cancel listeners, cleanup, capture release, and commit-versus-cancel handling:

> `removeEventListener('pointermove', move)`
>
> `removeEventListener('lostpointercapture', cancel)`
>
> `if (...hasPointerCapture(event.pointerId)) ...releasePointerCapture(event.pointerId)`

The new gesture implementations increase the places that must change together when fixing capture or cancellation behavior. Consider extracting the shared pointer-listener lifecycle while leaving navigation, divider, and swap calculations in their respective modules. This is a maintainability suggestion, not a documented-standard violation or demonstrated functional defect.

## Spec

**P2 — Switching notice reads an outdated title** — `app/renderer/index.tsx:122`. #49 requires: “一个共享显示规则供面板、导航与切换提示使用” and “显示「已切换至：<共享显示标题>」成功提示”. With reduced motion enabled, locating a dormant project from a maximized panel awaits its startup before reporting success, but reads `state.runs` captured before activation. If the new CLI emits an OSC title during startup, the panel and navigation display that title while the notice incorrectly says `Untitled task`. Read the current target run when creating the notice; add coverage for first activation with an immediate startup title. Existing coverage assigns the title before navigation, so misses this case.

No additional confirmed missing requirements or scope creep; intentional observation-stage filtering and pending human acceptance are excluded.

修复与复验由单个实现 agent 完成，记录在 [审查修复记录](spec-45-review-fixes.md)。极小面板导航输入焦点的额外假设也交由同一 agent 先复现，再据结果处理。

审查原始结果：Standards 1 项判断性建议、0 项硬性违规，最主要为指针事件清理重复；Spec 1 项 P2，最主要为首次启动目标项目时提示读取旧标题。
