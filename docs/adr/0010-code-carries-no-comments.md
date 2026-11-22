# 代码里不写注释，决策记在 ADR 和 docs 里

源代码（`app/`、`scripts/`、`tests/` 以及仓库根目录下的 `.ts`、`.tsx`、`.js`、`.mjs`、`.cjs`、`.css`）不写注释。代码做什么由名字和结构表达（见 `CODING_STANDARDS.md` 的 Names 一节）；为什么这样做，凡是从代码里看不出来、又会约束以后改动的，写进 `docs/adr/` 或 `docs/` 下对应的集成文档。

一条注释只会是下面四种之一，各有去处：

- **复述**：重复代码里已经看得到的东西。删掉。
- **过时**：说的是已经不存在的代码或实现。删掉。
- **借口**：为一个凑合的实现开脱，让它被照抄下去。删掉，并开一个 issue 去修那个实现。
- **决策记录**：记下一个重要、看代码看不出来的决定。挪进 ADR 或 `docs/`，再删掉。

工具指令不是写给人看的注释，可以保留：`@ts-expect-error`、`oxlint-disable…`、`prettier-ignore`。

## 检查与棘轮

`npm run check:comments`（`scripts/check-comments.mjs`）用 TypeScript 的语法树找出每个源文件里的注释，与 `scripts/comment-baseline.json` 比较：

- 基线里没有的文件不许有注释；基线里的文件，注释数不许超过基线。
- 某个文件的注释比基线少时，检查也失败，要求运行 `npm run check:comments -- --update` 把基线降下来。`--update` 只会降低或删除基线，不会抬高。

所以基线只会变小。一次改动删不完的注释留在基线里，等以后用 `/delete-comment` 继续清理。

## Considered Options

- **用 oxlint 的规则**：oxlint 没有禁止注释的规则；它的 JS 插件还是实验功能，也不支持按文件计数的基线。仓库已有的 `check:source-shape`、`check:test-waits` 都是用 TypeScript 语法树写的检查脚本，这里沿用同一种做法。
- **只禁止新增的 `//` 注释，保留 JSDoc**：JSDoc 正是这个仓库里绝大多数复述的来源，保留它等于保留问题。
- **一次删完，不要基线**：决策记录要逐条读、逐条挪进 ADR，一次改动未必做得完；基线让剩下的注释不再增加，又不挡住这次合并。

## Consequences

- `CODING_STANDARDS.md` 不再说「代码注释说明当前设计和理由」；理由只在 ADR、`docs/` 和 README 里。
- 读代码的人要找「为什么」时去看 ADR 和 `docs/`。ADR 按主题写，每条决定写明它约束哪个文件。
- 原来靠注释解释的名字，如果单看调用处说不清它做什么，就该改名，而不是补注释。
