export const meta = {
  name: 'team',
  description: 'Software-team pipeline: scout, blind ideas, judge, plan, build lanes with blind tests and review, integrate, final review, scope check',
  whenToUse: 'Large, open-ended coding task the user explicitly ran in team mode (takım modu). args: {task, mode: "design"|"build"|"full", decision?, scout?, plan?, onlyLanes?, previousLanes?, maxLanes?, cheap?, models?}',
  phases: [
    { title: 'Check', detail: 'clean working tree before any edit' },
    { title: 'Scout', detail: 'map relevant code, test command, baseline failures' },
    { title: 'Ideate', detail: 'blind proposals with different lenses' },
    { title: 'Judge', detail: 'pick and merge one approach' },
    { title: 'Plan', detail: 'acceptance criteria, interfaces, file-disjoint lanes (validated)' },
    { title: 'Build', detail: 'per lane: impl + blind tests, then review/fix loop on lane tests' },
    { title: 'Integrate', detail: 'full suite and wiring fixes' },
    { title: 'Final review', detail: 'adversarial review of the whole diff' },
    { title: 'Verify', detail: 'recheck final fixes, scope check on changed files' },
  ],
}

// Invariants (for maintainers):
// - Lanes own disjoint files and share one checkout without worktrees. Because other
//   lanes are mid-edit, lane reviews run only the lane's own test command; the full
//   suite runs only at integration and verify.
// - Plan/Explore agent types cannot use Edit/Write but still have Bash, so "read-only"
//   is a strong default, not a guarantee. The final scope check (git status vs. planned
//   files) is what catches drift; never remove it.
// - A null agent result or a "blocked" status is never treated as success. `ok` is true
//   only when every stage positively reported clean.
// - Blind testers see spec + interfaces, never implementation files. Fixers may change a
//   test only with a stated reason (test_changes); the final reviewer audits those.
// - No agent commits, pushes or writes process files into the repo; artifacts travel
//   through return values. External agents (omp, agy) are never used here.

const A = args || {}
const TASK = A.task
if (!TASK) throw new Error('args.task is required')
const MODE = A.mode || 'full'
if (!['design', 'build', 'full'].includes(MODE)) throw new Error(`unknown mode: ${MODE}`)
const MAX_LANES = A.maxLanes || 4
const MAX_FIX_LOOPS = A.maxFixLoops ?? 2
const CHEAP = !!A.cheap

// Model per role. `cheap` drops opus roles to sonnet and runs two ideators; `models`
// overrides any single role. Reviewers stay at least as strong as builders by default.
const M = Object.assign({
  guard: 'haiku',
  scout: CHEAP ? 'haiku' : 'sonnet',
  ideate: 'sonnet',
  judge: CHEAP ? 'sonnet' : 'opus',
  plan: CHEAP ? 'sonnet' : 'opus',
  build: 'sonnet',
  review: 'sonnet',
  integrate: 'sonnet',
  final: CHEAP ? 'sonnet' : 'opus',
  verify: 'sonnet',
}, A.models || {})

const SCOUT = { type: 'object', properties: {
  summary: { type: 'string' },
  relevant_paths: { type: 'array', items: { type: 'string' } },
  conventions: { type: 'string' },
  test_command: { type: 'string' },
  baseline_failures: { type: 'array', items: { type: 'string' } },
  risks: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'relevant_paths', 'test_command', 'baseline_failures'] }

const GIT = { type: 'object', properties: {
  not_git: { type: 'boolean' },
  head: { type: 'string' },
  stash_count: { type: 'number' },
  entries: { type: 'array', items: { type: 'object', properties: {
    status: { type: 'string' }, path: { type: 'string' }, orig_path: { type: 'string' } }, required: ['status', 'path'] } },
}, required: ['not_git', 'head', 'stash_count', 'entries'] }

const HASHES = { type: 'object', properties: {
  hashes: { type: 'array', items: { type: 'object', properties: {
    path: { type: 'string' }, hash: { type: 'string' } }, required: ['path', 'hash'] } },
}, required: ['hashes'] }

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
  integration_files: { type: 'array', items: { type: 'string' } },
  lanes: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' },
    goal: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    test_files: { type: 'array', items: { type: 'string' } },
    interfaces: { type: 'string' },
    test_command: { type: 'string' },
    acceptance_ids: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
  }, required: ['id', 'goal', 'files', 'test_files', 'interfaces', 'test_command', 'acceptance_ids', 'categories'] } },
}, required: ['acceptance', 'lanes'] }

