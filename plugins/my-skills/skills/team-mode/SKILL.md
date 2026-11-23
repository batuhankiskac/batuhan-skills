---
name: team-mode
description: Run a large, open-ended coding task like an automated software team (scout, blind idea proposals, judge, planner, parallel build lanes with blind testers and reviewers, integration, adversarial final review, retro). Use only when the user explicitly asks for team mode ("takım modunda yap", "ekip gibi çalış", "team mode"). Not for bug fixes, small tasks or limit saving; those use the orchestrator skill.
---

# Team mode

Claude-only by default. The team is a fixed pipeline run by the saved
`team` workflow (`~/.claude/workflows/team.js`); the root agent is the
conductor. Artifacts travel through return values, not files in the repo.

Roles and models (set inside the workflow):

| Stage | Role | Model | Independence |
|---|---|---|---|
| Scout | maps relevant code, test command, risks | sonnet, read-only | — |
| Ideate | 3 proposers: simplest / robust / best fit | sonnet, read-only | blind to each other |
| Judge | picks one, grafts the best ideas | opus, read-only | — |
| Plan | acceptance criteria, file-disjoint lanes | opus, read-only | — |
| Build | per lane: implementer + blind tester | sonnet | tester never reads impl |
| Review/fix | per lane, max 2 fix loops, pipelined | sonnet | reviewer read-only |
| Integrate | full suite, wiring fixes only | sonnet | — |
| Final review | adversarial whole-diff review | opus, read-only | sees only spec + diff |

External agents (`omp`, `agy`) are not part of the team. Use them only when
the user says so in the current request (for example "reviewer'ı agy
yapsın"); then the root runs that role itself through the `omp` / `agy`
skill instead of the workflow stage. Never probe whether they are available.

## 1. Before starting

1. Confirm the task is large and open-ended; otherwise tell the user in one
   line that the orchestrator's normal levels fit better, and use those
   unless they insist.
2. The repository must be a git repo with a clean working tree (or the user's
   changes committed/stashed by the user), so the team's diff is isolated.
   Do not stash or commit the user's work yourself.
3. The Workflow tool needs explicit opt-in; the user's "takım modu" request
   is that opt-in.

## 2. Run in two steps (default)

Step 1, design (cheap; ends before any code is written):

    Workflow({ name: "team", args: { task: "<full task brief>", mode: "design" } })

Show the user the judge's decision in a few lines (chosen approach, grafted
ideas, open questions) and ask once whether to build it. This is the only
user checkpoint.

Step 2, build with the approved (or user-edited) decision:

    Workflow({ name: "team", args: { task: "<same brief>", mode: "build", decision: <decision object or edited text> } })

If the user asked for full autonomy ("sormadan bitir"), use `mode: "full"`
in one run. `maxLanes` (default 4) caps parallel lanes.

If the saved name `team` is not found, pass the script path instead:
`Workflow({ scriptPath: "/Users/batuhankiskac/.claude/workflows/team.js", args: {...} })`
(the canonical copy lives in the batuhan-skills repo under `workflows/team.js`).

Write the task brief like for a colleague with no context: goal, constraints,
what done means, files or areas if known.

## 3. After the run (root's job)

1. Inspect `git diff --stat` and the full test run yourself; the workflow's
   "done" is not proof.
2. Lanes with `status: "blocked"` or open final-review findings: fix them
   directly or report them with evidence. Do not rerun the whole team.
3. Retro: name each confirmed bug pattern in one line. If the project uses a
   bug-hunt ledger, add them under "Eliminated bug classes"; record lasting
   lessons in the second brain (`ikinci-beyin-yaz` / `beyin`).
4. Report to the user: result, chosen approach, assumptions, blocked items,
   residual risk. No stage-by-stage narration.

## Cost

A full run spawns about 9 fixed agents plus 3-7 per lane (more when fix loops
run); three of them run on opus (judge, planner, final reviewer). Mention this once before step 1 if the user
seems to be watching limits.
