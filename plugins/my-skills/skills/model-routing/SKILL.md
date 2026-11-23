---
name: model-routing
description: >
  Use whenever you are about to spawn a subagent (Agent tool, workflow agent
  or any delegated worker) to choose its model: haiku for mechanical,
  well-specified work; sonnet for standard implementation, debugging, testing
  and review; opus for ambiguous, high-stakes or deep-reasoning work. Includes
  escalation when a cheaper model fails.
---

# Model routing

Run each delegated task on the cheapest model that will get it right the
first time. Under-powering costs a retry; over-powering costs money and
latency on every call. This applies to subagents only; the main session's
model is the user's choice.

## Tiers

**haiku**: the answer is "go look" or "do exactly this". Locating files and
call sites, broad search, summarising one file or log, running a command and
reporting, precisely described mechanical edits, copying an existing pattern,
reformatting data, simple fact lookups.

**sonnet** (the usual default): understanding code and deciding within a
clear scope. Features inside an existing architecture, bugs with a clear
reproduction, tests, bounded refactors, reviewing a moderate diff, moderate
research and documentation, UI from a clear spec.

**opus**: ambiguity, depth or a high cost of error. Architecture and
trade-off decisions, root causes spanning subsystems, concurrency, security,
auth, payments, data migrations, large cross-cutting refactors, vague
requirements, final adversarial review of critical changes, deep synthesis,
and anything that already failed on sonnet.

Between two tiers, ask what a wrong answer costs: cheap to notice and fix
means the lower tier; silent, expensive or hard to undo means the higher one.

## Mechanics

- Set `model` deliberately rather than inheriting by habit. It overrides a
  custom agent type's frontmatter model.
- A `fork` always inherits the parent model; if the work should run cheaper,
  use a fresh agent with a good brief.
- Leave `effort` alone unless the user or project instructions ask for it.
- A task with mixed parts can be split by tier (haiku finds call sites,
  sonnet updates them, opus designs the schema change).

## Escalation

If a cheaper model's result is incomplete, wrong or unsure, rerun that branch
one tier up with the same brief plus what was learned; after two escalations,
take it over in the root. Do not start opus-category work cheap to save
money, and keep the reviewer of correctness-critical code at least as strong
as the model that wrote it.

## Overrides

A model the user names, or project rules about models, take precedence over
this skill. When delegating, mention the chosen models in one line (for
example "2x haiku for search, 1x sonnet for the fix").