const WORK = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'blocked'] },
  changed_files: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
  tests: { type: 'string' },
  covers: { type: 'array', items: { type: 'object', properties: {
    acceptance_id: { type: 'string' }, test: { type: 'string' } }, required: ['acceptance_id', 'test'] } },
  test_changes: { type: 'array', items: { type: 'object', properties: {
    file: { type: 'string' }, reason: { type: 'string' } }, required: ['file', 'reason'] } },
  resolved: { type: 'array', items: { type: 'object', properties: {
    defect: { type: 'string' }, outcome: { type: 'string', enum: ['fixed', 'rejected'] }, note: { type: 'string' } },
    required: ['defect', 'outcome'] } },
}, required: ['status', 'changed_files', 'summary'] }

const FINDINGS = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    file: { type: 'string' }, line: { type: 'number' }, category: { type: 'string' },
    defect: { type: 'string' }, trigger: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
  }, required: ['file', 'category', 'defect', 'trigger', 'severity'] } },
}, required: ['findings'] }

const NO_GIT = 'Do not commit, push, stash or switch branches. Do not create notes or process files in the repository.'
const TEST_RULE = 'Do not edit test files to make them pass. Change a test only if it contradicts a clear spec, or the ' +
  'spec is ambiguous and you state the decision; list every test edit in test_changes with its reason. Never delete ' +
  'or skip tests or weaken assertions.'

