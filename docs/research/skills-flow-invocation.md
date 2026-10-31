# Skills flows and how each Agent CLI invokes a skill

Research for issue #141, part of map #136. Sources were read on 2026-10-31. Pinned commits:

- `mattpocock/skills` at `a496f5513d`. This is the same text as the copies in `~/.claude/skills` and `~/.agents/skills`; `to-tickets/SKILL.md` diffs clean against upstream.
- `cursor/plugins` at `4dd1d05818` (the `pstack/` folder).
- `openai/codex` at `67f0994b53`.
- `badlogic/pi-mono` at `9b7a44c48d`.

This note records facts only. It makes no product decision.

## 1. Matt Pocock's skills

Upstream repo: <https://github.com/mattpocock/skills>. Its README says "Skills For Real Engineers", and it ships one plugin for each harness:

- Claude Code: `claude plugin install mattpocock-skills@claude-plugins-official`
- Codex: `codex plugin marketplace add mattpocock/skills`
- Any other agent, pi included: `npx skills@latest add mattpocock/skills -a <agent>`

The engineering skills live under `skills/engineering/` and the general ones under `skills/productivity/`.

How the skills are used is documented in `ask-matt/SKILL.md` (the router). The main flow runs from idea to ship. Unless a row says otherwise, every skill in the table sets `disable-model-invocation: true`, which means only the user can start it.

| Order | Skill | Argument it expects | Preconditions and notes |
| --- | --- | --- | --- |
| 0 | `/setup-matt-pocock-skills` | none | Run once per repo. It writes the issue tracker, triage labels and domain doc layout into `docs/agents/`. `to-spec`, `to-tickets`, `implement-spec`, `triage` and `wayfinder` each tell the agent to stop and point the user here if this config is missing. |
| 1 | `/grill-with-docs` | free text (the idea), or nothing | Needs a working directory. It runs `grilling` and `domain-modeling` together and updates `GLOSSARY.md` and ADRs as it goes. `grilling` itself is model-invocable. |
| 1a (optional) | `/handoff`, then `/prototype`, then `/handoff` back | `handoff` declares `argument-hint: "What will the next session be used for?"` | A detour for questions that need runnable code to answer. |
| 2 | `/to-spec` | none | It synthesises a spec from the **current conversation** without interviewing the user, publishes it as an issue and labels it `ready-for-agent`. The router says to keep steps 1 to 3 in one unbroken context window. |
| 3 | `/to-tickets` | optional: "a spec path, an issue number or URL" | With no reference it works from the conversation context. It quizzes the user on the breakdown, then publishes tickets with native blocking edges (sub-issues when the source was an issue). It never closes or modifies the parent issue. |
| 4a | `/implement` | optional: a ticket reference | "If the user passes a ticket reference, fetch it ... If the reference is ambiguous, ask." Run it once per ticket and `/clear` between tickets. It runs `tdd` and then `code-review`, and commits to the current branch. |
| 4b | `/implement-spec` | a spec that already has tickets (passed as a reference or already in context) | It treats the tickets as a task graph and runs parallel implementer subagents in worktrees, which merge into one integration branch. It ends with one `code-review`. |
| 5 | `/retro` | none | Run it in the same session it reviews, before clearing. |

On-ramps into the flow:

- **`/triage`** takes free text. Its SKILL.md says "The maintainer invokes `/triage` and describes what they want in natural language", for example "Let's look at #42" or "Move #42 to ready-for-agent". It is only for issues you did not create; tickets from `/to-tickets` are already agent-ready.
- **`/wayfinder`** takes either a loose idea (chart mode) or "a map (URL or number). A ticket is optional" (work mode). It resolves one ticket per session, except research tickets. When the map clears it hands off to `/to-spec`.
- **`/diagnosing-bugs`** is model-invocable.

Codex: each upstream skill ships `agents/openai.yaml`. For example, `to-spec` has `policy: allow_implicit_invocation: false`. That is the Codex counterpart of `disable-model-invocation`, so in Codex these skills also run only when the user names them explicitly.

## 2. "poteto" skills

