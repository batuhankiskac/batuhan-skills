// Scenario tests for workflows/team.js.
//
// The script is executed the way the Workflow runtime executes it (an async body with the
// runtime hooks as globals), but the hooks are fakes: agent() answers from a table keyed by
// the call's label. Every path is therefore deterministic and spends no tokens. What these
// tests can prove is the script's control flow and the exact prompt text each agent gets;
// they say nothing about how a real model reacts to that text.
//
//   node tests/team.test.mjs
//
// To prove that an edit left the prompts byte-identical, compare against an older copy:
//   git show HEAD:workflows/team.js > /tmp/team-old.js
//   TEAM_BASELINE=/tmp/team-old.js node tests/team.test.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const AsyncFunction = (async () => {}).constructor
const read = path => readFileSync(path, 'utf8')
const compile = src => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
  src.replace(/^export const meta\b/m, 'const meta'))

const SRC = read(new URL('../workflows/team.js', import.meta.url))
const team = compile(SRC)
const baseline = process.env.TEAM_BASELINE ? compile(read(process.env.TEAM_BASELINE)) : null

// ---- Fake runtime. Like the real hooks, parallel() and pipeline() turn a throw into null.
const settle = p => p.then(v => v, () => null)
const parallel = thunks => Promise.all(thunks.map(t => settle(Promise.resolve().then(t))))
const pipeline = (items, ...stages) => Promise.all(items.map((item, i) =>
  settle(stages.reduce((prev, stage) => prev.then(v => stage(v, item, i)), Promise.resolve(item)))))

// ---- Default answers: one lane, everything clean. A key answers every label it prefixes;
// the longest matching key wins, so 'review:L1#0' also covers 'review:L1#0-retry' unless
// that label has its own entry.
const LANE = { id: 'L1', goal: 'add a()', files: ['src/a.js'], test_files: ['tests/a.test.js'], interfaces: 'a(): number',
  test_command: 'node --test tests/a.test.js', acceptance_ids: ['A1'], categories: ['ERR'] }
const PLAN = { acceptance: [{ id: 'A1', text: 'a() returns 1' }], invariants: [], non_goals: [], integration_files: [], lanes: [LANE] }
const git = (entries, head = 'h0') => ({ not_git: false, head, stash_count: 0, entries })
const hashes = hash => ({ hashes: [{ path: 'tests/a.test.js', hash }] })
const work = (extra = {}) => ({ status: 'done', changed_files: [], summary: 'ok', ...extra })
const CLEAN = { findings: [] }
const BUG = { file: 'src/a.js', category: 'ERR', defect: 'returns 2', trigger: 'a()', severity: 'major' }
const FIXED = work({ resolved: [{ defect: 'returns 2', outcome: 'fixed' }] })
const PLANNED_DIFF = [{ status: ' M', path: 'src/a.js' }, { status: '??', path: 'tests/a.test.js' }]

const HAPPY = {
  'pre-check': git([]),
  'scout': { summary: 's', relevant_paths: ['src/a.js'], test_command: 'npm test', baseline_failures: [] },
  'idea:': { title: 't', approach: 'x', changes: [], risks: [], size: 'S' },
  'judge': { chosen_title: 't', rationale: 'r', merged_approach: 'do x' },
  'plan#': PLAN,
  'impl:': work({ changed_files: ['src/a.js'] }),
  'tests:': work({ changed_files: ['tests/a.test.js'], covers: [{ acceptance_id: 'A1', test: 't1' }] }),
  'snapshot-tests': hashes('s1'), 'hash-before-review': hashes('s1'), 'hash-final': hashes('s1'),
  'review:': CLEAN,
  'integrate': work(),
  'final-review': CLEAN,
  'verify': CLEAN,
  'scope-check': git(PLANNED_DIFF),
}
// Reaches the call sites the clean run skips: the review retry, the lane fixer, the final fixer.
const BUSY = {
  'review:L1#0': null, 'review:L1#0-retry': { findings: [BUG] }, 'fix:': FIXED, 'review:L1#1': CLEAN,
  'final-review': { findings: [BUG] }, 'final-fix': FIXED,
}