const norm = p => String(p).trim().replace(/^\.\//, '').replace(/\/{2,}/g, '/')
const J = x => JSON.stringify(x, null, 1)
const approachText = d => typeof d === 'string' ? d
  : [d.merged_approach || J(d), (d.grafted_ideas || []).length ? `Grafted: ${d.grafted_ideas.join('; ')}` : '']
      .filter(Boolean).join('\n')

// HEAD and stash count are captured too: git status cannot see commits or stashes, and
// every agent has a shell, so an agent that commits would otherwise look like "no change".
async function gitStatus(label, ph) {
  const r = await agent(
    'From the repository root run `git rev-parse HEAD`, `git stash list | wc -l` and ' +
    '`git -c core.quotepath=off status --porcelain=v1 -uall`. Return head, stash_count and every status entry ' +
    'as its two-letter code and repo-root-relative path, unquoted (for renames: path = new path, orig_path = old ' +
    'path). Change nothing. If this is not a git repository, set not_git true, head "" and no entries.',
    { label, phase: ph, schema: GIT, model: M.guard, agentType: 'Explore' })
  if (!r) return null
  if (r.not_git) throw new Error('not a git repository; team mode needs git to isolate and check its diff')
  return { head: r.head.trim(), stash: r.stash_count, entries: r.entries.map(e => ({
    status: e.status.trim(), path: norm(e.path), orig: e.orig_path ? norm(e.orig_path) : null })) }
}

if (A.onlyLanes && (MODE !== 'build' || !Array.isArray(A.onlyLanes) || !A.plan))
  throw new Error('onlyLanes needs mode "build", an array of lane ids and the previous plan')

// ---- Check: build/full start from a clean tree so the final diff is the team's alone.
// onlyLanes reruns may start dirty, but only inside files the given plan owns.
let preGit = null
if (MODE !== 'design') {
  phase('Check')
  preGit = await gitStatus('pre-check', 'Check')
  if (preGit === null) throw new Error('could not read git status')
  const pre = preGit.entries
  if (pre.length) {
    const planned = A.onlyLanes && A.plan ? new Set([...(A.plan.integration_files || []),
      ...A.plan.lanes.flatMap(l => [...l.files, ...l.test_files])].map(norm)) : null
    const foreign = pre.filter(e => !planned || !planned.has(e.path))
    if (foreign.length) throw new Error(`working tree not clean: ${foreign.slice(0, 10).map(e => e.path).join(', ')}`)
  }
}

// ---- Scout (reused from the design run when passed in)
let scout = A.scout || null
if (scout && !scout.test_command) throw new Error('args.scout has no test_command')
if (!scout) {
  scout = await agent(
    `Task the team will implement:\n${TASK}\n\nMap only what this task needs: relevant files and their roles, ` +
    `conventions to follow, the command that runs the tests, and risks (money, auth, data, concurrency, public API). ` +
    `Run the test command once and list tests that already fail as baseline_failures (empty if all pass; if the ` +
    `suite cannot run, say why in summary). Change nothing. Be concise; paths over prose.`,
    { label: 'scout', phase: 'Scout', schema: SCOUT, model: M.scout, agentType: 'Explore' })
  if (!scout) throw new Error('scout failed')
}
scout.baseline_failures = scout.baseline_failures || []
const BASELINE = scout.baseline_failures.length
  ? `Tests already failing before the team started (not yours; do not fix unless in scope): ${scout.baseline_failures.join(', ')}`
  : 'The test suite was green before the team started.'
const CTX = `Task:\n${TASK}\n\nCodebase map:\n${J(scout)}`

// ---- Ideate + Judge (skipped in build mode, where the decision is passed in)
let decision = A.decision || null
let options = []
if (MODE !== 'build') {
  const LENSES = [
    ['simplest', 'the smallest change that fully meets the task, maximum reuse of existing code'],
    ['robust', 'the most correct and failure-proof design, even if it costs more code'],
    ['fit', 'the design that fits existing architecture and conventions best and is easiest to maintain'],
  ].filter(([k]) => !CHEAP || k !== 'robust')
  options = (await parallel(LENSES.map(([key, lens]) => () => agent(
    `${CTX}\n\nPropose ONE approach optimised for: ${lens}. You work alone; other proposers exist but you ` +
    `must not hedge between options. Read code as needed. Name concrete files and changes.`,
    { label: `idea:${key}`, phase: 'Ideate', schema: OPTION, model: M.ideate, agentType: 'Plan' })))).filter(Boolean)
  if (!options.length) throw new Error('all ideators failed')
  if (options.length < LENSES.length) log(`${LENSES.length - options.length} ideator(s) returned nothing; judging ${options.length}`)

  decision = await agent(
    `${CTX}\n\nIndependent proposals:\n${J(options)}\n\n` +
    `Judge them on correctness risk, size, fit with the codebase and maintainability. Pick one, graft clearly ` +
    `better ideas from the others, and state the merged approach precisely. List open questions only if a wrong ` +
    `guess would be expensive to undo.`,
    { label: 'judge', phase: 'Judge', schema: DECISION, model: M.judge, agentType: 'Plan' })
  if (!decision) throw new Error('judge failed')
  if (MODE === 'design') return { mode: MODE, scout, options, decision }
}
if (!decision) throw new Error('build mode needs args.decision')
const APPROACH = approachText(decision)

// ---- Plan (validated in code; one retry with the errors fed back)
function validatePlan(p, checkCount = true) {
  const errs = []
  p.integration_files = (p.integration_files || []).map(norm)
  for (const l of p.lanes) { l.files = l.files.map(norm); l.test_files = l.test_files.map(norm) }
  if (!p.lanes.length) errs.push('no lanes')
  if (!p.acceptance.length) errs.push('no acceptance criteria')
  if (checkCount && p.lanes.length > MAX_LANES) errs.push(`${p.lanes.length} lanes; at most ${MAX_LANES}`)
  const accIds = new Set(p.acceptance.map(a => a.id))
  if (accIds.size !== p.acceptance.length) errs.push('duplicate acceptance ids')
  const laneIds = new Set()
  const owner = new Map(p.integration_files.map(f => [f, 'integration']))
  const covered = new Set()
  for (const l of p.lanes) {
    if (laneIds.has(l.id)) errs.push(`duplicate lane id ${l.id}`)
    laneIds.add(l.id)
    if (!l.files.length) errs.push(`lane ${l.id} owns no implementation files`)
    if (!l.acceptance_ids.length) errs.push(`lane ${l.id} covers no acceptance criterion`)
    if (!l.test_files.length) errs.push(`lane ${l.id} has no test files`)
    if (!l.test_command.trim()) errs.push(`lane ${l.id} has no test command`)
    for (const f of [...l.files, ...l.test_files]) {
      if (owner.has(f) && owner.get(f) !== l.id) errs.push(`${f} owned by both ${owner.get(f)} and ${l.id}`)
      else if (owner.get(f) === l.id) errs.push(`${f} listed twice in lane ${l.id}`)
      owner.set(f, l.id)
    }
    for (const id of l.acceptance_ids) {
      if (!accIds.has(id)) errs.push(`lane ${l.id} cites unknown acceptance id ${id}`)
      covered.add(id)
    }
  }
  for (const id of accIds) if (!covered.has(id)) errs.push(`acceptance ${id} is covered by no lane`)
  return errs
}

let plan = A.plan || null
if (plan) {
  // A reused plan was already validated with the lane cap of its own run.
  const errs = validatePlan(plan, false)
  if (errs.length) throw new Error(`args.plan invalid: ${errs.join('; ')}`)
} else {
  const base = `${CTX}\n\nChosen approach:\n${APPROACH}\n\n` +
    `Write the build plan: testable acceptance criteria, invariants, non-goals, and at most ${MAX_LANES} lanes. ` +
    `Rules: no file in two lanes; impl files and test files are separate; files several lanes would need to touch ` +
    `(exports, registries, config) go in integration_files, which only the integrator edits. For each lane give ` +
    `the public interfaces other lanes and its blind tests rely on (signatures, types, error behaviour), a test ` +
    `command that runs only that lane's test files, and its 1-2 riskiest bug categories from ERR, BND, STATE, ` +
    `CONC, RES, SEC, CONTRACT, PERF. Every acceptance criterion belongs to at least one lane. If the work cannot ` +
    `be split cleanly, use one lane.`
  let feedback = '', lastErrs = []
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    const p = await agent(base + feedback,
      { label: `plan#${attempt}`, phase: 'Plan', schema: PLAN, model: M.plan, agentType: 'Plan' })
    if (!p) continue
    lastErrs = validatePlan(p)
    if (!lastErrs.length) plan = p
    else feedback = `\n\nYour previous plan was rejected:\n- ${lastErrs.join('\n- ')}\nPrevious plan:\n${J(p)}\nFix it.`
  }
  if (!plan) throw new Error(`planner failed to produce a valid plan${lastErrs.length ? `: ${lastErrs.join('; ')}` : ''}`)
}

