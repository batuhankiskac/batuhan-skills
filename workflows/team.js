export const meta = {
  name: 'team',
  description: 'Software-team pipeline: scout, blind ideas, judge, plan, build lanes with blind tests and review, integrate, final review',
  whenToUse: 'Large, open-ended coding task the user explicitly ran in team mode (takım modu). args: {task, mode: "design"|"build"|"full", decision?, maxLanes?}',
  phases: [
    { title: 'Scout', detail: 'one read-only pass over the relevant code' },
    { title: 'Ideate', detail: '3 blind proposals with different lenses' },
    { title: 'Judge', detail: 'pick and merge one approach', model: 'opus' },
    { title: 'Plan', detail: 'acceptance criteria and file-disjoint lanes', model: 'opus' },
    { title: 'Build', detail: 'per lane: impl + blind tests, then review/fix loop' },
    { title: 'Integrate', detail: 'full test run and integration fixes' },
    { title: 'Final review', detail: 'adversarial review of the whole diff', model: 'opus' },
  ],
}

// Invariants (for maintainers):
// - Lanes own disjoint files, so lane agents share one checkout without worktrees.
//   The planner must guarantee this; impl agents never touch test files and testers
//   touch only test files.
// - Read-only roles (scout, ideators, judge, planner, reviewers) use built-in
//   read-only agent types, so they cannot edit even if a prompt drifts.
// - No agent commits, pushes or writes process files into the repo; artifacts
//   travel through return values and are reported by the root.
// - External agents (omp, agy) are never used here; the root may use them only
//   when the user asks explicitly.

const A = args || {}
const TASK = A.task
if (!TASK) throw new Error('args.task is required')
const MODE = A.mode || 'full'
const MAX_LANES = A.maxLanes || 4
const MAX_FIX_LOOPS = 2

const SCOUT = { type: 'object', properties: {
  summary: { type: 'string' },
  relevant_paths: { type: 'array', items: { type: 'string' } },
  conventions: { type: 'string' },
  test_command: { type: 'string' },
  risks: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'relevant_paths', 'test_command'] }

const OPTION = { type: 'object', properties: {
  title: { type: 'string' },
  approach: { type: 'string' },
  changes: { type: 'array', items: { type: 'string' } },
  risks: { type: 'array', items: { type: 'string' } },
  size: { type: 'string', enum: ['S', 'M', 'L'] },
}, required: ['title', 'approach', 'changes', 'risks', 'size'] }

const DECISION = { type: 'object', properties: {
  chosen_title: { type: 'string' },
  rationale: { type: 'string' },
  merged_approach: { type: 'string' },
  grafted_ideas: { type: 'array', items: { type: 'string' } },
  open_questions: { type: 'array', items: { type: 'string' } },
}, required: ['chosen_title', 'rationale', 'merged_approach'] }

const PLAN = { type: 'object', properties: {
  acceptance: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  invariants: { type: 'array', items: { type: 'string' } },
  non_goals: { type: 'array', items: { type: 'string' } },
  lanes: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' },
    goal: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    test_files: { type: 'array', items: { type: 'string' } },
    acceptance_ids: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
  }, required: ['id', 'goal', 'files', 'test_files', 'acceptance_ids', 'categories'] } },
}, required: ['acceptance', 'lanes'] }

const WORK = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'blocked'] },
  changed_files: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
  tests: { type: 'string' },
}, required: ['status', 'changed_files', 'summary'] }

const FINDINGS = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    file: { type: 'string' }, line: { type: 'number' }, category: { type: 'string' },
    defect: { type: 'string' }, trigger: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
  }, required: ['file', 'category', 'defect', 'trigger', 'severity'] } },
}, required: ['findings'] }

const NO_GIT = 'Do not commit, push, stash or switch branches. Do not create notes or process files in the repository.'

// ---- Scout
phase('Scout')
const scout = await agent(
  `Task the team will implement:\n${TASK}\n\nMap only what this task needs: relevant files and their roles, ` +
  `conventions to follow, the command that runs the tests, and risks (money, auth, data, concurrency, public API). ` +
  `Be concise; paths over prose.`,
  { label: 'scout', phase: 'Scout', schema: SCOUT, model: 'sonnet', agentType: 'Explore' })
