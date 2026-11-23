---
name: bug-hunt
description: Token-efficient bug finding for AI-written code. Round mode hardens an existing codebase (find bugs, harden, debug, "bug-hunt"); pipeline mode is run by the orchestrator only for high-risk code tasks (money, auth, data, concurrency, several large lanes) or when the user asks for thorough testing. Deterministic gates first, risk map, one unit x one category review passes, confirmation by failing test, bug-class elimination and a yield-based stop rule.
---

# Bug Hunt

Goal: find the most real bugs per token. Not the most findings, not the most tests.

Two modes:

- **Pipeline mode** (section P, used by the orchestrator for high-risk code tasks;
  ordinary code tasks use the orchestrator's light level instead): quality checks run
  inside the build, per lane, as soon as each lane finishes. The user gives the task once; the pipeline drives itself to a
  verified result without asking the user what to do next.
- **Round mode** (sections 0-7): a standalone hunting round over an existing codebase.

Core rules:

1. Deterministic tools before LLM reading. Never ask a model to find what a tool finds for free.
2. Never review the whole repo in one pass. One target unit x one bug category per pass.
3. A finding is not a bug until a failing test or reproduction proves it.
4. Fix the bug class, not only the instance.
5. Tests are measured by what they catch (mutation score), not by count.
6. Stop when yield drops. Bug hunting has diminishing returns.

---

## 0. Ledger (single source of truth)

Use the project's existing findings file if one exists. Otherwise create
`.bughunt/ledger.md` from `references/ledger-template.md`.

Every pass reads the ledger first and must not re-report anything already listed
(open, fixed or rejected). Rejected false positives stay in the ledger so they
are never raised again.

Each round appends one line to the yield table (section 7).

## 1. Deterministic gate (zero LLM tokens)

Run what the project already has (type checker, linter, existing tests). Then add
the cheap tools that are missing. Python example:

```bash
mypy --strict <pkg>            # or the project's configured type check
ruff check .
bandit -q -r <pkg>             # security smells
pip-audit                      # vulnerable dependencies
semgrep --config auto --error  # generic bug patterns + project rules in .semgrep/
pytest -q -x --cov=<pkg> --cov-report=json --cov-branch
```

JS/TS equivalents: `tsc --noEmit`, `eslint`, `npm audit`, `semgrep`, `vitest --coverage`.

Gate output is fed to the fixer as-is. Do not ask a model to "look for" type,
lint or known-pattern errors after this step.

## 2. Risk map (decide where to look)

Rank units (module / file / function) by a simple score and review only the top ones:

- **Uncovered branches**: from `coverage.json` (`missing_branches`, `missing_lines`).
- **Churn**: `git log --since=30.days --name-only --format= | sort | uniq -c | sort -rn`
- **Complexity**: `radon cc -s -n C <pkg>` (or `ruff --select C901`).
- **Boundaries**: code that parses input, touches I/O, network, DB, money, time, concurrency or auth.
- **Ledger density**: units that already produced bugs usually have more.

Write the ranked list (top 5-15 units) into the ledger under "Targets".
Units with high coverage, low churn, low complexity and no boundary role are skipped.

## 3. Targeted review passes

One pass = one target unit + one category + only the context it needs
(the unit, its direct callers/callees signatures, the relevant spec lines, the ledger).
Prefer the diff since the last round over full files.

Categories (pick the ones that apply to the unit, highest risk first):

| Code | Category | Look for |
|---|---|---|
| ERR | Error handling | swallowed exceptions, wrong except scope, missing cleanup, partial writes |
| BND | Boundaries | empty/None/zero/negative/huge input, off-by-one, unicode, timezones |
| STATE | State & data flow | stale state, mutation of shared/default args, ordering assumptions, cache invalidation |
| CONC | Concurrency | races, missing locks/awaits, non-atomic check-then-act, retries without idempotency |
| RES | Resources | unclosed files/connections, unbounded growth, leaks, missing timeouts |
| SEC | Security | injection, path traversal, unsafe deserialization, secrets, authz gaps |
| CONTRACT | Spec conformance | behavior differing from the spec/acceptance criteria, wrong defaults |
| PERF | Performance | N+1, quadratic loops, repeated I/O in loops, needless copies |

Reviewer instructions (paste into the subagent prompt):

```
You are reviewing <unit> for category <CODE> only. Ignore every other category.
Read the ledger first; do not report anything already listed.
Report at most 5 findings. For each give:
  id, file:line, category, one-sentence defect,
  concrete trigger (input/state) -> wrong result,
  confidence (high/medium/low).
No style comments. No speculative "could be improved". If nothing is found, say NONE.
```

Model routing: pick every reviewer / tester / fixer model with the `model-routing`
skill (typically haiku or sonnet for review passes, sonnet for fixes, opus only for
hard or high-stakes fixes) and pass `model` explicitly. Independent passes
(different units or categories) run in parallel per the orchestrator skill;
reviewers never spawn further agents.

## 4. Confirm before fixing

For every finding, write the smallest failing test or reproduction script first.

- Passes immediately -> mark `rejected (not reproducible)` in the ledger. No fix.
- Fails -> mark `confirmed`, then fix.

Prefer a property-based test (Hypothesis / fast-check) when the bug is about a
range of inputs; it replaces many example tests.

Spec-derived tests: when a unit has no tests, have an agent that has NOT read the
implementation write property tests from the spec / docstring / acceptance
criteria only. Tests written from the code tend to encode its bugs as correct.

## 5. Fix and eliminate the class

After each confirmed fix:

1. Name the pattern in one line (e.g. "dict.get result used without None check").
2. Search the whole codebase for it: `rg`, `ast-grep` or a quick `semgrep` pattern.
3. Fix every instance found (each still needs a reproduction or is obviously the same defect).
4. If the pattern is mechanically detectable, add a rule to `.semgrep/` (or a lint
   config) so the gate in step 1 catches it forever.
5. Record pattern, instance count and rule file in the ledger.

## 6. Test hygiene (keep the suite lean)

- Keep one regression test per confirmed bug, named after the ledger id.
- On modules touched this round run mutation testing:
  `mutmut run --paths-to-mutate <module>` (Python) or `npx stryker run` (JS/TS).
- Surviving mutants show real test gaps: add a targeted (preferably property) test.
- Tests that kill no mutants that other tests do not already kill are candidates
  for deletion. Delete or merge them rather than letting the suite grow.
- For parsers and external-input entry points, a short fuzz run
  (`atheris`, Hypothesis `@given` with large budgets) is cheaper than hand-written cases.

## 7. Stop rule

After each round append to the ledger yield table:

`round | units reviewed | findings | confirmed | rejected | critical | tokens/approx cost`

Stop broad hunting when, for 2 consecutive rounds:

- confirmed bugs < 3, AND
- no critical (data loss, security, crash on common path), AND
- false-positive rate > 50%.

After stopping, only react to real signals: failing CI, runtime errors, user reports.
For those, give the debugger the stack trace plus the 2-3 relevant files, never the repo.

## P. Pipeline mode (autonomous, used by the orchestrator)

The root agent runs this end to end. It does not hand steps back to the user.
It asks the user only once, at P0, and only if a wrong guess would be expensive
to undo; otherwise it records its assumptions and continues.

### P0. Contract
Turn the task into `.bughunt/spec.md`:
- acceptance criteria (each one testable),
- public interfaces / signatures per unit,
- properties and invariants ("output sorted", "round-trip equal", "never negative"),
- explicit assumptions made.

### P1. Pre-brief (prevention)
Add to the shared context every worker receives:
- the spec,
- the ledger's "Eliminated bug classes" as a **do-not-write list**,
- the 2-3 bug categories most relevant to each unit (from the table in section 3).

### P2. Build lanes (truly concurrent)
For each ownership unit (per orchestrator section 6) start, in one fan-out:
- **Impl worker**: writes the code for the unit.
- **Blind test worker**: writes acceptance and property-based tests from the spec
  only, never reading the implementation. Owns only test files, so there is no
  file overlap with the impl worker.

### P3. Lane gate (pipelined, per lane, as soon as the impl worker finishes)
Do not wait for other lanes. For the finished lane:
1. Deterministic gate scoped to the lane's files (type check, lint, semgrep rules).
2. Run that lane's blind tests (wait for the test worker if still running).
3. One cheap review pass on the lane's diff for its top 1-2 categories (section 3 prompt).
4. Confirm findings (section 4). Send confirmed findings and failing test output back
   to the **same** impl worker (continue it, do not start a fresh one) to fix.
5. Repeat 1-4 until the lane is clean, max 3 loops. Then escalate the fixer model per
   `model-routing`; if still failing, mark the lane `blocked` with the evidence.

When a blind test fails, decide against the spec, not the code: if the spec is clear,
the code is wrong; if the spec is ambiguous, the root decides, records the decision in
the spec, and fixes whichever side is wrong.

Each confirmed bug goes into the ledger and through section 5 (pattern search, rule).

### P4. Integration
Root merges lanes, then runs once: full deterministic gate, full test suite, and a
small end-to-end smoke run of the real entry point(s) against the acceptance criteria.

### P5. Targeted hunt (only if needed)
Run a round-mode hunt (sections 2-6) only on units that, after P4, still rank high on
the risk map (low branch coverage, high complexity, boundary role) or caused
integration failures. Max 2 rounds in pipeline mode; apply the stop rule (section 7).

### P6. Done
The task is complete only when:
- every acceptance criterion has a passing test,
- the gate is green,
- no confirmed finding is open,
- the stop rule is met or the P5 round limit is reached.

Final report to the user: result, assumptions made, blocked items with evidence,
residual risk. No step-by-step narration.

## Round checklist

```
[ ] read ledger
[ ] step 1 gate green (or failures handed to fixer)
[ ] risk map updated, targets chosen
[ ] review passes: unit x category, cheap model, max 5 findings each
[ ] every finding reproduced or rejected
[ ] fixes + pattern search + rule added where possible
[ ] mutation test on touched modules, prune dead tests
[ ] yield row appended, stop rule checked
```

## Delegated worker rule

If you were spawned to run one review pass, one confirmation or one fix, do only
that, return results in the ledger format, and do not start a new round or
spawn agents.
