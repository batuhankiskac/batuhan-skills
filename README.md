# batuhan-skills

Agent skills I use every day with Claude Code and OpenAI Codex, packaged as a
[Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins). The same
`SKILL.md` files also run in Codex.

A skill is a Markdown file (`SKILL.md`) with a short frontmatter description. The agent
reads only the descriptions up front and loads a skill's full body when a task matches it,
so the instructions cost context only when they are needed. These skills encode how I want
agents to work: split work into parallel lanes, pick the right model for each lane, prove
bugs before fixing them and stop when the work is verified.

## The idea

Letting a model write code is easy; getting reliable code out of it is the hard part. The
skills here treat an agent session as a loop that must end in evidence, not in a confident
summary:

1. **Plan and split.** `orchestrator` decomposes a task into independent workstreams, shares
   context once and keeps delegation one level deep.
2. **Route.** `model-routing` sends each delegated task to the cheapest model that will get it
   right the first time, with escalation rules when a cheaper model fails.
3. **Check by risk.** Ordinary code changes get a light check (gate, tests for the changed
   behaviour, one review pass). High-risk work (money, auth, data, concurrency, several large
   lanes) runs `bug-hunt` pipeline mode: testable acceptance criteria, an implementation worker
   and a spec-only test worker in parallel, and every finished lane checked while the others
   keep running.
4. **Verify and stop.** Deterministic gates first, then targeted reviews, then a stop rule.
   Work is done when every acceptance criterion has a passing test and no finding is open.

## Skills

| Skill | What it does |
|---|---|
| [`orchestrator`](plugins/my-skills/skills/orchestrator/SKILL.md) | Picks a goal (speed, limit saving with an expensive root and cheap workers, or team mode), splits work by file ownership, keeps delegated workers from re-delegating, and scales verification to risk: a light check by default, the bug-hunt pipeline for high-risk code. Written as intent and rationale rather than rules, for capable models. |
| [`team-mode`](plugins/my-skills/skills/team-mode/SKILL.md) | On explicit request, runs a large task like an automated software team through the saved [`team` workflow](workflows/team.js): scout, three blind proposals, judge, planner with file-disjoint lanes, implementer plus blind tester per lane, pipelined review/fix, integration, an adversarial final review and a scope check. Lanes run only their own tests while others edit; a missing agent result never counts as a pass, and the run returns `ok` plus a list of open problems. Claude-only; a design step ends at one user checkpoint before code is written. With `repo` it works on a checkout other than the session's working directory (a separate worktree when a scheduler runs the live one), and `guard` gives every agent the run's hard limits. |
| [`model-routing`](plugins/my-skills/skills/model-routing/SKILL.md) | Chooses a model for every subagent: small model for mechanical, fully specified work; mid-tier for normal implementation, debugging and review; top-tier for ambiguous or high-stakes reasoning. Escalates on failure instead of defaulting everything to the largest model. |
| [`bug-hunt`](plugins/my-skills/skills/bug-hunt/SKILL.md) | Finds the most real bugs per token. **Pipeline mode** runs inside high-risk code tasks. **Round mode** hardens an existing codebase: findings ledger, deterministic gate (semgrep, bandit, pip-audit, branch coverage), risk map, one unit × one bug category per review pass, confirmation by failing test, bug-class elimination, mutation-based test pruning and a yield-based stop rule. |
| [`omp`](plugins/my-skills/skills/omp/SKILL.md) | Delegates work from Claude Code to the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding agent, so two harnesses with different models can work on one task. |
| [`agy`](plugins/my-skills/skills/agy/SKILL.md) | Delegates work from Claude Code to the Antigravity CLI (`agy`) coding agent, with permission modes, resumable conversations and a table of known errors. (Turkish) |
| [`ikinci-beyin-yaz`](plugins/my-skills/skills/ikinci-beyin-yaz/SKILL.md) | Writes decisions and lessons from any session into my Obsidian "second brain", a source-linked memory that is loaded back into agent context in later sessions. (Turkish) |

Most skills also ship an `agents/openai.yaml` with the display name, short description and
default prompt Codex shows for the skill, so one skill body serves both agents.

## Install

In Claude Code:

```
/plugin marketplace add batuhankiskac/batuhan-skills
/plugin install my-skills@batuhan-skills
```

Update with `/plugin marketplace update batuhan-skills`.

`team-mode` also needs the saved workflow, which plugins cannot ship. Link it once:

```
mkdir -p ~/.claude/workflows
ln -sf ~/.claude/plugins/marketplaces/batuhan-skills/workflows/team.js ~/.claude/workflows/team.js
```

To load the skills automatically in a project (including cloud sessions), add this to the
project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "batuhan-skills": {
      "source": { "source": "github", "repo": "batuhankiskac/batuhan-skills" }
    }
  },
  "enabledPlugins": {
    "my-skills@batuhan-skills": true
  }
}
```

### Codex

Codex reads skills from `~/.agents/skills/`. Copy or symlink the skill folders there:

```bash
git clone https://github.com/batuhankiskac/batuhan-skills
ln -s "$PWD"/batuhan-skills/plugins/my-skills/skills/* ~/.agents/skills/
```

Then call a skill by name in Codex, for example `$bug-hunt`.

## Layout

```
.claude-plugin/marketplace.json      marketplace definition
plugins/my-skills/
  .claude-plugin/plugin.json         plugin manifest (bump "version" on every change)
  skills/<name>/SKILL.md             one skill per folder
  skills/<name>/references/          templates loaded on demand
  skills/<name>/agents/openai.yaml   Codex metadata (display name, default prompt)
workflows/team.js                    saved workflow behind team-mode (linked into ~/.claude/workflows)
tests/team.test.mjs                  scenario tests for the workflow, run with fake agents
```

To add a skill: create `plugins/my-skills/skills/<name>/SKILL.md`, bump `version` in
`plugin.json` and push.

After changing `workflows/team.js`, run `node tests/team.test.mjs`. The tests replace the
runtime's agents with scripted answers, so they cover the script's control flow and the exact
prompt text, not how a model reacts to it.

## Status

These are personal working tools, tuned on my own projects and changed often. Thresholds such
as the bug-hunt stop rule are starting values that get adjusted after real runs.
