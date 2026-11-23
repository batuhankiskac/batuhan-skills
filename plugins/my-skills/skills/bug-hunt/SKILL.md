---
name: bug-hunt
description: Token-efficient bug finding for AI-written code. Round mode hardens an existing codebase (find bugs, harden, debug, "bug-hunt"); pipeline mode is run by the orchestrator only for high-risk code tasks (money, auth, data, concurrency, several large lanes) or when the user asks for thorough testing. Deterministic gates first, risk map, one unit x one category review passes, confirmation by failing test, bug-class elimination and a yield-based stop rule.
---

# Bug Hunt

Find the most real bugs per token, not the most findings or the most tests.
The approach rests on a few ideas:

- Tools before models: never spend model tokens finding what a type checker,
  linter or scanner finds for free.
- Narrow passes beat whole-repo reads: one unit and one bug category at a time.
- A finding is not a bug until a failing test or reproduction shows it.
- Fixing the class (the pattern everywhere, ideally with a rule) beats fixing
  the instance.
- Tests are worth what they catch, not their count.
- Yield falls off; stop when it does.

Two modes: **round mode** (sections 0-7) hunts in an existing codebase;
**pipeline mode** (section P) builds quality into a high-risk code task.

## 0. Ledger

Use the project's existing findings file, or create `.bughunt/ledger.md` from
`references/ledger-template.md`. It is the memory between passes: every pass
reads it, nothing already listed (open, fixed or rejected) is reported again,
and rejected false positives stay so they are not raised twice.

## 1. Deterministic gate

Run what the project already has (type checker, linter, tests), then add
cheap missing tools where they fit. Python: `mypy`, `ruff`, `bandit`,
`pip-audit`, `semgrep --config auto`, `pytest --cov --cov-branch`.
JS/TS: `tsc --noEmit`, `eslint`, `npm audit`, `semgrep`, `vitest --coverage`.
Gate output goes straight to the fixer; reviewers do not re-look for these
error types.

## 2. Risk map

Review where bugs are likely, not everywhere. Useful signals: uncovered
branches (coverage report), churn (`git log --since=30.days --name-only`),
complexity (`radon cc` or `ruff --select C901`), boundary code (input
parsing, I/O, network, DB, money, time, concurrency, auth) and units that
already produced bugs. Record the top targets (typically 5-15) in the ledger;
well-covered, stable, simple, non-boundary code can be skipped.

## 3. Targeted review passes

One pass covers one target unit and one category, with only the context it
needs (the unit, direct callers/callees, relevant spec lines, the ledger);
prefer the diff since the last round over full files.

| Code | Category | Look for |
|---|---|---|
| ERR | Error handling | swallowed exceptions, wrong except scope, missing cleanup, partial writes |
| BND | Boundaries | empty/None/zero/negative/huge input, off-by-one, unicode, timezones |
| STATE | State & data flow | stale state, shared/default arg mutation, ordering assumptions, cache invalidation |
| CONC | Concurrency | races, missing locks/awaits, check-then-act, retries without idempotency |
| RES | Resources | unclosed handles, unbounded growth, leaks, missing timeouts |
| SEC | Security | injection, path traversal, unsafe deserialization, secrets, authz gaps |
| CONTRACT | Spec conformance | behaviour differing from spec or acceptance criteria, wrong defaults |
| PERF | Performance | N+1, quadratic loops, repeated I/O in loops, needless copies |

Reviewer brief:

```
Review <unit> for category <CODE> only. Read the ledger first and skip
anything already listed. Report a handful of findings at most (around 5),
each with file:line, a one-sentence defect, the concrete trigger and wrong
result, and your confidence. No style remarks or speculative improvements.
Say NONE if nothing is found.
```

Independent passes run in parallel (see `orchestrator`); choose models with
`model-routing`. Reviewers do not spawn agents.

## 4. Confirm before fixing

Write the smallest failing test or reproduction for each finding. If it
passes, mark the finding rejected (not reproducible); if it fails, mark it
confirmed and fix it. Property-based tests (Hypothesis, fast-check) suit bugs
about input ranges. For untested units, tests written from the spec by an
agent that has not read the implementation avoid encoding its bugs as
correct.

## 5. Eliminate the class

After a confirmed fix, name the pattern in one line, search the codebase for
it (`rg`, `ast-grep`, a quick semgrep pattern), fix the other real instances,
and where it is mechanically detectable add a `.semgrep/` or lint rule so the
gate catches it from now on. Record pattern, instance count and rule in the
ledger.

## 6. Test hygiene

Keep one regression test per confirmed bug, named after its ledger id. On
touched modules, mutation testing (`mutmut`, `stryker`) shows real gaps:
surviving mutants deserve a targeted test, and tests that kill nothing unique
are candidates to merge or delete. For parsers and input entry points a short
fuzz run is cheaper than hand-written cases.

## 7. Stop rule

Append a yield row per round: `round | units | findings | confirmed |
rejected | critical | approx cost`. Stop broad hunting once yield has clearly
dropped, by default when two consecutive rounds bring few confirmed bugs
(fewer than 3), nothing critical (data loss, security, crash on a common
path), and mostly false positives (over half). After that, react only to real
signals (failing CI, runtime errors, user reports) with the stack trace and
the few relevant files, not the whole repo.

## P. Pipeline mode

Used by the orchestrator for high-risk code tasks. The root drives it to a
verified result; it asks the user only if a wrong assumption would be
expensive to undo, otherwise it records the assumption and continues.

- **P0 Contract.** Write `.bughunt/spec.md`: testable acceptance criteria,
  public interfaces per unit, properties and invariants, assumptions.
- **P1 Pre-brief.** Every worker gets the spec, the ledger's eliminated bug
  classes as patterns to avoid, and the 1-3 categories most relevant to its
  unit.
- **P2 Build lanes.** Per ownership unit, start together an implementation
  worker and a blind test worker that writes acceptance and property tests
  from the spec without reading the implementation and owns only test files.
- **P3 Lane gate.** As each lane finishes, without waiting for the others:
  scoped gate, that lane's blind tests, one cheap review pass for its top
  categories, confirmation of findings, and fixes by the same implementation
  worker. Loop a few times (around 3); if it still fails, escalate the fixer
  model, then mark the lane blocked with evidence. When a blind test fails,
  the spec decides: a clear spec means the code is wrong; an ambiguous spec
  means the root decides, records it in the spec and fixes the wrong side.
  Confirmed bugs go through section 5.
- **P4 Integration.** Merge lanes, then once: full gate, full suite, and a
  short end-to-end run of the real entry points against the acceptance
  criteria.
- **P5 Targeted hunt.** Only where the risk map still points after P4 (low
  coverage, high complexity, boundary role, integration failures); usually at
  most two rounds, with the stop rule.
- **P6 Done** when every acceptance criterion has a passing test, the gate is
  green, no confirmed finding is open, and the stop rule or round limit is
  reached. Report result, assumptions, blocked items with evidence and
  residual risk.

## Delegated workers

A worker spawned for one review pass, confirmation or fix does only that,
returns results in ledger format, and does not start rounds or spawn agents.
