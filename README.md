# batuhan-skills

Agent skills I use every day with Claude Code and other coding agents, packaged as a
[Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins).

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
   context once and forbids recursive delegation.
2. **Route.** `model-routing` sends each delegated task to the cheapest model that will get it
   right the first time, with escalation rules when a cheaper model fails.
3. **Build inside a quality pipeline.** `bug-hunt` (pipeline mode) turns the request into
   testable acceptance criteria, runs an implementation worker and a spec-only test worker in
   parallel, and checks every finished lane while the others keep running.
4. **Verify and stop.** Deterministic gates first, then targeted reviews, then a stop rule.
   Work is done when every acceptance criterion has a passing test and no finding is open.

## Skills

| Skill | What it does |
|---|---|
| [`orchestrator`](plugins/my-skills/skills/orchestrator/SKILL.md) | Minimises wall-clock time without losing correctness: role detection (coordinator vs. delegated worker), independent workstreams, a standard brief format, file ownership to avoid edit conflicts, single integration and verification, and a list of anti-patterns (agent spam, fake parallelism, duplicate repo scans). |
| [`model-routing`](plugins/my-skills/skills/model-routing/SKILL.md) | Chooses a model for every subagent: small model for mechanical, fully specified work; mid-tier for normal implementation, debugging and review; top-tier for ambiguous or high-stakes reasoning. Escalates on failure instead of defaulting everything to the largest model. |
| [`bug-hunt`](plugins/my-skills/skills/bug-hunt/SKILL.md) | Finds the most real bugs per token. **Pipeline mode** runs inside every code-writing task. **Round mode** hardens an existing codebase: findings ledger, deterministic gate (semgrep, bandit, pip-audit, branch coverage), risk map, one unit × one bug category per review pass, confirmation by failing test, bug-class elimination, mutation-based test pruning and a yield-based stop rule. |
| [`investigate-first`](plugins/my-skills/skills/investigate-first/SKILL.md) | Diagnoses unclear, intermittent or performance failures with evidence-ranked hypotheses before any code changes. |
| [`surgical-patch`](plugins/my-skills/skills/surgical-patch/SKILL.md) | Fixes a bug at the narrowest layer that owns the wrong behaviour, with regression proof and no drive-by refactoring. |
| [`lean-build`](plugins/my-skills/skills/lean-build/SKILL.md) | Builds new features with strict scope, maximum reuse of existing code and an explicit stop condition, to prevent overbuilding. |
| [`migration`](plugins/my-skills/skills/migration/SKILL.md) | Reversible, compatibility-safe transitions for schemas, data, APIs, configuration and dependencies, with rollback and preservation proof. |
| [`verify-and-stop`](plugins/my-skills/skills/verify-and-stop/SKILL.md) | Proves existing work meets its acceptance conditions without expanding scope. |
| [`omp`](plugins/my-skills/skills/omp/SKILL.md) | Delegates work from Claude Code to the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding agent, so two harnesses with different models can work on one task. |
| [`ikinci-beyin-yaz`](plugins/my-skills/skills/ikinci-beyin-yaz/SKILL.md) | Writes decisions and lessons from any session into my Obsidian "second brain", a source-linked memory that is loaded back into agent context in later sessions. (Turkish) |

Several skills also ship an `agents/openai.yaml` so the same instructions can be used by
OpenAI-compatible agent runners.

## Install

In Claude Code:

```
/plugin marketplace add batuhankiskac/batuhan-skills
/plugin install my-skills@batuhan-skills
```

Update with `/plugin marketplace update batuhan-skills`.

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

## Layout

```
.claude-plugin/marketplace.json      marketplace definition
plugins/my-skills/
  .claude-plugin/plugin.json         plugin manifest (bump "version" on every change)
  skills/<name>/SKILL.md             one skill per folder
  skills/<name>/references/          templates loaded on demand
  skills/<name>/agents/openai.yaml   optional config for other agent runners
```

To add a skill: create `plugins/my-skills/skills/<name>/SKILL.md`, bump `version` in
`plugin.json` and push.

## Status

These are personal working tools, tuned on my own projects and changed often. Thresholds such
as the bug-hunt stop rule are starting values that get adjusted after real runs.
