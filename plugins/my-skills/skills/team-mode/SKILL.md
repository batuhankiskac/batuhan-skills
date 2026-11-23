---
name: team-mode
description: Run a large, open-ended coding task like an automated software team (scout, blind idea proposals, judge, planner, parallel build lanes with blind testers and reviewers, integration, adversarial final review, scope check, retro). Use only when the user explicitly asks for team mode ("takım modunda yap", "ekip gibi çalış", "team mode"). Not for bug fixes, small tasks or limit saving; those use the orchestrator skill.
---

# Team mode

Claude-only by default. The team is a fixed pipeline run by the saved
`team` workflow (`~/.claude/workflows/team.js`); the root agent is the
conductor. Artifacts (decision, spec, findings) travel through return values,
not files in the repo, so nothing goes into `.bughunt/`.

Roles and default models (override with `models`, or `cheap: true`):

| Stage | Role | Model | Independence |
|---|---|---|---|
| Check | clean tree and HEAD before build; test-file hashes; scope check at the end | haiku | — |
| Scout | relevant code, test command, baseline failures | sonnet | read-only type |
| Ideate | 3 proposers: simplest / robust / best fit | sonnet | blind to each other |
| Judge | picks one, grafts the best ideas | opus | — |
| Plan | acceptance, interfaces, file-disjoint lanes | opus | validated in code |
| Build | per lane: implementer + blind tester; all lanes finish before any review | sonnet | tester sees spec + interfaces only |
| Review/fix | per lane, lane tests only, up to 2 fix loops | sonnet | reviewer read-only type |
| Integrate | full suite, wiring and integration files | sonnet | — |
| Final review | adversarial whole-diff review, test tampering | opus | did not write code |
| Verify | always reruns the full suite, rechecks final findings | sonnet | did not write code |

"Read-only" agent types cannot edit files but still have a shell, and
prompts are not enforcement. The end-of-run checks are: HEAD and stash list
unchanged, every changed file belongs to the plan, no test file deleted or
renamed away, and every test file whose hash changed after the blind tests
has a stated reason in `test_changes`. `cheap: true` runs two ideators and puts judge, planner and final
reviewer on sonnet.

External agents (`omp`, `agy`) are not part of the team. Use them only when
the user says so in the current request (for example "reviewer'ı agy
yapsın"); then the root runs that role itself through the `omp` / `agy`
skill instead of the workflow stage. Never probe whether they are available.

## 1. Before starting

1. Confirm the task is large and open-ended; otherwise tell the user in one
   line that the orchestrator's normal levels fit better, and use those
   unless they insist.
2. The repository must be a git repo with a clean working tree; the workflow
   refuses to build otherwise. Do not stash or commit the user's work
   yourself; ask them to.
3. The Workflow tool needs explicit opt-in; the user's "takım modu" request
   is that opt-in.

## 2. Run in two steps (default)

Step 1, design (no code is written; the scout runs the tests once for a
baseline):

    Workflow({ name: "team", args: { task: "<full task brief>", mode: "design" } })

Show the user the judge's decision in a few lines (chosen approach, grafted
ideas, open questions) and ask once whether to build it. This is the only
user checkpoint.

Step 2, build with the approved (or user-edited) decision, reusing the scout
so the codebase is not mapped twice:

    Workflow({ name: "team", args: { task: "<same brief>", mode: "build", decision: <decision or edited text>, scout: <scout from step 1> } })

If the user asked for full autonomy ("sormadan bitir"), use `mode: "full"`
in one run. Other args: `maxLanes` (default 4), `cheap`, `models` (for
example `{ final: "opus", build: "haiku" }`), `maxFixLoops`.

If the saved name `team` is not found, pass the script path instead:
`Workflow({ scriptPath: "/Users/batuhankiskac/.claude/workflows/team.js", args: {...} })`
(the canonical copy lives in the batuhan-skills repo under `workflows/team.js`).

Write the task brief like for a colleague with no context: goal, constraints,
what done means, files or areas if known.

## 3. After the run (root's job)

The workflow's reviews replace the orchestrator's quality levels and the
bug-hunt pipeline: do not run another review pass. Instead:

1. Read `ok` and `problems` first. `ok` is true only when every lane is
   clean, integration passed, the independent full-suite run is green, no
   serious final finding is open and all end-of-run checks pass. A missing
   agent result never counts as a pass.
2. Inspect `git diff --stat` and the full test run yourself; also skim
   `test_changes` (tests edited after the blind tests were written).
3. For a failed, blocked or unverified lane, either fix it directly or rerun
   only that lane: `mode: "build"` with the same `decision`, `scout`, the
   returned `plan`, `onlyLanes: ["<id>"]` and `previousLanes: <lanes from the
   previous result>` (lanes not rerun keep that status; without it they count
   as unknown and `ok` stays false). The tree may then be dirty, but only in
   planned files. Report what stays open with evidence.
4. Retro: name each confirmed bug pattern in one line. If the project uses a
   bug-hunt ledger, add them under "Eliminated bug classes"; record lasting
   lessons in the second brain (`ikinci-beyin-yaz` / `beyin`).
5. Report to the user: result, chosen approach, assumptions, open problems,
   residual risk. No stage-by-stage narration.

## Cost

A full run spawns about 14 fixed agents (four are cheap haiku git checks) plus 3-7 per lane (more when fix
loops run); three run on opus (judge, planner, final reviewer) unless
`cheap` is set. Mention this once before step 1 if the user seems to be
watching limits.