if (!scout) throw new Error('scout failed')
const CTX = `Task:\n${TASK}\n\nCodebase map:\n${JSON.stringify(scout, null, 1)}`

// ---- Ideate + Judge (skipped in build mode, where the decision is passed in)
let decision = A.decision || null
let options = []
if (MODE !== 'build') {
  const LENSES = [
    ['simplest', 'the smallest change that fully meets the task, maximum reuse of existing code'],
    ['robust', 'the most correct and failure-proof design, even if it costs more code'],
    ['fit', 'the design that fits existing architecture and conventions best and is easiest to maintain'],
  ]
  options = (await parallel(LENSES.map(([key, lens]) => () => agent(
    `${CTX}\n\nPropose ONE approach optimised for: ${lens}. You work alone; other proposers exist but you ` +
    `must not hedge between options. Read code as needed. Name concrete files and changes.`,
    { label: `idea:${key}`, phase: 'Ideate', schema: OPTION, model: 'sonnet', agentType: 'Plan' })))).filter(Boolean)
  if (!options.length) throw new Error('all ideators failed')

  decision = await agent(
    `${CTX}\n\nIndependent proposals:\n${JSON.stringify(options, null, 1)}\n\n` +
    `Judge them on correctness risk, size, fit with the codebase and maintainability. Pick one, graft clearly ` +
    `better ideas from the others, and state the merged approach precisely. List open questions only if a wrong ` +
    `guess would be expensive to undo.`,
    { label: 'judge', phase: 'Judge', schema: DECISION, model: 'opus', agentType: 'Plan' })
  if (!decision) throw new Error('judge failed')
  if (MODE === 'design') return { mode: MODE, scout, options, decision }
}
if (!decision) throw new Error('build mode needs args.decision')

// ---- Plan
const plan = await agent(
  `${CTX}\n\nChosen approach:\n${typeof decision === 'string' ? decision : JSON.stringify(decision, null, 1)}\n\n` +
  `Write the build plan: testable acceptance criteria, invariants, non-goals, and at most ${MAX_LANES} lanes. ` +
  `HARD RULE: no file may appear in two lanes (files or test_files); impl files and test files are separate. ` +
  `If the work cannot be split cleanly, use one lane. For each lane pick its 1-2 riskiest bug categories from ` +
  `ERR, BND, STATE, CONC, RES, SEC, CONTRACT, PERF.`,
  { label: 'plan', phase: 'Plan', schema: PLAN, model: 'opus', agentType: 'Plan' })
if (!plan) throw new Error('planner failed')

const owned = new Map()
for (const lane of plan.lanes) for (const f of [...lane.files, ...lane.test_files]) {
  if (owned.has(f) && owned.get(f) !== lane.id) throw new Error(`plan overlap: ${f} in ${owned.get(f)} and ${lane.id}`)
  owned.set(f, lane.id)
}
const SPEC = `Acceptance:\n${plan.acceptance.map(a => `${a.id}: ${a.text}`).join('\n')}\n` +
  `Invariants:\n${(plan.invariants || []).join('\n')}\nNon-goals:\n${(plan.non_goals || []).join('\n')}`
const laneSpec = l => `Lane ${l.id}: ${l.goal}\nOwns files: ${l.files.join(', ')}\nTest files: ${l.test_files.join(', ')}\n` +
  `Covers acceptance: ${l.acceptance_ids.join(', ')}`