async function run(args = {}, overrides = {}, script = team) {
  const table = { ...HAPPY, ...overrides }
  const calls = [], phases = [], logs = [], unanswered = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt, opts })
    const key = Object.keys(table).filter(k => opts.label.startsWith(k)).sort((a, b) => b.length - a.length)[0]
    if (key === undefined) { unanswered.push(opts.label); return null }
    // Cloned because the script normalises plans in place.
    const answer = structuredClone(typeof table[key] === 'function' ? table[key](prompt, opts) : table[key])
    // A guard agent that works where it was told reports that checkout as git's top level;
    // a scenario sets toplevel itself to play a guard that ran somewhere else.
    if (answer && opts.schema?.required?.includes('toplevel') && answer.toplevel === undefined)
      answer.toplevel = args.repo.replace(/\/+$/, '')
    return answer
  }
  let result, error
  try {
    result = await script({ task: 'Add a() that returns 1', ...args }, agent, parallel, pipeline,
      t => phases.push(t), m => logs.push(m), { total: null, spent: () => 0, remaining: () => Infinity }, null)
  } catch (e) { error = e }
  assert.deepEqual(unanswered, [], 'the fake answer table is missing these labels')
  return { result, error, calls, phases, logs, labels: calls.map(c => c.label) }
}

// One name per agent call site in team.js, derived from the label that site uses.
const site = label => /^(pre|scope)-check$/.test(label) ? 'git-status'
  : /^(snapshot-tests$|hash-)/.test(label) ? 'hash-tests'
  : /-retry$/.test(label) ? 'review-retry'
  : label.replace(/[:#].*$/, '')
const CODE = SRC.replace(/^\s*\/\/.*$/gm, '')   // whole-line comments out, so prose cannot count as a call
const count = re => (CODE.match(re) || []).length

const REPO = '/work/target-wt'
const GUARD = 'Never read or write under /work/target-live; launchd runs that checkout every 10 minutes.'
const SEP = '\n\n---\n\n'
const blockOf = prompt => prompt.slice(0, prompt.indexOf(SEP) + SEP.length)
const problems = r => (r.result.problems || []).join(' | ')
// With repo, a guard prompt differs from its plain twin in two declared ways only: its git
// commands name the checkout, and the answer must carry the top level git saw.
const GIT_AT = ` -C '${REPO}'`
const WHERE = ` Also return toplevel: the output of \`git${GIT_AT} rev-parse --show-toplevel\`, "" if it fails.`
const isGuard = c => ['git-status', 'hash-tests'].includes(site(c.label))
function assertTwin(located, plain) {
  const block = blockOf(located.prompt)
  let body = located.prompt.slice(block.length)
  if (isGuard(located)) {
    assert.ok(body.includes(WHERE), `${located.label}: no toplevel request`)
    assert.ok(!/`git (?!-C )/.test(body), `${located.label}: a git command does not name the checkout`)
    body = body.replace(WHERE, '').replaceAll(GIT_AT, '')
    assert.ok(located.opts.schema.required.includes('toplevel') && !plain.opts.schema.required.includes('toplevel'), located.label)
    assert.deepEqual({ ...located.opts, schema: null }, { ...plain.opts, schema: null }, located.label)
  } else assert.deepEqual(located.opts, plain.opts, located.label)
  assert.equal(body, plain.prompt, located.label)
}
const laneStatus = r => r.result.lanes[0].status

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ---- Existing behaviour ------------------------------------------------------------------
test('full run with every stage clean is ok', async () => {
  const r = await run()
  assert.equal(r.error, undefined)
  assert.equal(r.result.ok, true, problems(r))
  assert.equal(laneStatus(r), 'clean')
  assert.deepEqual(r.phases, ['Check'])
})

test('a run with a review retry, a lane fix and a final fix still ends ok', async () => {
  const r = await run({}, BUSY)
  assert.equal(r.result.ok, true, problems(r))
  assert.equal(r.result.lanes[0].fix_loops, 1)
  assert.ok(r.result.final_fix)
})

test('design mode stops after the judge and never asks for git state', async () => {
  const r = await run({ mode: 'design' })
  assert.deepEqual(Object.keys(r.result), ['mode', 'scout', 'options', 'decision'])
  assert.deepEqual([...new Set(r.labels.map(site))], ['scout', 'idea', 'judge'])
})

test('outside a git repository the run stops at Check and points at args.repo', async () => {
  const r = await run({}, { 'pre-check': { not_git: true, head: '', stash_count: 0, entries: [] } })
  assert.match(r.error.message, /not a git repository/)
  assert.match(r.error.message, /pass args\.repo/)
  assert.deepEqual(r.labels, ['pre-check'])
})

test('a dirty tree before the run is refused', async () => {
  const r = await run({}, { 'pre-check': git([{ status: ' M', path: './notes.md' }]) })
  assert.match(r.error.message, /working tree not clean: notes\.md/)
})

test('build mode without a decision is refused', async () => {
  const r = await run({ mode: 'build' })
  assert.match(r.error.message, /build mode needs args\.decision/)
})

test('a plan that fails validation twice stops the run with the reasons', async () => {
  const r = await run({}, { 'plan#': { ...PLAN, lanes: [{ ...LANE, test_files: [] }] } })
  assert.match(r.error.message, /planner failed.*lane L1 has no test files/)
  assert.deepEqual(r.labels.filter(l => l.startsWith('plan#')), ['plan#0', 'plan#1'])
})

test('a review that returns nothing twice leaves the lane unverified, not passed', async () => {
  const r = await run({}, { 'review:L1#0': null })
  assert.equal(laneStatus(r), 'unverified')
  assert.equal(r.result.ok, false)
})

test('a blocked implementer blocks its lane', async () => {
  const r = await run({}, { 'impl:': work({ status: 'blocked', summary: 'missing dependency' }) })
  assert.equal(laneStatus(r), 'blocked')
  assert.match(problems(r), /lane L1: blocked \(missing dependency\)/)
})

test('findings that survive the fix loops stay open', async () => {
  const r = await run({}, { 'review:': { findings: [BUG] }, 'fix:': FIXED })
  assert.equal(laneStatus(r), 'open_findings')
  assert.equal(r.result.lanes[0].fix_loops, 2)
  assert.equal(r.result.ok, false)
})

test('a missing verify result is a problem, not a pass', async () => {
  const r = await run({}, { 'verify': null })
  assert.match(problems(r), /verify: no result/)
  assert.equal(r.result.ok, false)
})

test('a file changed outside the plan fails the scope check', async () => {
  const r = await run({}, { 'scope-check': git([...PLANNED_DIFF, { status: ' M', path: 'README.md' }]) })
  assert.match(problems(r), /changed outside the plan: M README\.md/)
})

test('a commit made by an agent (HEAD moved) is reported', async () => {
  const r = await run({}, { 'scope-check': git(PLANNED_DIFF, 'h1') })
  assert.match(problems(r), /HEAD moved from h0 to h1/)
})

test('a test file edited after the snapshot without a stated reason is reported', async () => {
  const r = await run({}, { 'hash-final': hashes('s2') })
  assert.match(problems(r), /edited without a stated reason: tests\/a\.test\.js/)
})

test('a hash answer that leaves a test file out is unknown, never "unchanged"', async () => {
  // The file is edited (s1 -> s2) but each answer below hides it from both snapshots.
  const answers = { renamed: h => ({ hashes: [{ path: 'a.test.js', hash: h }] }), empty: () => ({ hashes: [] }),
    blank: () => hashes('  ') }
  for (const [kind, answer] of Object.entries(answers)) {
    const r = await run({}, { 'snapshot-tests': answer('s1'), 'hash-before-review': answer('s1'), 'hash-final': answer('s2') })
    assert.match(problems(r), /test snapshot: no complete result, test edits unchecked/, kind)
    assert.equal(r.result.ok, false, kind)
    assert.ok(r.logs.some(l => /no hash for tests\/a\.test\.js/.test(l)), kind)
  }
  // One incomplete answer at the end is enough to leave the edits unchecked.
  const late = await run({}, { 'hash-final': { hashes: [] } })
  assert.equal(late.result.ok, false)
  assert.match(problems(late), /test snapshot: no complete result/)
})

test('a planned test file that does not exist after the build is a problem', async () => {
  // Also what a hash agent working in the wrong directory looks like: "missing" every time.
  const r = await run({}, { 'snapshot-tests': hashes('missing'), 'hash-before-review': hashes('missing'), 'hash-final': hashes('missing') })
  assert.match(problems(r), /planned test files did not exist after the build: tests\/a\.test\.js/)
  assert.equal(r.result.ok, false)
})

test('edits the builders reported but git status does not show are a problem', async () => {
  const r = await run({}, { 'scope-check': git([]) })
  assert.match(problems(r), /agents reported changed files but git status shows none/)
  assert.equal(r.result.ok, false)
})

test('a git answer that cannot be trusted stops the run at Check but never throws at the end', async () => {
  const notGit = { not_git: true, head: '', stash_count: 0, entries: [] }
  const noHead = await run({}, { 'pre-check': git([], ' ') })
  assert.match(noHead.error.message, /no HEAD commit/)
  for (const [kind, answer] of [['not a repository', notGit], ['no HEAD', git(PLANNED_DIFF, '')]]) {
    const r = await run({}, { 'scope-check': answer })
    assert.equal(r.error, undefined, kind)
    assert.match(problems(r), /scope check: no result/, kind)
    assert.equal(r.result.ok, false, kind)
    assert.equal(r.result.lanes[0].status, 'clean', `${kind}: the run's results survive`)
  }
})

// ---- repo / guard ------------------------------------------------------------------------
test('repo set: every prompt, at every agent call site, starts with the checkout block', async () => {
  const r = await run({ repo: REPO }, BUSY)
  assert.equal(r.result.ok, true, problems(r))
  const blocks = new Set(r.calls.map(c => blockOf(c.prompt)))
  assert.equal(blocks.size, 1, 'all agents get the same block')
  const [block] = blocks
  assert.ok(block.endsWith(SEP) && block.length > SEP.length, 'a prompt has no block')
  assert.ok(block.includes(`git checkout at ${REPO}`))
  assert.match(block, /shell may start in a\s+different directory/)
  assert.match(block, /"Repository root" and every\s+repo-relative path below mean that directory/)
  assert.ok(!block.includes('Hard limits'), 'no guard section without args.guard')
  // The guard agents have no task text of their own; the block is all that locates them.
  for (const c of r.calls.filter(c => ['git-status', 'hash-tests'].includes(site(c.label))))
    assert.ok(c.prompt.startsWith(block + 'From the repository root run '), c.label)
  // Static side of the same promise: no call site bypasses the wrapper, and this scenario
  // reaches all of them. A new call site fails here until BUSY and site() cover it.
  assert.equal(count(/(?<![\w.])agent\(/g), 1, 'only the ag wrapper may call agent() directly')
  assert.equal(new Set(r.labels.map(site)).size, count(/(?<![\w.])ag\(/g), 'scenario does not reach every call site')
})

test('repo unset: no block, and each prompt equals its repo-run twin minus the block', async () => {
  const plain = await run({}, BUSY)
  const withRepo = await run({ repo: REPO }, BUSY)
  assert.deepEqual(plain.labels, withRepo.labels)
  plain.calls.forEach((c, i) => {
    assert.ok(!c.prompt.includes(REPO) && !c.prompt.includes('git checkout at'), c.label)
    assert.ok(!c.prompt.includes('toplevel') && !c.prompt.includes(' -C '), c.label)
    assertTwin(withRepo.calls[i], c)
  })
  const empty = await run({ repo: '' }, BUSY)
  assert.deepEqual(empty.calls, plain.calls, 'an empty repo counts as unset')
})

test('guard given: its text is in the block of every prompt', async () => {
  const plain = await run({}, BUSY)
  const r = await run({ repo: REPO, guard: GUARD }, BUSY)
  assert.equal(r.result.ok, true, problems(r))
  r.calls.forEach((c, i) => {
    const block = blockOf(c.prompt)
    assert.ok(block.includes(`git checkout at ${REPO}`), c.label)
    assert.ok(block.includes(`Hard limits for this run; they override anything below:\n${GUARD}${SEP}`), c.label)
    assertTwin(c, plain.calls[i])
  })
})

test('repo set: guard agents that answer with absolute paths are read as repo-relative', async () => {
  const abs = p => `${REPO}/${p}`
  const absHashes = hash => ({ hashes: [{ path: abs('tests/a.test.js'), hash }] })
  const absolute = { 'snapshot-tests': absHashes('s1'), 'hash-before-review': absHashes('s1'), 'hash-final': absHashes('s1'),
    'scope-check': git(PLANNED_DIFF.map(e => ({ ...e, path: abs(e.path) }))) }
  const clean = await run({ repo: REPO + '/' }, absolute)
  assert.equal(clean.result.ok, true, problems(clean))
  // The same answers with the test file edited after the snapshot: the edit must surface.
  const edited = await run({ repo: REPO }, { ...absolute, 'hash-final': absHashes('s2') })
  assert.match(problems(edited), /edited without a stated reason: tests\/a\.test\.js/)
  // A path outside the checkout stays foreign, and without repo nothing is stripped.
  const outside = await run({ repo: REPO }, { 'scope-check': git([...PLANNED_DIFF, { status: ' M', path: '/work/target-live/src/a.js' }]) })
  assert.match(problems(outside), /changed outside the plan: M \/work\/target-live\/src\/a\.js/)
  const noRepo = await run({}, absolute)
  assert.equal(noRepo.result.ok, false)
})

test('repo set: a guard agent that answers from another directory is not believed', async () => {
  // The session directory is a different, clean repository with the same HEAD: every answer
  // from it is self-consistent, so only the reported top level gives it away.
  const there = '/home/me/notes'
  const atCheck = await run({ repo: REPO }, { 'pre-check': { ...git([]), toplevel: there } })
  assert.match(atCheck.error.message, /git answered from \/home\/me\/notes, not from args\.repo \/work\/target-wt/)
  assert.deepEqual(atCheck.labels, ['pre-check'])

  for (const toplevel of [there, '', REPO + '/sub']) {
    const status = await run({ repo: REPO }, { 'scope-check': { ...git([]), toplevel } })
    assert.match(problems(status), /scope check: no result/, toplevel)
    assert.equal(status.result.ok, false, toplevel)

    const gone = { ...hashes('missing'), toplevel }
    const hash = await run({ repo: REPO }, { 'snapshot-tests': gone, 'hash-before-review': gone, 'hash-final': gone })
    assert.match(problems(hash), /test snapshot: no complete result, test edits unchecked/, toplevel)
    assert.equal(hash.result.ok, false, toplevel)
  }
  // Only the last guard is wrong: the run still must not pass.
  const late = await run({ repo: REPO }, { 'hash-final': { ...hashes('s1'), toplevel: there } })
  assert.equal(late.result.ok, false)
  // A repo path that needs shell quoting is quoted in the commands the guards are given.
  const odd = await run({ repo: "/work/it's here" })
  assert.equal(odd.result.ok, true, problems(odd))
  assert.ok(odd.calls[0].prompt.includes(`\`git -C '/work/it'\\''s here' rev-parse HEAD\``))
})

test('a guard without repo, or a repo that is not an absolute path, is refused before any agent runs', async () => {
  const lone = await run({ guard: GUARD })
  assert.match(lone.error.message, /args\.guard is only sent together with args\.repo/)
  const relative = await run({ repo: 'target-wt' })
  assert.match(relative.error.message, /args\.repo must be the absolute path/)
  assert.deepEqual([...lone.calls, ...relative.calls], [])
})

if (baseline) test('without repo, prompts and agent options are byte-identical to TEAM_BASELINE', async () => {
  for (const [args, over] of [[{}, {}], [{}, BUSY], [{ mode: 'design' }, {}], [{ cheap: true, maxFixLoops: 0 }, BUSY]]) {
    const now = await run(args, over), then = await run(args, over, baseline)
    assert.deepEqual(now.calls, then.calls)
    assert.ok(now.calls.length > 0)
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok    ${name}`) }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`) }
}
console.log(`\n${tests.length - failed}/${tests.length} scenarios passed`)
if (failed) process.exitCode = 1