const SPEC = `Acceptance:\n${plan.acceptance.map(a => `${a.id}: ${a.text}`).join('\n')}\n` +
  `Invariants:\n${(plan.invariants || []).join('\n')}\nNon-goals:\n${(plan.non_goals || []).join('\n')}`
const INTERFACES = plan.lanes.map(l => `[${l.id}]\n${l.interfaces}`).join('\n\n')
const laneSpec = l => `Lane ${l.id}: ${l.goal}\nOwns files: ${l.files.join(', ')}\nTest files: ${l.test_files.join(', ')}\n` +
  `Lane test command: ${l.test_command}\nCovers acceptance: ${l.acceptance_ids.join(', ')}\nInterfaces:\n${l.interfaces}`

const runLanes = A.onlyLanes ? plan.lanes.filter(l => A.onlyLanes.includes(l.id)) : plan.lanes
if (!runLanes.length) throw new Error('onlyLanes matched no lane')

// Records blob hashes of test files so later edits are caught even when nobody reports them.
async function hashTests(label, ph, files) {
  const r = await agent(
    'From the repository root run `git hash-object -- <file>` for each file below and return path and hash; use ' +
    `hash "missing" for a file that does not exist. Change nothing.\nFiles:\n${files.join('\n')}`,
    { label, phase: ph, schema: HASHES, model: M.guard, agentType: 'Explore' })
  return r ? new Map(r.hashes.map(h => [norm(h.path), h.hash.trim()])) : null
}

