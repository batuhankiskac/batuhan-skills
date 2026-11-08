---
name: orchestrator
description: >
  Proactively use for every non-trivial coding, debugging, refactoring,
  investigation, research, or multi-file task where independent work can be
  executed concurrently. Optimize wall-clock completion time by decomposing
  work into independent workstreams, delegating them in parallel when
  subagents are available, minimizing duplicate exploration, preventing
  recursive delegation, and performing consolidated integration and
  verification.
---

# Orchestrator

Optimize primarily for:

> Minimum wall-clock completion time while preserving correctness.

Do not optimize for maximum agent count.

The fastest execution usually comes from:

1. Removing unnecessary work.
2. Identifying independent workstreams.
3. Running those workstreams concurrently.
4. Avoiding duplicated repository exploration.
5. Avoiding recursive subagent spawning.
6. Integrating results once.
7. Verifying the integrated result once.

---

# 1. Determine Your Role

Before orchestrating, determine whether you are:

- the root/coordinating agent, or
- a delegated worker/subagent.

## Delegated worker rule

If you were created or delegated by another agent to perform a specific task:

DO NOT orchestrate again by default.

Do not spawn more agents merely because this skill exists.

Instead:

1. Execute the assigned work directly.
2. Remain inside the assigned scope.
3. Avoid unrelated repository exploration.
4. Perform only relevant validation.
5. Return concise findings/results to the parent.

Nested delegation is allowed only when:

- the parent explicitly requested it, or
- the assigned task itself contains multiple expensive and clearly independent
  branches and nested delegation provides a substantial wall-clock benefit.

Default behavior for delegated workers is direct execution.

This prevents:

    Root
      ├── Worker
      │    ├── Worker
      │    └── Worker
      └── Worker
           ├── Worker
           └── Worker

from appearing unnecessarily.

---

# 2. Decide Whether Orchestration Helps

Do not delegate trivial tasks.

Work directly for tasks such as:

- one small obvious edit
- one known bug in one location
- a simple question
- a tiny configuration change
- one command
- localized formatting
- a straightforward single-file implementation

Orchestrate when there are at least two substantial independent workstreams.

Typical examples:

- inspect frontend and backend independently
- analyze separate modules
- investigate several possible root causes
- inspect implementation and tests concurrently
- research multiple independent questions
- review several unrelated components
- perform broad repository reconnaissance
- implement changes in isolated file groups

Ask:

> Can this work be removed from the critical path by running it concurrently?

If not, do not create another agent.

---

# 3. Critical Path First

Identify the work that determines total completion time.

Prioritize parallelization of those tasks.

Do not spend worker capacity on low-value side work while the main critical
path remains serial.

Example:

BAD:

    Worker A -> rename variables
    Worker B -> format documentation

while the root spends ten minutes investigating the actual bug.

BETTER:

    Worker A -> trace request lifecycle
    Worker B -> inspect parser state transitions
    Root     -> inspect reproduction/test failure

All three attack the critical path concurrently.

---

# 4. Breadth-First Parallelism

Independent tasks should start together.

BAD:

    start A
    wait A
    start B
    wait B
    start C
    wait C

GOOD:

    identify A, B, C
    launch A + B + C
    continue useful root work
    collect results

If the runtime supports a batch or parallel task/subagent interface, prefer one
batched fan-out operation.

Avoid serial agent creation when assignments are independent.

---

# 5. Worker Count

More workers are not automatically faster.

Default guidance:

- 0 workers: trivial/localized work
- 2 workers: ordinary parallel task
- 3 workers: broad task
- 4 workers: large task with clean ownership boundaries

Use more only when decomposition is extremely clear.

Every worker adds:

- startup latency
- context cost
- coordination cost
- duplicate exploration risk
- merge/conflict risk

Use the smallest worker count that materially reduces the critical path.

---

# 6. Decompose by Ownership

Assignments must be narrow and independently executable.

Good boundaries include:

- file
- directory
- module
- subsystem
- responsibility
- investigation question
- test surface

GOOD:

    Worker A:
    Inspect HTTP request parsing in src/http/.
    Find unnecessary state transitions.
    Do not edit files.
    Return file paths and concrete findings.

GOOD:

    Worker B:
    Inspect connection lifecycle in src/network/.
    Identify duplicated cleanup logic.
    Do not modify parser code.

BAD:

    Analyze the whole repository and improve it.

Avoid having multiple workers modify the same files.

If several investigations may converge on the same file:

1. parallelize analysis,
2. collect findings,
3. let one agent/root perform the edit.

---

# 7. Share Context Once

Do not make every worker rediscover information already known.

Before fan-out, provide minimal shared context:

- objective
- relevant constraints
- known architecture
- useful paths
- acceptance criteria
- conventions that matter

Do not send entire conversations or huge repository dumps.

Worker context should be just enough to begin immediately.

---

# 8. Avoid Duplicate Exploration

Repository-wide scanning is often expensive.

If one worker owns architecture discovery, other workers should not repeat the
same full scan.

Prefer:

    one broad discovery
         ↓
    targeted parallel reads

over:

    Worker A -> scan everything
    Worker B -> scan everything
    Worker C -> scan everything

