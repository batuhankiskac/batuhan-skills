---
name: orchestrator
description: >
  Use for non-trivial coding, debugging, refactoring, investigation or research
  tasks where independent work can run in parallel, and whenever the user asks
  to save limits by delegating to cheaper models (expensive root, haiku/sonnet
  workers), even on small tasks. Covers when to delegate, how to split work,
  and how much verification a code change needs.
---

# Orchestrator

The point of delegation is a shorter reliable path to a verified result, or
fewer tokens on the expensive model. More agents is never the goal: each one
adds startup cost, context cost and merge risk.

## Pick the goal first

| Goal | When | Shape |
|---|---|---|
| **Speed** (default) | two or more substantial, independent workstreams | parallel workers |
| **Limit saving** | the user asks ("ucuz modda", "limit gitmesin", "başta opus altta haiku"), or the root runs on an expensive model and the task has mechanical parts | delegate even small pieces |
| **Team mode** | the user asks ("takım modunda", "ekip gibi") on a large, open-ended task | use the `team-mode` skill instead of this one |

In team mode the team workflow already reviews per lane and at the end; do
not add this skill's quality levels or a bug-hunt pipeline on top.

**Limit saving.** The root decides, writes briefs and verifies; reading,
searching, running commands and mechanical edits go to haiku, ordinary
implementation to sonnet. Cheap models fail on ambiguity, so briefs name the
exact files, change and return format, and returns are short (paths, lines,
diff summary) rather than file dumps. Skip delegation when writing the brief
costs more than doing the work.

**Speed.** Work directly when there is one critical path (a known bug, a
single-file change, a question). Delegate when separate branches can come off
the critical path: independent modules, competing root-cause hypotheses,
implementation vs. tests, separate research questions.

## If you are a delegated worker

Do the assigned work directly, stay in scope, and return concise results. Do
not spawn further agents unless the parent asked for it. This keeps the tree
one level deep.

## Splitting work

- Split by ownership (directory, module, question, test surface). Two workers
  never edit the same file; when investigations may converge on one file,
  parallelise the analysis and let one agent edit.
- If ownership or root cause is unclear, run a short read-only scouting wave
  before any parallel edits.
- Explore broadly once and share what was learned; workers should not each
  rescan the repository.
- Give each worker only what it needs to start: goal, scope, constraints,
  useful paths, what "done" means and what to return. Ask for
  integration-ready output, not narratives.
- Launch independent workers together, keep the root busy with its own
  critical-path work, and rely on completion notifications instead of polling.
- Pick each worker's model with `model-routing`.
- When one worker fails, keep the successful results and retry or take over
  only the failed branch.

External coding agents (`omp`, `agy`) exist on this machine as optional
support the user adds when Claude limits run low. Use them only when the user
asks for them in the current request; never probe whether they are available.

## Verification

Workers run only the checks relevant to their piece; the root integrates,
inspects the diff and verifies once. Code changes are verified before they
are reported; testing and review are not handed back to the user. The amount
of process scales with risk:

**Light level (default)** for ordinary features, fixes and refactors: the
project's existing type check / lint on touched files, tests for the changed
behaviour, the affected tests run, and one review pass over the diff for its
riskiest bug categories (bug-hunt section 3). A finding is confirmed with a
failing test before it is fixed. Nothing is written into `.bughunt/`.

**Full pipeline** (`bug-hunt` pipeline mode, its section P) when a wrong
result would be silent or hard to undo (money, auth, security, user data,
persistence or migrations, concurrency), when the task has several sizeable
independent code lanes, or when the user asks for thorough testing or
hardening. In that case the spec and the ledger's eliminated bug classes go
into every worker's brief.

If the task is itself a bug hunt on existing code, use bug-hunt **round
mode** instead: parallel unit x category review passes, findings confirmed at
the root, fixes applied by one agent.

Trivial edits need only the check that proves them. Skip verification only
when the user explicitly asks for an unverified draft.

## Finishing

The root owns the result: resolve contradictions between workers, integrate,
inspect the final state, confirm the chosen quality level passed and that the
original request is met. The user gets the outcome, assumptions and residual
risk, not orchestration noise.