// ---- Build. Barrier on purpose: every lane's code and blind tests exist before any lane is
// reviewed, so no review runs against another lane's half-written implementation.
const built_ = await parallel(runLanes.map(lane => async () => {
    const [impl, tests] = await parallel([
      () => agent(
        `${CTX}\n\nApproach:\n${APPROACH}\n\n${SPEC}\n\nAll lane interfaces:\n${INTERFACES}\n\n${laneSpec(lane)}\n\n` +
        `Implement this lane, honouring its interfaces exactly. Edit ONLY the files this lane owns (create them if ` +
        `listed); not test files, not integration files, not other lanes' files. Run a quick compile/type check of ` +
        `your files. Set status blocked (with the reason in summary) if you cannot finish. ${NO_GIT}`,
        { label: `impl:${lane.id}`, phase: 'Build', schema: WORK, model: M.build }),
      () => agent(
        `${SPEC}\n\n${laneSpec(lane)}\n\n${BASELINE}\n\n` +
        `Write acceptance and property-style tests for this lane from the spec and interfaces ONLY. Do NOT open the ` +
        `lane's implementation files (${lane.files.join(', ')}), even if they appear; you may read existing test ` +
        `helpers. Edit only the listed test files. In covers, map every acceptance id of this lane to the test that ` +
        `checks it. Do not run the tests (the implementation is being written in parallel). ${NO_GIT}`,
        { label: `tests:${lane.id}`, phase: 'Build', schema: WORK, model: M.build }),
    ])
    return { impl, tests }
}))
const runTestFiles = runLanes.flatMap(l => l.test_files)
const testSnapshot = await hashTests('snapshot-tests', 'Build', runTestFiles)

const lanes = await pipeline(runLanes,
  async (lane, _orig, i) => {
    const built = built_[i] || { impl: null, tests: null }
    const base = { id: lane.id, impl: built.impl, tests: built.tests }
    if (!built.impl || !built.tests) return { ...base, status: 'failed', reason: 'implementer or tester returned nothing' }
    if (built.impl.status === 'blocked' || built.tests.status === 'blocked')
      return { ...base, status: 'blocked', reason: [built.impl, built.tests].filter(w => w.status === 'blocked').map(w => w.summary).join(' | ') }

    const coveredIds = new Set((built.tests.covers || []).map(c => c.acceptance_id))
    const untested = lane.acceptance_ids.filter(id => !coveredIds.has(id))
    const history = [], testChanges = []
    let open = [], loops = 0, reason = null, unverified = false
    for (;;) {
      const prompt = `${SPEC}\n\n${laneSpec(lane)}\n\n${BASELINE}\n\n` +
        `Review this lane's files (git diff plus the files) for categories ${lane.categories.join(', ')} only, and ` +
        `run ONLY the lane test command. Other lanes' fixers may be editing this checkout: do not run the full ` +
        `suite and ignore failures outside this lane's files. Report this lane's failing tests as findings too.` +
        (untested.length ? ` These acceptance ids have no blind test: ${untested.join(', ')}; report one CONTRACT finding per id the code does not clearly meet.` : '') +
        (history.length ? `\n\nAlready handled in earlier rounds (do not re-report rejected ones without new evidence):\n${J(history)}` : '') +
        (testChanges.length ? `\n\nTests changed by the fixer so far (check none was weakened to hide a bug):\n${J(testChanges)}` : '') +
        `\n\nAt most 5 findings, each with a concrete trigger. No style comments. Empty list if clean.`
      let r = await agent(prompt, { label: `review:${lane.id}#${loops}`, phase: 'Build', schema: FINDINGS, model: M.review, agentType: 'Plan' })
      if (!r) r = await agent(prompt, { label: `review:${lane.id}#${loops}-retry`, phase: 'Build', schema: FINDINGS, model: M.review, agentType: 'Plan' })
      if (!r) { unverified = true; break }
      open = r.findings
      if (!open.length || loops >= MAX_FIX_LOOPS) break
      loops++
      const fx = await agent(
        `${SPEC}\n\n${laneSpec(lane)}\n\nFindings to fix:\n${J(open)}\n\n` +
        `For each finding first confirm it with a failing test or reproduction; mark ones that do not reproduce as ` +
        `rejected. Return resolved with an outcome per finding. ${TEST_RULE} Edit only this lane's files and test ` +
        `files; run only the lane test command. ${NO_GIT}`,
        { label: `fix:${lane.id}#${loops}`, phase: 'Build', schema: WORK, model: M.build })
      if (!fx) { reason = 'fixer returned nothing'; break }
      history.push(...(fx.resolved || []))
      testChanges.push(...(fx.test_changes || []).map(c => ({ ...c, file: norm(c.file) })))
      if (fx.status === 'blocked') { reason = `fixer blocked: ${fx.summary}`; break }
    }
    const status = unverified ? 'unverified' : reason ? 'blocked' : open.length ? 'open_findings'
      : untested.length ? 'incomplete' : 'clean'
    return { ...base, status, reason, fix_loops: loops, open_findings: open, untested_acceptance: untested,
             history, test_changes: testChanges }
  })