Share useful paths and discoveries with later work whenever possible.

---

# 9. Exploration Before Parallel Editing

If architecture, ownership, or root cause is unclear, first run a short
reconnaissance wave.

Example:

    Worker A -> trace request flow
    Worker B -> inspect error handling
    Worker C -> inspect tests

Then determine implementation ownership.

Do not immediately launch several editing workers into overlapping code.

---

# 10. Root Agent Must Stay Productive

After launching workers, the root should not duplicate their assignments.

Useful root work includes:

- analyzing the critical integration point
- preparing merge strategy
- reading acceptance criteria
- inspecting shared interfaces
- handling a separate critical-path branch
- planning final verification

Do not repeatedly poll workers when the environment supports completion
notifications or asynchronous task collection.

---

# 11. Tool-Aware Parallelism

Use available runtime capabilities.

If the environment provides:

- subagents
- task workers
- batch tasks
- parallel tool calls
- scouts
- reviewers
- explorers

use the cheapest appropriate mechanism.

Prefer specialized lightweight workers for:

- repository search
- file discovery
- test discovery
- simple reconnaissance

Reserve expensive reasoning workers for work that actually requires complex
reasoning.

Pick each worker's model with the `model-routing` skill (haiku / sonnet /
opus by task) and pass `model` explicitly on every spawn.

If no subagent mechanism exists, still apply the orchestration principles to
tool calls and work ordering.

---

# 12. Worker Prompt Contract

Worker assignments should approximately contain:

## Context

Only the background required to begin.

## Objective

Exactly one concrete outcome.

## Scope

Specific files/modules/questions owned by the worker.

## Constraints

Relevant technical requirements.

## Do Not

- do not recursively delegate
- do not expand scope
- do not modify unrelated files
- do not repeat expensive global checks
- do not perform work owned by another worker

## Return

Concise integration-ready output such as:

- root cause
- findings
- file paths
- changed files
- risks
- tests needed
- unresolved questions

Avoid long narrative reports unless required.

---

# 13. Parallel Editing Rules

Parallel editing is appropriate only when ownership is clean.

Safe:

    Worker A -> src/parser/*
    Worker B -> src/network/*
    Worker C -> tests/cgi/*

Unsafe:

    Worker A -> RequestHandler.cpp
    Worker B -> RequestHandler.cpp
    Worker C -> RequestHandler.cpp

When ownership overlaps, parallelize investigation instead of modification.

---

# 14. Verification

Avoid repeating expensive full-project checks inside every worker.

Workers should perform targeted validation relevant to their task.

Examples:

- affected unit tests
- compile affected module
- targeted type check
- inspect generated diff
- reproduce the specific bug

After integration, root performs consolidated verification.

Preferred sequence:

    parallel work
        ↓
    collect results
        ↓
    integrate
        ↓
    inspect diff
        ↓
    targeted verification
        ↓
    broader test/build only when justified

Do not run the same full test suite independently in every worker unless there
is a specific reason.

---

# 15. Failure Handling

A worker failure must not invalidate successful parallel branches.

If one worker fails:

1. preserve successful results,
2. retry only the failed branch,
3. reduce its scope if useful,
4. handle it directly if retry overhead exceeds remaining work.

Do not restart the entire orchestration wave.

---

# 16. Stop Parallelizing When It Stops Helping

Delegation has overhead.

Stop creating new workers when:

- remaining tasks are tiny
- tasks strongly depend on previous results
- ownership overlaps
- integration cost exceeds expected time saved
- only one critical-path task remains

Finish directly.

---

# 17. Anti-Patterns

Avoid these.

## Recursive agent explosion

    Root -> worker -> worker -> worker

without a strong justification.

## Agent spam

One worker for every tiny action.

## Fake parallelism

Launching tasks concurrently even though B requires A's result.

## Duplicate repository scans

Every worker independently discovering the same architecture.

## Shared-file editing

Several agents modifying the same implementation simultaneously.

## Serial fan-out

Waiting for independent workers one by one.

## Duplicate verification

Every worker running the complete project test suite.

## Oversized context

Sending irrelevant history and repository content to every worker.

## Excessive narration

Workers returning essays instead of actionable integration results.

---

# 18. Completion Contract

The coordinating agent owns the final result.

Before finishing:

1. collect relevant worker results,
2. resolve contradictions,
3. integrate applicable changes,
4. inspect the final state,
5. verify the result,
6. confirm the original user request is satisfied.

The user should receive the result of orchestration, not raw orchestration
noise.

---

# Fast Decision Algorithm

For each non-trivial task:

    Is the task trivial?
      yes -> execute directly
      no
       |
       v
    Are there 2+ independent expensive branches?
      no -> execute directly
      yes
       |
       v
    Can they run concurrently without conflicting ownership?
      no -> parallelize investigation only
      yes
       |
       v
    Launch minimum useful worker set together
       |
       v
    Root handles separate critical-path work
       |
       v
    Collect once
       |
       v
    Integrate
       |
       v
    Verify once

Remember:

> Parallelism is a means, not the objective.

The objective is the shortest reliable critical path.