// ---- Build: each lane flows through impl+tests -> review/fix without waiting for other lanes
const lanes = await pipeline(plan.lanes,
  async (lane) => {
    const [impl, tests] = await parallel([
      () => agent(
        `${CTX}\n\nApproach:\n${decision.merged_approach || decision}\n\n${SPEC}\n\n${laneSpec(lane)}\n\n` +
        `Implement this lane. Edit ONLY the files this lane owns (create them if listed). Do not touch test files. ` +
        `Run a quick compile/type check of your files. ${NO_GIT}`,
        { label: `impl:${lane.id}`, phase: 'Build', schema: WORK, model: 'sonnet' }),
      () => agent(
        `${SPEC}\n\n${laneSpec(lane)}\n\nTest command: ${scout.test_command}\n\n` +
        `Write acceptance and property-style tests for this lane from the spec ONLY. Do NOT read the lane's ` +
        `implementation files (${lane.files.join(', ')}); you may read existing test helpers and public interfaces ` +
        `elsewhere. Edit only the listed test files. Do not run the tests. ${NO_GIT}`,
        { label: `tests:${lane.id}`, phase: 'Build', schema: WORK, model: 'sonnet' }),
    ])
    return { lane, impl, tests }
  },
  async (built) => {
    const { lane } = built
    let open = [], loops = 0
    for (;;) {
      const r = await agent(
        `${SPEC}\n\n${laneSpec(lane)}\n\nReview the current changes in this lane's files (git diff plus the files) ` +
        `for categories ${lane.categories.join(', ')} only, and run the lane tests with: ${scout.test_command}. ` +
        `Report failing tests as findings too. At most 5 findings, each with a concrete trigger. No style comments. ` +
        `Empty list if clean.`,
        { label: `review:${lane.id}#${loops}`, phase: 'Build', schema: FINDINGS, model: 'sonnet', agentType: 'Plan' })
      open = r ? r.findings : []
      if (!open.length || loops >= MAX_FIX_LOOPS) break
      loops++
      await agent(
        `${SPEC}\n\n${laneSpec(lane)}\n\nFindings to fix:\n${JSON.stringify(open, null, 1)}\n\n` +
        `For each finding first confirm it (a failing test or reproduction); skip ones that do not reproduce and say so. ` +
        `If a blind test contradicts a clear spec, fix the code; if the spec is ambiguous, fix whichever side is wrong ` +
        `and state the decision. Edit only this lane's files and test files. ${NO_GIT}`,
        { label: `fix:${lane.id}#${loops}`, phase: 'Build', schema: WORK, model: 'sonnet' })
    }
    return { id: lane.id, impl: built.impl, tests: built.tests, fix_loops: loops, open_findings: open,
             status: open.length ? 'blocked' : 'clean' }
  })

// ---- Integrate
const integ = await agent(
  `${SPEC}\n\nAll lanes are built. Run the full test suite (${scout.test_command}) and any type check/lint the ` +
  `project has. Fix integration breaks only (wiring, imports, interfaces between lanes); do not redesign. ` +
  `Report what failed and what you changed. ${NO_GIT}`,
  { label: 'integrate', phase: 'Integrate', schema: WORK, model: 'sonnet' })

// ---- Final review
const final = await agent(
  `${CTX}\n\n${SPEC}\n\nAdversarially review the whole working-tree diff (git diff and new files) against the ` +
  `acceptance criteria and invariants. Hunt for silent wrong results, missed acceptance criteria, security and ` +
  `data-loss risks. Run the tests if useful. At most 8 findings, each with a concrete trigger; empty if clean.`,
  { label: 'final-review', phase: 'Final review', schema: FINDINGS, model: 'opus', agentType: 'Plan' })

let finalFix = null
const serious = final ? final.findings.filter(f => f.severity !== 'minor') : []
if (serious.length) {
  finalFix = await agent(
    `${SPEC}\n\nFix these confirmed-review findings (confirm each with a failing test first; skip non-reproducing ` +
    `ones and say so), then run the full suite (${scout.test_command}):\n${JSON.stringify(serious, null, 1)}\n${NO_GIT}`,
    { label: 'final-fix', phase: 'Final review', schema: WORK, model: 'sonnet' })
}

return {
  mode: MODE, scout, options, decision, plan,
  lanes: lanes.map((l, i) => l || { id: plan.lanes[i].id, status: 'failed' }),
  integration: integ,
  final_review: final ? final.findings : null,
  final_fix: finalFix,
}