const laneResults = lanes.map((l, i) => l || { id: runLanes[i].id, status: 'failed', reason: 'lane stage threw' })

// Test files whose content differs from the post-build snapshot. `null` means unknown.
const editedTests = h => testSnapshot && h ? runTestFiles.filter(f => h.get(f) !== testSnapshot.get(f)) : null
const testChangeFiles = () => new Set(allTestChanges.map(c => norm(c.file)))
const BASE = preGit && preGit.head ? `the base commit ${preGit.head}` : 'HEAD'

// ---- Integrate
const allTestChanges = laneResults.flatMap(l => (l.test_changes || []).map(c => ({ lane: l.id, ...c })))
const integ = await agent(
  `${SPEC}\n\nAll lane interfaces:\n${INTERFACES}\n\nIntegration files (yours to edit): ${(plan.integration_files || []).join(', ') || 'none'}\n` +
  `${BASELINE}\n\nAll lanes are built. Run the full test suite (${scout.test_command}) and any type check/lint the ` +
  `project has. Fix integration breaks only (wiring, imports, interfaces between lanes); do not redesign. ` +
  `${TEST_RULE} Set status blocked if the suite still has new failures. Report what failed and what you changed. ${NO_GIT}`,
  { label: 'integrate', phase: 'Integrate', schema: WORK, model: M.integrate })
if (integ) allTestChanges.push(...(integ.test_changes || []).map(c => ({ lane: 'integration', ...c, file: norm(c.file) })))

// ---- Final review
const untestedAll = laneResults.flatMap(l => l.untested_acceptance || [])
const midEdited = editedTests(await hashTests('hash-before-review', 'Final review', runTestFiles))
const final = await agent(
  `${CTX}\n\n${SPEC}\n\n${BASELINE}\n\nAdversarially review everything changed since ${BASE} (git diff against it, ` +
  `plus untracked files) against the acceptance criteria and invariants. Hunt for silent wrong results, missed ` +
  `acceptance criteria, security and data-loss risks, and test tampering: deleted or skipped tests, weakened ` +
  `assertions, tests rewritten to match the code.` +
  (midEdited && midEdited.length ? `\nTest files edited after the blind tests were written: ${midEdited.join(', ')}` : '') +
  (allTestChanges.length ? `\nReasons given for test edits:\n${J(allTestChanges)}` : '') +
  (untestedAll.length ? `\nAcceptance ids without a blind test: ${untestedAll.join(', ')}` : '') +
  `\nRun the tests if useful. At most 8 findings, each with a concrete trigger; empty if clean.`,
  { label: 'final-review', phase: 'Final review', schema: FINDINGS, model: M.final, agentType: 'Plan' })

let finalFix = null
const serious = final ? final.findings.filter(f => f.severity !== 'minor') : []
if (serious.length) {
  finalFix = await agent(
    `${SPEC}\n\n${BASELINE}\n\nFix these review findings. Confirm each with a failing test first; mark ` +
    `non-reproducing ones rejected in resolved. ${TEST_RULE} Then run the full suite (${scout.test_command}).\n` +
    `${J(serious)}\n${NO_GIT}`,
    { label: 'final-fix', phase: 'Final review', schema: WORK, model: M.build })
  if (finalFix) allTestChanges.push(...(finalFix.test_changes || []).map(c => ({ lane: 'final-fix', ...c, file: norm(c.file) })))
}

