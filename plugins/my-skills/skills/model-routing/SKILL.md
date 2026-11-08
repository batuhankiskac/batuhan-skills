---
name: model-routing
description: >
  Use every time you are about to spawn a subagent (Agent tool, workflow
  agent, or any delegated worker). Picks the cheapest model that can do the
  delegated task reliably — haiku for mechanical, well-specified work; sonnet
  for standard implementation, debugging, testing and review; opus for
  ambiguous, high-stakes or deep-reasoning work — and sets the `model`
  parameter explicitly instead of defaulting every task to opus or to one
  fixed subagent. Includes escalation rules when a cheaper model fails.
---

# Model Routing

Goal:

> Every delegated task runs on the cheapest model that will get it right
> the first time.

Under-powering costs a retry (time + tokens). Over-powering costs money and
latency on every call. Route by the task, not by habit.

This skill governs **subagents only**. The main session's model is the
user's choice; never change it.

---

# 1. Always Set `model` Explicitly

When calling the Agent tool, pass `model` on every call, chosen from the
table below.

- Custom agent types (`.claude/agents/*.md`) carry a `model` in their
  frontmatter. The Agent tool's `model` parameter overrides it — so route
  even when using a fixed custom agent.
- `subagent_type: "fork"` always inherits the parent model; `model` is
  ignored. If a task should run cheaper, use a fresh agent with a good brief
  instead of a fork.
- Do not set `effort` unless the user or project instructions ask for it.

---

# 2. Routing Table

## haiku — mechanical, fully specified, low ambiguity

The answer is basically "go look / go do exactly this". Little judgement.

- locate files, symbols, call sites, configs ("where is X defined?")
- broad grep-style reconnaissance; listing what exists
- read one file/log and summarize or extract specific facts
- run a command / test suite and report the output
- apply a precisely described mechanical edit (rename, move, reformat,
  bump versions, fix lint on given lines)
- boilerplate that copies an existing pattern exactly
- data extraction / reformatting (JSON ↔ CSV, tables, lists)
- simple, fact-lookup web searches

Prefer the `Explore` agent type with `model: "haiku"` for pure search.

## sonnet — the default for real work

Requires understanding code and making reasonable decisions inside a clear
scope.

- implement a feature within an existing architecture/pattern
- fix a bug that has a clear reproduction or a known location
- write or extend tests
- refactor with clear boundaries (one module / file group)
- review a moderate diff for correctness
- moderate research: compare a few options, summarize docs, synthesize
  several sources
- write documentation, READMEs, migration notes
- frontend/UI work from a clear spec

**When unsure between haiku and sonnet → sonnet.**

## opus — ambiguity, depth, or high cost of error

- architecture / system design; choosing between approaches with
  trade-offs
- debugging with an unknown root cause spanning several subsystems
- concurrency, memory, security, auth, payments, data-migration, or other
  correctness-critical code
- large cross-cutting refactors or API redesigns
- vague or conflicting requirements that need interpretation
- final adversarial review / verification of critical changes
- deep multi-step research needing careful synthesis and judgement
- a task that already failed on sonnet

**When unsure between sonnet and opus → ask "what does a wrong answer
cost?"** If it's cheap to detect and fix → sonnet. If it's silent,
expensive, or hard to undo → opus.

---

# 3. Quick Scoring

If the table doesn't settle it, score the task 0–2 on each:

| Signal              | 0                  | 1                    | 2                          |
|---------------------|--------------------|----------------------|----------------------------|
| Ambiguity           | exact instructions | some decisions       | open-ended / unclear       |
| Reasoning depth     | lookup / copy      | normal coding logic  | multi-step, subtle         |
| Blast radius        | read-only / local  | one module           | cross-cutting / prod-facing|
| Cost of error       | obvious, cheap     | caught by tests      | silent or irreversible     |
| Context to juggle   | 1 file             | a few files          | many files / subsystems    |

- total 0–2 → **haiku**
- total 3–6 → **sonnet**
- total 7+ or any "2" in *cost of error* on non-trivial code → **opus**

---

# 4. Escalation

Start cheap only where failure is cheap and visible.

1. haiku result is incomplete, wrong, or says it is unsure →
   re-run that branch on **sonnet** with the same brief plus what was
   learned.
2. sonnet fails or produces a doubtful fix → re-run on **opus**.
3. Never escalate more than twice for the same branch; take it over in the
   root instead.

Do not "start cheap" for opus-category tasks to save money — a failed
attempt on a hard task usually costs more than doing it right once.

Never downgrade verification: the reviewer of a change should be at least
as strong as the model that wrote it when the code is correctness-critical.

---

# 5. Mixed Tasks: Split by Tier

One task often contains work of different tiers. Split it so each part runs
on the right model (see the `orchestrator` skill for decomposition rules):

    haiku  -> find all call sites of parseConfig and list them
    sonnet -> update call sites in src/cli/* to the new signature
    opus   -> design the new config schema + migration plan (critical path)

Then a final review on the tier the riskiest part needed.

---

# 6. Overrides

- The user names a model ("bunu haiku yapsın", "use opus for everything")
  → follow it; it beats this table.
- Project / CLAUDE.md rules about models beat this table.
- If a custom agent type is clearly built for one tier (e.g. a heavy
  architect agent), you may keep its frontmatter model — but still decide
  consciously, don't just inherit.

---

# 7. Reporting

When you delegate, mention the chosen models briefly to the user in one
line (e.g. "2× haiku for search, 1× sonnet for the fix"). No long
justification.