poteto is the GitHub handle of Lauren Tan (React Compiler core team, <https://github.com/poteto>). She has published three skill collections:

| Collection | Where it lives | Status |
| --- | --- | --- |
| **pstack** | <https://github.com/cursor/plugins/tree/main/pstack> (`plugin.json`: `"name": "pstack"`, `"version": "0.15.36"`, author Lauren Tan) | Current, under active development (commits dated 2026-10-27). The README opens "i'm poteto ... **pstack is my answer.**" |
| noodle | <https://github.com/poteto/noodle> | "Skill-based agent orchestration. Built in Go." Its `.agents/skills` include `plan`, `execute`, `review`, `quality`, `schedule`, `todo`, `reflect` and others. Last push 2026-03. |
| brainmaxxing | <https://github.com/poteto/brainmaxxing> | Memory plus six skills: `reflect`, `ruminate`, `meditate`, `plan`, `review` and `brain`. Last push 2026-02. |

**How sure is this identification?** I read "poteto's skills" as **pstack**, because it is the collection she currently presents as "the same skills i use every day". But nothing in #136 or #141 names the repo, so this is my best inference, not a confirmed fact. If the user meant noodle or brainmaxxing, section 2 needs to be redone.

### pstack: its flow and arguments (from `pstack/README.md` and `skills/poteto-mode/SKILL.md`)

- **Getting started takes two steps:**
  1. `/setup-pstack` picks models and a reasoning budget. In Claude Code it writes `~/.claude/rules/pstack-models.md`.
  2. `/poteto-mode <free-text task>` "whenever you're doing anything that requires rigor".
- `poteto-mode` sets `disable-model-invocation: true`. It matches the request to one of 23 **playbooks** and opens a todo list whose first items are that playbook's steps. It then routes to the other skills itself.
  - The playbooks include investigation, bug fix, perf, feature, refactoring, prototype, babysit, shipping, autonomous run, orchestrate, multi-phase plan, session pickup and opening a PR.
  - The feature playbook, for example, runs: `how` → `architect` → throughput checkpoint → delegate the implementation (or `arena`) → verify → small ordered commits → `interrogate` if the design is contested → open a PR.
- **No skill takes a structured argument.** Every documented call is the skill name followed by plain language, for example:
  - `/poteto-mode check on pr 123. anything outstanding?`
  - `/how do we cancel runs?`
  - `/interrogate review this pr.`
  - `/tdd implement`
  - `/correct` and `/automate-me`, which take no text at all.

  An issue or PR number, when one is needed, goes inside that free text.
- **pstack has no issue-to-spec-to-tickets pipeline.** The README says: "why are there no planning skills? ... i don't believe in planning. the best spec is code."
  - So instead of an ordered chain of skills it has **one entry point** (`/poteto-mode`, with `/poteto-help` for routing questions) that picks a playbook internally.
  - Other skills are situational and can be called directly: `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `tdd`, `reflect`, `unslop` and so on.
- **What each harness supports:**
  - pstack targets Cursor. In Cursor, option/alt+enter turns `poteto-mode` into a persistent custom mode.
  - Claude Code: install it as a plugin (`/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`). Commands get a prefix: "`/poteto-mode` is `/pstack:poteto-mode`". Cursor-only steps are skipped, per `pstack/docs/harness/claude-code.md`.
  - Codex and pi: no first-party adapter exists (`docs/harness/` contains only `claude-code.md`). Ports exist (`bnema/pi-pstack`, `potetos-for-everyone`), but they are community-made and I did not verify them.

## 3. How each CLI invokes a skill

| CLI | Explicit invocation | Arguments | Implicit (model-chosen) | User-only flag |
| --- | --- | --- | --- | --- |
| **Claude Code** | `/skill-name` in the prompt. Plugin skills are `/plugin-name:skill-name`. Custom commands are now the same thing as skills. | Everything after the name becomes `$ARGUMENTS` (also `$0`, `$1`, ... and named `arguments`, split with shell-style quoting). If the skill body has no placeholder, Claude Code appends `ARGUMENTS: <value>`. `argument-hint` is only an autocomplete hint. | Yes, by description, unless disabled | `disable-model-invocation: true` |
| **Codex CLI** | Type `$skill-name` in the message, or pick one from `/skills` | Not a documented argument mechanism. The rest of the message is ordinary prompt text that the model reads alongside the injected skill. The docs' example is `$skill-installer linear`. | Yes, unless disabled | `agents/openai.yaml` → `policy.allow_implicit_invocation: false` |
| **pi** | `/skill:name` | "Arguments after `/skill:name` are appended to the loaded instructions as a user request", e.g. `/skill:pdf-tools extract report.pdf` | Yes. The system prompt lists each skill's name, description and path, and the model reads `SKILL.md` when it chooses to. | `disable-model-invocation: true` |

Sources for the table:

- Claude Code: <https://code.claude.com/docs/en/skills>. See the sections "Pass arguments to skills", "Control who invokes a skill" and the frontmatter reference.
- Codex: <https://learn.chatgpt.com/docs/build-skills>, which `developers.openai.com/codex/skills` now redirects to.
- pi: `packages/coding-agent/docs/skills.md` in pi-mono.

### Does text typed into the terminal trigger a skill, arguments included?

- **Claude Code: yes, from the interactive prompt.**
  - The docs describe typing at the terminal prompt, including stacking skills: `/write-tests /fix-issue 123` loads both skills and passes `123` as `$ARGUMENTS` to each.
  - In `claude -p` and the Agent SDK, "Claude Code loads only the first skill, with the rest of the line as its arguments."
  - The slash must be the first thing in the message.
  - Skills marked `disable-model-invocation` (all of Matt's flow skills, and `poteto-mode`) **only** start this way, or through a scheduled or loop prompt. The model cannot start them from a natural-language request.
- **Codex CLI: yes.**
  - `collect_explicit_skill_mentions` in `codex-rs/skills/src/selection.rs` scans every `UserInput::Text` for `$skill-name` tokens, besides structured `UserInput::Skill` selections from the `$` picker.
  - So a typed or pasted `$to-tickets 136` selects the skill without going through the popup.
  - A plain name only matches when it is unambiguous (names are counted and checked for collisions).
- **pi: yes.** `/skill:name args` typed by hand works. The docs say: "manually entered `/skill:name` commands still work" even when `enableSkillCommands` hides them from command discovery.
- **Not verified here:** whether a burst of PTY input ending in `\r` is accepted by each TUI exactly like typed keys, given autocomplete popups that open on `/` or `$`, and bracketed paste. That needs an empirical check before a Workbench relies on it.

### Where the installed copies are discovered

- `~/.claude/skills/<name>/SKILL.md`: Claude Code, user scope.
- `~/.agents/skills/` and `.agents/skills/`: both Codex (user and repo scope; repo scope is scanned up to the repo root) and pi.

The user has Matt's skills in both places, so all three CLIs can find them.

## What a Workbench sending a preset instruction would need (not a decision)

- **A syntax table per Agent Type.** One flow step renders differently in each CLI:
  - Claude Code: `/to-tickets 136` (or `/mattpocock-skills:to-tickets 136` if installed as a plugin)
  - Codex: `$to-tickets 136`
  - pi: `/skill:to-tickets 136`
  - pstack under Claude Code: `/pstack:poteto-mode <text>`
- **One argument shape covers every step.** All of these steps take "the skill token followed by free text", and an issue number or URL fits in that text:
  - Matt: `to-tickets`, `implement`, `wayfinder`, `triage`
  - pstack: every skill
- **Some steps take no target at all.** `to-spec` and `grill-with-docs` work from the conversation, not from a reference. So "send issue N to step X" means nothing for them, and `to-spec` depends on the same session having already done the grilling.
- **The Workbench would need to know preconditions it cannot see:**
  - `setup-matt-pocock-skills` has been run.
  - `to-spec` runs in the same context window as the grilling.
  - `implement` runs in a fresh context per ticket.
  - `wayfinder` resolves one ticket per session.
  - `implement-spec` needs a spec whose tickets already exist.
- **The flows have different shapes.** Matt's is a multi-step chain whose artifacts live in the tracker. pstack is one entry point plus situational tools. A flow abstraction that must cover both cannot assume an ordered pipeline.