// ---- Verify: always an independent full-suite run; no stage's own "done" is proof that tests pass.
const fixTestEdits = allTestChanges.filter(c => c.lane === 'final-fix')
const verify = await agent(
  `${SPEC}\n\n${BASELINE}\n\nRun the full suite (${scout.test_command}) and report every failure not in the ` +
  `baseline as a finding (category CONTRACT, severity major).` +
  (serious.length ? ` Then check each finding below against the current code and report those still present.\n` +
    `Findings:\n${J(serious)}\nThe fixer claimed:\n${J(finalFix ? finalFix.resolved || [] : [])}` : '') +
  (fixTestEdits.length ? `\nThe fixer edited tests; report any edit that weakens a check:\n${J(fixTestEdits)}` : '') +
  `\nEmpty list if the suite is green and nothing is still present.`,
  { label: 'verify', phase: 'Verify', schema: FINDINGS, model: M.verify, agentType: 'Plan' })
const finalOpen = verify ? verify.findings.filter(f => f.severity !== 'minor') : null

// ---- Scope check: HEAD and stashes unchanged, every changed file belongs to the plan, no test
// file deleted or renamed away, and every test edit since the snapshot was reported.
const after = await gitStatus('scope-check', 'Verify')
const endEdited = editedTests(await hashTests('hash-final', 'Verify', runTestFiles))
const allowed = new Set([...(plan.integration_files || []), ...plan.lanes.flatMap(l => [...l.files, ...l.test_files])])
const testFiles = new Set(plan.lanes.flatMap(l => l.test_files))
const isTest = f => testFiles.has(f) || /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\./.test(f)
const outOfScope = after ? after.entries.filter(e => !allowed.has(e.path) || (e.orig && !allowed.has(e.orig)))
  .map(e => `${e.status} ${e.orig ? `${e.orig} -> ` : ''}${e.path}`) : null
const deletedTests = after ? after.entries.flatMap(e => [
  ...(e.status.includes('D') && isTest(e.path) ? [e.path] : []),
  ...(e.orig && isTest(e.orig) ? [e.orig] : [])]) : null
const unreported = endEdited ? endEdited.filter(f => !testChangeFiles().has(f)) : null

// Lanes not rerun in an onlyLanes run keep their previous status, if the caller passed it.
const prevById = new Map((A.previousLanes || []).map(l => [l.id, l.status]))
const notRun = plan.lanes.filter(l => !runLanes.includes(l)).map(l => ({ id: l.id, status: prevById.get(l.id) || 'unknown (not rerun)' }))

const problems = []
for (const l of laneResults) if (l.status !== 'clean') problems.push(`lane ${l.id}: ${l.status}${l.reason ? ` (${l.reason})` : ''}`)
for (const l of notRun) if (l.status !== 'clean') problems.push(`lane ${l.id} (not rerun): ${l.status}`)
if (!integ) problems.push('integration: no result')
else if (integ.status !== 'done') problems.push(`integration blocked: ${integ.summary}`)
if (!final) problems.push('final review: no result')
if (serious.length && !finalFix) problems.push('final fix: no result')
if (!verify) problems.push('verify: no result')
else if (finalOpen.length) problems.push(`verify: ${finalOpen.length} serious finding(s) or new test failure(s) open`)
if (!after) problems.push('scope check: no result')
else {
  if (preGit && after.head !== preGit.head) problems.push(`HEAD moved from ${preGit.head} to ${after.head} (an agent committed)`)
  if (preGit && after.stash !== preGit.stash) problems.push('stash list changed (an agent stashed)')
}
if (outOfScope && outOfScope.length) problems.push(`changed outside the plan: ${outOfScope.join(', ')}`)
if (deletedTests && deletedTests.length) problems.push(`test files deleted or renamed away: ${deletedTests.join(', ')}`)
if (!testSnapshot || !endEdited) problems.push('test snapshot: no result, test edits unchecked')
else if (unreported.length) problems.push(`test files edited without a stated reason: ${unreported.join(', ')}`)
if (allTestChanges.length) log(`${allTestChanges.length} test edit(s) after blind tests; see test_changes`)

return {
  ok: problems.length === 0,
  problems,
  mode: MODE, models: M, scout, options, decision, plan,
  lanes: [...laneResults, ...notRun.map(l => ({ ...l, rerun: false }))],
  integration: integ,
  test_changes: allTestChanges,
  final_review: final ? final.findings : null,
  final_fix: finalFix,
  final_open: finalOpen,
  scope: { base: preGit && preGit.head, changed: after && after.entries, out_of_scope: outOfScope,
           deleted_tests: deletedTests, edited_tests: endEdited, unreported_test_edits: unreported },
}
